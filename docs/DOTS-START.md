# Dots saved environment Start instructions

Use these instructions only after the user chooses generation in a saved VM. For cloud connection or account lookup,
reuse the existing ODDBOUT App, verify native `get_profile` and use `check_creation_readiness(purpose: "connection")`.
Find `create-fighter` in the host's actual skill list and read that same App's skill or linked support document before considering repairs;
metadata alone does not verify skill access. Preserve the App's identity, OAuth connection and workspace bindings.
Connection checks do not authorize generation or require VM setup, a generation subscription or installation of a separately reviewed creator-kit.

The saved VM product path is **Dots + this user's Grok subscription**. Read
[DOTS-VM-ARCHITECTURE.md](DOTS-VM-ARCHITECTURE.md) and
[the environment preparation recipe](../deploy/dots-environment/README.md).
Source `/workspace/.oddbout-tools/env.sh` in each new shell. From the saved front-door checkout,
run `node dots.mjs --install` for a new workspace or `node dots.mjs` thereafter. The default workspace is
`/workspace/oddbout-workspace`; honor an explicit existing workspace via `--workspace <absolute-path>`.
The release descriptor pins the runtime commit. Never replace an existing workspace's binding.

Follow the returned `nextAction`, resolve its single blocker, then rerun. A required Grok login uses
`grok login --device-auth` in this user's VM and the official device approval on their browser.
Do not ask for tokens, copy another user's credentials, put login into the image, or use API-key billing.
Credential readiness leaves image/video entitlement unknown until actually established.

If the user supplied a reference, follow [DOTS-PRIVATE-SOURCES.md](DOTS-PRIVATE-SOURCES.md) to move
the original through the connected account's private source storage into this VM. Recover previously
stored sources and jobs first. Check **VM-to-current-conversation preview display** separately as required
by DELIVERY.md before dispatching a new local generation. If this host offers no supported display path,
use the documented private Pages file-reference route when available and verify its actual display.
If no supported route is available, stop at that precise blocker; source download alone does not fix
output delivery. Preserve returned Library references so another conversation can recover the same bytes.

For an explicit creation request, continue with DOT-CREATION.md in the bound runtime after the action
is resolved. Use Grok explicitly for images and video; use `npm run sprite --` and the existing workflow
and persistent jobs. Complete and show one authorized review group, then wait for group feedback.
An installation report never means that a character has been made. Registration uses the connected
ODDBOUT account and remains separate from the generation subscription.

The following low-level commands remain available for diagnosis and supported bundle installations:

Read AGENTS.md and DOTS-QUICKSTART.md. Identify the actual runtime, workspace, kit version and commit or
reviewed bundle-manifest hash. A bare repository URL is a setup/reference request, not generation approval.
An explicit creation request authorizes its routine preparation and requested stages; retain user review boundaries.

1. Run `node scripts/dots-workspace.mjs doctor --provider grok --workspace <absolute-workspace>` in the returned runtime.
   For a bundle also supply `--manifest-sha256 <independently-reviewed-hash>`. Default doctor is offline.
2. Run `dots-workspace.mjs resume` before any install or generation. Preserve all pending/unknown jobs,
   selected versions, raw files and input/output hashes. Do not update an active project's kit or vendor.
3. Only a new workspace that needs installation uses `bootstrap --install`. Missing system tools belong
   to the environment preparer. A bootstrap success or credential status never establishes image capability.
4. Honor the Codex output-contract blocker, including selected Codex redraws inside video-set. Explicit
   Grok routes retain their own engine checks; video-resume retrieves an existing request without a new POST.
   Ambiguous image calls must name their provider; never switch it to make a check pass. No protected session reads,
   CODEX_HOME relocation, auth copying, API-key fallback or provider/model substitution. Use only a verified
   official host generation/file route within the request, or report the specific missing capability.
5. Verify provider access, original file receipt/decode and parent display separately under DELIVERY.md.
   No test generation merely to make readiness green. ODDBOUT registration uses the connected account.
6. Run an authorized prepared job once with exact cwd/args/env via official exec, initially 30000 ms.
   Wait on the returned session/cell. Lost responses require original-job inspection, never blind resubmission.

Publish/Republish affects new tasks. Continue existing characters in their original task; a new task does
not inherit another task's files or login. Do not put personal auth or service keys into the shared setup.

## Private Grok account storage in a running user VM

Check the authentication storage directory before asking the user to approve device login. A successful
`grok --version` does not prove the CLI can save a login. Dots may provide a read-only default home;
a real trial returned `Failed to save credentials: Read-only file system` after browser approval.
The startup inspection now checks directory metadata/access without reading or modifying credentials,
and returns `prepare-private-grok-auth-storage` instead of another login request when storage is blocked
or unknown. Permission availability alone is not proof of successful credential persistence.

Grok officially supports an explicit `GROK_HOME` ([settings](https://docs.x.ai/build/settings)). If the
host permits a writable private user workspace, an explicitly approved, newly initialized account
store may use `<user-workspace>/.oddbout-private/grok-account` with directory mode 0700. This path is a
kit convention, not an xAI-required path. Do not relocate HOME/CODEX_HOME, copy an old credential,
follow a symlink, or change a read-only mount. Preserve unknown existing files and resolve them first.
A non-secret, user-local `.oddbout-private/account-env.sh` may hold only the GROK_HOME selector; source
it consistently for the official CLI, engine access checks and prepared creation jobs. Never put token
values in that selector, shell commands, evidence, Git, a Page, or a reusable environment image.

Before actual login, a newly created empty store can be checked with a non-secret create/rename/delete
probe; remove only that probe. The official CLI owns login creation/refresh. After user approval,
check the original process result, credential file presence/mode and the pinned engine's sanitized
status, not token contents. Do not start a new device flow after a failed or lost result without first
inspecting that attempt. Do not certify image/video entitlement from login alone.

The account store belongs only to the running user's task. Environment preparation contains no login
or per-user account directory; another task does not inherit this task's credentials. A custom
GROK_HOME must also pass the clean-image guard before any preparation is published.
