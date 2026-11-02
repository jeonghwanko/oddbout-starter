# Security boundary

This is an invite-only registration beta. Technical registration is separate from visual review and gameplay approval.

- The desktop MCP uses STDIO. Cloud tools are enabled only with an explicit user-session config; uploads go to that configured Supabase project.
- File tools require an explicit trusted `AI_FIGHTER_ROOT`. Inputs are relative manifest paths.
- Keep untrusted processes from modifying that directory during validation. Path checks are not an OS filesystem sandbox.
- Native image decoding runs serially in a child process with a deadline. V8's heap limit does not constrain all native memory.
- Edge authenticates each user with Supabase Auth and an operator-managed invitation. Worker credentials have a separate hash allowlist and are never passed to Dot.
- Remote files are private and immutable. The API checks actual bytes and hashes before upload. The worker downloads and fully decodes them before registration.
- Operator-approved `arena-player-v1` packages are intentionally public through read-only `/roster` routes. The bucket remains private; delivery URLs expire after ten minutes. Revocation stops new delivery but cannot retract downloaded files or an ongoing match.
- Approval binds the exact manifest hash, runtime scope and review evidence through a database constraint. User credentials cannot grant approval. New registrations remain pending.
- The game rechecks approval on entry, validates manifest and asset hashes, and uses common player combat rules. This scope does not approve the character as an AI opponent or prove competitive balance.
- Database transactions, owner quotas, storage reservations and unique constraints enforce retries. RLS denies cross-owner reads; direct client writes and privileged RPC calls are revoked.
- The current worker uses private fresh directories, pixel budgets, a serial decoder and process timeout. Production OS/container hard memory limits remain a deployment requirement; V8 heap limits do not bound native memory.
- Profile strings and error values are untrusted data. Never execute them or insert them as raw HTML.
- A passing local validation does not establish ownership, visual quality, fair gameplay, or registration.
- Store user sessions and worker configs outside the checkout with owner-only access. Never configure the MCP with the service-role key or worker config. Renew or revoke invitations and worker credentials after their 30-day beta validity.
- No credentials belong in this repository. Report vulnerabilities through the repository's private security reporting when available; otherwise open an issue without secrets or private file contents.

See [the adversarial review](docs/records/ADVERSARIAL-REVIEW.md) for reproduced defects and remaining release blockers.
