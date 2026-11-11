# Jobs, watching, plan and reuse

The skill body's hard rules win if this page disagrees. An unknown generation outcome is not a confirmed failure. A delivery failure is not permission to regenerate.

## Say the stage, decide from the pictures

While a long job runs, say the stage, what is left, and what is blocked, in a sentence or two. That narration is not the preview. Appearance and motion approval still require the actual images. `get_creation_job` is observation: `executedByThisCall` and `cancelledByThisCall` are false. Stopping the reader does not cancel the runner. Cancel only with `cancel_creation_job`, and only for the reason that tool allows. Read a hosted job with `get_hosted_fighter`. That read does not start a job, advance a motion, or register; ODDBOUT's worker does that on its own.

## Plan before generation

`plan_creation`, or `npm run creation:plan -- --workspace <absolute dir> --session <id>`, lists the current group's kept selections, items still open, recorded reuse files and known jobs. `startedGeneration` is false. `cost.known` is false. Do not fill in a price, token total or subscription charge. A hosted token balance is reported only by the hosted tool result that actually returned it. The plan does not prepare a job and does not change provider.

Run `preflight_creation` or `npm run creation:preflight` before the first generation and again before registration. A kit older than 0.6.21 has neither, nor the plan or checkpoint tools: use `check_creation_readiness` there. `purpose: connection` and `purpose: registration` do not ask for a generation subscription or install the engine. The command does not run `nextCommands`.

## Execute and recover

The state tools do not generate images. Prepare an immutable command using `prepare_creation_job`. It returns a structured local execution command. Read the engine's relevant workflow before choosing args. Declare all input files, including request and plan JSON and their referenced assets, and expected output files. Generation plans include the exact resolved upstream `workflowArgs` for a fresh access preflight. Use explicit providers on `gen` and `gen-set`. The preflight and generation provider must agree.

Run the returned command through the host's normal terminal execution tool, using the returned cwd and env. It launches the existing engine without a shell, records the attempt before launch, and does not retry it. `get_creation_job` retrieves the actual outcome. Process success and file hashes are not visual approval. `get_creation_job` without a job ID lists existing work.

- Reuse the same job ID for an identical preparation retry. Changed args require a new ID.
- Use `cancel_creation_job` to discard an unstarted preparation before creating a corrected one. That is a cancel, not an observation.
- If the outcome is unknown, inspect existing provider request records and local outputs first, even when no request ID was returned. Use upstream `video-resume` where appropriate. Never resubmit blindly.
- `resolve_creation_job` requires actual evidence: recovered output, proof no request started, or an explicit user choice accepting possible duplicate generation or usage. A generic "continue" is insufficient. Resolution does not rerun a job or approve an animation. Preserve the original job as evidence.
- Exit 75 and a preflight requiring input preserve the user's existing provider policy. Do not choose another account, provider, billing mode, or retry on the user's behalf.

For detailed schema examples and recovery semantics read `docs/LOCAL-PLUGIN.md` in the returned kit root. For commands not supported by the initial managed runner, use the documented kit CLI directly and record their actual outputs as versions or evidence. Do not claim they received managed-job guarantees.

## Reuse failed-run files

Reuse is opt-in. `update_creation_session` type `reuse` records existing files under `output/<sessionId>-work/` for one item, with a note of the user's words. The files must already exist. The record does not copy them over a selected version and does not generate. `prepare_creation_job` then refuses that item with `reuse-recorded` until the plan's `regenerate` array names it. `regenerate` is the explicit request to draw that item again. Clearing the record is type `reuse-clear`.

Do not reuse by sending the same registration `idempotencyKey` as a new package, and do not drop a key because a generation failed. Registration retries keep the original key for the same bytes. A new package needs a new key. Selected versions stay until the user accepts a replacement through `version` and `select`.

## Checkpoints

A long job writes `output/<sessionId>-work/jobs/<jobId>.checkpoint.json` whenever its record is saved. `read_creation_checkpoint` and `resume_creation_job` only read. `executed` stays false. The job record is the authority: a checkpoint whose schema, job id, session, status or `registrationKey` disagrees is refused with `checkpoint-mismatch`, and the file's key is not used. Resume does not mint a key and does not submit again.

For a hosted job, `get_hosted_fighter` only reads, including when `waitSeconds` is set. It does not advance a motion or register; ODDBOUT's worker does. In the dummy harness the read carries `observe: true` and `advance_hosted_fighter` is the confirmed mutating step; the live tools have no advance tool. The same `idempotencyKey` returns the same job.

