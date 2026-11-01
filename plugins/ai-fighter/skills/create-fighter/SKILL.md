---
name: create-fighter
description: Create, revise, resume, validate or register an ODDBOUT fighter in a PC or supported Dots workspace using the user's generation account and connected ODDBOUT registration. Also inspect the user's registered fighters. Process design and forwarded examples do not authorize generation.
---

# ODDBOUT

One workflow covers creation, review and registration. When exposed in this conversation, the connected ODDBOUT tools own the registration
account; the workspace kit owns files, version selections and generation jobs. Do not ask the user to
install AI Fighter Creator as a second plugin or choose between two product names.
For registered-fighter lookup or status, first check that the connected ODDBOUT tools are available here; no workspace setup is needed.
For creation, read [workspace routing](references/workspace.md). Use the same project tools through
`creation:tool` in the user's PC or the Dots workspace. Do not move work to a PC when the user chose Dots.
For Dots initialization/resume, also follow the kit's `docs/DOTS-START.md`: offline doctor, recovery inventory,
then explicit bootstrap if this is a new workspace. Keep unsupported output contracts blocked; never read
protected Codex sessions or start a second generation because the original exec is still waiting.
Workspace generation uses the installed creator kit's sprite-gen and the user's account.
For supported direct conversation appearance generation/display, check that route first under `docs/DELIVERY.md`;
do not require a PC or leave the user's chosen VM scope. Packaging still uses the creator kit.

## Connection-only checks and missing tools

A connection/status request does not authorize starting or resuming creation. Inspect this conversation's actual
ODDBOUT tools, call native `get_profile` when available, and use `check_creation_readiness` with `purpose: connection`.
Keep server discovery, account plugin import/update, installation and selection in this conversation, tool exposure,
and the returned account identity separate. A released ZIP, local Codex connection or successful public MCP tool listing
does not establish any Dots-native account connection.

In ChatGPT/Dots, reuse the existing available ODDBOUT cloud App with its account tools and creation skill.
Read the skill and support document from that same App through the host's skill tools; do not substitute an old ZIP package's skill.
An imported plugin's root `mcp.json`, even with an HTTPS server, may be desktop-only. The creator-kit ZIP is optional
reviewed source/runtime delivery for an explicitly chosen workspace, not the cloud App connection or a second required plugin.
Only when no existing App is available should supported first-time cloud MCP OAuth provisioning be considered.
Only an actually missing skill calls for a maintainer to add it through Plugin Creator to the same app-backed plugin,
preserving its binding and presentation. Do not copy the kit's root MCP declaration into that app-backed plugin.
After an explicitly requested old-plugin removal, verify the installed list, all host skill-list pages, and native account
lookup in the same conversation. Uninstall and permanent deletion of an owned plugin are different actions; do not turn
a `not_installed` response into permission for permanent deletion. Preserve existing work and use the verified App package.

If `get_profile` is absent, report tool exposure as unverified; do not start local login, device pairing or generation
to replace the missing cloud connection. Resolve the current plugin through the host's supported discovery and settings.
Use only a returned current plugin URL/ID, never a historical private link or an invented replacement. A missing ID or
empty search does not prove deletion, replacement or a server outage. Prefer refreshing/selecting an existing verified
plugin. Preserve OAuth grants, workspaces, pending requests and jobs. Remove an old connection only within an explicit
user request after the replacement succeeds in this same conversation and its account matches the intended account.
If a native call returns an authentication error, follow that error's supported connection action; missing tools alone
are not evidence that the token expired.

## Hosted route

When the connected ODDBOUT tools list `request_hosted_fighter`, ODDBOUT can make the fighter on its own worker:
no workspace, kit or generation account of the user's is needed. Offer it first when the user wants ODDBOUT to make
the fighter or has no generation setup; the workspace route below stays the user's choice. Pass the user's words (and
their own pictures with their confirmation of rights: attached files where the host attaches them, else `start_picture_upload`,
whose link the user opens, or with `terminal: true` whose command sends a picture file you have; show them before passing them), then follow each result's `next`: show both looks (front views; the pick
is also the fighter's profile picture) and pass the user's pick or one change, show the motion previews (made from a side view
ODDBOUT draws from the pick) and pass their approval or one motion change, register on their request.
If the user leaves the choices to ODDBOUT ("just make it"), pass `delegate: true`: ODDBOUT picks the look and the user answers once, at the motions.
Wait with `get_hosted_fighter` `waitSeconds` rather than repeated reads. Do not generate locally for a hosted job.
If the user runs a generation host on their own PC (`npm run host -- join` from the site), pass `host: mine`: their own subscription makes it, with no
consent to give and without using their tokens (each account starts with 500,000; ODDBOUT's own worker takes off what it spends).
Another person's host (`list_generation_hosts`) takes none of their tokens and needs the user's consent first.

## Start or resume

1. Read the connected ODDBOUT `get_fighter_spec` sections `overview` and `creation` using its actual schema.
   The cloud connector does not necessarily support `context` or `guide`. Use workspace `get_fighter_spec`
   through `creation:tool` for `context`, `guide`, and the kit's `creation` section. Its creation response supplies
   this user's runtime kit root (`tool.repositoryRoot`), workspace (`packageRoot`), sprite-gen skill path,
   and the full creation/interaction guides. In a portable installation the kit and workspace differ.
   Read those guides, `docs/AUTHORING.md` and `vendor/sprite-gen/SKILL.md` in the returned kit root.
   If generation is needed and the Python environment is missing, run `npm run sprite:setup` with cwd set to that kit root.
   Connecting or registering an already-built package does not require generation setup.
   Keep all project inputs and outputs in the returned workspace. Run prepared jobs with their exact
   returned cwd/env. Do not put assets, sessions, or a Python venv in the plugin cache.
   Game data owns motions, frame counts and timing. Refresh it on resume and before each new group.
2. Use `list_creation_sessions` and `get_creation_session` for an existing project. Prefer the current
   conversation over earlier notes. Create a session only for the user's actual project; use
   `mode: dialogue-only` for requested simulations. A link or process question is not a generation request.
3. Accept text, images or both. Ask only about unresolved reference roles or material conflicts.
   Confirm current image and video access together when missing; reuse answers in the current conversation.
   Prefer GPT base + Grok motion when both are available, or the available provider for both.
   An explicit user choice wins. Read the upstream workflow and obtain `ready` before generating.
   Preserve a stop-on-failure choice; never silently switch provider or billing route.
4. Read `docs/DELIVERY.md` in the returned kit root before generation. Check generation and parent-conversation
   delivery routes separately. Dots conversation model, CLI `--model` worker and image tool/backend are distinct;
   a copied report model, login or tool listing does not verify generation. Require actual call/completion/output
   evidence, keep unknown backend/account identity unknown, and treat `creation:delivery` as a record check only.
   Local/Library saves and child-only or queued previews do not prove parent display. Recover existing results
   before retries; delivery failures do not authorize regeneration.
5. Use `check_creation_readiness` and `docs/CONNECTION-READINESS.md` for the ODDBOUT connection action.
   Set `purpose: connection` for sign-in checks and `purpose: registration` for an existing final package;
   only `purpose: generation` prepares the generation engine or asks about generation access.
   For an explicitly selected local stdio connection, use `connect_oddbout(action: start)` within a connection/registration request; show its public link/code,
   then `action: wait` after the user approves. Repeated start returns the same pending link. Respect
   retryAfterSeconds. Current runtimes adopt login without an MCP restart. If these tools are absent,
   use `npm run creation:check -- connection` only to inspect that explicitly selected local route. Missing cloud tools
   must follow the connection-only checks above, not this local CLI fallback.
   Keep authenticated registration API access, generation access and parent delivery separate. A saved session
   is unverified until GET /me succeeds. Environment-preparer actions (VM host allowlist/Republish) are initial
   workspace setup, not repeated creator steps; the kit cannot perform those settings changes.
   Reuse pending device approval and preserved sessions/jobs after recovery. Do not claim a Dots-native button
   was installed: hosts may render the action as a button, choice or official link.

## Front first

The appearance group starts with the fighter's **front** (the profile set, `get_fighter_spec` → `profileSet`): one full-body front
view, the user's approval of it, then the side view and the motions drawn from it. The front is his profile picture on the site and
his face in the arena, and the home lists him only once his profile set is approved.

1. Draw two front candidates with the user's account. Every generation of this fighter (fronts, the side view, later edits) carries
   the spec's `profileSet.style.colouring` text and attaches `profileSet.style.anchor.url` (the house style anchor) as the LAST
   reference image: our plain cel colouring, never the user's references' rendering. His pictures give the character, not the style.
2. Show both and take the user's pick or change. Measure the face square on the pick (`profileSet.face`) and show it as a round crop.
3. Draw the side view (facing right) from the approved front as the first reference, same colouring; check it is the same character.
   Continue the appearance group (concept/idle) from that side view; the motions follow it.
4. After registration, upload the approved front with `prepare_profile_set` (fighter id, its `profile-set.json`),
   `upload_profile_set_asset` and `submit_profile_set`, and follow `get_profile_set`. The front is not part of the package.

## Work in review groups

Complete appearance, locomotion, attacks, defense, and final review in the game's order.
Offer the optional style group (skill, entrance and victory clips, fighting style) once after defense when the context lists it; skip it if the user declines.
Finish the agreed group autonomously, show its actual images/animations together, and wait for feedback.
Positive feedback advances when all other current versions are already accepted and checks pass.
Praise plus a requested change is a revision. Later delegation does not waive an earlier pending group.
Only explicitly delegated groups may proceed without their user review boundary.

Use `update_creation_session` with the current `expectedRevision` to record one decision:

- `version`: record a new version and the actual files. Never reuse a version ID or overwrite selected files.
  Keep outputs under `output/<sessionId>-work/artifacts/<item>/<version>/`.
- `review`: record actual observations and existing evidence files. `passed` is an agent observation,
  not a tool-generated visual certificate. Unknown observations remain unverified. Dialogue simulations
  use `hypothetical` and must never become production approvals.
- `select`: quote the user's actual acceptance of the named current version.
- `revision`: record the affected item and feedback, preserve accepted versions, and change only affected art.
- `delegate`: record the exact groups delegated and the user's words.
- `profile`: record the chosen name/description. Metadata changes do not invalidate animation choices.
- `advance`: enforce the group boundary. Resolve only the returned blockers; do not ask for accepted items again.

Re-read after a revision conflict; do not blindly replay a stale update. If game context changed,
explain the changed requirements and use `refresh-context` after comparing them. Old selections remain
recorded, but stale evidence must be reviewed. Keep brief conversational notes in `creation-notes.md`.

## Execute and recover

The state tools do not generate images. Prepare an immutable command using `prepare_creation_job`;
it returns a structured local execution command. Read the engine's relevant workflow before choosing args.
Declare all input files, including request/plan JSON and their referenced assets, and expected output files.
Generation plans include the exact resolved upstream `workflowArgs` for a fresh access preflight.
Use explicit providers on `gen`/`gen-set`; the preflight and generation provider must agree.

Run the returned command through the host's normal terminal execution tool, using the returned cwd/env.
It launches the existing engine without a shell, records the attempt before launch, and does not retry it.
Keep progress visible during long jobs. `get_creation_job` retrieves the actual outcome; process success
and file hashes are not visual approval. `get_creation_job` without a job ID lists existing work.

- Reuse the same job ID for an identical preparation retry. Changed args require a new ID.
- Use `cancel_creation_job` to discard an unstarted preparation before creating a corrected one.
- If the outcome is unknown, inspect existing provider request records and local outputs first, even
  when no request ID was returned. Use upstream `video-resume` where appropriate; never resubmit blindly.
- `resolve_creation_job` requires actual evidence: recovered output, proof no request started, or an
  explicit user choice accepting possible duplicate generation/usage. A generic “continue” is insufficient.
  Resolution does not rerun a job or approve an animation. Preserve the original job as evidence.
- Exit 75 and a preflight requiring input preserve the user's existing provider policy. Do not choose
  another account, provider, billing mode, or retry on the user's behalf.

For detailed schema examples and recovery semantics read `docs/LOCAL-PLUGIN.md` in the returned kit root.
For commands not supported by the initial managed runner, use the documented kit CLI directly and
record their actual outputs as versions/evidence; do not claim they received managed-job guarantees.

## Final files and registration

Follow `docs/GAIT-REVIEW.md`: one coordinate/scale reference, phase plan before generation,
both same-foot stance ROIs, final game-pack pixels/durations, actual previews and verified contacts.
For GPT walk/run, use the kit CLI and the pinned sprite-gen-agent motion engine. Generate diagnostic key poses first;
review both physical legs, their hip attachments, contacts and body continuity before binding that image.
Full sequences require the actual phase guide and reviewed key-pose reference, not only a layout guide.
Use painted extraction with `ground_frames: false` to retain source flight height. Generation OK is not
motion approval. Do not repair failed gait by pasting a frozen torso over separate legs, and stop after
two consecutive failures of the same anatomy/contact requirement. Preserve unknown attempts without retrying.
Use upstream `game-pack`, then `fighter:pack` with `reviewPolicy: required`. Never hand-assemble sheets
or invent measurements. A format fixture is never a generated character.

Run the existing manifest and full-file validators. Record `package` with the manifest and every asset,
then `package-review` with real validation reports and the user's final preview feedback.
The session review is a record, not a substitute for those validators or generation authorization.
The final `get_creation_session` must have no blockers before submission.

Use the connected ODDBOUT account for registration from either workspace. Verify `get_profile` matches
the user's intended account and call the cloud `check_creation_readiness`; a workspace readiness result
does not verify that login. Never copy a CLI session into the connector or request local login for this route.
Read the cloud tools' current schemas, then call `prepare_fighter_registration` with the actual approved
manifest, `upload_fighter_asset` for each pending file, `submit_fighter_registration`, and
`get_fighter_submission`. Pass actual host attachments/files, not rendered previews, made-up URLs, or
paths on another machine. Materialize supported Library files with their original bytes and verify hashes.
Preserve the submission ID and idempotency key across identical retries; inspect status before retrying
an unknown response. Changed package bytes need a new key. A metadata-only final edit followed by an
explicit registration request requires fresh validation, not repeated approval of unchanged animations.
Then upload the approved front as his profile set ([Front first](#front-first) step 4).
Report registration only after the response confirms it. A registered fighter starts in production (제작 중): it stays out of
other people's cups, ranked duels and lists. Tell the user to check each required motion on the fighter page's All motions and enter it there; call
`enter_fighter` only on the user's request after showing every required motion and hearing each confirmed.
If the connector or attachment route is missing,
preserve the completed package and report that blocker; do not silently switch registration accounts.
