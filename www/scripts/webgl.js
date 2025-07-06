// Initializes a canvas, and a context
// Input: Canvas Element ID
// Output: Canvas Element, WebGL-context
// Error: Returns 'null' and prints to console[error]
export function initializeWebGLContext(canvas_id, mode = "webgl2") {
  // Grab the canvas element
  const canvas = document.getElementById(canvas_id);
  if (!canvas) {
    console.error("Did not find canvas with id: " + canvas_id);
  }

  // Create WebGL-Context
  const webgl = canvas.getContext(mode);
  if (!webgl) {
    console.error("Could not create a WebGL-context:" + webgl);
  }

  // Resize the canvas to match the display size
  resizeCanvasToDisplaySize(webgl);

  return [canvas, webgl];
}

// Compile OpenGL Shaders
// Input: WebGL-context, type of shader, source code of shader
// Output: WebGL Shader Object on success, null on error
// Error: Prints Shader compilation error log to console[warn]
export function compileShader(gl, type, source) {
  let shader = gl.createShader(type);
  if (!shader) {
    console.error(
      "Shader type: " +
        type +
        " is not a valid WebGL shader type.\nValid shader types are: gl.VERTEXT_SHADER, gl.FRAGMENT_SHADER",
    );
    return null;
  }
  // Add the source to the WebGL Shader
  gl.shaderSource(shader, source);
  // Compile the shader
  gl.compileShader(shader);
  // Check for compilation errors
  let success = gl.getShaderParameter(shader, gl.COMPILE_STATUS);
  if (success) {
    return shader;
  } else {
    // Compilation failed
    // Print compilation error to console to aid in debugging
    console.warn(gl.getShaderInfoLog(shader));
    // Clean up the resource
    gl.deleteShader(shader);
    return null;
  }
}

// Creates a WebGl Program
// Input: WebGL-context
//        Compiled Vertex Shader
//        Compiled Fragment Shader
// Output: WebGL Program, or null on error
// Error: Prints Program linking error log to console[warn]
export function createWebGLProgram(gl, vertex_shader, fragment_shader) {
  let program = gl.createProgram();
  gl.attachShader(program, vertex_shader);
  gl.attachShader(program, fragment_shader);
  gl.linkProgram(program);
  var success = gl.getProgramParameter(program, gl.LINK_STATUS);
  if (success) {
    return program;
  } else {
    // Linking failed
    // Print linking error to console to aid in debugging
    console.warn(gl.getProgramInfoLog(shader));
    // Clean up the resource
    gl.deleteProgram(program);
    return null;
  }
}

// Combines above functions for to easily create a WebGL program
// Inputs: Canvas Element ID
//         Vertex Shader Source
//         Fragment Shader Source
// Outputs: Canvas Element
//          WebGL-context, WebGL-program, (null on error)
// Error: Prints various WebGL logs to console[warn|error]
export function quickCreateWebGLProgram(
  canvas_id,
  vertex_shader_source,
  fragment_shader_source,
) {
  let [canvas, webgl] = initializeWebGLContext(canvas_id);
  if (!canvas || !webgl) {
    console.warn("Could not initialize a WebGL-Context");
    return [null, null, null];
  }

  // Compile Shaders
  let vertex_shader = compileShader(
    webgl,
    webgl.VERTEX_SHADER,
    vertex_shader_source,
  );
  let fragment_shader = compileShader(
    webgl,
    webgl.FRAGMENT_SHADER,
    fragment_shader_source,
  );
  if (!vertex_shader || !fragment_shader) {
    console.warn("Could not compile shaders.");
    return [canvas, webgl, null];
  }

  // Create OpenGL Program
  let program = createWebGLProgram(webgl, vertex_shader, fragment_shader);
  if (!program) {
    console.warn("Could not link shaders into WebGL Program");
    return [canvas, webgl, null];
  }
  // Assume we're going to use a single program
  webgl.useProgram(program);

  // Resize & Clear the canvas
  resizeCanvasToDisplaySize(webgl);
  webgl.viewport(0, 0, webgl.canvas.width, webgl.canvas.height);
  webgl.clearColor(0, 0, 0, 0);
  webgl.clear(webgl.COLOR_BUFFER_BIT);

  return [canvas, webgl, program];
}

/////////////////////
// UNIFORM SETTERS //
/////////////////////
// Common uniforms used by shaders (resolution, time, mouse-position)
// Provides setters for these values, as well as convenience functions
// that setup event listeners to re-set them when appropriate

// Updates the 'resolution' vec2 uniform in the WebGL Program
// Inputs: WebGL-context, WebGL-program, uniform name
// Outputs: (void)
export function updateUniformResolution(
  webgl,
  program,
  uniform_name = "resolution",
) {
  let location = webgl.getUniformLocation(program, uniform_name);
  webgl.uniform2f(location, webgl.canvas.width, webgl.canvas.height);
}

// Can be set to the window resize event to update the canvas's
// resolution, adjusts the view port, and optionally updates a uniform
// value to the current resolution.
// Inputs: WebGL-context, WebGL program, (vec2 uniform name)
// Outputs: (void)
export function enableCanvasWindowResizeEvent(
  webgl,
  program,
  uniform_name = null,
  callback = null,
) {
  let resize_listener = () => {
    resizeCanvasToDisplaySize(webgl);
    if (uniform_name) {
      updateUniformResolution(webgl, program, uniform_name);
    }
    // Call user defined function on resize
    if (callback) {
      callback();
    }
  };
  // Run it once
  resize_listener();
  // Add listener to update the canvas on window resize
  window.addEventListener("resize", resize_listener);
}
// Checks if a canvas matches its display size, and resizes to match
// Input: a WebGL-context
//        a ratio to scale the canvas up (>1.0) or down (<1.0)
// Output: a boolean indicating if the canvas was resized
export function resizeCanvasToDisplaySize(webgl, ratio = 1.0) {
  const canvas = webgl.canvas;
  // Lookup the size the browser is displaying the canvas in CSS pixels
  const displayWidth = canvas.clientWidth * ratio;
  const displayHeight = canvas.clientHeight * ratio;

  // Check if the canvas is not the same size.
  const needs_resize =
    canvas.width !== displayWidth || canvas.height !== displayHeight;

  if (needs_resize) {
    // Make the canvas the same size
    canvas.width = displayWidth;
    canvas.height = displayHeight;
  }
  webgl.viewport(0, 0, webgl.canvas.width, webgl.canvas.height);

  return needs_resize;
}

// Updates the 'time' uniform in the WebGL Program with the
// milliseconds elapsed since 'startUniformTimer' was called
// Inputs: WebGL-context, WebGL-program, uniform name
// Outputs: (void)
export function updateUniformTime(webgl, program, uniform_name = "time") {
  let location = webgl.getUniformLocation(program, uniform_name);
  let current_time = Date.now();
  let time_elapsed = current_time - start_time;
  webgl.uniform1f(location, time_elapsed);
}
let start_time = 0;
// Starts the timer
export function startUniformTimer() {
  start_time = Date.now();
}
// No Event Listener for this one, this should be updated during
// the render loop.

// Updates the 'mouse' vec2 uniform in the WebGL Program with
// the xy location of the mouse inside the canvas in st coordinate
// space [(-1,-1), (1,1)]
// Inputs: WebGL-context, WebGL-program, mouse_position, uniform_name
// Outputs: (void)
export function updateUniformMouse(
  webgl,
  program,
  mouse_position,
  uniform_name = "mouse",
) {
  let location = webgl.getUniformLocation(program, uniform_name);
  webgl.uniform2f(location, mouse_position.x, mouse_position.y);
}

// Will update the 'mouse' vec2 uniform with the st coordinates
// every time the mouse moves inside the canvas's context
// Inputs: WebGL-context, WebGL-program, uniform_name
// Outputs: (void)
export function enableMouseEventListener(
  webgl,
  program,
  uniform_name = "mouse",
) {
  let getMousePos = function (canvas, evt) {
    var rect = canvas.getBoundingClientRect();
    return {
      x: ((evt.clientX - rect.left) / canvas.width) * 2.0 - 1.0,
      y: ((evt.clientY - rect.top) / canvas.height) * -2.0 + 1.0,
    };
  };

  // Create a event listener
  webgl.canvas.addEventListener(
    "mousemove",
    function (evt) {
      var mouse_position = getMousePos(canvas, evt);
      updateUniformMouse(webgl, program, mouse_position, uniform_name);
    },
    false,
  );
}
