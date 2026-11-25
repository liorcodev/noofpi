# Changelog

All notable changes to noofpi are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- `noofpi preview` builds, then runs the production build (`node`, `bun` and `docker` presets).
- `noofpi prepare` generates the `.noofpi/` type declarations without starting a server, for a `postinstall` script.
- `noofpi typecheck` runs `prepare`, then `vue-tsc --noEmit` (arguments after `--` go to vue-tsc).
- `--open` opens the browser once `dev`, `start` or `preview` is ready.
- `--help` / `-h` and `--version` / `-v`.

### Changed

- The CLI parses its options with `node:util`'s `parseArgs`: `--port=3000` works, a missing option value or an unknown option is an error, and an invalid `--port` is rejected instead of becoming `NaN`.
- `noofpi --help` exits with code 0. An unknown command exits with code 1 and names the commands.

## [1.2.0] - 2026-11-18

### Added

- `Register` in `noofpi/runtime` has separate `localRoutes` (`lfetch`) and `remoteRoutes` (`dfetch`, `pfetch`, `sfetch`) keys. `useDoofpi()` and `useDoofpiFetch()` type their client with the routes of its mode, taken from the `{ mode }` option or, without one, from the new `defaultFetch` key (the `doofpi.fetch` of the config). A key that is not registered falls back to `routes`.

### Changed

- `.noofpi/doofpi.d.ts` registers the `routes` export of `server/doofpi.ts` as `localRoutes` (plus `defaultFetch`) instead of `routes`, so it no longer clashes with `routes` registered in your own `env.d.ts`.
- `useDoofpi()` and `useDoofpiFetch()` are overloaded. `useDoofpi<OtherRoutes>()` and `useDoofpiFetch<T, OtherRoutes>()` keep working.

## [1.1.2] - 2026-11-18

### Fixed

- `useAsyncData`, `useDoofpiFetch` and page loaders keep the message of a doofpi API error (`DoofpiClientError`, e.g. `401 Invalid credentials`) when it happens during SSR, instead of replacing it with `Internal Server Error`. Other unexpected errors are still hidden.

## [1.1.1] - 2026-11-17

### Changed

- vue-router's console diagnostics (for example `[VUE_ROUTER_R0004] No match found for location with path ...` on an unknown URL) are silenced. `nostics`, which vue-router reports through, is aliased to a no-op module in the Vite config, and `vue-router` is bundled for SSR so the alias applies there too.

## [1.1.0] - 2026-11-17

### Added

- `noofpi dev` emulates Cloudflare bindings (vars, KV, D1, R2, ...) with Wrangler's `getPlatformProxy` for the `cloudflare-*` presets, so `env` is available in server middleware and doofpi endpoints. Needs `wrangler` installed.

## [1.0.0] - 2026-11-16

### Added

- First release: a Vue + Vite full-stack framework built around doofpi.
- File-based pages, layouts, route middleware and an error page.
- SSR or SPA, switchable globally or per route with `routeRules`.
- A built-in doofpi server (`server/doofpi.ts`) and a doofpi client with four fetch modes: `lfetch`, `pfetch`, `dfetch` and `sfetch`.
- Typed i18n, fonts and images, Tailwind CSS v4 and auto-imports.
- Security headers, CSRF checks and a request body limit by default.
- `noofpi dev`, `noofpi build` and `noofpi start`, with `node`, `bun`, `docker`, `cloudflare-worker`, `cloudflare-pages` and `github-pages` build presets.
