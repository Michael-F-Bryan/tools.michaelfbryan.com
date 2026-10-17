{
  description = "Development environment for tools.michaelfbryan.com";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs =
    { nixpkgs, ... }:
    let
      systems = [
        "aarch64-linux"
        "x86_64-linux"
        "aarch64-darwin"
      ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in
    {
      devShells = forAllSystems (
        pkgs:
        let
          inherit (pkgs) lib stdenv;

          # Matches CI and the README.
          nodejs = pkgs.nodejs_22;

          # Exactly the version in package.json's `packageManager` field. This
          # is nixpkgs' own pnpm 11 package (the npm registry tarball run by
          # Nix's Node), re-pinned to the project's version. Update `version`
          # and `hash` together whenever `packageManager` changes.
          pnpm = pkgs.pnpm_11.override {
            version = "11.24.0";
            hash = "sha256-0eqyQzFyZhzDahjshfzpP3cdsZYnFzKcwB7JwoJMok8=";
            nodejs-slim = nodejs;
          };
        in
        {
          default = pkgs.mkShellNoCC {
            packages = [
              nodejs
              pnpm
              # `next dev` and `next build` read `git log` for entry history.
              pkgs.git
            ]
            ++ lib.optionals stdenv.hostPlatform.isLinux [ pkgs.chromium ];

            env = {
              # Fail instead of letting pnpm download a different version of
              # itself when `packageManager` and this flake disagree.
              pnpm_config_pm_on_fail = "error";
            }
            # Playwright's downloaded browsers expect a conventional Linux
            # loader and libraries, so point `playwright.config.ts` at the Nix
            # Chromium instead. On macOS, install Playwright's Chromium as usual.
            // lib.optionalAttrs stdenv.hostPlatform.isLinux {
              AGENT_BROWSER_EXECUTABLE_PATH = lib.getExe pkgs.chromium;
            };
          };
        }
      );
    };
}
