# rededit

A more efficient editor for REDCap projects.

Early days: this repo currently holds the core logic engine (`src/logic`) and a small demo editor for REDCap's branching/calc language.

## What's here

- `src/logic`: a lossless lexer, an error-tolerant parser, a type checker with lint rules and fixes, completion, signature help and highlighting for REDCap logic. Plain TypeScript, no runtime dependencies, runs in browsers and Node.
- `demo/`: a dependency-free editor page (a textarea over a highlighted `<pre>`) wired to `src/logic`, using a made-up longitudinal project in `demo/mood-study.ts`.
- `test/`: `node:test` suites, including a fuzz test that throws random input at every entry point.

## Develop

Requires Node 22.18 or later (it runs the TypeScript sources directly).

```sh
npm ci
npm test           # run tests
npm run typecheck  # tsc --noEmit
npm run demo       # build, then serve the demo at http://localhost:8080/demo/
```

The only dev dependency is TypeScript.
