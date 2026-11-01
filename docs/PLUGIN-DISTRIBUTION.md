# ODDBOUT distribution

0.6.8 source candidate: packaging/session progress use file and contract checks only; numerical and visual
quality reports are deferred diagnostics. Its pinned engine adds lossless WebP-only intermediate packs and
explicit intermediate budgets up to 200 MB. Existing frames, timings, selections and final upload limits remain.
Publication details will be recorded after the immutable ZIP and public files are verified.

**Current source-kit release: 0.6.7** (2026-11-01: explicit public context file handoff; the Dots pin moves to this release).

Adds an explicit per-invocation public game-context file and receipt to the context and workspace-tool CLIs.
The receipt checks the configured source, raw-byte SHA-256 and Git blob identity, and a 15-minute retrieval window.
It is local integrity metadata, not a signed origin or independent freshness certificate. The original trusted
fetch and official file-delivery route remain required. Revision, missing-motion, user selection and quality
gates are unchanged; failed file checks never silently fall back to networking. The CLIs also reuse direct-fd
JSON output to avoid initializing Node's socket-backed stdout in restricted hosts.

The guides distinguish Grok device login from the host's per-command execution approval. A default-sandbox
`EPERM` alone does not establish that an existing approved Grok route is broken. No login, generation,
credential migration, automatic permission escalation or security-policy change is part of this release.
Publication did not update `deploy/dots-release.json` or active Dots workspace bindings; the pin moved separately (below).

- [Download the 0.6.7 ZIP](https://oddbout.com/creator-kit/0.6.7/9094ac2c755abb0fad0f3edf51875dd3b335d1c06f7fd17099100adab814a6aa/oddbout-0.6.7.zip)
- [Release manifest](https://oddbout.com/creator-kit/0.6.7/9094ac2c755abb0fad0f3edf51875dd3b335d1c06f7fd17099100adab814a6aa/release.json)
- [Download helper](https://oddbout.com/creator-kit/0.6.7/9094ac2c755abb0fad0f3edf51875dd3b335d1c06f7fd17099100adab814a6aa/fetch-creator-kit.py)

| Verified item | Value |
| --- | --- |
| ZIP size | 4,192,281 bytes |
| ZIP SHA-256 | `22992a2a8354b088f6d9f4c64a880eb92be02d6cde3ad62027bc3921e486181c` |
| Release manifest SHA-256 | `f5e49d4da32536efb60cdd8d993fc373311cc7963c1714169d2c21961974f4a2` |
| Runtime manifest SHA-256 | `8fa8f4520cb156f84e85e6acbd897a8c5f79243d79ba676a31e2b561cc73bb7d` |
| Helper SHA-256 | `b66c31ff833816dfa74c90d9155359d3fdd484dff8c12759e48addde01707592` (unchanged) |
| Build source | `7ded1965102e6f9c386fe50a5b142d06fe25071d` ([PR #240](https://github.com/jeonghwanko/oddbout-starter/pull/240)) |
| Main merge | `dbcb3d06614c29d5018f37260557faa36053c810` |
| Pages publication | `2a53b5b8d2bc54564718823c8d54a50bc17e674f` |

The PR's complete CI passed before merge, including the full test suite, sprite-gen setup and Edge type checks.
Local validation passed 59 focused tests and strict typechecking; independent source review found no actionable defect.
A separate Dots scratch checkout of the exact build commit installed locked dependencies and passed three focused
test files. Ten actual CLI calls under default restricted execution loaded the public context through file input,
retained missing-motion, failed-quality and changed-revision blockers, and rejected malformed or expired receipts.
The 20,932-byte context matched a fresh full connected-GitHub retrieval; no production module was rewritten for the test.

The trusted helper re-downloaded the public manifest and ZIP over HTTPS, verified both archive and runtime manifest,
and extracted 738 files. The built archive's 729 runtime source files matched the checkout byte for byte; the generated
package manifest reported 0.6.7. The downloaded transport, both CLIs, fd writer, READMEs and affected bundled guides
matched those sources. The downloaded launcher's read-only status reported `installed: false`.
Publication added only the ZIP, manifest and helper, preserving all 6,423 previous site/release files with no changes
or deletions. Public checks returned HTTP 200 and matching bytes for all three release files and 12 existing site files.

A separate credential-free network diagnostic also distinguished execution permissions: normal host-approved
per-command execution reached the public context (HTTP 200) and Grok's proxy root (HEAD HTTP 404), preserving the
configured proxy, destination rules and TLS. That approval runs a command outside its default sandbox; it is not a
network-only grant. These responses establish reachability, not authenticated generation. Neither this diagnostic
nor the kit verification logged in, generated, changed active workspace bindings, or republished a saved environment.

After publication `deploy/dots-release.json` moved to `dbcb3d0` (0.6.7), the main merge whose tree equals the build
source; it stays `candidate` with `savedVmAcceptance: pending`. A real `node dots.mjs --install` from that change into a
fresh scratch runtime home and workspace cloned the commit, ran the npm and sprite setup steps (both exit 0; sprite-gen
3.4.0 imports), bound 0.6.7/`dbcb3d0` with a clean tree and matching vendor pin, and stopped at Grok sign-in, which was
not performed. Generation stayed unverified and was not dispatched. This does not republish the saved Dots environment:
its new tasks keep the front-door checkout it was prepared with until the preparer reruns
`deploy/dots-environment/install.sh` and republishes. Existing Dots tasks keep their workspace binding; no active Dots
conversation, runtime, session or generated result was changed.

**Previous source-kit release: 0.6.6** (2026-11-01: variable-frame Dots gait review; the Dots pin moves to this release).

The Dots gait review accepts the contract's walk 12–32 and run 10–16 frame cycles (#236) instead of requiring 16/12, so a
valid cycle is not resampled to fit. Every actual frame still needs its own phase; contact measurements, visual review and
evidence bound to the final pixels and timing remain required. The kit guide names the current version (#235). 0.6.6 also
carries 0.6.5's proxy-aware context fetch.

- [Download the 0.6.6 ZIP](https://oddbout.com/creator-kit/0.6.6/7d75ec86c87a2b2e3e6f8aeacc90702987022d0b698211b8f8b35d9d5c48c02d/oddbout-0.6.6.zip)
- [Release manifest](https://oddbout.com/creator-kit/0.6.6/7d75ec86c87a2b2e3e6f8aeacc90702987022d0b698211b8f8b35d9d5c48c02d/release.json)
- [Download helper](https://oddbout.com/creator-kit/0.6.6/7d75ec86c87a2b2e3e6f8aeacc90702987022d0b698211b8f8b35d9d5c48c02d/fetch-creator-kit.py)

| Verified item | Value |
| --- | --- |
| ZIP size | 4,166,083 bytes |
| ZIP SHA-256 | `1cb68930132e9e8fff4d03c86c26bbfdf6d597212feb5fc72c902417df859af4` |
| Release manifest SHA-256 | `18e2349bc4e958b60ec8f8a9fd6a85d7ebc71e7473a38f097e83b180ce20b180` |
| Runtime manifest SHA-256 | `7f615b1c983cc6ee4a424bb41a37b550036f70cbc2337223c49736bf3a351c05` |
| Helper SHA-256 | `b66c31ff833816dfa74c90d9155359d3fdd484dff8c12759e48addde01707592` (unchanged from 0.6.5) |
| Build source | `0a692cf886e7a51ecc90db781b331057080b59cb` (merge of [PR #237](https://github.com/jeonghwanko/oddbout-starter/pull/237)) |
| Pages publication | `695e86cf9118bd0a46573d6b3de790251bea80c9` |

The build source's tree equals PR #237's head `50bfb86`, whose CI passed before the merge. The trusted helper downloaded
the public manifest and ZIP over HTTPS into a fresh directory, verified the archive and runtime manifest, and extracted
736 files. The 89 tracked runtime source files matched the build source byte for byte; `package.json` differs only by the
bundler's removal of repository-only scripts. The extracted `tools/ai-fighter/gait.mjs` reads the contract's frame range,
`docs/ODDBOUT-PLUGIN.md` names 0.6.6, and `mcp/creation-context.mjs` defaults to `runtimeFetch`. The extracted launcher's
read-only `--status` reported `installed: false` and created no files.

Publication added only the ZIP, manifest and helper, preserved all 6,420 existing site/release files (none modified or
deleted), and verified HTTP 200 and exact bytes for the three public files plus unchanged site entry documents. The 0.6.5
ZIP and manifest still serve their recorded hashes. No generation, login or registration was run.

`deploy/dots-release.json` then pinned `0a692cf` (0.6.6), still `candidate` with `savedVmAcceptance: pending`. A real
`node dots.mjs --install` from this change into a fresh scratch runtime home and workspace cloned that commit, ran the
npm and sprite setup steps (both exit 0; the engine imports), bound 0.6.6/`0a692cf` with a clean tree and matching vendor
pin, and stopped at Grok sign-in, which was not performed. Generation stayed unverified and was not dispatched. This
does not republish the saved Dots environment: its new tasks keep the front-door checkout it was prepared with until the
preparer reruns `deploy/dots-environment/install.sh` and republishes. Existing Dots tasks keep their workspace binding;
no active Dots conversation, runtime, session or generated result was changed.

**Previous source-kit release: 0.6.5** (2026-11-01: use the host proxy for game-context fetches).

The CLI and workspace session/job context lookups now default to `runtimeFetch`, preserving the host's HTTP(S) proxy,
`NO_PROXY` and CA settings. Host execution permission remains separate: this fix does not grant network access, retry
through a direct connection or bypass an `EPERM` denial. Both READMEs, the context/network guide, Dots quickstart and
document index were updated. The ZIP also includes the Codex Git plugin installation guide added since 0.6.4.

- [Download the 0.6.5 ZIP](https://oddbout.com/creator-kit/0.6.5/a7148fe349f737cfda5a64e277edfe8f81b6826e098dde63d736af4525b8c33d/oddbout-0.6.5.zip)
- [Release manifest](https://oddbout.com/creator-kit/0.6.5/a7148fe349f737cfda5a64e277edfe8f81b6826e098dde63d736af4525b8c33d/release.json)
- [Download helper](https://oddbout.com/creator-kit/0.6.5/a7148fe349f737cfda5a64e277edfe8f81b6826e098dde63d736af4525b8c33d/fetch-creator-kit.py)

| Verified item | Value |
| --- | --- |
| ZIP size | 4,183,015 bytes |
| ZIP SHA-256 | `2de2c6bd05e4e915d9cffc7c4b5d5932c67be2d51c36c24ebc3e5b32bd04aa53` |
| Release manifest SHA-256 | `c3a6cb8cbee8b8c2a545800b0ea5c6a89c1ecb533068752e0b4b78d3046609b4` |
| Runtime manifest SHA-256 | `7201a309e1015f1b684d591a4132ef35573c036c11fd0f94339a11af1256b7c6` |
| Helper SHA-256 | `b66c31ff833816dfa74c90d9155359d3fdd484dff8c12759e48addde01707592` |
| Build source | `e001103ebf590b4cca37f85b5f1ef609821dce36` |
| Pages publication | `2a10a36067b553746611f82139254d2de89973ad` |

The source tree matches [PR #233](https://github.com/jeonghwanko/oddbout-starter/pull/233)'s merge commit
`68051eb47f67054c1538ce886f5b6f59fcc10d15`; CI passed before publication. Twenty focused context/proxy/bundle/release
tests, strict typechecking and the Codex skill synchronization check also passed locally.

The trusted helper downloaded the public manifest and ZIP over HTTPS into a fresh local verification directory,
verified the complete archive and runtime manifest, and extracted 736 files. All 89 tracked runtime source files,
including both READMEs and bundled docs, and all seven plugin source files matched the build source byte-for-byte.
The downloaded `mcp/creation-context.mjs` imports `runtimeFetch` and uses it as the default request function;
`api/runtime-fetch.mjs` is present. A loopback-only proxy test of that extracted module observed its CONNECT request
for `raw.githubusercontent.com:443` and the expected sanitized denial without forwarding traffic. This proves the
packaged proxy route, not permission in every Dots host. The locally extracted launcher's read-only status check
also passed without installing a runtime or creating a workspace.

Publication added only the ZIP, manifest and helper, preserved all 6,417 existing site/release files, and verified
HTTP 200 and exact bytes for all three public files plus unchanged site entry documents. Existing immutable releases
remain available. The active Dots runtime, sessions, jobs, selected versions and generated results were not modified
by this release; no generation, login or registration was run. The connected cloud App, `deploy/dots-release.json`
and sprite-gen pin were not updated, and no service redeployment was needed. Keep in-progress creation on its current
runtime; install the new kit separately for a new environment or review an update after that work finishes.
At publication that Dots pin was still 0.6.0 (`c102167`), whose context fetch uses plain `fetch`, so
`node dots.mjs --install` did not deliver this fix; 0.6.6 moved the pin.

Erratum (found after publication): the ZIP's `docs/ODDBOUT-PLUGIN.md` still names kit 0.6.4 and `oddbout-0.6.4.zip`.
The immutable ZIP keeps that text; `main` corrects it, and the bundle test now checks it against the kit version.

**Earlier source-kit release: 0.6.4** (2026-11-01: use the existing cloud App; keep optional workspace tooling separate).
Ordinary ChatGPT/Dots use starts with the existing available ODDBOUT cloud App, which carries account tools and the creation skill together.
Do not import this source ZIP as a second cloud plugin. The ZIP is reviewed runtime/source delivery for an explicitly chosen workspace,
or a desktop-client package; its version is independent of the connected App. Private App IDs and links are not public distribution links.

The 2026-11-01 connection cleanup removed the old private 0.6.2 ZIP plugin after explicit approval of permanent deletion.
The same Dots conversation then verified the existing account through native `get_profile`, read the new App's skill and support document,
and listed only that App's creation skill across all pages. The connected App remained version 1.0.1. This is account-specific evidence,
not proof of public availability or generation. Published old kit paths remain immutable release history, not cloud App installation instructions.

Published at
`https://oddbout.com/creator-kit/0.6.4/f817d405588b298e94d258b2249117ed8de18b8c69b3efcff860ea20cd799377/release.json`
(manifest SHA-256 `64a5250d8eb5d850c57dbe00935aacc08b1d5fa2166f4c86e53b238562b5748c`, helper `fetch-creator-kit.py`
`b66c31ff833816dfa74c90d9155359d3fdd484dff8c12759e48addde01707592`, ZIP `35cccb4d6e20e23c51e006f11f4762f26590610de45f9c30dce0033df81db870`,
4,179,082 bytes; Pages commit `5b1c9d5d689ec9536201f4faf7a2e2762504a568`, live-verified).
Built from `955ee5a49707b47a415b08f7a4df08c8f2a04d37`; its tree matches PR #227's merge commit `14a0da291c03aae608d29b3a5c87ec4d88643ccd` (CI passed).
The trusted helper inspected and extracted the actual ZIP. All 88 tracked non-vendor runtime files, including both READMEs and bundled docs,
and all three skill files matched the source commit byte-for-byte. The runtime manifest verified the remaining bundled files;
the extracted launcher's read-only status passed without installation or generation. Neither the removed private ZIP ID nor the private App ID appears in the archive.
Publication added only three release files, preserved all 6,414 existing files, and verified public bytes and unchanged site entry documents.
This release updates the source kit and its documentation; it does not update the connected App's saved package, OAuth grants or version.

**Earlier source-kit release: 0.6.3** (2026-11-01: distinguish desktop MCP configuration from the ChatGPT/Dots cloud App connection, preserve other clients' setup, and add the creation skill to the same connected App).
Published at
`https://oddbout.com/creator-kit/0.6.3/a228c3b3d1c04f934b92647e9dda4beab5ebf08b4582f7f696ca681645fa1361/release.json`
(manifest SHA-256 `720e4cf0fb12dd69a1a8b29ae6565c963ea99bbd6cfdae41e8453a8c4084dbe6`, helper `fetch-creator-kit.py`
`b66c31ff833816dfa74c90d9155359d3fdd484dff8c12759e48addde01707592`, ZIP `ea511c1646e1a561e2966624b61ed1fbc83045b4324d74e096eb2b9eda447d72`,
4,176,688 bytes; Pages commit `d510f27bc2692c4f92ab1665acb5c6990dbd658d`, live-verified).
Built from `1b2ee05e082ee9223de0c97d163ddcb2449aca12`; its tree matches PR #225's merge commit `aca67bda6c6055d64726cf0866e7d4b9a339d5ed` (CI passed).
The trusted helper inspected and extracted the actual ZIP. All 22 bundled README/docs and 88 tracked non-vendor runtime files matched the source commit byte-for-byte;
the runtime manifest verified the remaining bundled files, and the extracted launcher's read-only status passed. Publication added only three release files,
preserved all 5,837 existing files, and verified public bytes and unchanged site entry documents.

The separate connected App received the skill and runtime as version 1.0.1 through a guarded update. Its existing App binding and complete presentation were
read back unchanged; no root MCP declaration was added. This App version is independent of the source kit version. Account verification and actual generation/delivery
remain separate checks; publishing this ZIP does not create or connect an App for another user.

Previous release: 0.6.2 (2026-11-01: distinguish Dots installation/account verification from public discovery; preserve existing connections; prevent an already-cancelled job from starting its engine).
Published at
`https://oddbout.com/creator-kit/0.6.2/b23c8ebc112649b33c946eac4a16aeb75c723739b201c470aed03defca1703af/release.json`
(manifest SHA-256 `67e2d19f26613a69d58dda9b42de7b9f24d2b87c2b228eeee9dece0273512bb6`, helper `fetch-creator-kit.py`
`b66c31ff833816dfa74c90d9155359d3fdd484dff8c12759e48addde01707592`, ZIP `41bb12e41be285fbd452c6fa15b1041e52f39571d38d02369a7fc1983de5660b`,
4,057,211 bytes; Pages commit `3359f0f047fed168e210f2287676acefe66468cd`, live-verified).
Built from `a07ab17c37e768d565b4306da26645cd0589487a` (PR #219, merged after CI passed). All kit inputs match the merge commit;
the concurrent `host/og` pin change is not a kit input. The trusted helper inspected and extracted the actual ZIP,
all 22 bundled README/docs and all 88 tracked runtime source files (excluding the generated package manifest) matched the source commit byte-for-byte,
and the extracted launcher's read-only status and offline/public discovery checks passed. Publication added only the three release files,
preserved all 5,834 existing files, and verified public bytes and unchanged site entry documents.

A private account plugin was created from this exact ZIP with version 0.6.2; its stored MCP URL, OAuth configuration, skill and cancellation guards
were read back. The ZIP import exposed a desktop MCP connection, not a connected ChatGPT/Dots App. A plugin-list screenshot and public discovery did not establish native Dots tool exposure.
A separate connected ODDBOUT App subsequently returned native `get_profile` in the intended Dots conversation. The source ZIP and that App are distinct installation paths.
Private account IDs/links are not portable distribution identifiers and are not published here. Saved-Dots-VM creation remains a separate acceptance check,
and `deploy/dots-release.json` remains independently pinned.

Earlier release: 0.6.1 (2026-11-01: both READMEs, the document index, starting guide and current MCP connection/migration guides now ship in the ZIP).
Published at
`https://oddbout.com/creator-kit/0.6.1/1032b5d1c84c95599922d511f6f3fb172b3d003e22582c0228893f537befe5e1/release.json`
(manifest SHA-256 `f5d8996fb93e1f5a3427de66da96318acba6a6d574cf7540e98783f0008be0db`, helper `fetch-creator-kit.py`
`b66c31ff833816dfa74c90d9155359d3fdd484dff8c12759e48addde01707592`, ZIP `b21017f1e622ebbbd998ff31188790cd2787b8a55ec71dd2051fa0777b03ceb5`,
4,050,942 bytes; Pages commit `db0056bebba4bb9ddce5321ae5ed7431f6edd440`, live-verified).
Built from `0c6f04a3233f2cd92bb7e16842c4b9d9379b1d28` (merged in PR #213 after CI passed). The trusted helper inspected and extracted the actual ZIP,
all 22 bundled README/docs files matched that commit byte-for-byte, and the extracted launcher's read-only status check passed.
Publication added only the ZIP, manifest and helper, preserved all 5,831 existing files, and verified public bytes and unchanged site entry documents.
These checks do not certify ChatGPT ZIP import or saved-Dots-VM creation. The separate Dots source candidate in `deploy/dots-release.json` remains pinned independently.

Earlier release: 0.6.0 (2026-10-28: the source plugin included hosted ODDBOUT MCP configuration for desktop clients and the creation skill; ChatGPT/Dots require an App connection). Published at
`https://oddbout.com/creator-kit/0.6.0/a6f8a9cea1654b3ec27e5ea8b803fb04271fd2e13a62e41ff6805c7b6ea11fe3/release.json`
(manifest SHA-256 `32f59f872444d491080fc55b02a8c242dddfb181ae89a0edf101390bfd723a76`, helper `fetch-creator-kit.py`
`b66c31ff833816dfa74c90d9155359d3fdd484dff8c12759e48addde01707592`, ZIP `6ec11d47407d7c32de4bebfa4110ab0b384afe78f748dcb20b5de2e3e10d9445`,
Pages commit `6daeb9c`, live-verified). A release's own helper fetches it: 0.6.0's helper expects `mcp.json`, older releases' helpers `.app.json`.
Earlier: 0.5.4 (stoppable, time-limited generation jobs, faster readiness and file checks; 0.5.3 added faster packing and gait checks, resumable device sign-in, recoverable version copies; 0.5.2 added lock recovery, recorded jobs and contract-derived profile limits; 0.5.1 restored the projected-ground module missing from 0.5.0; sprite-gen-agent engine; 0.4.0 was the last with the hash-bound patch). Use [ODDBOUT-PLUGIN.md](ODDBOUT-PLUGIN.md). `plugin:bundle` now produces a
source-only ODDBOUT ZIP with the creation skill and desktop-client hosted MCP configuration (`mcp.json`); it no longer embeds
Windows node_modules or starts a local MCP. Install locked dependencies in the extracted writable runtime.
The 0.2.x Windows bundle details below are historical and do not describe the current bundle or install ID.

## Current source distribution and VM delivery

The source bundle includes both READMEs, the document index, starting guide and creation/connection guides, including the unified MCP migration instructions.
Repository-only operations and research docs and gameplay media remain in the repository; the bundled index links to them.
From the pinned vendor tree, the source bundle omits only `vendor/sprite-gen/docs/assets/` documentation demonstration media.
The pinned upstream source, package assets, workflow text and Apache-2.0 LICENSE/NOTICE remain included.
Upstream Markdown image links into the omitted directory are not offline previews; use the upstream
repository at the pinned revision if those examples are needed. The builder records every omission,
recomputes the runtime manifest, and enforces a 20 MB bundle budget (a product budget, not a universal ChatGPT limit).

```sh
npm run plugin:bundle -- output/new-source-bundle
npm run kit:release -- output/new-source-bundle output/new-kit-release
```

`kit:release` verifies the actual ZIP and produces an additive `public/creator-kit/<version>/<content-id>/`
tree with three files: the ZIP, `release.json`, and `fetch-creator-kit.py`. The private `release-report.json`
contains the reviewed manifest/helper hashes, a download-only network plan, and explicit untested states.
Paths include both archive and helper content identity. Nothing is published, installed or logged in by this command.
Do not use the whole-site `site:publish` command with this partial tree; it does not accept partial kit releases.
Publishing must preserve the existing site and older immutable release paths, then verify all three public files.

Use the additive publisher after reviewing the manifest hash. The first command performs local and remote
read-only checks. Supply a fresh attempt directory for each run; preserve failed/unknown attempts and inspect
the remote ref before retrying. Publication is authorized separately from artifact preparation.

```sh
node scripts/publish-creator-kit.mjs output/new-kit-release output/kit-publish-check <reviewed-manifest-sha256>
node scripts/publish-creator-kit.mjs output/new-kit-release output/kit-publish-run <reviewed-manifest-sha256> --publish
```

The publisher uses the current Pages tree as its base, verifies all existing Git objects remain unchanged
(apart from parent directory trees required for the new path), and adds only the three reviewed files.
It rejects immutable-path collisions and concurrent branch changes, never forces a ref, and verifies actual
public bytes plus the unchanged site entry documents after publication. It leaves the site's `deployment.json`
unchanged; `publication-result.json` records this separate kit release. A later whole-site publisher restores
the existing `creator-kit/` tree after verifying the new site's own artifact and blocks staged changes or deletions
to those releases. Do not combine a new kit payload into a whole-site artifact.

Use a trusted copy of `scripts/fetch-creator-kit.py` (or verify a downloaded helper against the independently
reviewed report before executing it). The agent, not the user, supplies actual reviewed hashes and paths:

```sh
python3 fetch-creator-kit.py download --manifest-url <reviewed-release-url> --manifest-sha256 <reviewed-sha256> --destination <new-absolute-directory>
```

For offline validation, replace `--manifest-url` with `--manifest-file <local-release.json>` and add
`--archive <local-zip>`. The script requires HTTPS on the approved origin for network reads, preserves
host proxy/CA policy, rejects redirects and unsafe archives, and never overwrites an existing destination.
It verifies both complete archive identity and runtime inventory before extraction. Failure records remain
in the attempt directory. It performs no dependency installation, login, generation, registration or policy changes.

The ZIP has `launcher.mjs` at its root; this helper extracts it as `<destination>/plugin/launcher.mjs`.
Initialize a separate per-user runtime/workspace and run `--status`, then install locked dependencies explicitly.
Windows/local extraction is not evidence of a successful Dots VM download or Library recovery.
See [ENVIRONMENT-ONBOARDING.md](ENVIRONMENT-ONBOARDING.md#library-전송-장애-이후의-전달-계획-2026-10-26)
for the phased plan and the separate, not-yet-implemented private user-file path.

## Previous Windows-only distribution (0.2.x–0.3.x)

The local checkout plugin is installed separately from a public directory listing. Version 0.2.0 adds
a self-contained **Windows x64 Node MCP bundle**. Node.js 22.12+ must be on PATH. Python 3.11+ and
the pinned sprite-gen environment are installed explicitly on the creator's computer before generation.
Generation provider accounts and any usage charges belong to that creator.

## Build and install the portable package

```sh
npm run plugin:bundle -- output/ai-fighter-portable
codex plugin marketplace add /absolute/path/to/output/ai-fighter-portable
codex plugin add ai-fighter-creator@ai-fighter-local
```

This uses the same marketplace identity as the checkout-linked development plugin, so changing
the marketplace source upgrades the existing plugin rather than installing a second active namespace.
When `ai-fighter-local` is already configured from a different build directory, remove its source with
`codex plugin marketplace remove ai-fighter-local` before adding the new directory, then run
`codex plugin add ai-fighter-creator@ai-fighter-local` to refresh the installed version.

The builder uses the pinned clean sprite-gen-agent tree (`vendor/sprite-gen`), retains its Apache-2.0 LICENSE and NOTICE,
and installs Node production dependencies from the lockfile with lifecycle scripts disabled.
It never copies the source checkout's output, venv, user home, credentials or npm configuration.
The ZIP contains `plugin.json` at its root, one stdio server in `mcp.json`, the creation skill, an icon,
the launcher, runtime source and Node dependencies. `${PLUGIN_ROOT}` resolves installation paths;
no maintainer path is embedded in MCP configuration. Existing output is never overwritten.

On first use the launcher verifies the bundled runtime bytes and copies them into
`~/.ai-fighter/creator/runtimes/<bundle-hash>/`. This writable copy holds its own sprite-gen venv.
Projects live in `~/.ai-fighter/creator/workspace/`; an upgrade keeps that workspace. Existing account
sessions remain at the login helper's usual `~/.ai-fighter/client.json`. The launcher performs no
network install, login, generation or upload. Host execution permissions still apply.

For testing, set `AI_FIGHTER_CREATOR_HOME` to a new absolute directory. `AI_FIGHTER_ROOT` can name
an explicit existing project workspace. In the new Dots bootstrap contract, `node launcher.mjs --status`
only verifies and reports paths. `node launcher.mjs --install --manifest-sha256 <reviewed-runtime-manifest-sha256>`
explicitly initializes the writable runtime without starting MCP. See [DOTS-QUICKSTART.md](DOTS-QUICKSTART.md)
for provenance, dependency installation and resume. Older released launchers retain their original contract.
The runtime is trusted local software, not an OS sandbox;
do not run unreviewed commands or recipes from someone else's project.

The build report and checksum describe only that build. The ZIP must be rebuilt after source changes.
Other OS/CPU combinations are not yet validated; do not advertise them as supported.

## Listing links in 0.2.1

Version 0.2.1 sets the following published URLs in `extensions.com.openai.interface`:

| Field | Public URL |
| --- | --- |
| `websiteURL` | https://oddbout.com/ai-fighter-creator/index.html |
| `supportURL` | https://oddbout.com/ai-fighter-creator/support.html |
| `privacyPolicyURL` | https://oddbout.com/ai-fighter-creator/privacy.html |
| `termsOfServiceURL` | https://oddbout.com/ai-fighter-creator/terms.html |

The English policies link to Korean translations. The publisher is Lucas Foundation and the policy
effective date is 2026-10-22. Both the checkout-linked builder and portable builder copy this manifest;
the portable build report includes the four URLs. Build a new 0.2.1 package instead of editing an
installed 0.2.0 cache. Upload the new ZIP after organization allowlisting; changing local metadata
does not create or update a Platform directory draft. Review footage remains outstanding.

## Public directory status and prerequisites

The ZIP is a distribution candidate, **not an approved public app**. Installation from a local
marketplace does not imply publication. Official local MCP submissions currently require OpenAI
partner eligibility and organization allowlisting. The submission flow then requires a verified
publisher identity. See the [desktop-only guide](https://developers.openai.com/plugins/deploy/desktop-only)
and [submission requirements](https://developers.openai.com/plugins/deploy/submission).

Before public submission:

- Obtain OpenAI's confirmation that the submitting organization is allowlisted.
- Complete the developer/organization identity verification in the Platform portal. Use that identity
  for `extensions.com.openai.interface.developerName`; do not invent a verified publisher.
- Keep the published privacy and terms pages and the four listing URLs above current. Account data,
  local project files, provider uploads, registration storage and retention must be described accurately.
  A source-code license alone is not the service's terms or privacy policy.
- Run five positive and three negative reviewer cases against the actual release. Provide reviewer
  access separately in the secure portal if required, plus an accessible video of the real workflows.
  Automated tests do not prove successful media generation or registration.
- Upload the ZIP with its local MCP configuration after allowlisting, follow portal findings, and submit
  for review. Publish only after approval. Do not upload account credentials, local work output or
  support correspondence as part of the public package.

The repository intentionally contains no organization ID, support conversation, reviewer credentials,
identity documents or invented demo URL in its distributable metadata. Local request records belong
under ignored `output/`. See `PLUGIN-REVIEW-CASES.md` for the reviewer scenarios to execute.
