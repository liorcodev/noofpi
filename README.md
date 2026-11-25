<div align="center">

<img src="./assets/logo.svg" alt="noofpi logo" width="96" height="96">

# noofpi

A minimal Vue + Vite full-stack framework built around [doofpi](https://www.npmjs.com/package/doofpi)

File-based pages, SSR or SPA, a built-in doofpi server and a doofpi client with four fetch modes.

[![npm version](https://img.shields.io/npm/v/noofpi.svg)](https://www.npmjs.com/package/noofpi) [![MIT License](https://img.shields.io/badge/license-MIT-green.svg)](https://opensource.org/licenses/MIT)

</div>

## Getting started

```sh
bun create noofpi my-app
cd my-app
bun install
bun run dev
```

To add noofpi to an existing project:

```sh
bun add noofpi doofpi
```

Requires Node.js 20 or newer (or Bun). `doofpi` is a peer dependency (`>=1.3.1`).

`tailwindcss`, `@tailwindcss/vite` and `sharp` are optional peer dependencies, install them when you use the feature:

```sh
bun add tailwindcss @tailwindcss/vite   # tailwind: true
bun add sharp                           # importing images with ?image
```

## CLI

```
noofpi dev        Start the dev server with live reload
noofpi build      Build for production into .output/
noofpi start      Run the production build
noofpi preview    Build, then run the production build
noofpi prepare    Generate the .noofpi/ type declarations
noofpi typecheck  Run prepare, then vue-tsc --noEmit
```

Options: `--root <dir>`, `--port <port>`, `--host <host>`, `--open`, `--preset <name>`, `-h, --help` and `-v, --version`. Options accept `--port 3000` and `--port=3000`.

`noofpi prepare` writes the `.noofpi/*.d.ts` files without starting a server, so editor types work right after install. Run it from a `postinstall` script: `"postinstall": "noofpi prepare"`.

`noofpi typecheck` needs `vue-tsc` and `typescript` in the project. Arguments after `--` go to vue-tsc: `noofpi typecheck -- --project tsconfig.app.json`.

`noofpi preview` works with the `node`, `bun` and `docker` presets.

## Documentation

https://liorcodev.github.io/noofpi-docs/

## License

MIT
