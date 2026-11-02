# ODDBOUT distribution

**Current source-kit release: 0.6.13** (2026-11-03 KST: expression sheets and the profile-set kit command).

A registered fighter's profile set may now carry his expression sheet: six arena faces, the KO card's defeat face last (#282). 0.6.13
ships `npm run fighter:profile-set -- --front <pick> [--expressions <sheet>] --out <folder>`. It frames the chosen front, measures
the face square as hosted generation does, fits a 3:2 sheet to 1536 × 1024, runs the server's set-file parse and the validator's own
pixel checks, and writes `profile-set.json`, `front.webp`, `expressions.webp` and the round-face and KO previews. The kit carries
the contract (`api/profile-set-contract.mjs`) and the check (`worker/profile-set-check.mjs`), not the server API. The creation guides,
AGENTS.md and the create-fighter skill draw the sheet from the approved front and upload it with `assetId: expressions`. Tool results also
carry the site's deep links (`siteUrl`, #288). The contract, validators of the duel package and sprite-gen pin are unchanged.

Cloud `prepare_fighter_packaging` points to the reviewed 0.6.13 runtime once `ai-fighter-mcp` is deployed with
this pin. It also supplies the workspace execution instructions; the cloud cannot read Dots files. Install the locked Node
dependencies in the extracted `plugin/runtime/`, then run its `inspect_fighter_packaging` and `pack_fighter_package`
tools on the existing plan. There is no new generation or generation login.

- [Download the 0.6.13 ZIP](https://oddbout.com/creator-kit/0.6.13/6fdeedc579fc0455ac6d031ac32fff2bdcfa6e83408aff7fd308c74f0d0f178b/oddbout-0.6.13.zip)
- [Release manifest](https://oddbout.com/creator-kit/0.6.13/6fdeedc579fc0455ac6d031ac32fff2bdcfa6e83408aff7fd308c74f0d0f178b/release.json)
- [Download helper](https://oddbout.com/creator-kit/0.6.13/6fdeedc579fc0455ac6d031ac32fff2bdcfa6e83408aff7fd308c74f0d0f178b/fetch-creator-kit.py)

| Verified item | Value |
| --- | --- |
| ZIP size | 4,202,585 bytes |
| ZIP SHA-256 | `9b13237dc111cdf1ab6b1df3a664681cc92a358b37883e17da13979e986c2ef2` |
| Release manifest SHA-256 | `7342a12c389b14c7bbccce2334bb76b3aa85ae22b5507230956118bc11555285` |
| Runtime manifest SHA-256 | `908b4e723fe7da217ad9298ab6937cb3abf54ab8fcbcad4bd8bc74075e32afc3` |
| Helper SHA-256 | `b66c31ff833816dfa74c90d9155359d3fdd484dff8c12759e48addde01707592` (unchanged) |
| Archive build source | `b24d04641a79f49ff1cc51a6ff16cf937b99dcf8` (main after [PR #292](https://github.com/jeonghwanko/oddbout-starter/pull/292)) |
| Tested PR head | `d88e40af978f84e067637b603f7c3afae43f5d60` ([PR #292](https://github.com/jeonghwanko/oddbout-starter/pull/292)) |
| sprite-gen pin | `704cb9e5a34f16a0340e7fc6e46709a047ab02d4` (unchanged) |
| Kit Pages publication | `b6c5643705fe778ff1e3222e06a2aabb58086d3d` |

Full PR CI passed for #292 (and for #282 before it). The archive was built from a clean worktree at the main merge with the sprite-gen
submodule checked out at its pin; a trial build of the PR head before the merge already held the new command, the contract and the pixel
check and left `api/http.mjs` out. The trusted helper downloaded the published release, verified it and extracted all 742 archive files.
Locked production Node dependencies installed with no vulnerabilities reported. The extracted runtime reports version 0.6.13 and the
`fighter:profile-set` script, its `creation:tool` lists all 18 workspace tools, and its `fighter:profile-set` built a set from a house front
and sheet that its own validator check passed. No Python engine ran.

Publication added only three release files, preserved 6,366 existing files without changes or deletions,
and verified HTTP 200 and exact release bytes plus 12 unchanged site files at 2026-11-02T22:51:18.956Z. This release requires no game,
API or site build.

The Dots source pin is `b24d04641a79f49ff1cc51a6ff16cf937b99dcf8` (0.6.13). It is still a candidate, with saved-VM acceptance pending. A
scratch `node dots.mjs --install` at this pin installed the runtime (npm and sprite-gen setup exit 0, version 0.6.13 at that commit); Grok
sign-in, generation and delivery were not verified (`grok-generation-and-delivery-unverified`). The saved Dots environment was not
republished. No animation was generated and no registration was submitted during this release verification.

Earlier releases (0.6.12 back to 0.4.0) and their verification records are in [records/KIT-RELEASES.md](records/KIT-RELEASES.md).
When a new release becomes current, move the entry above there.

For installation and migration use [ODDBOUT-PLUGIN.md](ODDBOUT-PLUGIN.md). `plugin:bundle` now produces a
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
and ships source only: install locked Node dependencies in the extracted writable runtime.
It never copies the source checkout's output, venv, user home, credentials, node_modules or npm configuration.
The ZIP contains `plugin.json` at its root, the hosted ODDBOUT MCP configuration in `mcp.json` (streamable HTTP,
`https://mcp.oddbout.com/mcp`), the creation skill, an icon, the launcher and runtime source. MCP configuration
names no local command or path. Existing output is never overwritten.

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
under ignored `output/`. See [the reviewer cases](records/PLUGIN-REVIEW-CASES.md) for the scenarios to execute.
