# ODDBOUT

**English** | [한국어](README.ko.md)

**Create a fighter with AI. Bring your character into the arena.**

ODDBOUT is a fighting game where you play with a character you create. This repository contains the open-source tools for making that character. Work with an AI assistant to turn a description or reference image into artwork, animations, and a fighter package for the game. The tools and docs also use the name AI Fighter. It also holds [ODDBOUT Showrunner](#oddbout-showrunner), an experimental agent broadcast that runs ODDBOUT cups on a PayPal Sandbox budget.

[Play ODDBOUT](https://oddbout.com/fighter.html) · [Manage your fighters](https://oddbout.com/creator.html?lang=en) · [Site guide](https://oddbout.com/docs.html?lang=en) · [Creation guide](docs/START-HERE.md) · [Report a problem](https://github.com/jeonghwanko/oddbout-starter/issues)

## Install the Codex plugin

Install the local custom plugin from this Git repository: [Codex installation guide](docs/LOCAL-PLUGIN.md#install-the-codex-skill-from-git). It adds the creation skill and reuses your existing ODDBOUT MCP. No directory approval or creator-kit ZIP is required. Login stays a separate user action.

## Watch

<table>
<tr>
<td width="50%" valign="top">

[![ODDBOUT × Twitch Cup: built by agents, picked by chat, fought live](https://img.youtube.com/vi/aLOsJlcQ2_c/maxresdefault.jpg)](https://youtu.be/aLOsJlcQ2_c)

**[ODDBOUT × Twitch Cup](https://youtu.be/aLOsJlcQ2_c)** (2:50). Built by agents, picked by chat, fought live: a Codex agent connects to ODDBOUT's MCP and plugin, Dots draws and animates the fighters, oddbout.com checks and registers them, and Twitch viewers send them into a four-fighter cup by typing `!join`. The stream shown is a solo rehearsal.

[Try the cup](https://oddbout.com/twitch.html) · [Twitch Cup source](https://github.com/jeonghwanko/oddbout-twitch-cup)

</td>
<td width="50%" valign="top">

[![ODDBOUT Showrunner: AI agents live-streaming and earning revenue?](https://img.youtube.com/vi/-GeIlI4Cf9w/maxresdefault.jpg)](https://youtu.be/-GeIlI4Cf9w)

**[ODDBOUT Showrunner](https://youtu.be/-GeIlI4Cf9w)** (1:54). AI agents live-streaming and earning revenue? An animated walkthrough of paid agent broadcast work that keeps going when a laptop closes, a payment tab never returns or a server restarts, so a payment is neither lost nor charged twice.

[Try the PayPal Sandbox demo](https://broadcast.oddbout.com/broadcast/) (test money only) · [About Showrunner](#oddbout-showrunner)

</td>
</tr>
</table>

### Gameplay clip

[![ODDBOUT gameplay: two fighters in the arena](docs/media/oddbout-gameplay.gif)](docs/media/oddbout-gameplay.mp4)

Existing ODDBOUT gameplay. The subscription-based character creation workflow is still experimental; this clip does not show a complete creation run.

[Watch the 10-second clip](docs/media/oddbout-gameplay.mp4) · [Play ODDBOUT](https://oddbout.com/fighter.html) · [Questions and feedback](https://github.com/jeonghwanko/oddbout-starter/discussions)

## What you can make

- Start with a short idea, reference images, or both.
- Review the artwork and animations with your assistant. Ask to change what you do not like while keeping the versions you have chosen.
- Build a package with all 11 required motions (and, if you like, a signature skill, an entrance and a victory pose), check the files, and register it with your account.
- Check every motion and enter the fighter, so other people can fight it in cups and ranked duels.
- Play with your registered fighter directly or let the common AI controller take over.

The kit includes sprite-gen, creation workflows, validation tools, and the workspace tools your assistant runs. Your account and registration go through the hosted ODDBOUT MCP. The game engine is maintained separately.

The creator-kit ZIP includes both READMEs and the creation, connection and MCP migration guides. The document index also lists repository-only operations and research docs; those and the gameplay media remain available in this repository.

Game-context requests use the host's existing HTTP(S) proxy, `NO_PROXY` and CA settings.
When VM networking is unavailable, a fresh complete public response obtained through an allowed connected tool can use
the [explicit file handoff](docs/GAME-CREATION-CONTEXT.md#explicit-public-context-file-handoff), with integrity and freshness checks.
See the [release files and verification record](https://github.com/jeonghwanko/oddbout-starter/blob/main/docs/PLUGIN-DISTRIBUTION.md)
and [network troubleshooting](docs/GAME-CREATION-CONTEXT.md#network-errors-and-existing-workspaces).
Grok account login and host network permission are separate; this file route supplies public rules only.
Keep an in-progress fighter on its current runtime and preserve its sessions, jobs and results;
publishing a ZIP does not upgrade an existing Dots task or the connected cloud App.

In this kit, "sprite-gen" means the sprite-gen engine and CLI pinned at `vendor/sprite-gen`, which comes from [sprite-gen-agent](https://github.com/jeonghwanko/sprite-gen-agent), our fork of Alex Kim's [sprite-gen](https://github.com/aldegad/sprite-gen). Commands, paths and the Python package keep the name `sprite-gen`.

## Ways to make a fighter

Every way registers the fighter to your own Google account, up to three fighters per account. The first two need nothing installed;
the third installs the generator from this repository on your PC; the last two make the package yourself. The [site guide](https://oddbout.com/docs.html?lang=en)
walks through each.

| Way | What you do | Good for |
| --- | --- | --- |
| **Leave it to ODDBOUT** | On [My fighters](https://oddbout.com/creator.html?lang=en), say in one line what fighter you want, and add up to two pictures you may use if you like. Pick one of two fronts, check the motions (redo the ones you want changed), register, and enter the fighter once you have checked its moves. | The quickest start. Signing up gives you 500,000 tokens; what ODDBOUT uses making your fighters comes off them. One request at a time, up to three a day; on a full day your request waits its turn. |
| **Talk to your agent** | On [My fighters](https://oddbout.com/creator.html?lang=en#view=agents) → My agents, pick the agent you use (ChatGPT/Codex/Dots, Grok, Claude or Gemini) and follow its steps: it connects to the hosted ODDBOUT MCP with your Google account ([cloud connection guide](docs/CLOUD-MCP.md)). Then ask @ODDBOUT for a fighter in your chat. | Making and editing fighters from a conversation. ODDBOUT makes it as above. In ChatGPT you attach pictures; other agents give you an upload link. |
| **Your own PC** | On My agents → Advanced → Make on my PC, name a host, accept the host terms and run the three-line command it gives on a Linux PC with your ChatGPT and SuperGrok subscriptions ([generation host guide](docs/GENERATION-HOST.md)). | More fighters on your own subscriptions: no approval, and none of your tokens. |
| **Make it with any tool, upload on the site** | Make the package with any tool, following the [package contract](contracts/ai-fighter/v1/README.md), and check it with `npm run validate`, or with no sign-in in the [site guide's checker](https://oddbout.com/docs.html?lang=en#bring-your-own). Then on [My fighters](https://oddbout.com/creator.html?lang=en) choose New fighter → Other ways → Upload a finished package. | A fighter you already made elsewhere, or a tool of your own. |
| **Make it yourself** | Run this kit with an assistant that can use local tools, and choose every concept and motion ([below](#create-with-the-local-kit)). | Full control over each frame. |

## Register from Dots without a PC

For ChatGPT/Dots account operations, select the connected ODDBOUT cloud App available to your account. Its account tools and
`create-fighter` skill belong to the same App. In the intended conversation, call native `get_profile` and confirm the expected
registration account; find and read that App's skill and support document through the host's skill tools.
The verified private App is not a public listing. If no App is available to you, see [first-time connection](docs/CLOUD-MCP.md).
Do not import the creator-kit ZIP or create a second plugin for cloud connection. Account and skill checks do not authorize creation.

Grok, Claude, Gemini and other supported clients connect from My agents on the creator page. Once connected, cloud tools handle account checks, file transfer and registration; local CLI tools remain available for workspace creation and validation.
When the hosted generation tools are available, ODDBOUT can make the fighter on its worker at your request.
Save the verified account ID, request key and job ID; after a timeout or disconnect, follow [hosted job recovery](docs/CLOUD-MCP.md#호스팅-작업의-중단과-미리보기-복구)
to look up the same job by its ID or original key and refresh preview URLs without resubmitting. A connection or a returned URL does not prove that an image was displayed and reviewed.
Creation in your own workspace still uses your selected generation account.

For **creation in a saved Dots VM**, use [the Dots VM entry point](docs/DOTS-START.md).
The intended flow is one repository URL plus your creation request, using your own Grok subscription.
The environment preparer runs [the install recipe](deploy/dots-environment/README.md) once; Dots then runs
`node dots.mjs --install` once and `node dots.mjs` to resume the same pinned workspace. The source and
preview-delivery checks remain distinct from login. Saved-VM creation and delivery remain separate acceptance checks;
unit tests or a parent-container run do not certify them.

The setup below is for running the creation kit in a workspace; it is not required to authenticate the cloud connector.

## Create with the local kit

The local kit works with supported local tools and does not require ChatGPT's app setup. For ChatGPT/Dots, cloud account operations use the hosted MCP app;
local creation, saved sessions, jobs and validation use the `creation:tool` CLI. See [the unified plugin and migration guide](docs/ODDBOUT-PLUGIN.md).

Send the [repository URL](https://github.com/jeonghwanko/oddbout-starter) to your assistant in the prepared workspace. Add an idea or a reference image. For example:

> Make a cat boxer in blue armor for ODDBOUT using this kit.
> Show me the fighter's front first so we can get the appearance right.
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
| Appearance | The full-body front (two to choose from), its six match faces ending with the KO face, and the side view and idle pose drawn from it |
| Movement | Fighting stance, walk (12–32 frames), and run (10–16 frames) at a consistent scale |
| Attacks | Combo, slam, and dash, including preparation and recovery |
| Defense and reactions | Block, hit, groggy, fall, and get-up poses |
| Fighting style (optional) | A signature skill, an entrance and a victory pose, and how the fighter fights. Offered once after defense; skip it if you like |
| Final review | All 11 motions (and any optional clips) from the packaged files, plus the name, description, portrait, and match lines |

Your assistant shows you actual previews and waits for your feedback after each group. It revises the affected assets and keeps your other selections. You can also ask it to handle later groups on its own. Every picture uses ODDBOUT's plain cel colouring: your references give the character, not the rendering. Packaging needs only the file and contract checks; gait and visual-quality reports are kept as notes and never block it, so your own look at each group is the quality check.

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

To connect the tools, follow the [local Codex plugin guide](docs/LOCAL-PLUGIN.md#optional-local-development-installation-on-this-computer): `npm run plugin:build`, then the printed `codex plugin marketplace add …` and `codex plugin add oddbout@ai-fighter-local`. The workspace tools run in process through `npm run creation:tool`; your account and registration use the hosted ODDBOUT MCP.

The [unified plugin guide](docs/ODDBOUT-PLUGIN.md) and [distribution record](https://github.com/jeonghwanko/oddbout-starter/blob/main/docs/PLUGIN-DISTRIBUTION.md) cover the reviewed portable source kit. A local plugin installation does not mean the cloud App is connected in Dots or that the kit is listed in a public directory.

## Register and play

When you choose the final result and ask to register it, your assistant checks the package and uses your verified ODDBOUT account. For a cloud connection, verify it with `get_profile` in the active conversation. You do not need to set up a backend or get service API keys.

The server checks your uploaded files and registers your fighter as **Not entered**: you can watch it and practise in the arena. Your assistant checks the result to confirm the registration. The queue can take time to process. Your assistant then uploads the chosen front and its faces as the fighter's profile set: its picture on the site and its faces in matches. The home page lists the fighter once an operator approves the set. To let other people play against your fighter in cups and ranked duels, open **All motions** on its page, check each of the 11 required motions and press **Enter ODDBOUT**. If the site asks for the front first, ask your agent to send the profile set.

Open the [creator page](https://oddbout.com/creator.html?lang=en) with the same Google account to see your fighter; its **My agents** button, beside the title, manages your connected agents and your PC. On a fighter's page, **Profile**, **Animation**, **Combat** and **World** change its name and lines, its package, its fighting style and its story without a conversation; **Ask for a fix** on All motions copies a request for the agent that made it. See [registration, limits, and profile edits](docs/OPEN-REGISTRATION.md) for details. Keep login links, callback URLs, and session files private.

To replace your own fighter's package, your assistant passes its `fighterId` to `prepare_fighter_registration`, or you
upload the new package with the fighter's **Animation** button; its ID and record stay. Changed art still needs the required
motion reviews, final package approval and your registration request; the new package returns the fighter to Not entered
until you check its motions again. The cloud `open_creator_homepage` tool returns a fixed website URL. Sign in separately
on the website and check that its account matches cloud `get_profile`; it does not create a one-use sign-in link.

## ODDBOUT Showrunner

Showrunner, in [`broadcast/`](broadcast), runs ODDBOUT cups as a broadcast on a budget. You buy credits with PayPal Sandbox
and approve a session and its budget. An optional AI producer then chooses, through its own MCP and only within that approval,
whether to host the next cup, wait or stop; it cannot pay or approve a budget. A runner on a PC with a graphical session and OBS
plays each cup in the [Twitch Cup](https://github.com/jeonghwanko/oddbout-twitch-cup) arena, and the server's ledger applies
each result report once, so a resent report is not charged again.

Its storefront sells Spotlight tickets: one to three hours of cups with your promotion, an MP4 or a YouTube or Twitch link,
played in two five-minute sponsor breaks each hour. You schedule the broadcast and press Start yourself. When it ends, you
check the settlement against PayPal and approve the fighters' appearance fees. A paid broadcast also outlives a closed checkout
tab, a lost agent or a server restart: once you have approved its automatic start, the server verifies the original payment
and starts the original producer session, and you can follow it from another device.

It is still in development. It uses PayPal Sandbox test money only, never live payments, and the runner's `--live` mode stays
blocked until Twitch channel verification exists. [Try the Sandbox demo](https://broadcast.oddbout.com/broadcast/), or read:

- [Product and purchase flow](docs/SHOWRUNNER-PRODUCT.md): Spotlight tickets, promotion media, scheduling, settlement and payouts
- [Paid task recovery across VM, phone and PC](docs/PAID-TASK-RECOVERY.md): for PayPal Sandbox developers, the isolated
  deployment, the paid-task MCP setup, verification and the hackathon demo guide
- [Local setup and current checks (Korean)](docs/BROADCAST-SANDBOX.md) and [the hosted demo](docs/BROADCAST-HOSTING.md)
- [The plan and acceptance gates (Korean)](docs/PAYPAL-AGENT-BROADCAST-PLAN.md)

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
| [Showrunner product](docs/SHOWRUNNER-PRODUCT.md) · [Paid task recovery](docs/PAID-TASK-RECOVERY.md) · [Sandbox (Korean)](docs/BROADCAST-SANDBOX.md) · [Hosted demo](docs/BROADCAST-HOSTING.md) | Agent broadcasts: Spotlight tickets, PayPal Sandbox payments and their recovery, the AI producer, the cup runner and OBS |

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
