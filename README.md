# Game of Life
Webpage that hosts a version of Conway's Game of Life, realized in Rust+WASM, and rendered with WebGL.

Check it out: [https://gol.xvrqt.com](https://gol.xvrqt.com)

## Purpose
I wanted to learn how to transpile Rust into WASM code, and then use that code in a website. Big thanks to [The Rust-WASM Book](https://rustwasm.github.io/book/) for such a great guide.
I also was able to refresh my WebGL skills, and spent time implementing a ray-marched renderinding of the Game of Life, and improving my BRDF's from Blinn-Phong to Cook-Torrance.
Lastly, I wrapped it all up in a Nix Flake which properly builds and deploys the website to my server, and provides a development environment. I really leveled up my ability to use Flakes from solely using them for configuration of NixOS Modules, to now building and deploying my own non-trivial pacakages.

## Usage
`c` -> Hold to change the color of the active cells

`r` -> Toggle 'rainbow mode' which will shift the colors over time 

`+/-` -> Increases/Decreases the number of cells in the Game of Life

`cursor` -> Light follows the cursor position in the canvas

`<space>` -> Pause the simulation (but not the animation)

`<enter>` -> Restart the simulation (will auto-restart after a few seconds if the universe is completely dead)

## Development
Clone this directory.
Run `nix develop` in the project root to start a server at `http://localhost:6969` that will preview your changes.
Run `rebuild-wasm` if you edit the Rust source code to rebuild it and copy it so you can see changes on refresh.

## Installation
Given this is a static website, it is trivial to serve.
Using Nix makes it more complicated because of course it does, so here's how to use Nix Flakes to serve it.

### Setup
First, you need to use my [websites](https://github.com/xvrqt/website-flake) flake to setup the appropriate options, and configurations to serve this website with no additional setup from you.

```nix
{
  inputs = {
    game-of-life.url = "github:xvrqt/game-of-life-demo";
  };

  outputs = {...} @ sites: {
    nixosModules.default.imports = [
      # ... other sites
      sites.game-of-life.nixosModules.${system}.default
    ];
  };
}
```

### Options
Fortunately, this should already be included because you wrote both flakes. When you have added this flake as an input to the `website` flake, and then added the `website` flake to your NixOS Configuration flake modules list, then you can enable it in your main NixOS module via the following options:

```nix
services = {
  websites = {
    enable = true;
    email = "my@email.com";
    dnsProvider = "cloudflare";
    dnsTokenFile = ./path/to/secret;
    sites = {
      game-of-life = {
        enable = true;
        domain = "gol.xvrqt.com";
      };
    };
  };
};
```
