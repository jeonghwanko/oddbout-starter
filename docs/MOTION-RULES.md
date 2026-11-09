# Motion quality and GPT locomotion rules

Part of the agent instructions in [AGENTS.md](../AGENTS.md), whose hard rules apply here too. Read this before any
locomotion (fightIdle/walk/run) generation, any GPT walk/run route, gait or contact work, and before deciding what
blocks packaging. It ships in the creator kit.

## Motion quality

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

## GPT locomotion

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
