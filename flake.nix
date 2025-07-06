{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
    rust-overlay = {
      url = "github:oxalica/rust-overlay";
      inputs = {
        nixpkgs.follows = "nixpkgs";
      };
    };
  };

  outputs = {
    nixpkgs,
    flake-utils,
    rust-overlay,
    ...
  }:
    flake-utils.lib.eachDefaultSystem (
      system: let
        pkgName = "game-of-life";
        # Used to ensure we build our Rust packages with Nightly
        rustToolchainFile = ./rust-toolchain.toml;
        rustToolchainSettings = {
          extensions = ["rust-src"];
          targets = ["wasm32-unknown-unknown"];
        };
        rustToolchain.default = final: _: {
          rustToolchain =
            (final.rust-bin.fromRustupToolchainFile rustToolchainFile).override rustToolchainSettings;
        };
        # Setup pkgs with Rust overlays
        pkgs = import nixpkgs {
          inherit system;
          overlays = [
            (import rust-overlay)
            rustToolchain.default
          ];
        };
        # Directories
        web_dir = "www";
        wasm_dir = "game-of-life";
        # Build inputs used by dev shells, and packages alike
        buildInputs = [
          # Rust Nightly Toolchain
          pkgs.rustToolchain

          # Required to create the WASM targets, and pack them for web
          pkgs.wasm-bindgen-cli
          pkgs.llvmPackages.bintools
        ];
      in
        with pkgs; rec {
          ##############
          ## PACKAGES ##
          ##############
          packages = let
            # Compiles the WASM code used by the website, and the JS Bindings
            wasm = (pkgs.callPackage (./. + "/${wasm_dir}") {inherit pkgs buildInputs;}).default;
            # Simple copy of the website source into the Nix Store
            website = (pkgs.callPackage (./. + "/${web_dir}") {inherit pkgs;}).default;
          in {
            inherit wasm website;
            # Combine them into a single Nix Store path
            all = pkgs.symlinkJoin {
              name = "gol_website";
              paths = [wasm website];
            };
            default = packages.all;
          };

          ############
          ## SHELLS ##
          ############
          devShells = import ./shell.nix {inherit pkgs web_dir wasm_dir buildInputs;};

          #############
          ## MODULES ##
          #############
          nixosModules.default = {
            lib,
            config,
            ...
          }: let
            # Check if both the website service is enabled, and this specific site is enabled.
            cfgcheck = config.services.websites.enable && config.services.websites.sites.${pkgName}.enable;
            # Website url
            domain = config.services.websites.sites.${pkgName}.domain;
          in {
            # Create the option to enable this site, and set its domain name
            options = {
              services = {
                websites = {
                  sites = {
                    "${pkgName}" = {
                      enable = lib.mkEnableOption "Webpage displaying Conway's Game of Life in a WebGL rendered grid.";
                      domain = lib.mkOption {
                        type = lib.types.str;
                        default = "gol.xvrqt.com";
                        example = "gateway.xvrqt.com";
                        description = "Domain name for the website. In the form: sub.domain.tld, domain.tld";
                      };
                    };
                  };
                };
              };
            };

            config = {
              # Add the website to the system's packages
              environment.systemPackages = [packages.default];

              # Configure a virtual host on nginx
              services.nginx.virtualHosts.${domain} = lib.mkIf cfgcheck {
                forceSSL = true;
                enableACME = true;
                acmeRoot = null;
                locations."/" = {
                  root = "${packages.default}";
                };
              };
            };
          };
        }
    );
}
