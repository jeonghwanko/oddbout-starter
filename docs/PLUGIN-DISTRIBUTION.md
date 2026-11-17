# ODDBOUT distribution

**Source-kit release: 0.6.22** (2026-11-12 KST: share a finished fighter on X, sprite-gen 92c6c8f).

`npm run fighter:social` (workspace MCP `export_social_media`) turns a finished package and its profile set into files to post on X:
each motion as an MP4 and GIF loop, a showcase ending on the fighter's card, the six faces as transparent PNG stickers and reaction loops,
a four-picture post and `POST.md` with caption links. It reads the package and profile set and writes a new folder only; nothing is
generated or posted, and the files are checked against X's published media limits. `grok-face` (`prepare_grok_face_clip`) prepares a
looping Grok face clip's still, prompt and command without generating ([PR #436](https://github.com/jeonghwanko/oddbout-starter/pull/436),
[docs/SOCIAL-EXPORT.md](SOCIAL-EXPORT.md)). The share reference tells an older kit that the export needs 0.6.22
([PR #437](https://github.com/jeonghwanko/oddbout-starter/pull/437)). The engine pin moves from `767f3ec` to `92c6c8f` (sprite-gen-agent
#64 to #77: scale-check's faster head search and its `--cache`, [PR #432](https://github.com/jeonghwanko/oddbout-starter/pull/432)), and
the pixel judge no longer fails identity on a look's floating effects ([PR #431](https://github.com/jeonghwanko/oddbout-starter/pull/431)).
The contract and the cloud tools are unchanged.

- [Download the 0.6.22 ZIP](https://oddbout.com/creator-kit/0.6.22/d3175cd11ccc2aa75f5e042158241987a74814325996efa67d9ec75e90428b4a/oddbout-0.6.22.zip)
- [Release manifest](https://oddbout.com/creator-kit/0.6.22/d3175cd11ccc2aa75f5e042158241987a74814325996efa67d9ec75e90428b4a/release.json)
- [Download helper](https://oddbout.com/creator-kit/0.6.22/d3175cd11ccc2aa75f5e042158241987a74814325996efa67d9ec75e90428b4a/fetch-creator-kit.py)

| Measured artifact | Value |
| --- | --- |
| ZIP size | 4,426,542 bytes |
| ZIP SHA-256 | `12a60a6100dc364d34a86ca95519b02d953960c54c91fa836e43a6ca3886151b` |
| Release manifest SHA-256 | `f8d74bbded2d6f6a77a947231189157028fb1c760d200a0e662f1d99b1caddf5` |
| Runtime manifest SHA-256 | `978fee549d2e7f9522adb6576c2413f1cf0e80f4a837711d63dcded11456d839` |
| Helper SHA-256 | `b66c31ff833816dfa74c90d9155359d3fdd484dff8c12759e48addde01707592` (unchanged) |
| Archive build source | `b1220ef7` (main after [PR #437](https://github.com/jeonghwanko/oddbout-starter/pull/437)) |
| sprite-gen pin | `92c6c8f4b0b6eafa2c678c16a152c18cbf2ca10b` |
| Kit Pages publication | `2a10bd50b6ebd525b8c50845712cd290ee0fd4fe` (Cloudflare Pages) |

The archive was built from a clean LF worktree at the main merge with the sprite-gen submodule at its pin; a trial build of the PR head
gave byte-identical release files. The trusted helper verified and extracted the published release (788 files), and the extracted
launcher's `--status` reported the runtime manifest above with nothing installed. No dependency install, generation login, generation or
registration ran. The publisher ran from PowerShell with `ODDBOUT_SITE_PROVIDER=cloudflare-pages` and the shared settings in the game's
`kaito_web/deploy/oddbout-site-publication.json`; its dry run and its live verification passed, adding only the three release files to
`codex/creator-pages`. A separate download of the three files served HTTP 200 with the hashes above at 2026-11-11T20:30Z.
`host/pins.json` selects this archive for the next host package release; it does not update an already installed host.

Earlier releases (0.6.21 back to 0.4.0) and their verification records are in [records/KIT-RELEASES.md](records/KIT-RELEASES.md).
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

## ChatGPT directory — linked ODDBOUT app card

Use the [card copy and icon](../deploy/chatgpt/oddbout-linked-app-card.json) when updating the existing linked app under **Apps / 앱 1** in the [ODDBOUT directory listing](https://chatgpt.com/plugins/plugin_asdk_app_6adc695de1bc8191a604b42bbaa178af). The file is an operator handoff outside the plugin ZIP. It contains the Korean and English copy, the two identities to match, and the 1024 × 1024 O icon as both a repository path and a download URL.

1. Before the next submission, check the lower card in Korean and English. If it still has the registration-only copy or the old icon, apply the corresponding fields and PNG to the **existing linked app** when an app-metadata editor is available. On November 7, 2026 the publisher portal offered package ZIP updates and MCP reconnect/rescan, with no separate editor visible for this card. If that is still the case, use the card file to request the metadata update for that app through publisher support.
2. After the update, open the directory in each locale and inspect **Apps / 앱 1** itself. Confirm the O icon and the first sentence about creating a fighter and choosing between two looks. Record the result for the linked card separately from the package version.

## The `oddbout` npm package (2026-11-05)

`packages/oddbout` is published to npm on its own as `oddbout` (the name was unclaimed on 2026-11-05). `npx -y oddbout@latest connect`
runs it ([one-line connection](CLOUD-MCP.md#한-줄로-연결하기-2026-11-05)). It has no dependencies and is not part of the creator-kit ZIP.
Publishing needs the maintainer's npm account and an explicit decision; no workflow publishes it.

1. Merge to `main` first. The CLI installs the skill from `main`'s `.claude-plugin/marketplace.json` and `.agents/plugins/`, and the
   docs that name the command reach anyone who pulls `main` at once.
2. Raise `version` in `packages/oddbout/package.json`. Run `node --test test/oddbout-connect.test.mjs`, then in `packages/oddbout`
   `npm pack --dry-run` (five files: `LICENSE`, `README.md`, `bin/oddbout.mjs`, `lib/connect.mjs`, `package.json`) and
   `npm publish --access public`.
3. Check what users get: `npx -y oddbout@latest --version` prints the new version and `npx -y oddbout@latest check` answers in JSON.

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
