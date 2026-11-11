# Review groups

The skill body's hard rules win if this page disagrees. Text is not a preview. Queued panels, text reports and local paths are not displayed previews.

Complete appearance, locomotion, attacks, defense, and final review in the game's order. Offer the optional style group (skill, entrance and victory clips, fighting style) once after defense when the context lists it; skip it if the user declines. Finish the agreed group autonomously, show its actual images and animations together, and wait for feedback. Positive feedback advances when all other current versions are already accepted and checks pass. Praise plus a requested change is a revision. Later delegation does not waive an earlier pending group. Only explicitly delegated groups may proceed without their user review boundary.

Use `update_creation_session` with the current `expectedRevision` to record one decision:

- `version`: record a new version and the actual files. Never reuse a version ID or overwrite selected files. Keep outputs under `output/<sessionId>-work/artifacts/<item>/<version>/`.
- `review`: record actual observations and existing evidence files. `passed` is an agent observation, not a tool-generated visual certificate. Unknown observations remain unverified. Dialogue simulations use `hypothetical` and must never become production approvals.
- `select`: quote the user's actual acceptance of the named current version.
- `revision`: record the affected item and feedback, preserve accepted versions, and change only affected art.
- `delegate`: record the exact groups delegated and the user's words. This is not `delegate: true` on a hosted request. Hosted appearance delegation is the hosted tool argument, and only when the user explicitly delegates that choice.
- `memory`: record the agreed route (`hosted` or `workspace`), account id, account email, hosted job id and the next action. No tokens, callback URLs or login links. The session then rewrites `BRIEF.md` and `PROGRESS.md`.
- `reuse`: record files from a failed or interrupted run that the user wants kept. See [jobs](jobs.md).
- `profile`: record the chosen name and description. Metadata changes do not invalidate animation choices.
- `advance`: enforce the group boundary. Resolve only the returned blockers; do not ask for accepted items again.

Re-read after a revision conflict; do not blindly replay a stale update. If game context changed, explain the changed requirements and use `refresh-context` after comparing them. Old selections remain recorded, but stale evidence must be reviewed. `BRIEF.md` and `PROGRESS.md` are the short resume. They are not a second record.
