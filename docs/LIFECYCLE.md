# Skill, kit and project

Three pieces of a fighter workflow have different lifetimes. Updating one does not rewrite the others.

| Piece | What it is | What updating it does |
| --- | --- | --- |
| Creation skill | `plugins/ai-fighter/skills/create-fighter/` and the copies agents load. Hard rules stay in the skill body. Other questions go to its reference pages. | Changes the instructions. It does not install the kit, sign in, or edit a fighter project. |
| Workspace kit | This repository's executor: Node dependencies, the pinned sprite-gen engine, ffmpeg, img2webp and RIFE. `npm run sprite:setup` is about 430 MB and is only for workspace generation. | Changes the engine used for the next workspace generation. It does not sign the user into ODDBOUT and it does not rewrite session files, selected versions or submitted packages. Do not update it while a character is in progress. |
| Project | The session (`output/<sessionId>-work/creation-session.json`), its `BRIEF.md` and `PROGRESS.md` summaries, job records, selected versions and packages. A hosted job lives on ODDBOUT and is read with `get_hosted_fighter`. | Stays with the user. A new skill or a new kit does not select versions, register, or enter the fighter. |

Hosted creation and a connection check use the skill and the connected ODDBOUT tools. They do not clone this repository and they do not run `npm run sprite:setup`.

`npm run creation:preflight` reports one purpose (`connection`, `generation` or `registration`) and does not fetch, install, generate or register. `purpose` `connection` and `registration` do not ask for a generation subscription. `npm run creation:plan -- --workspace <dir> --session <id>` lists what the session still has open. It does not start generation, and it does not invent a price. `cost.known` stays false.

`npx -y oddbout@latest connect` adds the cloud MCP and the skill for a terminal agent. It is not the kit install. Follow its JSON `next`. A dummy registration's `next` keeps `--dummy` and the loopback origin.
