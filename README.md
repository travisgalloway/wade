# wade

A CAD PWA built with SvelteKit, brepjs/OpenCascade, and three.js WebGPU.

## Developing

Install dependencies and start the dev server:

```sh
pnpm install
pnpm dev
```

## Building

```sh
pnpm build
```

Produces a static, client-only SPA (no SSR) via `@sveltejs/adapter-static`. Preview it with `pnpm preview`.

## Documentation

**[docs/](docs/README.md)** — start with the [architectural invariants](docs/architecture/invariants.md). Nine rules govern this codebase, most are enforced by CI, and the source cites them by number.

- [Architecture](docs/README.md#architecture--how-it-works-today) — threading model, kernel, rendering, orientation, input, state.
- [Roadmap](docs/roadmap/phases.md) — Phases 0–2 are done; Phase 3 (PWA hardening) is next.
- [Testing](docs/guides/testing.md) and [conventions](docs/guides/conventions.md).
