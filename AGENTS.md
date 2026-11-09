# ODDBOUT creator kit: agent instructions

Codex loads this file; Grok requires a trusted folder (`--trust` headlessly); Claude Code imports it via `CLAUDE.md`.
Keep these product rules in code and docs. The shipped kit applies only creation/Dots rules and lacks repository-only docs.

## Start here

| Your task | Read first | Then |
| --- | --- | --- |
| The user sent only a repository link | `docs/START-HERE.md` | Its steps, then the row below |
| Create, revise, resume or register a fighter with a user | [Hard rules](#hard-rules), [Creating a fighter](#creating-a-fighter) | `docs/CREATION-UX.md`; `docs/DOT-CREATION.md` and `docs/AUTHORING.md` before the first generation; the live AI Fighter spec before creating a package |
| Set up or resume a Dots workspace | `docs/DOTS-QUICKSTART.md`, `docs/DOTS-START.md` | [Hard rules](#hard-rules), [Dots workspaces](#dots-workspaces), [Workspace, connection and sign-in](#workspace-connection-and-sign-in); to create, the row above |
| Change code, tests or docs here | [Hard rules](#hard-rules), [docs/REPOSITORY.md](docs/REPOSITORY.md) | The doc that owns the area ([docs/README.md](docs/README.md)). [Creating a fighter](#creating-a-fighter) states product requirements the code implements: read the part your change touches |
| Deploy or operate the service | [Hard rules](#hard-rules), [Deploys](docs/REPOSITORY.md#deploys) | `docs/CREATOR-HOSTING.md`, `docs/CLOUD-MCP.md`, `docs/GENERATION-HOST.md` |

`docs/records/` and `docs/research/` are history, not procedure, unless a rule below directs you there.

## Hard rules

These apply to every task; later sections cannot relax them.

1. Never invent hashes, origins, measurements, contact timing, successful generation or registration results.
   Report only what a tool, file or server response returned or what you observed in the actual output; anything
   unobserved stays unverified.
2. An unknown generation outcome is not a confirmed failure, even without a request ID. Inspect existing records and
   outputs before any retry. A generic continuation request does not authorize a potentially duplicate generation,
   and a delivery failure is not permission to regenerate.
3. When generating in a workspace, use only the current user's generation account. Never copy the maintainer's
   credentials, home paths, subscription confirmations or saved choices to another user. No automatic model,
   provider, account or billing switch, and no helper or security-rule bypass: only the user's explicit choice
   changes the route, within the host's rules (Dots allows no API-key fallback). ODDBOUT's hosted route is not an
   account switch ([Providers and subscriptions](#providers-and-subscriptions)).
4. Callback URLs can contain codes or tokens. Never ask users to paste them into ordinary chat or describe that as
   safe, even if tool output suggests a paste mode.
5. A Git URL or research request alone does not authorize generation, and process design/review requests and
   forwarded example characters do not authorize generating a character. Follow the latest direct user intent; stop
   dependent generation when it changes.
6. Never overwrite a registered immutable package or a selected version.
7. Preserve unrelated working-tree changes.

## Creating a fighter

For each user's fighter, use bundled sprite-gen: read `docs/DOT-CREATION.md` and `docs/AUTHORING.md` before generation,
and the live AI Fighter spec before packaging.

### Intent and intake

- Read `docs/CREATION-UX.md` for intent, text/image intake, account choices and the process evaluation rubric.
- Explicit creation requests authorize routine preparation within their scope ([hard rule 5](#hard-rules) lists what
  does not authorize generation).
- Accept text, reference images, or both. Ask only about missing reference roles or material conflicts.
- Distinguish user requirements from proposed details; do not make users complete a long character form.
- An explicit edit overrides the reference's existing detail; do not ask again whether to keep what the user said to remove.
- Ask only for missing creative decisions that affect the next preview. Handle installation, extraction, measurement
  and validation within the agreed step without making the user approve each command.

### Providers and subscriptions

- When the connected ODDBOUT tools list `request_hosted_fighter`, ODDBOUT can make the fighter on its own worker with
  no workspace or generation account of the user's. Offer it first when the user wants ODDBOUT to make the fighter or
  has no generation setup, and follow the Hosted route in `plugins/ai-fighter/skills/create-fighter/SKILL.md`; another
  person's generation host needs the user's consent first. The rules below cover generating in a workspace.
- Default recommendation: GPT base + Grok video when both are available, all Grok when only Grok is available, all
  GPT when only GPT is available. Explicit user choices override this product preference.
- Confirm current access in one understandable question. The recommendation never authorizes an automatic runtime provider switch.
- Track image and video access separately. Honor an already chosen stop-on-failure policy without reoffering rejected alternatives.
- Respect capacity stop conditions and the selected model. Preserve upstream provider selection and billing rules.
- Design the default customer flow for one already-owned generation subscription. Separate actual image/video/editor
  capabilities from subscription names and API billing. Do not make a second subscription or a self-hosted
  VACE/ComfyUI GPU server a hidden requirement.
- Remote experiments are research evidence unless explicitly selected as the product path. Read
  `docs/research/MOCHA-LOCOMOTION-HANDOFF.md` before resuming Mocha locomotion research; further VACE generation is
  paused for the requested architecture review.

### Review groups

- Hosted creation skips workspace motion reviews: after the appearance choice (including delegation), complete motions
  and register into production. Honor holds/edits; await server confirmation before claiming registration. The owner enters on the site.

- Creation is conversational in review groups: appearance (concept/idle), locomotion (fightIdle/walk/run), attacks
  (combo/slam/dash), defense and reactions (block/hit/groggy/fall), then final review.
- Appearance starts with the front (the profile set, `get_fighter_spec` → `profileSet`): the user chooses a full-body front view;
  the side view and the motions are drawn from it, and after registration the front goes up as his profile set. His expression sheet
  (six arena faces, the KO card's defeat face last) is drawn from the chosen front and goes up with it; `npm run fighter:profile-set`
  builds the set's files, never hand-typed values. Every generation carries the spec's colouring text and attaches its style anchor as
  the last reference: the house's plain cel colouring.
- When the game context lists the optional style group (skill/entrance/victory clips and the fighting style), offer it
  once after defense and skip it when the user declines. It never blocks final, but each optional clip a package
  carries needs a selected, checked version.
- Complete the agreed group autonomously, show its actual previews together, and wait for feedback at the group
  boundary, not after every motion. Show actual images/animation, not only progress text.
- A positive response advances to the next group without another permission question.
- Skip review boundaries only for groups the user explicitly delegates, and preserve the user's actual delegated
  scope. Delegating later groups does not waive an earlier pending review.
- Reuse choices the user already made. A request to create or register alone does not waive group feedback.
- Read the full feedback: praise with a revision request is a revision; praise of one motion applies to that motion's current version.
- Track acceptance per motion and version. A positive response about the last pending motion completes the group when
  the other current versions are already accepted and the required checks pass; do not ask for those approvals again.
- Preserve selected versions and revise affected assets only. Follow the feedback and work-note rules in `docs/DOT-CREATION.md`.

### Generation and delivery

- "sprite-gen" means the engine and CLI pinned at `vendor/sprite-gen` ([sprite-gen](#sprite-gen)). For local
  generation use the bundled `vendor/sprite-gen/SKILL.md` and its referenced workflow. `npm run sprite:setup` installs
  this checkout's source in its own venv; `npm run sprite -- <command>` runs that environment. Do not update the pin
  or modify vendor code as part of character creation.
- Before generation, follow `docs/DELIVERY.md`: verify generation access and actual image/file delivery to the
  current user conversation separately.
- Supported appearance previews may be generated and displayed directly in the current conversation: for those that
  do not require a PC, check the conversation host's own direct image-generation/display route first, within the
  user's environment/account/model constraints. Packaging and registration use local files.
- Local generation requires a verified delivery route. Tool names visible to the model do not prove that the selected
  Library helper can use them. Run `npm run creation:delivery` when local execution is available.
- Distinguish the Dots conversation model, the Codex CLI `--model` worker and the actual image tool/backend. The
  provider report's copied `model` is not an observed image backend.
- Login, model strings and tool listings do not verify generation: require actual call traces and completed outputs
  in that environment. Keep unobserved backend and account identity unknown. Readiness flags and `creation:delivery`
  record checks are not live generation/display certificates or authorization to generate.
- Keep generation, local save, Library save, conversation display, review and user selection distinct. Queued panels,
  text reports and local paths are not displayed previews, including across delegated chats.
- Recover existing outputs before any retry; a delivery failure is not permission to regenerate. New generation needs
  an explicit new-generation/edit request.

### Workspace, connection and sign-in

- Run creation in a workspace per `docs/EXECUTION-HOST.md` (bot service VM or the user's PC): one user per workspace,
  the user's own login only, no service API keys in the environment, work folders and attempt records preserved
  across sessions, and no pulls of this repository while a character is in progress.
- Call MCP `check_creation_readiness` before a character's first generation, after a workspace restart and before
  registration. Use purpose `generation` only for generation setup; `connection` and `registration` must not ask for
  generation subscriptions or install/update the engine.
- Run the readiness result's kit `nextCommands` (restart when told). Pass `account` only as the user stated it;
  otherwise let the conversation host's form or numbered options ask.
- Follow `docs/CONNECTION-READINESS.md`: the account and registration belong to the connected ODDBOUT cloud tools
  (`get_profile`, then `prepare_fighter_registration`, `upload_fighter_asset`, `submit_fighter_registration` and
  `get_my_fighters` view `submission`). The workspace tools never read a CLI login; a missing or failing cloud tool is not a
  reason to sign in locally.
- The kit's own login (`npm run login`, used to join a generation host or run admin commands) runs only with a supported
  secure handoff or the device connection ([hard rule 4](#hard-rules)): for a browser on another device, `--device`,
  then `--device-wait`. The link and pairing code are public: tell the user to approve only a request they started and
  whose code matches.
- If no secure route is supported, report the authentication blocker. Do not implement a bypass or assume a planned flow already exists.
- Keep ODDBOUT API/account, generation access and parent delivery separate. A saved session is not a server-verified account.
- VM CONNECT/network blocks belong to the initial environment preparer; ordinary creators reuse that workspace. The
  kit cannot change VM host allowlists or Republish: report that limitation without claiming success.
- After recovery, inspect existing sessions/jobs and pending device approval before any new action.

### Dots workspaces

- For Dots setup or resume, read `docs/DOTS-QUICKSTART.md` and `docs/DOTS-START.md` first.
- Run the offline `scripts/dots-workspace.mjs doctor` before opt-in probes; `bootstrap --install` is a separate action.
  Inspect existing sessions/jobs before installing.
- Never run the generation readiness tool as a supposedly read-only doctor: its kit path may fetch/fast-forward.
- Keep source and reviewed bundle layouts distinct. The launcher's `--status` is read-only; `--install` requires the
  reviewed manifest hash.
- Block unaudited Codex image-output paths, including an actual Codex still redraw inside `video-set`. Explicit Grok
  image/video commands keep their own engine checks; `video-resume` retrieves an existing request. Do not infer Codex
  use merely from a video command or require Codex readiness for a Grok route.
- Never read or delete protected sessions, relocate `CODEX_HOME`, or claim an invented stdout/file adapter.
- Keep the initial official exec wait at 30000 ms, then recover the same session/cell until completion; an unknown
  outcome must not cause another dispatch.

### Motion quality

- Packaging and registration use required file/contract checks only. Quality diagnostics (gait scores, same-foot
  tracking, visual anatomy/alternation/loop verdicts) are deferred work, never a prerequisite or a reason to regenerate.
  Do not call `requireReview` as a registration gate or demand an explicit visual override to continue.
- The contract still requires all 11 motions, walk 12–32 and run 10–16 distinct frames, valid timing, decodable files,
  correct dimensions, hashes, crops, origins, contacts and the remaining package checks. Keep selected versions and
  review-group user feedback; neither user selection nor a file-check pass certifies animation quality.
- `fighter:pack` defaults to `reviewPolicy: files-only`. Older `required`/`engine-loop` plans also use file checks only.
  Existing reports stay intact as diagnostics; stale/failed/missing reports do not block. Fresh usable measurements
  may supply geometry/stride, but never claim visual approval. Session quality reviews are also non-blocking;
  missing/changed files, unselected versions, requested edits and an unvalidated package still block.
- The following gait procedures are optional later quality work. When explicitly requested, keep one coordinate/scale
  reference, bind observations to the actual pixels and durations, and leave uncertain observations unverified.
- Split heel/forefoot contacts, padded/hoofed/clawed soles and lifted heels (digitigrade) may use
  `docs/FOOT-EVIDENCE.md` only with fresh per-frame outlines of both feet; v2 evidence groups sole lobes per foot and
  tracks the leading ground contact. This is an explicit AI Fighter extension: retain the upstream report and every
  other rejection. Never fabricate foot identity.
- For a requested generation-free gait experiment, use `gait-guide` (`docs/GAIT-REVIEW.md`). Render and review the
  authored phase/IK/foot-lock proxy before any new generation. Proxy joints, depth and contacts are design ground
  truth, never observations of generated artwork. Show actual normal/slow previews and keep visible part masks
  distinct from X-ray joints.
- A numerical flight flag is not visible flight. Check the final projection and exact sample times with
  `screen_audit`, then inspect raster foot contours and occlusion separately. Keep per-foot projected ground
  references; never substitute guide labels for output observations.
- Save video latents before decoding when supported. Isolate temporal decoding artifacts on the same latent; do not
  resample diffusion or silently reduce tile size to diagnose decoding.

### GPT locomotion

GPT locomotion uses the motion engine in the pinned sprite-gen-agent; run it through `npm run sprite --`.

When the user chooses authored joint pose guidance, use the v5 measured `gen-motion` route documented in
`docs/GAIT-REVIEW.md` and `vendor/sprite-gen/docs/pose-motion.md`:

- One whole-body pose per call: target guide + immutable appearance-only identity + reviewed anchors, the authored
  pose route's 16/12-frame plans, then pose and cycle review. These route defaults do not require resampling video cycles.
- Review the actual prepared original/guide pairing in `input-review.json` before generation; a coordinate plan is not
  proof of anatomical fit. Inspect `image_tool_trace` for actual dispatch evidence.
- Structural canvas errors and unknown timeout outcomes must not consume another generation; reconcile existing results.
- New generation requires a version-2 plan with visible original body-landmark calibration. Measure actual body points
  and fresh physical-foot outlines/sole points before visual approval.
- `--measure` and explicit `--register` never generate. Registration permits only a bounded uniform whole-body
  scale/translation inferred from body points, with independent foot/flight checks. It is not bottom alignment: feet
  never drive the transform, wrong anatomy is not repaired, raw pixels remain immutable and corrected pixels require fresh review.
- Geometry failures block retry in contract 3/4 runs. New gait-motion runs are contract 5: semantic pose prompts,
  diagnostic guide geometry, declared hidden points (`unverified_hidden`, never pass), and export gated by sequence
  review plus per-stance-interval `contact-coverage.json` (`docs/GAIT-REVIEW.md`).
- This route exports `sprite-gen-asset` directly and does not use row extraction or `bind-keyposes`.

The existing row route:

- Use `fighter:gait init` for separate key-pose and full-sequence requests. Review both physical legs, hip
  attachments, contacts and whole-body continuity before `fighter:gait bind-keyposes`; missing/failed observations
  remain unverified. The full sequence must carry the actual phase guide and reviewed key-pose image.
- Preserve painted-row source Y with `fit.ground_frames: false`; do not erase flight by bottom-aligning each frame.

Both routes:

- A generic skeleton guide is phase vocabulary, not a measurement of this character's proportions.
- Do not splice a frozen torso onto separate legs, duplicate poses, or label a plan as observed gait.
- `gen-set` success is generation only. Stop after repeated failure of the same anatomy/contact requirement, preserve
  versions and explain the limitation instead of continuing unbounded generation or compositing.

### Packaging and registration

- For workspace packaging recovery, use cloud `prepare_fighter_packaging` and execute its returned workspace MCP
  `inspect_fighter_packaging` / `pack_fighter_package` calls through the host's normal execution tool. Do not make
  the user relay errors or patch the kit. Cloud preparation is not evidence of file access or a completed package.
- When resolution optimization is within the user's request and the live contract advertises `texture-resolution-1`,
  `fitSheets: true` fits individual sheets and whole-package byte/pixel budgets, with measured bounded trials
  after body normalization. Keep the chosen encoding; use `report.budget` for actual totals and `outputScale` for
  an optional post-normalization density cap. Preserve original files, frame identities,
  timing and marks; `pixelScale` preserves its apparent game size. File/byte limits stay required. Never regenerate.

- `examples/sparring-bot` and `npm run example` are geometric test fixtures. They do not satisfy a request for a
  generated character; do not rename or restyle that fixture and call it sprite-gen output.
- Build the package with `npm run sprite -- game-pack`, then `npm run fighter:pack -- <plan.json>` (see
  `docs/DOT-CREATION.md`). It measures scale, frames, origins, contacts and hashes from the pixels: do not
  hand-assemble sheets or type those values. The plan holds contact steps, landmarks and gait review paths.
- Normal authoring uses `reviewPolicy: files-only`; `format-only` remains a format-fixture label. Neither certifies visual quality.
- Separate get-up art uses `fall.getUpAnimation` (`docs/DOT-CREATION.md`); keep auxiliary cells out of fall playback.
- Any signed-in user may upload without an invitation or manual approval. Submit only within the user's request, and
  distinguish validation failures from post-publication moderation.
- Reuse the same idempotency key for immutable retries; changed package bytes need a new key. A user-requested
  metadata-only final edit followed by an explicit registration request needs fresh validation, but not repeated
  approval of unchanged animations.
- A validated fighter starts in production (제작 중): out of other people's cups, ranked duels and lists while the owner
  previews and practises it. Other people meet it after the owner watches each required motion and enters it (출전,
  on the site's motions page or with `enter_fighter`); a new package returns it to production. Entry also needs its front
  painting (profile set) to pass ODDBOUT's front check — one character, whole from head to soles, facing the viewer —
  or an operator's approval; the fighter's `front` (`get_my_fighters` view `fighter`) says what is missing. Losing its last front returns it to production.

## Changing this repository

Read [docs/REPOSITORY.md](docs/REPOSITORY.md) first: repository map, commands, branches and CI, type checking and
deploys. The essentials, which apply even before you open it:

- Stage files by name; never `git add -A`, `git add .`, `git add -u` or `git commit -a` (they can stage
  `vendor/sprite-gen` as a rollback). Branch from `main`; never commit to `codex/*` branches by hand. In a checkout other sessions share, work in a
  `git worktree` and never switch its branch.
- Run only the relevant suites (`node --test test/<name>.test.mjs`, `npm run test:fast`, `npm run typecheck`) and
  finish local checks before pushing; CI runs once per ready pull request.
- Never put a CI skip marker in a commit message, or deploy hooks and tokens in any file, commit or pull request.

### sprite-gen

`vendor/sprite-gen` pins a commit of [sprite-gen-agent](https://github.com/jeonghwanko/sprite-gen-agent), our fork of
Alex Kim's [sprite-gen](https://github.com/aldegad/sprite-gen) that carries the motion engine. Commands, paths and
the Python package keep the name `sprite-gen`.

- Keep its Apache-2.0 LICENSE and NOTICE. Do not update the pin or modify vendor code as part of ordinary character
  creation. Engine changes are committed to sprite-gen-agent first; then move the pin. Bundling refuses local vendor
  edits, and setup refuses those a moved pin would overwrite. CI refuses a pin that does not move forward along
  sprite-gen-agent main.
- A pull does not move the submodule: set `git config submodule.recurse true` once per clone, or run
  `git submodule update` after each pull. Otherwise the old checkout shows as `M vendor/sprite-gen`, and `git add -A`
  stages it as a rollback.
- The venv holds an editable install of this checkout's path: after moving the checkout, rerun `npm run sprite:setup`,
  or the Python engine suites fail.
