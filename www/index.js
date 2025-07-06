import {
  enableCanvasWindowResizeEvent,
  quickCreateWebGLProgram,
  updateUniformTime,
  startUniformTimer,
  enableMouseEventListener,
} from "./scripts/webgl.js";
import {
  vertex_shader_source,
  fragment_shader_source,
} from "./scripts/shaders.js";
import init, { Universe } from "./wasm/wasm_game_of_life.js";

let buffer_id = 0;
async function run() {
  // Load the WASM so we can use the functions defined therein
  let wasm = await init();

  // Create WebGL program & context
  const [canvas, gl, program] = quickCreateWebGLProgram(
    "canvas",
    vertex_shader_source,
    fragment_shader_source,
  );
  // Quit if something went wrong
  if (!canvas || !gl || !program) {
    return null;
  }

  // Setup the Uniform Block that the cells reside in
  buffer_id = gl.createBuffer();

  // Calculate the Game of Life cell grid dimensions
  initializeUniverse();
  // Initialize Uniforms
  startUniformTimer();
  updateUniformTime(gl, program);
  // Set the grid size
  updateUniformGridDimension(gl, program, universe.width(), universe.height());
  // Reset the view, canvas size, and grid size on a resize
  enableCanvasWindowResizeEvent(gl, program, "resolution", () => {
    // Additionally, create a new universe, resize the grid
    initializeUniverse();
    updateUniformGridDimension(
      gl,
      program,
      universe.width(),
      universe.height(),
    );
    tick_or_tock = 0;
    draw(gl);
  });
  // Sets a uniform that moves the light with the mouse
  enableMouseEventListener(gl, program);
  // Initialize key event handlers
  window.addEventListener("keydown", onKeyDown);

  // Kick off the render
  renderLoop(gl, program, wasm);
}

let universe = null;
function initializeUniverse() {
  let [width, height] = calculateGridDimensions(canvas);
  universe = Universe.new(width, height);
}

// Handles keyboard input
let rainbow_mode = false;
let onKeyDown = function (event) {
  if (event.key == " ") {
    paused = !paused;
  } else if (event.key == "Enter") {
    universe.reset();
    tick_or_tock = 0;
  } else if (event.key == "=" || event.key == "+") {
    min_grid_dimension = Math.min(64, (min_grid_dimension += 2));
    window.dispatchEvent(new Event("resize"));
  } else if (event.key == "-") {
    min_grid_dimension = Math.max(4, (min_grid_dimension -= 2));
    window.dispatchEvent(new Event("resize"));
  } else if (event.key == "c") {
    // Change colors
    change_color = true;
  } else if (event.key == "r") {
    rainbow_mode = !rainbow_mode;
    if (rainbow_mode) {
      change_color = true;
    }
  }
};

// Updates the blend timing uniform
let blend_location = null;
function updateBlendUniform(gl, program, time_elapsed) {
  let blend_ce = Math.min(1.0, time_elapsed / 1000.0);
  if (!blend_location) {
    blend_location = gl.getUniformLocation(program, "blend_ce");
  }
  gl.uniform1f(blend_location, blend_ce);
}

let change_color = true;
let color_shift = 2.0;
let paused = false;
// Timestamp of when the simulation began
let start_time = Date.now();
let dead_universe_time = 0;
let tick_or_tock = 0;
// Time the Universe of Cells last updated
let last_tick_time = Date.now();
function renderLoop(gl, program, wasm) {
  let current_time = Date.now();
  let time_elapsed = current_time - start_time;
  let time_elapsed_since_last_tick = current_time - last_tick_time;

  // Update the simulation every second
  let change = true;
  if (!paused && time_elapsed_since_last_tick > 1000) {
    last_tick_time = current_time;
    if (tick_or_tock % 2 == 0) {
      universe.tick();
    } else {
      change = universe.tock();
    }
    tick_or_tock++;
  }

  // Update time-dependent uniforms
  updateBlendUniform(gl, program, time_elapsed_since_last_tick);
  updateTimeUniform(gl, program, time_elapsed);

  // Update the hue of active blocks
  let color_location = null;
  if (change_color) {
    color_shift += 1.0 / 60.0;
    if (!color_location) {
      color_location = gl.getUniformLocation(program, "color_shift");
    }
    gl.uniform1f(color_location, color_shift);
    change_color = false || rainbow_mode;
  }

  // Redraw the frame
  draw(gl);

  // Check if the universe has died
  if (!change) {
    bigBang();
  }

  // Update the universe's status in the shader
  updateActiveBlocks(gl, program, wasm.memory);

  // Call ourselves again
  requestAnimationFrame(() => {
    renderLoop(gl, program, wasm);
  });
}

// Reset if dead
function bigBang() {
  // If the universe has been dead for 5 seconds, restart it
  if (dead_universe_time == 0) {
    if (universe.is_dead()) {
      dead_universe_time = Date.now();
    }
  } else if (Date.now() - dead_universe_time > 5000) {
    universe.reset();
    dead_universe_time = 0;
    tick_or_tock = 0;
  }
}

// Updates the "grid_dimensions" ivec2 uniform in the shader
let grid_dimensions_location = null;
function updateUniformGridDimension(webgl, program, width, height) {
  if (!grid_dimensions_location) {
    grid_dimensions_location = webgl.getUniformLocation(
      program,
      "grid_dimensions",
    );
  }
  webgl.uniform2i(grid_dimensions_location, width, height);
}

// Calculate the grid dimensions from the canvas size
// Input: Canvas Element
// Output: Width (number of cells left to right)
//         Height (number of cells up to down)
let min_grid_dimension = 8;
function calculateGridDimensions(canvas) {
  const xy_ratio = (1.0 * canvas.width) / canvas.height;
  let width = min_grid_dimension;
  let height = min_grid_dimension;
  if (xy_ratio > 1) {
    // Wide Screen
    width = Math.round(min_grid_dimension * xy_ratio);
    width -= width % 2; // Ensure even dimensions
  } else if (xy_ratio < 1) {
    // Tall Screen
    height = Math.round(min_grid_dimension * (1 / xy_ratio));
    height -= height % 2; // Ensure even dimensions
  }
  return [width, height];
}

let data_size = null;
function updateActiveBlocks(gl, program, memory) {
  const height = universe.height();
  const width = universe.width();
  const cells_ptr = universe.cells();

  let cells_block_index = gl.getUniformBlockIndex(program, "Cells");
  gl.uniformBlockBinding(program, cells_block_index, 1);
  if (!data_size) {
    data_size = gl.getActiveUniformBlockParameter(
      program,
      cells_block_index,
      gl.UNIFORM_BLOCK_DATA_SIZE,
    );
  }

  // JS Idiocy to get the correct sized buffer
  let cell_buffer = new ArrayBuffer(data_size);
  let cells_data = new Uint32Array(
    memory.buffer,
    cells_ptr,
    (width * height) / 4,
  );
  let cells = new Uint32Array(cell_buffer);
  cells.set(cells_data);

  // Bind the buffer to the bind-point, and buffer in the cell data
  gl.bindBuffer(gl.UNIFORM_BUFFER, buffer_id);
  gl.bufferData(gl.UNIFORM_BUFFER, cells, gl.DYNAMIC_READ);
  gl.bindBufferBase(gl.UNIFORM_BUFFER, 1, buffer_id);

  // Connect the buffer to the block interface
  gl.bindBufferRange(
    gl.UNIFORM_BUFFER,
    cells_block_index,
    buffer_id,
    0,
    cells.byteLength,
  );
}

let time_location = null;
function updateTimeUniform(gl, program, secs_elapsed) {
  if (!time_location) {
    time_location = gl.getUniformLocation(program, "time");
  }
  gl.uniform1f(time_location, secs_elapsed);
}

function draw(gl) {
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

// Let the show begin!
run();
