# Agent quickstart

For a workspace agent with a shell, an image generator and the ODDBOUT connector. Product rules stay in [AGENTS.md](../AGENTS.md). This page is the short path for the mistakes that show up after a package already validates.

## Offline check

Node.js 22.12 or newer. ffmpeg is installed separately. Generation also needs `npm run sprite:setup` (the sprite-gen submodule, its venv, img2webp and RIFE, about 430 MB). A generation host PC is Linux. Grok login and generation permission are separate from this local check.

```sh
git clone --branch main --single-branch https://github.com/jeonghwanko/oddbout-starter.git
cd oddbout-starter && npm ci --ignore-scripts
npm run example && npm run validate -- output/sparring-bot/fighter.json
npm run fighter:profile-set -- --front <front.png with alpha> --out <new folder>
```

`npm run validate` can succeed and still return `pending` names such as `runtime-preview`, `visual-review` and `server-registration`. Those are later stage names. `pendingStages` is the same list. `missingAssets` is empty. Warnings do not clear `ok`.

## Register local files

ChatGPT can pass host file attachments to `prepare_fighter_registration` and `upload_fighter_asset`. A host without those file arguments, including a Grok bot with only a shell, cannot. Do not invent download URLs. `start_picture_upload` is for hosted reference pictures, not package WebP files.

Use the connected cloud tools by default. Choose the local CLI only when the user explicitly selects local registration; a missing or failing cloud tool or authentication does not authorize switching routes. Confirm the intended ODDBOUT account with `get_profile` when available, and use only the user's own CLI session. Do not ask the user to paste callback URLs or tokens into chat. For a remote browser, use the supported device login flow (`--device`, then `--device-wait`); if no secure handoff is supported, report the authentication blocker. The dry run does not need login.

```sh
npm run fighter:register -- --dir <package> [--fighter <uuid>] [--idempotency-key <uuid>]
```

Without `--submit` the command performs its local preflight and saves an idempotency key beside the package (`.oddbout-registration.json`); it does not contact the server or need login. After the user explicitly asks for local submission, sign in with their own account using `npm run login` via a supported secure handoff, then add `--submit`. That uploads each WebP, submits, and polls. Reuse the saved key and submission record for identical retries; changed bytes need a new key. A CLI session is not a substitute for `get_profile` on the connector, and it must never be copied into the connector.

`pending` and `pendingStages` are pipeline stage names, never asset ids. Upload every `missingAssets` entry. When the server has not confirmed storage (`assetUploadState` is `unconfirmed` or the field is absent), upload every `assets` entry. A retry of the same bytes succeeds. Reading `pending` as asset ids and submitting early returns `409 assets-incomplete`.

The profile set is still `npm run fighter:profile-set` for the files. Its `pending` values (`upload-front`, `submit`, `server-validation`) are stage names too. Picture ids are `missingAssets` (`front`, and `expressions` when the set has a sheet).

## Revise a registered fighter

1. Read `get_profile`, then `get_my_fighters` (view `list`). Say the account id, email, `fighterCount` and `fighterLimit` before using a remembered roster. Use the returned profile and list `account` fields; missing fields on older servers or a null limit stay unknown. The profile nickname is always `ODDBOUT`. The default limit is 3; only the returned value verifies this account's limit (`af_creators.fighter_limit`).
   Confirm the requested revision target appears in the returned roster. If it is missing or ambiguous, stop and ask; never create a substitute.
2. Build a new local package with the motions that change. `npm run validate` it.
3. After the user has seen the motions and asked to register, use the connected cloud route by default: `prepare_fighter_registration` with `fighterId`. If the user explicitly chooses local registration and this host cannot attach files, submit with `npm run fighter:register -- --dir <package> --fighter <id> --submit` after secure login. This is a new submission. The fighter id and its history stay. The previous submission is not overwritten. A cloud-tool or auth failure alone does not authorize a route switch.
4. Do not call `revise_hosted_motion` (`request_hosted_fighter` step `revise_motion`) for a registered fighter. That step only accepts a legacy hosted job at `motion_ready`. A style-only edit with no new art is `update_fighter` kind `style`.

Hard rule 6 in AGENTS.md forbids deleting a submitted immutable package or a selected version. A `fighterId` revision does not do that.

## combat.style

Read `browse_oddbout` view `style_guide` before filling a style. There is no super clip. `super` picks `slam`, `combo`, `fast` or `dash`.

`temper` is an object of optional grades from 1 to 5, not one enum. The keys are `guard`, `retreat`, `measure` and `patience`.

`shockwave`, when present, is the constant `true`. Omit it to leave the shockwave off.

Skill clip kinds are `stretch`, `pincer`, `flight`, `feint`, `slide`, `counter` and `brace`. The skill clip has no display-name field. `profile.moves` names combo, slam, dash and block only.

The skill clip, a summon and a shockwave share one budget of 2 (`extrasBudget`). `mix.fast` must be less than or equal to `mix.slam + mix.combo`, and at least one of slam, combo and fast is above 0.

```json
{
  "combat": {
    "kitId": "standard-duel",
    "stats": { "power": 3, "toughness": 4, "speed": 2 },
    "style": {
      "mix": { "slam": 3, "combo": 2, "fast": 1 },
      "special": "slam",
      "super": "dash",
      "distance": 2,
      "temper": { "patience": 5 },
      "summon": "sportsCar"
    }
  }
}
```

`{ "shockwave": true }` counts as one of the two extras. Adding a skill clip and a summon beside it is over the budget.

## Poses and inspect-motion

New motion frames: [POSE-GENERATION.md](POSE-GENERATION.md). Right-facing side view, the style anchor last, one scale based on standing body height 400 (not each pose's extent).

`inspect-motion` reporting `needs-review` because ground contact is unknown is normal for an action clip with no foot region. It does not block packaging. Show the motion and wait for the user.
