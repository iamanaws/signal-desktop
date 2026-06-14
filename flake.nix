{
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";

  outputs =
    { self, nixpkgs }:
    let
      forSystems =
        f:
        nixpkgs.lib.genAttrs nixpkgs.lib.systems.flakeExposed (
          system: f { pkgs = import nixpkgs { inherit system; }; }
        );

      commonPackages =
        pkgs: with pkgs; [
          nodejs
          corepack

          typescript
          typescript-language-server

          gcc
          python3
        ];
    in
    {
      formatter = forSystems ({ pkgs }: pkgs.nixfmt-tree);

      packages = forSystems (
        { pkgs }:
        {
          default = pkgs.callPackage ./package/package.nix { };
        }
      );

      devShells = forSystems (
        { pkgs }:
        {
          default = pkgs.mkShellNoCC {
            packages = commonPackages pkgs;
          };
        }
      );
    };
}
