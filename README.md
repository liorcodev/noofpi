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

## CLI

```
noofpi dev      Start the dev server with live reload
noofpi build    Build for production into .output/
noofpi start    Run the production build
```

Options: `--root <dir>`, `--port <port>`, `--host <host>`, `--preset <name>`.

## Documentation

https://liorcodev.github.io/noofpi-docs/

## License

MIT
