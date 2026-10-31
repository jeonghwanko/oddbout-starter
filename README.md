# ODDBOUT

**English** | [한국어](README.ko.md)

**Create a fighter with AI. Bring your character into the arena.**

ODDBOUT is a fighting game where you play with a character you create. This repository contains the open-source tools for making that character. Work with an AI assistant to turn a description or reference image into artwork, animations, and a fighter package for the game. The tools and docs also use the name AI Fighter.

[Play ODDBOUT](https://oddbout.com/fighter.html) · [Manage your fighters](https://oddbout.com/creator.html?lang=en) · [Site guide](https://oddbout.com/docs.html?lang=en) · [Creation guide](docs/START-HERE.md) · [Report a problem](https://github.com/jeonghwanko/oddbout-starter/issues)

## Gameplay preview

[![ODDBOUT gameplay: two fighters in the arena](docs/media/oddbout-gameplay.gif)](docs/media/oddbout-gameplay.mp4)

Existing ODDBOUT gameplay. The subscription-based character creation workflow is still experimental; this clip does not show a complete creation run.

[Watch the 10-second clip](docs/media/oddbout-gameplay.mp4) · [Play ODDBOUT](https://oddbout.com/fighter.html) · [Questions and feedback](https://github.com/jeonghwanko/oddbout-starter/discussions)

## What you can make

- Start with a short idea, reference images, or both.
- Review the artwork and animations with your assistant. Ask to change what you do not like while keeping the versions you have chosen.
- Build a package with all 11 required motions, check the files, and register it with your account.
- Play with your registered fighter directly or let the common AI controller take over.

The kit includes sprite-gen, creation workflows, validation tools, and an MCP server for connecting your assistant to the game. The game engine is maintained separately.

The creator-kit ZIP includes both READMEs and the creation, connection and MCP migration guides. The document index also lists repository-only operations and research docs; those and the gameplay media remain available in this repository.

In this kit, "sprite-gen" means the sprite-gen engine and CLI pinned at `vendor/sprite-gen`, which comes from [sprite-gen-agent](https://github.com/jeonghwanko/sprite-gen-agent), our fork of Alex Kim's [sprite-gen](https://github.com/aldegad/sprite-gen). Commands, paths and the Python package keep the name `sprite-gen`.

## Ways to make a fighter

Every way registers the fighter to your own Google account, up to three fighters per account. The first two need nothing installed;
the third installs the generator from this repository on your PC; the last runs this whole kit. The [site guide](https://oddbout.com/docs.html?lang=en)
walks through each.

| Way | What you do | Good for |
| --- | --- | --- |
| **Leave it to ODDBOUT** | On [My fighters](https://oddbout.com/creator.html?lang=en), say in one line what fighter you want (pictures you may use are optional). ODDBOUT draws the look and the motions; you check them, ask for a change if you like, and register. | The quickest start. One fighter per account is free; it is used once its looks are drawn (our own failures give it back). On a full day your request waits its turn. |
| **Talk to your agent** | On [My agents](https://oddbout.com/creator.html?lang=en#view=agents), connect Codex (ChatGPT · Dots · Codex CLI), Grok, Claude (apps · Claude Code) or Gemini CLI to the hosted ODDBOUT MCP ([cloud connection](docs/CLOUD-MCP.md)), then ask `@ODDBOUT` in your chat. | Making and editing fighters from a conversation. Pictures can be attached from ChatGPT only. |
| **Your own PC** | On My agents → My PC, create a host and run the three-line command it gives on a Linux PC with your ChatGPT and SuperGrok subscriptions ([generation host guide](docs/GENERATION-HOST.md)). | More fighters on your own subscriptions: no approval and no limit of one. |
| **Make it yourself** | Run this kit with an assistant that can use local tools, and choose every concept and motion ([below](#create-with-the-local-kit)). | Full control over each frame. |

## Register from Dots without a PC

For **creation in a saved Dots VM**, use [the Dots VM entry point](docs/DOTS-START.md).
The intended flow is one repository URL plus your creation request, using your own Grok subscription.
The environment preparer runs [the install recipe](deploy/dots-environment/README.md) once; Dots then runs
`node dots.mjs --install` once and `node dots.mjs` to resume the same pinned workspace. The source and
preview-delivery checks remain distinct from login. This **0.6.0 candidate** still requires actual saved-VM
creation acceptance; unit tests or a parent-container run do not certify it.

Connect the hosted **ODDBOUT** MCP, sign in with Google, then select `@ODDBOUT` in your Dots conversation.
The ODDBOUT plugin 0.6.0 or later already carries this connection; without the plugin, add it in ChatGPT Plugins as a custom
MCP server (adding both shows ODDBOUT twice). Grok and Claude connect the same server from their connector settings, and
[My agents](https://oddbout.com/creator.html?lang=en#view=agents) shows and disconnects every connection. The cloud connector handles account checks,
file transfer and registration; no local MCP installation, API key or callback copying is needed.
See [cloud connection instructions](docs/CLOUD-MCP.md) for each host's endpoint and first-time setup.
When the hosted generation tools are available, ODDBOUT can make the fighter on its worker at your request.
Save the verified account ID, request key and job ID; after a timeout or disconnect, follow [hosted job recovery](docs/CLOUD-MCP.md#호스팅-작업의-중단과-미리보기-복구)
to look up the same job by its ID or original key and refresh preview URLs without resubmitting. A connection or a returned URL does not prove that an image was displayed and reviewed.
Creation in your own workspace still uses your selected generation account.
The setup below is for running the creation kit in a workspace; it is not required to authenticate the cloud connector.

## Create with the local kit

Use the **ODDBOUT** plugin for creation, review and registration from a PC or a supported Dots workspace.
The same connected ODDBOUT account registers the result in either environment. Use one hosted ODDBOUT MCP
connection for account operations and the `creation:tool` CLI for local creation, saved sessions, jobs and validation.
The CLI uses the existing workspace tools without adding another MCP connection. A second AI Fighter Creator
plugin is no longer required. To replace the older `ai-fighter` and `ai-fighter-creator` connections, follow
[the unified plugin and migration guide](docs/ODDBOUT-PLUGIN.md) and verify the cloud account and local tools first.

Send the [repository URL](https://github.com/jeonghwanko/oddbout-starter) to your assistant in the prepared workspace. Add an idea or a reference image. For example:

> Make a cat boxer in blue armor for ODDBOUT using this kit.
> Show me the concept first so we can get the appearance right.
> Then show me movement, attacks, and reactions in groups for feedback.
> When I choose the final result, validate it, register it with my account, and check that I can use it in the game.

Your assistant handles setup, generation, packaging, and file checks. You choose how the character looks and moves. Local creation can begin before you sign in to ODDBOUT.

### What you need

| Requirement | Details |
| --- | --- |
| A local execution environment | Your PC or a supported per-user workspace, with Git, Node.js **22.12+**, and Python **3.11+**. Your assistant can help with setup. |
| Your own generation account | Image and motion generation use your own supported accounts and subscriptions. The assistant checks actual image/video access and preview delivery before starting. |
| A Google account for registration | Sign in when you want to upload and register your fighter. No invitation or manual approval is required. |

Using the local kit takes setup and several rounds of review. Time, usage limits, and costs depend on your provider and how many changes you make. You choose the provider with your assistant. Switching providers or using a paid API needs your agreement. A browser-only chat needs a connected execution environment for the full workflow.

### Make and review, one group at a time

| Group | What you review |
| --- | --- |
| Appearance | Full-body concept, idle pose, and a face close-up from the same artwork |
| Movement | Fighting stance, walk, and run at a consistent scale |
| Attacks | Combo, slam, and dash, including preparation and recovery |
| Defense and reactions | Block, hit, groggy, fall, and get-up poses |
| Final review | All 11 motions from the packaged files, plus the name, description, and portrait |

Your assistant shows you actual previews and waits for your feedback after each group. It revises the affected assets and keeps your other selections. You can also ask it to handle later groups on its own. Alongside file checks, the assistant reviews character consistency, movement, foot contact, and timing. You review the results before moving on.

See the [full creation workflow](docs/DOT-CREATION.md) for generation, revision, and packaging.

## Set up the kit yourself

For a Dots VM, start with [Dots bootstrap, doctor and resume](docs/DOTS-QUICKSTART.md) and the
[saved-environment Start instructions](docs/DOTS-START.md). The offline entry point is
`node scripts/dots-workspace.mjs doctor --workspace <absolute-workspace>`; installation is explicit
with `bootstrap --install`. A Git URL alone does not authorize generation. Start from `main` (below) and
record its actual commit.
The Dots workflow reports unsupported image-output contracts as blocked; it does not read protected
Codex sessions or claim that login/installation proves image generation or parent delivery.

Use the **main** branch, which contains the public service configuration. For a new installation:

```sh
git clone --branch main --single-branch https://github.com/jeonghwanko/oddbout-starter.git
cd oddbout-starter
npm ci --ignore-scripts
npm run sprite:setup
npm run sprite:status
```

Installed before 2026-10-29 from `codex/creator-hosting`? That branch is frozen, and the kit's readiness check now stops a checkout
on it as the wrong branch. Commit or set aside any local changes, then move the checkout to `main` (a plain `git checkout main`
fails in a single-branch clone):

```sh
git remote set-branches origin main
git fetch origin
git switch -C main origin/main
npm ci --ignore-scripts
npm run sprite:setup
```

Setup downloads the pinned sprite-gen source into this checkout and installs it in a dedicated Python environment. Use Git clone; the GitHub source ZIP does not contain the submodule files. The status command checks installation, not generation access or quota.

Setup also fetches the outside tools sprite-gen needs, without sudo: `img2webp` with `-exact` (libwebp 1.6.0, SHA-256 pinned, placed in the kit's environment when your system has none or an older one such as Ubuntu 24.04's 1.3.x) and RIFE for smooth walk and run loops (`sprite-gen rife install`, about 430 MB download). Install `ffmpeg` yourself first: `sudo apt install ffmpeg` (Ubuntu/Debian), `brew install ffmpeg` (macOS) or `winget install --id Gyan.FFmpeg -e` (Windows). Setup and `sprite:status` list each tool as `ok`, `missing` or `broken` with the command that fixes it. A Linux machine without a GPU also needs `sudo apt install libvulkan1 mesa-vulkan-drivers` for RIFE; without RIFE, loops are cut as filmed with a warning. Keep an in-progress character workspace in place and avoid pulling repository updates during creation.

To connect the tools, follow the [local Codex plugin guide](docs/LOCAL-PLUGIN.md): `npm run plugin:build`, then the printed `codex plugin marketplace add …` and `codex plugin add oddbout@ai-fighter-local`. The older manual MCP connection (`node scripts/print-install.mjs`) remains for compatibility. Other local hosts can connect `mcp/stdio.mjs` with `AI_FIGHTER_ROOT` set to the checkout.

The [unified plugin guide](docs/ODDBOUT-PLUGIN.md) covers the portable source package. A local plugin installation does not mean the plugin is installed in Dots or listed in a public directory.

## Register and play

When you choose the final result and ask to register it, your assistant checks the package and registers it through your connected ODDBOUT account: the ODDBOUT plugin, or an agent connected on My agents, signed in with your Google account. You do not need to set up a backend or get service API keys. Older local tools without that connection sign in with `npm run login`.

The server checks your uploaded files and registers your fighter in production: you can watch it and practise in the arena. Your assistant checks the result to confirm the registration. The queue can take time to process. To let other people play against your fighter in cups and ranked duels, open **All motions** on its page, check each of the 11 required motions and press **Enter ODDBOUT**.

Open the [creator page](https://oddbout.com/creator.html?lang=en) with the same Google account to see your fighter; its My agents tab manages your connected agents and your PC. See [registration, limits, and profile edits](docs/OPEN-REGISTRATION.md) for details. Keep login links, callback URLs, and session files private.

The cloud source supports replacing your own fighter's package by passing its `fighterId` to
`prepare_fighter_registration`, preserving its ID and history. Changed art still needs the required motion reviews,
final package approval and your registration request; the new package returns the fighter to production before entry.
The cloud `open_creator_homepage` tool returns a fixed website URL. Sign in separately on the website and check that
its account matches cloud `get_profile`; it does not create a one-use sign-in link. These source capabilities require
an MCP deployment: check the connected server's `tools/list` for the tool and optional `fighterId` argument before use.

## Help and contributions

If setup, generation, sign-in, registration, or gameplay fails, [open an issue](https://github.com/jeonghwanko/oddbout-starter/issues) with the failing step, expected and actual behavior, error message, and tool version or commit. Exclude credentials and private files. For generation or upload timeouts, check existing requests and outputs before retrying.

Bug reports, clearer setup instructions, and reproducible examples are welcome. Read [AGENTS.md](AGENTS.md) before using an assistant to change this repository.
Pull requests target `main` and merge only after the `test` workflow passes; `npm test` runs the same suite locally, including the
strict type check of `api/`, `worker/`, `mcp/` and `scripts/`.

| Resource | Use it for |
| --- | --- |
| [Cloud connection](docs/CLOUD-MCP.md) · [Connection recovery](docs/CONNECTION-READINESS.md) | Connecting ChatGPT, Grok and Claude, Google sign-in, account checks, and cloud registration |
| [Authoring guide](docs/AUTHORING.md) | Fighter files and the package contract |
| [Creation UX](docs/CREATION-UX.md) | Character intake, feedback, and version selection |
| [Game creation context](docs/GAME-CREATION-CONTEXT.md) | Current motions, controls, and timing |
| [Gait review](docs/GAIT-REVIEW.md) | Walk/run quality and contact evidence |
| [Execution environment](docs/EXECUTION-HOST.md) · [Preview delivery](docs/DELIVERY.md) | Account isolation, local execution, and actual media display |
| [Hosting](docs/CREATOR-HOSTING.md) · [Security](SECURITY.md) | Deployment and security boundaries |
| [Generation host (Korean)](docs/GENERATION-HOST.md) | Make your own fighters on your own Linux PC and subscriptions, and, once approved, other creators' requests |

Local development checks, after installing dependencies:

```sh
npm run spec:check
npm test
npm run validate -- examples/sparring-bot/fighter.json
npm run mcp:smoke
```

`npm run test:fast` skips the slow image-packing, proxy and Python-engine suites (`npm run test:heavy` runs only those); run the full `npm test` before a release.

The sparring-bot example is a geometric test fixture. These checks do not generate or register a character. Running matches on a self-hosted service requires the separate production game engine bundle.

## License

The creator kit is [MIT-licensed](LICENSE). The bundled [sprite-gen](vendor/sprite-gen) submodule is [sprite-gen-agent](https://github.com/jeonghwanko/sprite-gen-agent), our fork of Alex Kim's [sprite-gen](https://github.com/aldegad/sprite-gen), with its own Apache-2.0 LICENSE and NOTICE. Generation providers have their own account and usage terms.
