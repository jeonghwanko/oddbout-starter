# Final files and registration

Part of the `create-fighter` skill ([SKILL.md](../SKILL.md)); its rules apply here too.

Use native cloud `prepare_fighter_packaging` for packaging failures. It returns exact invocations of the
workspace MCP tools `inspect_fighter_packaging` and `pack_fighter_package`; execute them through the host's
ordinary terminal tool using the returned JSON arguments, rather than asking the user to relay errors or
hand-patch the kit. Cloud preparation does not read VM files and is not a successful package. A new reviewed
kit can run separately against the existing workspace; keep the active runtime and selected originals.
When the user permits resolution optimization and the live contract lists `texture-resolution-1`, use
`fitSheets: true` with kit 0.6.10+: it fits sheet dimensions and total/per-asset byte/pixel budgets using actual
measurements, keeps frames/timing and preserves game size with `pixelScale`. It uniformly reduces density across
normalized motions when totals need it, preserving the chosen encoding and originals. Read `report.budget`;
the optional `outputScale` caps post-normalization density. A bounded worker may take up to ten minutes: resume
the same host execution after its initial 30-second wait. Never silently shrink
only a motion's character or remove frames. Required file, contract and upload limits still apply.

Quality diagnosis in `docs/GAIT-REVIEW.md` is optional later work. Preserve selected files and actual previews;
no same-foot stance, visual verdict or numerical pass is required for packaging or registration.
For GPT walk/run, use the kit CLI and the pinned sprite-gen-agent motion engine. Generate diagnostic key poses first;
review both physical legs, their hip attachments, contacts and body continuity before binding that image.
Full sequences require the actual phase guide and reviewed key-pose reference, not only a layout guide.
Use painted extraction with `ground_frames: false` to retain source flight height. Generation OK is not
motion approval. Do not repair failed gait by pasting a frozen torso over separate legs, and stop after
two consecutive failures of the same anatomy/contact requirement. Preserve unknown attempts without retrying.
Use upstream `game-pack`, then `fighter:pack` with the default `reviewPolicy: files-only`.
Only file/contract checks gate packaging and registration. Gait scores and visual quality verdicts are deferred;
do not require a passing report, an explicit visual override, or regeneration. Preserve existing diagnostics unchanged.
Legacy `required`/`engine-loop` plans also use file checks only; review-group user choices still apply. Never hand-assemble sheets
or invent measurements. A format fixture is never a generated character.

Run the existing manifest and full-file validators. Record `package` with the manifest and every asset,
and preserve the user's final preview feedback. `package-review` is an optional quality record, not a gate.
The session requires current validated package bytes, not a quality verdict or generation authorization.
The final `get_creation_session` must have no blockers before submission.

Use the connected ODDBOUT account for registration from either workspace. Verify `get_profile` matches
the user's intended account and call the cloud `get_my_fighters` view `readiness`; a workspace readiness result
does not verify that login. Never copy a CLI session into the connector or request local login for this route.
Read the cloud tools' current schemas, then call `prepare_fighter_registration` with the actual approved
manifest, `upload_fighter_asset` for each pending file, `submit_fighter_registration`, and
`get_my_fighters` view `submission`. Pass actual host attachments/files, not rendered previews, made-up URLs, or
paths on another machine. Materialize supported Library files with their original bytes and verify hashes.
Preserve the submission ID and idempotency key across identical retries; inspect status before retrying
an unknown response. Changed package bytes need a new key. A metadata-only final edit followed by an
explicit registration request requires fresh validation, not repeated approval of unchanged animations.
Then upload the approved front and expression sheet as his profile set ([profile set](profile-set.md) step 6).
Report registration only after the response confirms it. A registered fighter starts in production (제작 중): it stays out of
other people's cups, ranked duels and lists. Tell the user to check each required motion on the fighter page's All motions and enter it there; call
`enter_fighter` only on the user's request after showing every required motion and hearing each confirmed.
If the connector or attachment route is missing,
preserve the completed package and report that blocker; do not silently switch registration accounts.
