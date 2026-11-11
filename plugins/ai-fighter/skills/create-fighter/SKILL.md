---
name: create-fighter
description: Create (on ODDBOUT's hosted worker, or in the user's PC or Dots workspace with the user's generation account), revise, resume, validate or register an ODDBOUT fighter, its profile set or fighting style. Also check the ODDBOUT connection and inspect the user's registered fighters. Not for cups, sparring, stories or changing the kit's code. Process design and forwarded examples do not authorize generation.
---

# ODDBOUT

One workflow covers creation, review and registration. The connected ODDBOUT tools own the registration account. The workspace kit owns files, version selections and generation jobs. Do not ask the user to install a second plugin or choose between two product names.

The skill, the kit and a fighter project do not share a lifetime. Detail: `docs/LIFECYCLE.md`. Installing this skill does not install the kit or sign anyone in. The kit is the workspace executor and is not required for a hosted fighter or a connection check. A project is the session, selected versions, jobs and packages. Do not update the kit while a project is in progress, and do not rewrite a project when the skill or the kit changes.

A connection or status request does not authorize starting or resuming creation. For registered-fighter lookup, check that the connected ODDBOUT tools are available; no workspace setup is needed. For creation, choose the route below and open only the reference that matches the question.

## Hard rules

These stay in this file. A reference page cannot relax them.

- Quota: read `get_profile`, then `get_my_fighters` view `list`, and report the returned account id, email, `fighterCount` and `fighterLimit`. Missing or null stays unknown. At the limit, a new fighter is refused with `fighter-quota`: stop, and do not call `request_hosted_fighter` or prepare a package without a `fighterId`. A revision of a fighter already in the roster is not a new fighter and is not counted.
- Revision without a target: confirm the fighter is in the returned roster. If it is absent or ambiguous, stop and ask which fighter is meant. Never create a substitute. A revision is a new package with the same `fighterId`. The prior submission stays immutable. `revise_hosted_motion` (`request_hosted_fighter` step `revise_motion`) only edits a legacy job at `motion_ready`. A style-only edit is `update_fighter` kind `style`.
- Delegation: set `delegate: true` only when the user explicitly delegates the appearance choice. "Make it", "just make it" and "그냥 만들어줘" request creation but do not delegate. Ask the user to choose the look and do not pass `delegate: true`.
- `idempotencyKey` is required for `prepare_fighter_registration`, a profile set, `update_fighter` kind `style`, and `request_hosted_fighter` step `request`. Reuse the original key for the same bytes. Changed bytes need a new key. An unknown outcome is not a failure: inspect the existing record before any retry.
- Never call `enter_fighter` automatically: call it only on the user's request after showing every required motion and hearing each confirmed. Call `delete_fighter` only on the user's explicit request, after `prepare_fighter_deletion` has returned the account and fighter and you have shown them; pass its token, the exact `confirmName` and `confirm: true`. `enter_fighter` takes the hash of the package the user watched and every reviewed clip. The live ODDBOUT tools take no `confirmed` flag. The dummy flow harness (`npm run flow:test`, results labelled `ODDBOUT-DUMMY`) is stricter: there `enter_fighter` and `delete_fighter` are `permission-forbidden`, and a mutate tool runs only with `confirmed: true` and confirmation text on that same call (`docs/TOOL-PERMISSIONS.md`). No flag confirms every tool or the next call.
- Show the measured profile set and get approval before `prepare_fighter_registration` kind `profile_set` and before entry. `pending` and `pendingStages` are stage names, never asset ids. Upload each `missingAssets` entry.
- Do not ask for callback URLs or tokens in chat. Do not switch provider, account or registration route because a tool failed.
- Queued panels, text reports and local paths are not displayed previews. Say the stage in one sentence while a long job runs. Approval still waits for the actual images.
- Watching a job does not run it or cancel it. `get_creation_job` returns `executedByThisCall: false` and `cancelledByThisCall: false`. A live `get_hosted_fighter` only reads: ODDBOUT's worker advances the job on its own, and `waitSeconds` only waits for a change. Wait with `waitSeconds` rather than repeated reads. In the dummy harness the read is `get_hosted_fighter` with `observe: true`, and `advance_hosted_fighter` (dummy only; the live tools have no advance tool) moves the dummy worker with `confirmed: true` plus confirmation text. Resume reuses the stored `idempotencyKey` and does not start a second registration.

## Which route

When `request_hosted_fighter` is available, offer hosted creation first if the user wants ODDBOUT to make the fighter or has no generation setup. No workspace or generation account of the user's is required. Pass the user's words, follow each result's `next`, and read [hosted creation](references/hosted.md) before the first call. Hosted creation includes registration into production. Do not wait for motion approval. Only the owner enters the fighter.

The workspace route is the user's choice of a PC or Dots workspace. Read [workspace routing](references/workspace.md) before the first generation there. Use the same project tools through `creation:tool`. Do not move a Dots task to a PC. Before generation, run `npm run creation:preflight -- --purpose generation` or workspace `preflight_creation`. It does not install or generate. `npm run creation:plan` lists what is still open and does not start it. A kit older than 0.6.21 has none of `creation:preflight`, `creation:plan`, `preflight_creation`, `plan_creation`, `read_creation_checkpoint` or `resume_creation_job` (its `package.json` version says which): there, use workspace `check_creation_readiness` instead of preflight, skip the plan, and do not update a kit with a character in progress just to get them.

## Read the page for the question

| Question | Read |
| --- | --- |
| Connection, missing tools, plugin selection | [connection](references/connection.md) |
| Hosted creation, looks, wait, delegation on that route | [hosted creation](references/hosted.md) |
| Front, profile set, expression sheet | [front](references/front.md) |
| Review groups and session decisions | [groups](references/groups.md) |
| Jobs, watching, plan, reuse, recovery | [jobs](references/jobs.md) |
| Tool permission tiers | `docs/TOOL-PERMISSIONS.md` |
| Registration, revision, style, entry | [registration](references/registration.md) |
| Share on X: clips, reaction faces, Grok face clips | [share on X](references/social.md) |
| Workspace kit, Dots, `creation:tool` | [workspace routing](references/workspace.md) |
| Skill, kit and project lifetimes | `docs/LIFECYCLE.md` |
| Poses, style fields, gait | The kit docs named in [registration](references/registration.md) |
| Delivery of previews to this chat | `docs/DELIVERY.md`, named in [workspace routing](references/workspace.md) |

## Resume

A workspace session writes `BRIEF.md` and `PROGRESS.md` beside `creation-session.json`. They are a summary. `get_creation_session` and `get_creation_job` are the record. When a workspace session exists, record the agreed route, account id, account email and hosted job id with `update_creation_session` type `memory`. Do not put tokens, callback URLs or login links in that note. Hosted resume is `get_hosted_fighter` with the original job id or `idempotencyKey`.
