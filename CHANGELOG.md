# Changelog

All notable changes to noofpi are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

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
