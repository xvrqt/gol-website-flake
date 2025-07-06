export const fragment_shader_source = `#version 300 es 
precision highp float;

#define PI 3.1415926535
#define RGB /255.0 // e.g. 255.0 RGB -> (255.0 / 255.0) -> 1.0
#define VIEW_SCALE 80.0 // Area we draw over (e.g. [-4, 4])

// RAY MARCHING SETTINGS
//////////////////////////
#define MAX_STEPS 10000
// If our step is below this, we end the march
#define MARCH_ACCURACY 1e-3
// Beyond this distance we stop the march
#define MAX_MARCH_DISTANCE VIEW_SCALE*9.0
// Where to initialize rays from 
#define DEFAULT_RAY_ORIGIN  vec3(0.0, 0.0, -VIEW_SCALE)

////////////////////
// CUSTOM STRUCTS //
////////////////////

// An "Object" in our scene
// SceneObj.types
#define OBJ_GROUND 0
#define OBJ_BLOCK 1
struct SceneObj {
  // How far the object is from the ray origin
  float dist;
  // Type of Object determines it material
  // -1 -> Nothing
  //  0 -> Ground Plane
  //  1 -> Block
  int type;
  // Each block has a unique ID to identify it
  int id;
  // Center of the object
  vec3 loc;
};

// Cook-Torrance BRDF Material Model
#define GROUND_PLANE_MATERIAL 0
#define BLOCK_MATERIAL 1
#define BLOCK_ACTIVE_MATERIAL 2
struct PBRMat {
  vec3 color;
  float metallic;
  float roughness;
  float reflectance;
  float emissive;
  float ambient_occlusion;
};
PBRMat materials[3] = PBRMat[3](
    // Ground Plane
    PBRMat(
        // vec3(23.0 RGB, 238.0 RGB, 232.0 RGB),
        vec3(0.95),
        0.0,
        0.2,
        0.1,
        0.2,
        0.3
    ),
    // Block (Inactive)
    PBRMat(
        vec3(0.05),
        1.0,
        0.1,
        0.9,
        0.0,
        0.3
    ),
    // Block (Active)
    PBRMat(
        vec3(255.0 RGB, 105.0 RGB, 180.0 RGB),
        0.0,
        0.9,
        0.9,
        9.0,
        0.3
    )
);

// A vector/ray that is cast/marched 
struct Ray {
  vec3 origin; 
  vec3 direction; 
};

// Where a ray of light has struck an object
struct Surface {
  vec3 position;
  vec3 normal; 
  PBRMat material; 
};

// A light source in the scene
#define DIRECTIONAL_LIGHT 0
#define POSITIONAL_LIGHT 1
struct Light 
{
    // 0 -> Directional Light
    // 1 -> Point Light
    int type; 

    // 'position' for a point light
    // 'direction' vector for directional light
    vec3 pos_dir_vec;
    vec3 color; 
    float intensity;
};

// Initialize Global Lights
// White directional light, pointing away from camera
// Follows cursor 
Light lights[1] = Light[1](
    Light( 
        POSITIONAL_LIGHT, 
        vec3(0.0, 0.0, -70.0), 
        vec3(1.0), 
        1024.0));

//////////////
// UNIFORMS //
//////////////

// The size of the screen in pixels
uniform vec2 resolution;
// Elapsed time in miliseconds 
uniform float time;
// Mouse Position (st)
uniform vec2 mouse;
// Grid Dimensions
uniform ivec2 grid_dimensions;
// Brightness coefficient
uniform float blend_ce;
// Color shift the active blocks
uniform float color_shift;

// Need to pack into a vector because the layout is 64 bit aligned
// ergo u32's waste 75% of their memory on their stride
// Cells are represented as u8s, packed 4 cells into a u32 and 4 u32's into 
// a uvec4; implying that uvec4 cells[1024] holds 16,384 cells, enough for
// 128x128 grids (this also fits on my iPhone's Uniform Block maz size limit)
uniform Cells {
    uniform uvec4 cells[1024];
};

/////////////
// HELPERS //
/////////////

// Returns, as a uint, the value of the bits starting at 'offset'
// and ending at 'offset + n' from the 'value' passed in
// Used for extracing Cell state from packed u32's
uint getbits(uint value, uint offset, uint n) {
  uint max_n = 32u;
  if (offset >= max_n)
    return 0u; /* value is padded with infinite zeros on the left */
  value >>= offset; /* drop offset bits */
  if (n >= max_n)
    return value; /* all  bits requested */
  uint mask = (1u << n) - 1u; /* n '1's */
  return value & mask;
}

vec3 rgb2hsv(vec3 c) {
    vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
    vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));

    float d = q.x - min(q.w, q.y);
    float e = 1.0e-10;
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}


///////////
// SETUP //
///////////

// Blocks are N times the size of the space between them
#define GUTTER_RATIO 3.0
// Corners & Edges of blocks are rounded at 50%
#define ROUNDING_RATIO 0.5

// Spacing between blocks (will be updated)
float GRID_GUTTER_SIZE = 0.0;
// Half the side length of a cube (will be updated)
float BLOCK_SIZE = 0.0;
// How the corners and edges of the boxes are rounds (will be updated)
float BLOCK_ROUNDING = 0.1;
void set_grid_dimensions(float ratio) {
  // Get minimum dimension
  int min_dim = min(grid_dimensions.x, grid_dimensions.y);
  float min_dimension = float(min_dim);
  // If the screen is taller than wide, don't resize blocks to fit
  float nom = VIEW_SCALE * min(ratio, 1.0); 
  // Screen needs to fit N blocks and N+1 gutters
  float denom = (min_dimension + 1.0) + (GUTTER_RATIO * min_dimension);

  BLOCK_SIZE = (nom * GUTTER_RATIO) / denom;
  BLOCK_ROUNDING = BLOCK_SIZE * ROUNDING_RATIO;
  GRID_GUTTER_SIZE = nom / denom;
}

/////////
// SDF //
/////////

// SDF for a Rounded Rectangle (used for GOL cells)
float sdRoundBox(vec3 p) {
  vec3 b = vec3(BLOCK_SIZE);
  vec3 q = abs(p) - b + BLOCK_ROUNDING;
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - BLOCK_ROUNDING;
}

// Takes in the repeating grid offset of the rounded rectangle SDF
// Returns the linear index into the GoL cells vector and is used
// for the SceneObj 'id' field
int calculateCellIndex(ivec2 id) {
  // Calculate Cell index that maps onto the GoL
  int x = ((grid_dimensions.x - 2) / 2) + id.x; 
  int y = (grid_dimensions.y / 2) - id.y; 
  return x + grid_dimensions.x * y;
}

// Returns the distance to closest block to point 'p' in the 
// grid of blocks.
SceneObj gol_grid_distance(vec3 position) {
  // Add the block size to the point to center it
  // Calculate spacing between block centers
  float spacing = 2.0 * BLOCK_SIZE + GRID_GUTTER_SIZE;
  // Round the position into discrete areas of space
  ivec2 id = ivec2(round(position.xy / spacing));
  // Determine if the area is above/below the axis line
  ivec2 o = sign(ivec2(position.xy - spacing) * id);
  float closest_distance = 1e20;
  // A 1D index of the block that maps onto the GoL simulation
  int index = 0;
  // We only need to check blocks in the x/y directions 
  ivec2 gd = grid_dimensions;
  // Center of the block
  vec3 block_location = vec3(0.0);
  // Block object we will return
  SceneObj block = SceneObj(1e20, OBJ_BLOCK, -1, vec3(0.0));
  for (int j = 0; j < 2; j++)
    for (int i = 0; i < 2; i++) 
       for (int k = 0; k <= 2; k = k + 2) {
      // ID of block to check if it's closer
      ivec2 rid = id + ivec2(i, j) * (k - 1);
      // Limit repetition to within the grid dimensions
      rid = clamp(rid, -(grid_dimensions - 2) / 2, grid_dimensions / 2);
      // Block center (subtract BLCOK_SIZE to center the grid)
      vec3 location = spacing * vec3(rid, 0.0) - BLOCK_SIZE;

      // Adjust position of some blocks based on id
      // Max displacement can only be half a block before a repeating SDF breaks down
      float a = 0.5 * BLOCK_SIZE * sin(float(length(vec2(rid) - 0.5)) + time * 0.001);
      location.z += a;

      float block_distance = sdRoundBox(position - location); 

      // Update block we will be returning
      if (block_distance < block.dist) {
        block.dist = block_distance;
        block.id = calculateCellIndex(rid);
        block.loc = location;
      }
    }

  return block; 
}

// Distance from the ground plane
#define GROUND_PLANE_LOCATION 0.0
SceneObj ground_plane_distance(vec3 p) {
  float distance = abs(p.z - GROUND_PLANE_LOCATION);
  return SceneObj(distance, OBJ_GROUND, -1, vec3(p.xy, GROUND_PLANE_LOCATION));
}

// Closest object in the scene, from point 'position'
SceneObj nearestObject(vec3 position) {
  SceneObj block = gol_grid_distance(position);
  SceneObj ground = ground_plane_distance(position);
  if (block.dist < ground.dist) {
    return block;
  } else {
    return ground; 
  }
}

// Approximates a normal vector using SDF
#define EPS_GRAD 0.001
vec3 computeSDFGrad(SceneObj is, vec3 p) {
    // Ground has trivial normal
    if(is.type == OBJ_GROUND) { return vec3(0.0, 0.0, -1.0); }
    // If the point is touching the top of the block
    // AND if the point is not part of the rounding
    float margin = 2.0 * BLOCK_SIZE + GRID_GUTTER_SIZE;
    bool x_check = abs(is.loc.x - p.x) < margin;
    bool y_check = abs(is.loc.y - p.y) < margin;
    bool z_check = abs(is.loc.z - p.z) < margin;

    bool x_test = (y_check && z_check);
    bool y_test = (x_check && z_check);
    bool z_test = (y_check && x_check);
    float offset = 0.01;
    if(is.loc.z - BLOCK_SIZE > p.z - offset && z_test) { return vec3(0.0, 0.0, -1.0); }
    else if(is.loc.z + BLOCK_SIZE <= p.z + offset && z_test) { return vec3(0.0, 0.0, 1.0); }
    else if(is.loc.y - BLOCK_SIZE > p.y - offset && y_test) { return vec3(0.0, -1.0, 0.0); }
    else if(is.loc.y + BLOCK_SIZE <= p.y + offset && y_test) { return vec3(0.0, 1.0, 0.0); }
    else if(is.loc.x - BLOCK_SIZE > p.x - offset && x_test) { return vec3(-1.0, 0.0, 0.0); }
    else if(is.loc.x + BLOCK_SIZE <= p.x + offset && x_test) { return vec3(1.0, 0.0, 0.0); }
    else {
        vec3 p_x_p = p + vec3(EPS_GRAD, 0, 0);
        vec3 p_x_m = p - vec3(EPS_GRAD, 0, 0);
        vec3 p_y_p = p + vec3(0, EPS_GRAD, 0);
        vec3 p_y_m = p - vec3(0, EPS_GRAD, 0);
        vec3 p_z_p = p + vec3(0, 0, EPS_GRAD);
        vec3 p_z_m = p - vec3(0, 0, EPS_GRAD);

        float sdf_x_p = sdRoundBox(p_x_p - is.loc);
        float sdf_x_m = sdRoundBox(p_x_m - is.loc);
        float sdf_y_p = sdRoundBox(p_y_p - is.loc);
        float sdf_y_m = sdRoundBox(p_y_m - is.loc);
        float sdf_z_p = sdRoundBox(p_z_p - is.loc);
        float sdf_z_m = sdRoundBox(p_z_m - is.loc);

        return vec3(sdf_x_p - sdf_x_m
                ,sdf_y_p - sdf_y_m
                ,sdf_z_p - sdf_z_m) / (2.0 * EPS_GRAD);
    }

}

////////////
// LIGHTS //
////////////

// Distance from a point to a light
float light_dist(vec3 position, Light light) 
{ 
    // Directional Lights are 'infinitely' far away
    float distance = 1e20;
    // Point Light
    if(light.type == POSITIONAL_LIGHT) { distance = length(light.pos_dir_vec - position); }
    return distance;
}

// Normalized vector from a position towards a light
Ray light_ray(vec3 position, Light light) {
    vec3 direction = vec3(0.0);
    if(light.type == DIRECTIONAL_LIGHT) { 
        direction = normalize(light.pos_dir_vec);
    } else if(light.type == POSITIONAL_LIGHT) { 
        direction = normalize(light.pos_dir_vec - position);
    }
    return Ray(position, direction);
}

// Intensity of a light source at a position
vec3 light_radiance(Light light, vec3 position) {
    float intensity_at_point = 1.0; // Default for directional lights
    if (light.type > 0) { // Doesn't apply to directional light
        float light_distance = light_dist(position, light);
        intensity_at_point = light.intensity / pow((light_distance + 1.0), 2.0);
    }
    return light.color * intensity_at_point;
}

void updateLightPositions(float res_ratio) {
  // Update the position of the spot light
  lights[0].pos_dir_vec.x = mouse.x * VIEW_SCALE * max(1.0, res_ratio);
  lights[0].pos_dir_vec.y = mouse.y * VIEW_SCALE * max(1.0, 1.0 / res_ratio);
}

///////////////
// MATERIALS //  
///////////////

// Interpolates between two materials
PBRMat blend_materials(float x, PBRMat mat_a, PBRMat mat_b) {
  return PBRMat(
    mix(mat_a.color, mat_b.color, vec3(x)),
    mix(mat_a.metallic, mat_b.metallic, x),
    mix(mat_a.roughness, mat_b.roughness, x),
    mix(mat_a.reflectance, mat_b.reflectance, x),
    mix(mat_a.emissive, mat_b.emissive, x),
    mix(mat_a.ambient_occlusion, mat_b.ambient_occlusion, x)
  );
}

// 4 Cell states are packed into a single u32
#define ID_PACK_RATIO 4u
uint getCellValue(uint id) {
    uint v_id = id / (ID_PACK_RATIO * ID_PACK_RATIO);
    uint u8_id = (id % (ID_PACK_RATIO * ID_PACK_RATIO)) / ID_PACK_RATIO;
    uint offset = id % ID_PACK_RATIO;
    offset = offset * 7u + offset;
    return getbits(cells[v_id][u8_id], offset, 8u);
}

#define ALIVE 7u
#define DEAD 0u
PBRMat getObjectMaterial(int type, int id) {
    // Default to ground plane
    PBRMat material = materials[GROUND_PLANE_MATERIAL];
    // Blocks
    if (type == OBJ_BLOCK) {
        uint cell = getCellValue(uint(id));
            PBRMat alive = materials[BLOCK_ACTIVE_MATERIAL]; 
            float sin_at = sin(color_shift);
            float cos_at = cos(color_shift);
            float angle = (atan(sin_at, cos_at) / (2.0 * PI)) + 0.5;
            vec3 color = vec3(angle, 0.9, 0.9);
            alive.color = hsv2rgb(color);
            
            PBRMat fade = materials[BLOCK_ACTIVE_MATERIAL];
            color.r += 0.05;
            color.r = fract(color.r);
            fade.color = hsv2rgb(color);

            PBRMat dead = materials[BLOCK_MATERIAL];

        if (cell == ALIVE) {
            material = alive;
        } else if (cell == DEAD) {
            material = dead;
        } else {
            float blend = clamp(blend_ce, 0.0, 1.0);
            if (cell == 1u) { // Growing
                if (blend < 0.85) {
                  blend = mix(0.0, 0.5, blend);
                  material = blend_materials(blend, dead, fade);
                } else { 
                  blend = mix(0.5, 1.0, blend);
                  material = blend_materials(blend, fade, alive); 
                }
            } else { // Dying 
              material = blend_materials(blend, alive, dead);
            }
        }
    }
    return material;
}

//////////////////
// RAY MARCHING //
//////////////////

// Generates a ray direction from fragment coordinates
// The initial Ray we begin to march
Ray generatePerspectiveRay(vec2 resolution, vec2 fragCoord) {
  // Normalized Coordinates [-1,1]
  vec2 st = ((gl_FragCoord.xy * 2.0) - resolution.xy) / resolution.y;
  // Ray Direction (+z is "into the screen")
  vec3 rd = normalize(vec3(st, 1.0));
  return Ray(DEFAULT_RAY_ORIGIN, rd);
}

// Move a ray forward until it intersects with an object
SceneObj ray_march(in Ray ray) {
    float distance = 0.0;
    for (int i = 0; i < MAX_STEPS; i++) {
      // Find the closest object to the ray
      vec3 position = ray.origin + (distance * ray.direction);
	  SceneObj object = nearestObject(position);

      // Struck and Object
	  if (object.dist <= MARCH_ACCURACY) {
        object.dist = distance;
        return object;
	  } else if (distance > MAX_MARCH_DISTANCE) { // Too far!
	    return SceneObj(MAX_MARCH_DISTANCE,-1,-1, vec3(0.0));
	  } else { // Keep marching forward
	    distance += object.dist;
      }
    }
    // If the ray doesn't hit anything
    return SceneObj(MAX_MARCH_DISTANCE,-1,-1, vec3(0.0));
}

///////////////////
// COOK-TORRANCE //
///////////////////

// Shadowing, Masking for specular reflection
float V_SmithGGXCorrelatedFast(float roughness, float LoN, float VoN) {
    float GGXV = LoN * (VoN * (1.0 - roughness) + roughness);
    float GGXL = VoN * (LoN * (1.0 - roughness) + roughness);
    return 0.5 / (GGXV + GGXL);
}

// Distribution of micro-facets
float D_GGX(float roughness, float NoH) {
    float a = NoH * roughness;
    float k = roughness / (1.0 - NoH * NoH + (a * a));
    return (k * k * (1.0 / PI));
}

// Fresnel term
vec3 F_Schlick(float VoH, vec3 f0, float f90) {
    return f0 + (vec3(f90) - f0) - pow(1.0 - VoH, 5.0);
}

// How much light from an emissive surface reaches a point
vec3 emissive_radiance(Surface surface, vec3 position) {
    float distance = distance(surface.position, position); 
    float intensity_at_point = surface.material.emissive / pow(distance + 1.0, 2.0);
    return surface.material.color * intensity_at_point;
}

// Physically based rendering for a 'surface', hit by a 'ray' from a 'light'
vec3 PBR(Surface surface, Ray ray, Light light, out float reflectance) {
    ///////////////////
    // Specular Term //
    ///////////////////
    vec3 f0 = vec3(0.16 * pow(surface.material.reflectance, 2.0)); // Achromatic dielectric approximation
    f0 = mix(f0, surface.material.color, surface.material.metallic); // Metals have chromatic reflections
    float f90 = 1.0; // Approximation

    vec3 surface_normal = surface.normal; // Shouldn't this already be normalized?
    vec3 view_direction = normalize(ray.origin - surface.position);
    vec3 light_direction = normalize(light_ray(surface.position, light).direction);
    vec3 half_angle = normalize(view_direction + light_direction);
    vec3 HxN = cross(half_angle, surface_normal);
    vec3 light_radiance =  light_radiance(light, surface.position);

    // Precompute dot products
    float VoN = max(dot(view_direction, surface_normal), 0.0);
    float LoN = max(dot(light_direction, surface_normal), 0.0);
    float HoN = max(dot(half_angle, surface_normal), 0.0);
    float VoH = max(dot(view_direction, half_angle), 0.0);
    
    // Distribution of micro-facets
    float D = D_GGX(surface.material.roughness, HoN);
    // Geometry/Visual term of facets (shadowing/masking)
    float V = V_SmithGGXCorrelatedFast(surface.material.roughness, LoN, VoN);
    // Fresnel Reflectance
    vec3 F = F_Schlick(VoH, f0, f90);
    // Specular color
    vec3 Fs = D * V * F;

    //////////////////
    // Diffuse Term //
    //////////////////
    // Metal do not have a diffuse color (only specular)
    vec3 base_color = (1.0 - surface.material.metallic) * surface.material.color; 
    // Diffuse Color
    vec3 Fd = base_color * (1.0 / PI);
    
    // Ambient Term
    vec3 Fa = vec3(0.03) * surface.material.color * (1.0 - surface.material.ambient_occlusion);

    // Update reflectance term
    reflectance = length(F);
    return Fa + (Fs + Fd) * light_radiance * LoN;
}

#define SHADOW_FACTOR vec3(0.03)
// Calculate a color reflected from the POV of 'ray' upon the 'surface'
vec3 direct_illumination(in Surface surface, in Ray ray, out float reflectance) {
    vec3 color = vec3(0.0);
    // For every light
    for(int i = 0 ; i < lights.length(); i++) {
      // Create a ray pointing from the surface to the light source
      Ray light_ray = light_ray(surface.position, lights[i]);
      // Offset the origin a small amount for float rounding errors / self collision
      light_ray.origin = surface.position + 0.06 * surface.normal;
	  float distance_to_light = light_dist(surface.position, lights[i]);
      // Find the object (if any) the ray intersects with
	  SceneObj object = ray_march(light_ray);

      // If the ray collides with another object, closer to the light source
	  if (object.type >= 0 && (object.dist < distance_to_light)) {
        // It's in shadow
        if (surface.material.emissive == 0.0) {
            color +=  SHADOW_FACTOR * surface.material.color * surface.material.ambient_occlusion;
        }
      } else { // Color/Light normally
        float r;
	    color += PBR(surface, ray, lights[i], r);
        reflectance += r;
	  }
    }
    return color;
}

#define GAMMA 2.1
#define RAY_OFFSET 0.05
#define NUM_REFLECTIONS 2
vec3 march(in Ray input_ray) {
  // Shadow the input ray
  Ray ray = input_ray;
  // Accumulating the final color
  vec3 final_color = vec3(0.0);
  // Reduces contributions to the final color 
  vec3 mask = vec3(1.0);

  for(int i = 0; i < NUM_REFLECTIONS; i++) {
    // Find the first object the ray intersects
    SceneObj object = ray_march(ray);
    // If the ray hit an object (-1 indicates no intersections)
    if (object.type >= 0) {
      // Generate a 'surface' where the ray hit the object 
      vec3 position = ray.origin + object.dist * ray.direction;
      PBRMat material = getObjectMaterial(object.type, object.id);
      vec3 normal = normalize(computeSDFGrad(object, position));
      Surface surface = Surface(position, normal, material);
      
      // How much the last surface hit reflects light
      // Calculate the color of the surface
      vec3 color = vec3(0.0);
      if (surface.material.emissive > 0.0) {
        vec3 view_direction = normalize(ray.origin - surface.position);
        float LoN = max(dot(view_direction, surface.normal), 0.0);
        if (i == 0) {
          color += surface.material.emissive * surface.material.color * LoN;
        } else {
          color += emissive_radiance(surface, ray.origin) * LoN;
        }
       }

       // Color normally
       color += direct_illumination(surface, ray, surface.material.reflectance);
        
      // Update the final color of the fragment
      final_color += (mask * color);
      mask *= surface.material.reflectance;
        
      // Emissive surfaces won't reflect any thing
      if (surface.material.emissive > 0.0) { break; }
      
      // Create a new reflection ray for the next loop iteration
      // Move the ray a little off the surface to avoid float rounding errors
      vec3 new_position = surface.position + RAY_OFFSET * surface.normal;
      ray = Ray(new_position, reflect(ray.direction, surface.normal));
    } 
  }
    
  // Color Corrections
  // HDR Correction
  final_color /= (final_color + vec3(1.0));
  //Gamma Correction
  final_color = pow(final_color, vec3(1.0 / GAMMA));

  return final_color; 
}

out vec4 fragColor;
void main() {
  // Set the grid dimensions (number of blocks for the GOL)
  // Such that they fill the user's screen.
  float res_ratio = resolution.x / resolution.y;
  set_grid_dimensions(res_ratio);

  // Update the light positions
  updateLightPositions(res_ratio);
  
  // Ray Marching
  Ray ray = generatePerspectiveRay(resolution.xy, gl_FragCoord.xy);
  // Output Color
  vec3 color = march(ray);
  fragColor = vec4(color, 1);
}

`;

export const vertex_shader_source = `#version 300 es
in vec4 position;

void main() {
  // Vertices of our lone triangle
  vec2 vertices[3] = vec2[3](vec2(-1,-1), vec2(3,-1), vec2(-1, 3));
  // Pass each vertex with each call, convert to homogeneous vectors
  gl_Position = vec4(vertices[gl_VertexID],0,1);
}
`;
