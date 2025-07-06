{pkgs, ...}: let
  pkgName = "game_of_life";
in {
  default = pkgs.stdenv.mkDerivation {
    pname = "website-${pkgName}";
    version = "1.0.0";
    src = ./.;

    # Simply copy everything to the Nix Store
    installPhase = ''
      mkdir -p $out
      cp -r ./* $out/
    '';
  };
}
