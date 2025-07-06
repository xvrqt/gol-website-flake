{
  pkgs,
  buildInputs,
  ...
}: let
  pkgName = "game_of_life";

  # Rust Settings
  rust_src = ./.;

  # Setup the Rust Toolchain to use
  rustPlatform = pkgs.makeRustPlatform {
    cargo = pkgs.rustToolchain;
    rustc = pkgs.rustToolchain;
  };

  # WASM Settings
  wasm_target = "wasm32-unknown-unknown";
  wasm_flags = "--no-typescript --target web";
  wasm_src_dir = "./target/${wasm_target}/release/*.wasm";
  wasm_out_dir = "wasm"; # No './' because we use it in the install phase too
in {
  default = pkgs.stdenv.mkDerivation {
    pname = "wasm-${pkgName}";
    version = "1.0.0";
    src = rust_src;

    nativeBuildInputs = buildInputs ++ [rustPlatform.cargoSetupHook rustPlatform.cargoBuildHook];

    # Rust Env Variables
    RUST_LOG = "debug";
    CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_LINKER = "lld";
    # Pre-download Cargo Dependencies
    cargoDeps = rustPlatform.importCargoLock {
      lockFile = ./Cargo.lock;
    };

    buildPhase = ''
      cargo fetch
      cargo build --release --target=${wasm_target}
      wasm-bindgen --out-dir ./${wasm_out_dir} ${wasm_flags} ${wasm_src_dir}
    '';

    installPhase = ''
      mkdir -p $out/${wasm_out_dir}
      cp ./${wasm_out_dir}/*.wasm $out/${wasm_out_dir}/
      cp ./${wasm_out_dir}/*.js $out/${wasm_out_dir}/
    '';
  };
}
