# Changing this repository

Read this before changing code, tests or docs here, after the [hard rules](../AGENTS.md#hard-rules). It lives outside
`AGENTS.md` so creation sessions do not load it on every turn; it does not ship in the creator kit.

## Repository map

| Path | What it is |
| --- | --- |
| `api/` | Server API (registration, accounts, generations) for the Edge functions and the Render worker, plus the client modules the kit ships |
| `supabase/functions/` | Edge functions `ai-fighter` (API), `ai-fighter-mcp` (hosted MCP) and the temporary `client-ip-probe`; `supabase/migrations/` is the database |
| `mcp/` | MCP tools: `server.mjs` holds the workspace tools, which `scripts/creation-tool.mjs` runs in process; `cloud.mjs`, `cloud/` and the other `edgeOnlyFiles` in `scripts/build-plugin-bundle.mjs` run only in the hosted MCP; the Render worker imports a few |
| `worker/` | Render validator worker and the `mcp.oddbout.com` gateway |
| `scripts/` | The CLIs behind `npm run`: creation tools, packing, gait, Dots, plugin build and release, deploy helpers |
| `host/` | Generation-host tools that make hosted fighters on a generation PC ([host/README.md](../host/README.md)) |
| `contracts/ai-fighter/` | The v1 package contract. The files its `SOURCE.json` lists, and `server/`, are byte copies of the game's ([Type checking](#type-checking)) |
| `deploy/` | Service and creation-environment settings (JSON); several ship in the kit |
| `tools/ai-fighter/` | Package validator, contract builder, gait and contact evidence |
| `plugins/` | Plugin sources: `ai-fighter` (skill `create-fighter`) and `oddbout-cloud` (hosted-MCP plugin). `ai-fighter/local-files.mjs` holds the shared path confinement, rename retry and file hashing, beside the launcher that imports it |
| `packages/oddbout` | The npm package behind `npx -y oddbout@latest connect`, which connects a terminal agent to the hosted MCP (`docs/CLOUD-MCP.md`) |
| `vendor/sprite-gen` | The pinned generation engine, a Git submodule ([sprite-gen](../AGENTS.md#sprite-gen)) |
| `website/`, `web/` | Pages `npm run site:build` builds into the creator site (plugin review sites, cloud connect) |
| `examples/sparring-bot` | A geometric test fixture, never a generated character |
| `docs/` | Guides and records; the map is [docs/README.md](README.md) |

## Commands

These exist in this repository's checkout; a creator-kit installation has only the creation scripts.

```sh
npm ci --ignore-scripts             # dependencies; ffmpeg comes from the system
npm run sprite:setup                # pinned sprite-gen in its own venv, plus img2webp and RIFE; heavy tests and generation need it
npm run test:fast                   # every suite except image packing, proxy and Python-engine suites
npm run test:heavy                  # only those slow suites
npm test                            # every suite in test/ and host/, including the strict type check
node --test test/<name>.test.mjs    # one suite (generation-host suites live in host/)
npm run typecheck                   # tsc alone; CI also runs the deno check below and a sprite-gen pin check
deno check --frozen --config supabase/functions/<name>/deno.json supabase/functions/<name>/index.ts
npm run spec:check && npm run validate -- examples/sparring-bot/fighter.json && npm run mcp:smoke
```

## Branches, tests and CI

- `main` is the working branch: branch from it and open pull requests against it. `codex/creator-hosting` was the kit
  and service branch until 2026-10-29 and is frozen at the commit that moved everything to `main`; never push to it.
  `codex/creator-pages` (the published site) and `codex/game-context` (the game's published creation context) are
  written by publishing tools; never commit to them by hand.
- Other sessions may be working in a shared checkout of this repository or the game's: do branch work in a
  `git worktree`, never switch a shared checkout's branch, and leave pulling it to the session working there.
- Run only the relevant tests locally ([Commands](#commands)). Pull requests to `main` run the `test` workflow, and a
  pull request merges only when it passes. Merges to `main` run nothing; `main`'s head runs it at most once every three
  hours, for everything merged since, and not at all when that tree already passed. Do not dispatch extra runs unless asked.
- One change, one run (about 11 minutes). Put a change and what it brings along in one pull request: an engine pin with
  its kit version, `host/pins.json` and records. Finish local checks before pushing. Open the pull request as a draft
  while it still changes (a draft runs no tests), then `gh pr ready` runs `test` once. A push after that waits four
  minutes before running, and a further push in that time replaces it: push a fix's commits together, not one by one.
  Fetch `main` first: a head that already contains `main` merges into the tree it was tested with, so the three-hourly run
  on `main` has nothing new to test.
- Never put `[skip ci]` or another GitHub skip marker (`[ci skip]`, `[no ci]`, `[skip actions]`, `[actions skip]`, a
  `skip-checks: true` trailer) anywhere in a pull request's last commit message, body included, even quoted: the
  required check then never reports.
- Stage files by name. `git add -A`, `git add .`, `git add -u` and `git commit -a` can stage `vendor/sprite-gen` as a
  rollback ([sprite-gen](../AGENTS.md#sprite-gen)).
- `AGENTS.md` and the docs and scripts listed in `scripts/build-plugin-bundle.mjs` ship in the creator kit, where
  creation agents read them. A rule removed there leaves users who pull `main` at once, and kit users at the next release.

## Type checking

- Every `api/`, `worker/`, `mcp/` and `scripts/` module starts with `// @ts-check` (after a `#!` line, if any);
  `npm run typecheck` (also in `npm test`) runs tsc over them under `strict`. Satisfy it with JSDoc types or casts, not
  runtime changes; a caught value is `catch (/** @type {any} */ error)`.
- Every Edge function's deno.json has the same `strict: true`, so `deno check supabase/functions/<name>/index.ts`
  agrees; the Edge deploy itself does not type-check. Deno's TypeScript is older than this kit's tsc and can infer less
  (an SDK callback's arguments, 2026-10-30), so the `test` workflow also runs `deno check --frozen` on every Edge
  function that has a deno.json; after typing a file an Edge function bundles, run it locally too.
- `scripts/edge-bundle.mjs` reads a JSDoc `import('…')` type as an import: in those files, name only modules the
  bundle already ships or its deno.json maps (an unmapped one makes the `fighter:edge` or `fighter:mcp` plan fail).
  The kit bundle reads imports the same way, so a kit file that names an Edge-only module makes `npm run plugin:bundle` fail.
- `contracts/` and `server/` carry no `// @ts-check` marker; `tsconfig.vendored.json` turns `checkJs` on for them and
  `npm run typecheck` runs it too. For a type error in a byte copy (the files `contracts/ai-fighter/SOURCE.json` lists),
  fix the game repository (`kaito_web/tsconfig.server.json` checks the same files), then copy the files here and run
  `npm run contract:vendored -- --pin`.

## Deploys

Merging to `main` starts no service deploy: the only workflow is `test`, and Render's auto-deploy is off. Creators who
clone or pull `main` from a repository link get the change at once. Each production part carries the import graph of
its entry point, so a shared module (`api/`, `mcp/`, `contracts/`, `server/`, `deploy/`) can reach several parts.
Procedures: `docs/CREATOR-HOSTING.md`.

| Part | Built from | Deployed by |
| --- | --- | --- |
| `ai-fighter` Edge function | `supabase/functions/ai-fighter/` and its imports | the game repository's `npm run fighter:edge` |
| `ai-fighter-mcp` Edge function | `supabase/functions/ai-fighter-mcp/` and its imports, with its own copy of `api/` | the game repository's `npm run fighter:mcp` |
| Database | `supabase/migrations/` | a migration applied on its own, never by a merge |
| Render validator and `mcp.oddbout.com` gateway | `worker/` and its imports (`api/http.mjs`, `client.mjs`, `submissions.mjs`, `profile-sets.mjs` and the modules under them, the package checks in `mcp/`, `contracts/`, `server/`; not `api/handler.mjs`), and `package.json` `dependencies` only (`npm ci --omit=dev`) | `npm run worker:deploy -- <full commit sha>` with the deploy hook from the user |
| Creator site | the game's private source, `website/`, `web/` and what `scripts/build-creator-site.mjs` imports | `npm run site:build`, then `npm run site:publish` |
| Creator kit and plugin | `plugins/ai-fighter/`, the runtime list and import graph in `scripts/build-plugin-bundle.mjs`, `vendor/sprite-gen` | the next kit release (`docs/PLUGIN-DISTRIBUTION.md`) |
| Generation PCs | the host files (`HOST_FILES` in `scripts/host.mjs`) and this repository at `KIT_REF` in `host/og` | a pull request moving `KIT_REF`; then the operator's `og self-update` and `og setup` on the official PC, and `npm run host:setup` after a pull on community hosts |

- Deploy the production `ai-fighter` Edge function only from the game repository with `npm run fighter:edge -- plan`,
  review its source/engine/live-version changes, then use `deploy --plan <id>` with the same options.
- Never upload this checkout directly through Supabase CLI/MCP or a hand-built payload: its duel engine is a null
  adapter. `scripts/edge-bundle.mjs --list` is inspection only; the game planner imports `edgeFiles` and supplies the
  real and retained engines.
- Deploy a `main` commit that passed `test`. Merges are tested only every three hours: when the commit has no passing
  `test`, run `gh workflow run test --ref main` and wait for it first.
- Verify the deployed release and served engines afterward. Do not overwrite a newer deployment from another session.
- Batch production changes: merge the pull requests that touch any part above together, right before their deploy,
  and deploy each affected part once. Work that reaches no part can merge when it is ready.
- Never write deploy hooks, tokens or their values into this public repository's files, commits or pull requests.
