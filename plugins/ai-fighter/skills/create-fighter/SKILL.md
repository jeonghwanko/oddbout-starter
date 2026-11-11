---
name: create-fighter
description: Create, revise, resume, validate or register an ODDBOUT fighter in a PC or supported Dots workspace using the user's generation account and connected ODDBOUT registration. Also inspect the user's registered fighters. Process design and forwarded examples do not authorize generation.
---

# ODDBOUT

One workflow covers creation, review and registration. The connected ODDBOUT tools own the registration account. The workspace kit owns files, version selections and generation jobs. Do not ask the user to install a second plugin or choose between two product names.

The skill, the kit and a fighter project do not share a lifetime. Detail: `docs/LIFECYCLE.md`. Installing this skill does not install the kit or sign anyone in. The kit is the workspace executor and is not required for a hosted fighter or a connection check. A project is the session, selected versions, jobs and packages. Do not update the kit while a project is in progress, and do not rewrite a project when the skill or the kit changes.

A connection or status request does not authorize starting or resuming creation. For registered-fighter lookup, check that the connected ODDBOUT tools are available; no workspace setup is needed. For creation, choose the route below and open only the reference that matches the question.

## Hard rules

These stay in this file. A reference page cannot relax them.

- Quota: read `get_profile`, then `get_my_fighters` view `list`, and report the returned account id, email, `fighterCount` and `fighterLimit`. Missing or null stays unknown. At the limit, stop. Do not prepare a package or call `request_hosted_fighter`. The error is `fighter-quota`.
- Revision without a target: confirm the fighter is in the returned roster. If it is absent or ambiguous, stop and ask which fighter is meant. Never create a substitute. A revision is a new package with the same `fighterId`. The prior submission stays immutable. `revise_hosted_motion` (`request_hosted_fighter` step `revise_motion`) only edits a legacy job at `motion_ready`. A style-only edit is `update_fighter` kind `style`.
- Delegation: set `delegate: true` only when the user explicitly delegates the appearance choice. "Make it", "just make it" and "그냥 만들어줘" request creation but do not delegate. Ask the user to choose the look and do not pass `delegate: true`.
- `idempotencyKey` is required for `prepare_fighter_registration`, a profile set, `update_fighter` kind `style`, and `request_hosted_fighter` step `request`. Reuse the original key for the same bytes. Changed bytes need a new key. An unknown outcome is not a failure: inspect the existing record before any retry.
- Never call `enter_fighter` automatically. `enter_fighter` and `delete_fighter` are `permission-forbidden`. A mutate tool runs only with `confirmed: true` and confirmation text on that same call. No flag confirms every tool or the next call.
- Show the measured profile set and get approval before `prepare_fighter_registration` kind `profile_set` and before entry. `pending` and `pendingStages` are stage names, never asset ids. Upload each `missingAssets` entry.
- Do not ask for callback URLs or tokens in chat. Do not switch provider, account or registration route because a tool failed.
- Queued panels, text reports and local paths are not displayed previews. Say the stage in one sentence while a long job runs. Approval still waits for the actual images.
- Watching a job does not run it or cancel it. `get_creation_job` returns `executedByThisCall: false` and `cancelledByThisCall: false`. `get_hosted_fighter` with `observe: true` does not advance a job, and neither does `waitSeconds` on that read. `advance_hosted_fighter` is the mutating step and needs `confirmed: true` plus confirmation text on that call. Resume reuses the stored `idempotencyKey` and does not start a second registration.

## Which route

When `request_hosted_fighter` is available, offer hosted creation first if the user wants ODDBOUT to make the fighter or has no generation setup. No workspace or generation account of the user's is required. Pass the user's words, follow each result's `next`, and read [hosted creation](references/hosted.md) before the first call. Hosted creation includes registration into production. Do not wait for motion approval. Only the owner enters the fighter.

The workspace route is the user's choice of a PC or Dots workspace. Read [workspace routing](references/workspace.md) before the first generation there. Use the same project tools through `creation:tool`. Do not move a Dots task to a PC. Before generation, run `npm run creation:preflight -- --purpose generation` or workspace `preflight_creation`. It does not install or generate. `npm run creation:plan` lists what is still open and does not start it.

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
| Workspace kit, Dots, `creation:tool` | [workspace routing](references/workspace.md) |
| Skill, kit and project lifetimes | `docs/LIFECYCLE.md` |
| Poses, style fields, gait, delivery | The kit docs named in the reference for that question |

## Resume

A workspace session writes `BRIEF.md` and `PROGRESS.md` beside `creation-session.json`. They are a summary. `get_creation_session` and `get_creation_job` are the record. Record the agreed route, account id, account email and hosted job id with `update_creation_session` type `memory`. Do not put tokens, callback URLs or login links in that note. Hosted resume is `get_hosted_fighter` with the original job id or `idempotencyKey`.
