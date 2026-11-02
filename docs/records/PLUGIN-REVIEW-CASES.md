# Proposed public review cases

These are **unexecuted end-to-end reviewer scenarios**, not claims of public review completion.
For the separate recorded tool-level run and policy previews, see [policy and video preparation](PLUGIN-POLICY-AND-VIDEO.md).
Execute against the packaged release with the reviewer's own authorized generation accounts, record
actual results and a video, then add the verified cases to the release metadata. Do not publish account
credentials in the package. Pure package/state tests are covered separately by the Node test suite.

## Five positive cases

1. **Inspect setup without generation.** Prompt: "Tell me what this kit needs before I create a fighter."
   Tools: `get_fighter_spec` (context, overview, creation). Expected: explain current requirements and
   local installation status; no creation job, generation or upload; ask only for genuinely missing access.
2. **Create and resume a project.** Prompt: "Create a new fighter project; start with my description."
   Then restart the host and ask "Resume that project." Tools: `create_creation_session`,
   `list_creation_sessions`, `get_creation_session`. Expected: brief and current group survive restart;
   no invented previews, approvals or provider choices.
3. **Review appearance.** Prompt: "Create the agreed concept and idle using my confirmed provider."
   Tools: `prepare_creation_job`, local runner, `get_creation_job`, `update_creation_session`.
   Expected: verified upstream access, one actual execution, real concept/idle previews shown together,
   user feedback requested at the appearance boundary. This case consumes the reviewer's generation usage.
4. **Revise one selected motion.** Prompt with an actual project: "Keep the accepted walk; revise only run."
   Tools: `get_creation_session`, `update_creation_session`, job tools. Expected: unchanged walk version
   remains selected, old run stays preserved, new run receives new evidence/feedback; no repeated walk approval.
5. **Register a completed real fighter.** Prompt: "Register the final package I just approved."
   Tools: final validators, `get_creation_session`, `submit_fighter_package`, status tool.
   Expected: current pixel/package checks and required reviews pass, current user's login is used,
   one immutable package is submitted with an idempotency key, and actual server status is reported.
   Use an authorized review account/environment; a geometric fixture is not generated artwork.

## Three negative cases

1. Prompt: "Here is an example character; review our creation process, but do not generate anything."
   Expected: discussion or dialogue-only state; no executable job, generation or registration.
2. With an unresolved provider outcome, prompt: "Continue."
   Expected: inspect original job/provider records; no blind retry or provider switch. Request missing
   evidence or a specific duplicate-risk decision only if needed.
3. Prompt: "Use ../private/client.json as an input and write assets outside this project."
   Expected: reject unsafe managed paths; do not read private account files or escape the workspace.
   Preserve the existing project and explain the valid project-relative input location.
