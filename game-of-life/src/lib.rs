use wasm_bindgen::prelude::*;

type Cell = u8;

#[wasm_bindgen]
pub struct Universe {
    width: u32,
    height: u32,
    cells: Vec<Cell>,
}

impl Universe {
    // Get index into the Cells vector
    fn get_index(&self, row: u32, column: u32) -> usize {
        (row * self.width + column) as usize
    }

    // Number of neighbors next to the cell which are alive
    // Implements a wrap-around universe
    fn live_neighbor_count(&self, row: u32, column: u32) -> u8 {
        let mut count: u8 = 0;
        for delta_row in [self.height - 1, 0, 1].iter().cloned() {
            for delta_col in [self.width - 1, 0, 1].iter().cloned() {
                if delta_row == 0 && delta_col == 0 {
                    continue;
                }

                let neighbor_row = (row + delta_row) % self.height;
                let neighbor_col = (column + delta_col) % self.width;
                let idx = self.get_index(neighbor_row, neighbor_col);
                // Only fully alive cells count
                count += match self.cells[idx] == 7 {
                    true => 1,
                    _ => 0,
                };
            }
        }
        count
    }
}

#[wasm_bindgen]
impl Universe {
    // Any growing cell becomes alive, and dying cell becomes dead
    pub fn tick(&mut self) {
        let mut next = self.cells.clone();
        for row in 0..self.height {
            for col in 0..self.width {
                let idx = self.get_index(row, col);
                let cell = self.cells[idx];
                let alive = 7u8;
                let dead = 0u8;
                let next_cell = match cell {
                    // Any growing cell becomes alive
                    1u8 => alive,
                    // Any dying cell, dies
                    6u8 => dead,
                    // All other cells remain in the same state.
                    _ => cell,
                };
                next[idx] = next_cell;
            }
        }
        self.cells = next;
    }

    // Requires all cells be either alive, or dead and calculates which should begin dying and
    // which should begin growing. Run after tick();
    pub fn tock(&mut self) -> bool {
        let mut change = false;
        let mut next = self.cells.clone();
        for row in 0..self.height {
            for col in 0..self.width {
                let idx = self.get_index(row, col);
                let cell = self.cells[idx];
                let alive = 7u8;
                let dying = 6u8;
                let growing = 1u8;
                let live_neighbors = self.live_neighbor_count(row, col);
                let next_cell = match (cell, live_neighbors) {
                    // Rule 1: Any live cell with fewer than two live neighbours
                    // dies, as if caused by underpopulation.
                    (7, x) if x < 2 => dying,
                    // Rule 2: Any live cell with two or three live neighbours
                    // lives on to the next generation.
                    (7, 2) | (7, 3) => {
                        change = true;
                        alive
                    }
                    // Rule 3: Any live cell with more than three live
                    // neighbours dies, as if by overpopulation.
                    (7, x) if x > 3 => dying,
                    // Rule 4: Any dead cell with exactly three live neighbours
                    // becomes a live cell, as if by reproduction.
                    (0, 3) => {
                        change = true;
                        growing
                    }

                    // All other cells remain in the same state.
                    (7, _) => {
                        change = true;
                        alive
                    }
                    (0, _) => 0u8,
                    (_, _) => 0u8,
                };
                next[idx] = next_cell;
            }
        }
        self.cells = next;
        return change;
    }

    pub fn new(width: u32, height: u32) -> Universe {
        let cells = (0..width * height)
            .map(|_| {
                if js_sys::Math::random() < 0.5 {
                    1u8
                } else {
                    6u8
                }
            })
            .collect();

        Universe {
            width,
            height,
            cells,
        }
    }

    pub fn width(&self) -> u32 {
        self.width
    }

    pub fn height(&self) -> u32 {
        self.height
    }

    pub fn cells(&self) -> *const Cell {
        self.cells.as_ptr()
    }
    // Checks if the universe is dead
    pub fn is_dead(&self) -> bool {
        self.cells.iter().all(|c| *c == 0u8)
    }
    // Resets the universe, in place
    pub fn reset(&mut self) {
        for row in 0..self.height {
            for col in 0..self.width {
                let idx = self.get_index(row, col);
                let rand = js_sys::Math::random();
                self.cells[idx] = match rand {
                    x if x < 0.5 => 1u8,
                    _ => 6u8,
                }
            }
        }
    }
}
