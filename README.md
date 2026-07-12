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

- [CAD PWA architecture scope](docs/cad-pwa-scope.md) — the locked-in decisions and reasoning behind the stack.
- [Implementation plan](docs/implementation-plan.md) — the phase-by-phase build order.
