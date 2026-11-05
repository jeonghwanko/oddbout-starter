# ODDBOUT 1.0.4 preparation — 2026-11-06

Status: **draft package; not uploaded, submitted or ready for submission**. The user requires separate approval for portal upload, submission, cancellation, publication and merging the PR. MCP server code is unchanged. Preserve the old 1.0.1 and 1.0.0 drafts.

Package: `oddbout-dots`; public plugin: `plugin_asdk_app_6adc695de1bc8191a604b42bbaa178af`; existing endpoint: `https://mcp.oddbout.com/mcp`.

## 1. Portal observation and update behavior

The current portal contradicts the earlier unpublished-state note: 1.0.3 is **Published / 디렉터리에 공개됨**. The preceding authorized operation in this conversation had already returned “Plugin published!”. This preparation did not publish or cancel anything.

Opening the existing release showed MCP **Configured**, the correct endpoint, **Domain verified**, and **No authentication / Authorized**. All 42 tools and server instructions showed **Published**. The MCP tab nevertheless showed **Needs attention / Complete MCP setup / Account connected. No scan has finished since this connection.** Rescan was disabled. No reconnect or rescan was performed in this preparation.

The earlier `Unavailable` fields were no longer present. The UI did not explain their historical cause; neither “normal after approval” nor “server unreachable” is established. Likewise, the contradictory setup warning is unresolved. The live unauthenticated `get_profile` probe returns 401, so the portal's “No authentication” label is not evidence that private tools allow anonymous account access. Reconcile the preserved app binding and authentication display before submitting the new draft.

Official [submission guidance](https://developers.openai.com/plugins/deploy/submission#update-your-published-plugin) says a new ZIP creates a package version with its own checks/review; publishing an approved update replaces the previous package. Preparing/uploading a draft is not publication or cancellation of the current release. Hosted tools are scanned separately: new tools await approval and held updates preserve their prior live definitions. Current 42-tool Published status is a portal observation, not an inference from the old twelve-tool review.

For published-app reuse the new package retains one `oddbout` MCP entry and its exact URL, and omits authentication overrides rather than attempting to replace saved OAuth credentials. This follows the preparation skill's published-app update procedure. After an authorized upload, verify that the draft reuses `asdk_app_6adc695de1bc8191a604b42bbaa178af`; do not create a duplicate app if the binding is unresolved. No app reference or credentials are embedded in the author-supplied ZIP.

## 2. Live inventory and listing

Actual public `tools/list`: **42 tools**, protocol `2026-07-28`. All tools have boolean read-only, destructive and open-world annotations. The downloaded JSON has SHA-256 `225ccb83611ea9b32dec1454b35e50ec2d21708b2383b71b74c321b01e392849`.

The listing now uses **Entertainment**, English subtitle **Create and play with fighters**, and matching Korean copy. It covers generation, picture/package/profile-set uploads, unranked practice, cups/career, grouped reads, public writing and confirmed owner deletion. It does not sell generation tokens or process payments.

Verified source facts:

- Official generation deducts actual used account tokens even for failed/cancelled work; spent tokens are not refunded. `any` may be fulfilled by the official worker and charged. Own-PC/community-host generation does not deduct the official-generation allowance. No request-level maximum-token input exists. Sources: `mcp/cloud/hosted-tools.mjs`, `api/generations.mjs`, `docs/CLOUD-MCP.md` (hosted generation).
- `any` or another person's host requires explicit consent to send description/pictures to that PC. Rights confirmation is required for supplied pictures. `host=mine` is the owner's own PC, not an external-host consent bypass.
- Canon, notes, relations, world posts and public nicknames are public; writing can carry the OAuth client's registered name. World creation is public immediately. Sources: `mcp/cloud/workshop-tools.mjs`, `api/workshop.mjs`, `docs/CLOUD-MCP.md` (workshop).
- Deletion requires the live owner/session/client, exact name and ten-minute confirmation; removes active listings/new matches and releases the slot. Private originals and history remain. Signed-link expiry (at most 600 seconds) is not data erasure. Sources: `api/fighter-deletion.mjs`, deletion migrations, `docs/CLOUD-MCP.md`.

## 3. Public page audit

All four English listing URLs returned HTTP 200 and relevant ODDBOUT content. Their displayed effective date was 2026-11-02. No policy page was changed or published by this preparation.

| Page | Already covered | Missing or stale before submission |
| --- | --- | --- |
| [Overview](https://oddbout.com/cloud-plugin/) | Account connection, registration, confirmed deletion | Still says directory approval is pending. Scope centers on registration and the user's separate generator; add official hosted generation, token use, reference uploads, profile sets, grouped reads and public writing. |
| [Privacy](https://oddbout.com/cloud-plugin/privacy.html) | Game/community arguments, public writing/nickname, client attribution, consent to external generation hosts, retained packages/history, erasure contact | Describe generation requests/jobs, references and generated outputs, usage accounting and their retention separately. Explain upload-ticket expiry vs retained pictures and currently absent unused-picture cleanup. Distinguish generation-PC cleanup from server retention and do not promise verified deletion on independent hosts. Identify current Cloudflare gateway processing alongside Supabase/Render as applicable. Clarify generation/review providers based on actual selected route and enabled configuration; do not assert optional Decisions review is enabled. |
| [Terms](https://oddbout.com/cloud-plugin/terms.html) | Content rights, public writing, moderation, availability limits, no payments, confirmed deletion | Add official hosted-generation allowance and actual token deductions including failure/cancellation, host selection/consent, review boundaries and no automatic retry on unknown outcomes. Clarify production status vs entry and front/motion checks. |
| [Support](https://oddbout.com/cloud-plugin/support.html) | Working contact address, queued registration recovery, privacy/deletion and security reports | Add job-ID/original-key recovery, token balance/quota, queue/host availability, expiring preview refresh, picture-upload status/limits and public-content reports. Explicitly distinguish cancelling a job from deleting its stored data. Never request passwords, tokens or signed links. |

The existing public-writing and external-host clauses should be retained, not reported as wholly absent. Provider log retention currently says Supabase/Render logs are removed within 30 days; verify actual current provider settings before extending that claim to Cloudflare. Hosting documentation describes generation-host cleanup, but this preparation did not audit a live host's filesystem or retention enforcement.

The same factual corrections must be reconciled in the Korean pages. Neither a source draft nor a successful HTTP response proves the corrected policies are published. Legal commitments and provider retention periods must not be invented from implementation assumptions.

## 4. Five positive / three negative cases and execution

The exact prompts, tools and observable expectations are in `plugins/oddbout-cloud/plugin.json`. Run with the dedicated ordinary reviewer, not the operator account. Negative conversation scenarios are distinct from server validation probes.

| Case | Coverage | Current reviewer execution |
| --- | --- | --- |
| P1 | Identity, registration readiness, existing hosted jobs/balance | Blocked: reviewer login unavailable |
| P2 | One text-only official-host request; stop at two front candidates | User approved this one request on 2026-11-06. Not dispatched: reviewer login unavailable. No tokens spent by this preparation. |
| P3 | Existing owned registration and deletion preparation only | Blocked: reviewer login and current fixture verification unavailable |
| P4 | Grouped roster/rankings reads and seeded unranked spar | Public reads passed separately; reviewer-authenticated spar not run |
| P5 | Explicit sample world/post publication and readback | Blocked: reviewer login unavailable; no public test writing created |
| N1 | No other-owner identity selection/deletion | Not run as a reviewer conversation; anonymous private-call denial verified separately |
| N2 | No external-host sharing without consent / hidden token accounting | Not run as a reviewer conversation; live schemas and source inspected |
| N3 | No fabricated registration files or promise of complete erasure | Not run as a reviewer conversation; live schemas and source inspected |

Normal password sign-in + dedicated OAuth client + PKCE + consent/revocation already exists in `scripts/run-cloud-review-checks.mjs`. Its old assertions assume particular fixtures and do not implement all new cases; adapt its safe authentication pattern when credentials are available. Do not use admin/service-role impersonation to claim reviewer success. Do not reset the review account's password without authorization, since that would invalidate existing private review instructions.

The current environment has no `ODDBOUT_REVIEW_CREDENTIAL_FILE`. Targeted checks of the local starter/game workspaces and game environment-file variable names did not locate reviewer credentials. The published portal's Metadata & Skills view did not expose Review details. Historical records establish that credentials were saved in private reviewer fields, not that they can be recovered here. Passwords/tokens must stay outside repository, ZIP and conversation.

Independent live public probes (not reviewer runs):

- `get_fighter_spec(section=overview)`: 200, `ok=true`.
- `browse_oddbout(view=fighters)`: 200, `ok=true`, 26 built-ins and 10 registered entries.
- `browse_oddbout(view=rankings)`: 200, `ok=true`, 20 entries.
- `browse_oddbout(view=world)`: 200, `ok=true`, two worlds/eight covers.
- `browse_oddbout(view=hosts)`: 200, `ok=true`, one host.
- Anonymous `get_profile`: 401, `invalid_token`.
- `browse_oddbout(view=record)` without `fighterId`: 200 with `ok=false`, `invalid-arguments`, recovery guidance.

Raw public probe evidence remains under ignored `output/review-20261106/`; SHA-256 `38379aa993a4f21b940da96ae21472f339fb081bd1ed2107dad5cb4caf52914e`. No private account fixture or generated result was invented.

The old 2026-10-24 registration/deletion video does not demonstrate the new scope. The manifest explicitly clears `demo_recording_url` instead of carrying that video as a new walkthrough. A new actual ChatGPT walkthrough remains required: identity/existing jobs → approved generation candidates → owned inspection/deletion scope → roster/practice → public sample post → one negative prompt. Use a recording of real interactions, hide credentials, verify playback, host it at a reviewer-accessible URL, then rebuild the ZIP. Public API probes or a screenshot montage are not a ChatGPT conversation recording.

## 5. Icon and package provenance

The user rejected the first generated boxing-glove icon. A second generated O exploration was also excluded after locating the existing brand assets. The package uses the established neon-yellow O on dark navy from `crashbang-heroes/kaito_web/public/favicon.svg`, rendered to a 1024 × 1024 PNG with Sharp. It is not newly generated artwork. The original source SVG is included for reproducibility.

- SVG SHA-256: `c168877cd832ed298ff94cf85a8b35b407c8e8ef13504fe2238672c2aaf00ebe`.
- PNG SHA-256: `04a3c0f37debb505698d61bf57870899c7e971f2c17a2a788d132927a91d326f`; 41,759 bytes.

ZIP build: `python scripts/zip-plugin.py plugins/oddbout-cloud output/review-20261106/oddbout-dots-1.0.4.zip`. This packages only the explicit plugin directory, in stable order. The ZIP hash is recorded in the adjacent local checksum file and the PR description after building. No MCP source, credentials, local evidence, provider account files or unapproved generated icon variants are packaged.

Built candidate: **33,692 bytes**, SHA-256 `06e3ca98c92e0ecf45af3d1194a7484c938db529d574e28006bf85394711e40f`. Inventory: `plugin.json`, `mcp.json`, `assets/icon.svg`, `assets/icon.png`. Local structural checks passed for identity/version, listing limits (subtitle 29 / description 1,878 characters), exactly five positive/three negative cases, expected tool names against the actual live list, single unchanged endpoint, absence of app/credential fields, all 42 annotation sets and PNG format/dimensions/size. `git diff --check` passed. These are local package checks, not portal validation or reviewer-conversation passes.

Before requesting upload/submission approval: resolve reviewer access and execute the eight conversations (record real Passed/Failed/Blocked outcomes), finish/verify the new demo, correct and publish policy pages within separately authorized scope, then rebuild/re-hash. Merge, portal upload and submission remain unapproved.
