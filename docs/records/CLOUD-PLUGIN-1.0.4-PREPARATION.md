# ODDBOUT 1.0.4 preparation — 2026-11-06

Status: **draft package; not uploaded, submitted or ready for submission**. The user requires separate approval for portal upload, submission, cancellation, publication and merging the PR. MCP server code is unchanged. Preserve the old 1.0.1 and 1.0.0 drafts.

Package: `oddbout-dots`; public plugin: `plugin_asdk_app_6adc695de1bc8191a604b42bbaa178af`; existing endpoint: `https://mcp.oddbout.com/mcp`.

## Blocker follow-up (2026-11-06 KST)

**Public pages — published and verified:** [Website source PR #352](https://github.com/jeonghwanko/oddbout-starter/pull/352) updates the English and Korean overview, privacy, terms and support pages. It covers hosted requests and token accounting, reference uploads, generation providers and host choice, public writing and entry, retention, private original PNGs and delivery to a chosen VM. Both languages distinguish a stored-source receipt or expiring grant from actual delivery or erasure. Support explains recovery of an existing job, quota and expiring previews, picture tickets and content reports. The Claude guide and historical reviewer evidence were preserved.

The [Pages deployment](https://github.com/jeonghwanko/oddbout-starter/actions/runs/42160303558) succeeded at publishing commit `8ca55060` (source PR head `556cb19d`, game `2cadd63b`, build `9e7fc23f-4ffc-4bee-bc9b-9ffab519c717`). Compared with the previous Pages commit, only the eight documents and deployment marker changed. All eight canonical URLs returned 200 and matched their built bytes, both with and without a cache-busting query. The publication/hosting tests (12), type check and website PR CI passed. No main merge was performed. Merge #352 when authorized to retain the disclosures in future site builds.

**MCP discovery resolved on November 6.** The owner pressed Rescan in the portal for the published 1.0.3 package. During the scan the four grouped tools appeared with pending publication. At completion the portal showed exactly **24 tools, all Published**, and “No findings in the latest MCP scan.” The published rows include `get_my_fighters`, `update_fighter`, `write_story` and `manage_career`. The `get_my_fighters` detail panel displayed the grouped definition with the default list view. This satisfies the portal verification prerequisite for the proposed 19-tool change. The observed production and portal inventories are both 24. The support email was not sent.

The old 42-tool definitions had a Last checked time of 03:14:40 KST. The current production MCP deployment was updated at 04:19:00 KST. An earlier disabled-button observation described the state at that time. It did not establish an ongoing scanning failure. The earlier observations below are historical.

**Reviewer access:** The user requested recovery instructions only. A local operator guide and a masked-input PowerShell helper are prepared in the ignored `output/review-20261106-blockers/` directory. The helper is for normal password sign-in after the existing password is recovered or the operator separately authorizes rotation; it verifies the dedicated email/ID before writing a new Windows-user-only credential file outside the repository. It was syntax checked, not run. No password was changed, no recovery email was sent, and no grant was used to impersonate the reviewer. All eight reviewer conversations remain unrun; no generation tokens were spent. If the password changes, the old private review password is invalid and must be updated through the private portal fields when an upload is authorized.

## PR #350 review corrections (2026-11-06 KST)

The MCP manifest is restored byte-for-byte from 1.0.3 (`0130b0fc`): `mixed`, DCR, scopes `openid email profile`, and `oidcEnabled: true`. No official OpenAI documentation supporting removal of this block was found; the official sources and the corrected rationale are recorded in section 1.

English/Korean listing copy and capabilities now include private creator-original storage, delivery preparation for the selected workspace (VM), file/source receipt checks, and workspace packaging preparation. The privacy-page correction list below covers the same data flow. These are listing changes, not a claim that policy pages or the MCP server changed.

P1 now says `get_hosted_fighter with view=job (the default) and no jobId or idempotencyKey, listing recent requests`. This matches the saved live 24-tool definition, which returns the latest five requests when both identifiers are absent.

Current candidate: `output/review-20261106-pr350-revision/oddbout-dots-1.0.4.zip`, **34,338 bytes**, SHA-256 `c4a4f71809375ba93de4627b8a3a37e32e7d6db54938dc036b547eb3aef3c0dd`. The adjacent `SHA256SUMS.txt` records it. Built with `python scripts/zip-plugin.py plugins/oddbout-cloud output/review-20261106-pr350-revision/oddbout-dots-1.0.4.zip`. Archive integrity and all four entries were checked against the source files: `plugin.json`, `mcp.json`, `assets/icon.svg`, `assets/icon.png`. Local checks passed for byte-identical 1.0.3 authentication, the unchanged endpoint, listing limits (2,305-character long description, 12 capabilities), five positive/three negative cases, tool names against the saved 24-tool inventory, icon dimensions/size and absence of credential/app-binding fields. `git diff --check` passed. Reviewer conversations and portal validation remain unverified; no new generation, merge, upload or submission was performed.

## Earlier observations: stage 2, 24 tools (2026-11-06 KST)

This follow-up supersedes the **initial 42-tool inventory/candidate** recorded in the numbered sections below. Main now contains PR #351 (`928b6d0e`, merged as `c73355c7`); the production endpoint actually returns **24 tools**. The live tools/list snapshot SHA-256 is `5c389cc7f682290f997492d1d7697799c13ebc27121b62713b464e23326476fb`.

The new grouped names are `get_my_fighters`, `update_fighter`, `write_story`, `manage_career`; existing generation/registration/entry names now have selectors. The five compatibility reads remain listed: `list_my_fighters`, `get_registered_fighter`, `get_fighter_submission`, `check_creation_readiness`, `open_creator_homepage`. The intended later inventory is 19, **only after the portal confirms the replacement definition is live**. No server code or KEEP_LISTED entry was changed by this preparation.

The user requested Rescan and Live-definition verification. The published 1.0.3 portal instead showed **Rescan disabled**, 42 previous Published definitions, and no `get_my_fighters` row. Its downloadable diagnostics JSON likewise contained 42 tools, without any of the four new grouped names. The connection drawer confirmed the correct URL and **Mixed Auth / DCR / openid email profile**, despite the overview's “No authentication” label.

The existing scanner account was reconnected through the normal Google/OAuth flow (not the dedicated reviewer), preserving the configured endpoint and auth scope. After callback and page reload, **Rescan remained disabled**, the same setup warning remained, and the old 42 definitions were still shown. Consequently no rescan could be dispatched and **new-tool Live availability is not verified**. Do not remove the five compatibility reads on this evidence. The UI exposes no reason beyond “Scan unavailable” and “Account connected. No scan has finished since this connection.” A further portal/support diagnosis is needed; do not infer a server outage, alter authentication to no-auth, or bypass the disabled UI.

The five positive/three negative cases now use the current selectors:

- P1: `get_my_fighters(view=readiness, purpose=registration)`.
- P2: `request_hosted_fighter(step=request)`; stop before `choose_look`, `revise_motion` or `submit_fighter_registration(kind=hosted)`.
- P3: `get_my_fighters` views `list`, `fighter`, `submission`, plus unchanged deletion preparation.
- P4: unchanged public browsing and authenticated unranked spar.
- P5: `write_story(write=world, action=create)` and `write_story(write=world_post)`.
- N2: prohibit unconsented external-host `request_hosted_fighter` steps `request` and `picture_ticket`.

Local package checks passed against the new 24-tool snapshot; the five public reads, anonymous-profile 401 and missing-record-argument error were repeated successfully. These remain public protocol probes, not reviewer-account scenario results. Reviewer credentials remain unavailable: the user-specified `.secret` directory also contained no matching reviewer credential reference in its text files; `ai-fighter-open-registration-verification.json` contains service verification records, not the review password. No approved generation test has been dispatched.

Superseded stage-2 candidate: `output/review-20261106-stage2/oddbout-dots-1.0.4.zip`, **33,760 bytes**, SHA-256 `af5c226358f74db1e09718f7c75d138e3395985dd66f4feb81a4221656ca53b1`. This and the earlier candidate are retained as historical output and must not be uploaded. Screenshot evidence: `output/review-20261106-stage2/portal-rescan-disabled.png` (local, ignored). The PR remains draft; merge/upload/submission/publication are not authorized or performed.

## 1. Portal observation and update behavior

The current portal contradicts the earlier unpublished-state note: 1.0.3 is **Published / 디렉터리에 공개됨**. The preceding authorized operation in this conversation had already returned “Plugin published!”. This preparation did not publish or cancel anything.

Opening the existing release showed MCP **Configured**, the correct endpoint, **Domain verified**, and **No authentication / Authorized**. All 42 tools and server instructions showed **Published**. The MCP tab nevertheless showed **Needs attention / Complete MCP setup / Account connected. No scan has finished since this connection.** Rescan was disabled. No reconnect or rescan was performed in this preparation.

The earlier `Unavailable` fields were no longer present. The UI did not explain their historical cause; neither “normal after approval” nor “server unreachable” is established. Likewise, the contradictory setup warning is unresolved. The live unauthenticated `get_profile` probe returns 401, so the portal's “No authentication” label is not evidence that private tools allow anonymous account access. Reconcile the preserved app binding and authentication display before submitting the new draft.

Official [submission guidance](https://developers.openai.com/plugins/deploy/submission#update-your-published-plugin) says a new ZIP creates a package version with its own checks/review; publishing an approved update replaces the previous package. Preparing/uploading a draft is not publication or cancellation of the current release. Hosted tools are scanned separately: new tools await approval and held updates preserve their prior live definitions. Current 42-tool Published status is a portal observation, not an inference from the old twelve-tool review.

The package retains one `oddbout` MCP entry, its exact URL and the complete 1.0.3 authentication block. OpenAI's [MCP authentication reference](https://developers.openai.com/plugins/build/plugins#configure-mcp-authentication) places authentication in the server's `extensions["com.openai"].auth`, with `mixed` for public and OAuth-protected access. The [submission authentication guidance](https://developers.openai.com/plugins/deploy/submission#configure-authentication-for-submission) says the portal reads these settings from `mcp.json` and warns that saved client registration may constrain changes. Neither those sections nor the published-plugin update guidance establishes that this block should be removed. The earlier omission followed the preparation skill's migration advice, not a verified official rule; it is reverted in response to PR review. After an authorized upload, inspect the saved Mixed/DCR/scopes/OIDC settings and verify reuse of `asdk_app_6adc695de1bc8191a604b42bbaa178af`. No credentials or author-supplied app reference are embedded in the ZIP.

## 2. Live inventory and listing

Actual public `tools/list`: **42 tools**, protocol `2026-07-28`. All tools have boolean read-only, destructive and open-world annotations. The downloaded JSON has SHA-256 `225ccb83611ea9b32dec1454b35e50ec2d21708b2383b71b74c321b01e392849`.

The listing now uses **Entertainment**, English subtitle **Create and play with fighters**, and matching Korean copy. It covers generation, picture/package/profile-set uploads, private creator originals and workspace (VM) delivery preparation, file/source receipt checks, workspace packaging preparation, unranked practice, cups/career, grouped reads, public writing and confirmed owner deletion. It does not sell generation tokens or process payments.

Verified source facts:

- `upload_fighter_asset(kind=creator_source)` stores an authorized original PNG in account-owned private storage after measured size/hash checks. `prepare_fighter_registration(kind=source_download)` creates a five-minute download grant encrypted to the selected workspace's VM request; the workspace must receive the envelope and download the file. `check_creator_file(view=input)` checks bytes/hash in server memory without persisting the input; `view=source` reads the stored-source receipt. Neither receipt proves VM delivery or display. Sources: the saved live 24-tool definition, `mcp/creator-sources.mjs`, `mcp/file-input-probe.mjs`, `api/creator-source-crypto.mjs`, `scripts/dots-source.mjs`, and `supabase/migrations/20261027150303_creator_private_sources.sql`.
- `prepare_fighter_packaging` returns inspection/packaging invocations for existing workspace files. The cloud connector cannot read the VM path or execute the package; the workspace must run the commands and check their results before registration. Source: `mcp/cloud/packaging-tools.mjs`.
- Official generation deducts actual used account tokens even for failed/cancelled work; spent tokens are not refunded. `any` may be fulfilled by the official worker and charged. Own-PC/community-host generation does not deduct the official-generation allowance. No request-level maximum-token input exists. Sources: `mcp/cloud/hosted-tools.mjs`, `api/generations.mjs`, `docs/CLOUD-MCP.md` (hosted generation).
- `any` or another person's host requires explicit consent to send description/pictures to that PC. Rights confirmation is required for supplied pictures. `host=mine` is the owner's own PC, not an external-host consent bypass.
- Canon, notes, relations, world posts and public nicknames are public; writing can carry the OAuth client's registered name. World creation is public immediately. Sources: `mcp/cloud/workshop-tools.mjs`, `api/workshop.mjs`, `docs/CLOUD-MCP.md` (workshop).
- Deletion requires the live owner/session/client, exact name and ten-minute confirmation; removes active listings/new matches and releases the slot. Private originals and history remain. Signed-link expiry (at most 600 seconds) is not data erasure. Sources: `api/fighter-deletion.mjs`, deletion migrations, `docs/CLOUD-MCP.md`.

## 3. Public page audit before the website update

At the initial audit all four English listing URLs returned HTTP 200 and relevant ODDBOUT content. Their displayed effective date was 2026-11-02. The gaps below describe that earlier version; the subsequent EN/KR publication is verified above.

| Page | Already covered | Missing or stale before submission |
| --- | --- | --- |
| [Overview](https://oddbout.com/cloud-plugin/) | Account connection, registration, confirmed deletion | Still says directory approval is pending. Scope centers on registration and the user's separate generator; add official hosted generation, token use, reference uploads, profile sets, grouped reads and public writing. |
| [Privacy](https://oddbout.com/cloud-plugin/privacy.html) | Game/community arguments, public writing/nickname, client attribution, consent to external generation hosts, retained packages/history, erasure contact | Add private creator-original PNG storage, its account-linked metadata, delivery to the user's chosen workspace (VM), five-minute encrypted download grants and separate server/workspace retention (details below). Describe generation requests/jobs, references and generated outputs, usage accounting and their retention separately. Explain upload-ticket expiry vs retained pictures and currently absent unused-picture cleanup. Distinguish generation-PC cleanup from server retention and do not promise verified deletion on independent hosts. Identify current Cloudflare gateway processing alongside Supabase/Render as applicable. Clarify generation/review providers based on actual selected route and enabled configuration; do not assert optional Decisions review is enabled. |
| [Terms](https://oddbout.com/cloud-plugin/terms.html) | Content rights, public writing, moderation, availability limits, no payments, confirmed deletion | Add official hosted-generation allowance and actual token deductions including failure/cancellation, host selection/consent, review boundaries and no automatic retry on unknown outcomes. Clarify production status vs entry and front/motion checks. |
| [Support](https://oddbout.com/cloud-plugin/support.html) | Working contact address, queued registration recovery, privacy/deletion and security reports | Add job-ID/original-key recovery, token balance/quota, queue/host availability, expiring preview refresh, picture-upload status/limits and public-content reports. Explicitly distinguish cancelling a job from deleting its stored data. Never request passwords, tokens or signed links. |

The creator-source privacy correction must distinguish these operations:

- **Private storage:** `upload_fighter_asset(kind=creator_source)` stores the PNG and an account-linked source record (source ID, idempotency key, byte count, SHA-256, dimensions, status, creation/verification times). This operation does not generate, register or publish a fighter.
- **Workspace (VM) delivery:** `prepare_fighter_registration(kind=source_download)` authorizes a five-minute download, returning an encrypted grant bound to the requesting VM. The user-selected workspace receives the original only when its local receiver runs. Grant expiry does not erase the server copy or an already downloaded workspace copy. Explain the receiving environment's processing, retention and erasure separately; no scheduled source cleanup was found in the inspected implementation, and no live VM retention policy was audited.
- **Checks:** `check_creator_file(view=input)` downloads the selected PNG into server memory for size/hash and PNG-header checks without persisting it; `view=source` reads private storage metadata. Neither check certifies image decoding, VM receipt or display. A source receipt or delivery grant must not be represented as completed delivery.

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

The three available native ODDBOUT connections were also checked with `get_profile`: each returned an identity, and none matched the dedicated reviewer. They were not used as substitute reviewer accounts; their private identity values are not included here.

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

Before requesting upload/submission approval: resolve reviewer access and execute the eight conversations (record real Passed/Failed/Blocked outcomes), finish/verify the new demo, then rebuild/re-hash. Recheck the published policy pages if a later website release intervenes. Merge, portal upload and submission remain unapproved.
