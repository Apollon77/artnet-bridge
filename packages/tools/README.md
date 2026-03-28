# @artnet-bridge/tools - ArtNet Bridge Tooling

This package supports build and execution infrastructure for other artnet-bridge packages.

> Supports Node.js >= 22.13.0

## Rational

ArtNet Bridge consists of multiple TypeScript packages.  We support multiple module formats targeting
disparate JavaScript runtimes.  We publish a moderate number of packages to NPM.  We support Linux, Windows and MacOS.

This package standardizes and centralizes configuration for build.  It minimizes reliance on TSC and generally
does its best to run build as quickly as possible.

## Dev workflow

Although ArtNet Bridge relies on third-party tools for build, the interface is command-line oriented and unique to
ArtNet Bridge.  As such, it will be unfamiliar to new developers.

To minimize developer burden, we also maintain traditional `tsconfig.json` files with project references in each `src/`
and `test/`.  These files support traditional IDE and `tsc --watch` workflows and are largely (but not entirely) ignored
by the tooling package.

These files do add configuration overhead but we minimize this with a shared [tsconfig.base.json](tsconfig.base.json)
supplied by this package.

## Build

We use [TSC](https://www.typescriptlang.org/docs/handbook/compiler-options.html) to validate TypeScript types and
generate declaration files.  We use [esbuild](https://esbuild.github.io/) for transcoding TypeScript to ESM (ES6 module
format) and CJS (CommonJS module format).

The [artnet-build](./bin/build.js) script orchestrates TSC and esbuild.  It inspects `package.json` for the target
module to determine whether to emit ESM, CJS or both.

Use `artnet-build --help` for command line usage.  If you run `artnet-build` in a monorepo root it builds all packages
that have changed (or depend on other packages that have changed) since the last build.

`artnet-build` itself is implemented in TypeScript.  It uses `esbuild` to bootstrap itself in fresh installs.

## Execution

We facilitate execution via [artnet-run](bin/run.js). This command bootstraps tooling, transpiles the target module, and
executes the named JS or TS script.

`artnet-run` understands ArtNet Bridge `package.json` conventions and automatically transpiles typescript files in the
target package prior to execution.

`artnet-run` accepts a script to run and passes other arguments to the script verbatim.

If you set the environment variable `ARTNET_RUN_ECHO`, `artnet-run` will print the command line prior to invoking a script.
