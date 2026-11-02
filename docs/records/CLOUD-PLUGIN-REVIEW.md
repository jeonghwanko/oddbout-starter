# ODDBOUT cloud plugin review

Status verified on 2026-10-24 at 11:54 UTC: **1.0.3 · In review**.
Publication is still **Not published**; submission is not approval.
This remote MCP submission is independent of the local MCP eligibility case.

## Final draft and public addresses

- Portal: https://platform.openai.com/plugins/manage/plugin_asdk_app_6adc695de1bc8191a604b42bbaa178af
- Current version: `appsub_c4f81422604c81919f02f879be61a50f`, package `oddbout-dots` 1.0.3.
- Previous version: `appsub_6adc695de1ec8191a9e9734d647cef44`, package 1.0.2;
  its pending review was withdrawn to submit the deletion-enabled revision.
- Source: `plugins/oddbout-cloud/`. Publisher: verified individual **정환 고**.
- Public MCP: https://mcp.oddbout.com/mcp
- Google/email consent UI: https://oddbout.com/connect.html
- EN/KR product, support, privacy and terms: https://oddbout.com/cloud-plugin/
- Domain proof: https://mcp.oddbout.com/.well-known/openai-apps-challenge

The portal locks an uploaded package's MCP URL. Earlier Supabase and Render URL
drafts remain unsubmitted; the own-domain draft above is the final target.
Do not submit the earlier drafts or overwrite their hostname's challenge token.

Spaceship DNS has `mcp CNAME ai-fighter-validator.onrender.com` (TTL 30 minutes).
Render verified the custom domain and issued its TLS certificate. Existing root
GitHub Pages A records and the www CNAME are unchanged. The original Render URL
remains a compatibility endpoint; public plugin metadata uses the branded URL.

## Authentication and hosting

The gateway forwards only the fixed Supabase MCP endpoint with bounded request
bodies and protocol headers. It receives no administrative database key and
forwards no cookies, wake headers, arbitrary destinations or redirects. Resource
metadata selects one of two fixed public origins from the incoming hostname.
Supabase still checks signatures, issuer, dedicated MCP role/marker, owner,
OAuth client, live session, consent and revocation. The original Supabase URL,
legacy Render URL and branded URL are explicitly accepted audiences of one
service; ordinary database/storage access remains unavailable to OAuth tokens.

MCP Edge Function version 8, registration API version 30, the branded-audience
migration and the owner-confirmed deletion migration are deployed.
Render deployment `dep-dbe6lqjncjis73d6mmkg` serves gateway commit
`4d745e42df6663f7e7384e6dac36d610ae029358`. Live checks verified the exact commit,
branded resource metadata, hostname-specific challenge, eleven tools and a branded
HTTP 401 authentication challenge. The portal verified the domain and completed
OAuth with the dedicated reviewer. Its MCP scan reported no findings.
The free Render instance can
take 50 seconds or more to start after inactivity. No paid plan was selected.

A dedicated ordinary reviewer account was created with explicit user approval.
Password login and the final own-domain draft's OAuth consent completed in the
real browser. Credentials are stored outside the repository in a restricted
local file and may be sent only to OpenAI's private Review details. Never put
reviewer passwords in source, ZIPs, screenshots, logs or public walkthroughs.

## Connection screen

Uses the real ODDBOUT logo and self-hosted Pretendard fonts. EN/KR covers
headings, actions, consent, errors, accessibility labels and support links.
Language changes preserve the authorization ID. URL preference, session
preference and browser language determine the initial locale. Narrow app panels
use one column. Content hashes version CSS/JS. The primary Google button and
expandable email login both use normal Supabase authentication; no bypass exists.

Desktop and 390px layouts were inspected. The real reviewer email login and
consent screen were verified. Existing game-site updates were fast-forwarded
and preserved before publishing the connection and policy pages.

## Initial 1.0.2 evidence and outcome

- Five live non-publishing MCP cases passed on the dedicated review account:
  profile, registration readiness, overview contract, empty owned fighter list,
  and accurate not-found handling for a nonexistent submission.
- The checks used normal password authentication, a separate OAuth client,
  PKCE S256 and consent. Its temporary grant was revoked after testing; the
  portal's ChatGPT connection was preserved.
- Twelve targeted gateway, MCP/authentication and worker tests passed.
- Sanitized responses: https://oddbout.com/cloud-plugin/review-20261024/evidence.json
- Walkthrough: https://oddbout.com/cloud-plugin/review-20261024/walkthrough.mp4
  (87-second video assembled from actual authentication and response screenshots;
  not a recording of a ChatGPT conversation). Live bytes matched local files.
- Final ZIP SHA-256: `1b5f1c713a60670434f8d773a019041e66865647faca0113821aaad95292be82`.
- Dedicated credentials and sign-in instructions were saved only in the portal's
  private reviewer fields. The package includes five positive and three negative
  scenarios. Negative server boundary checks do not certify model behavior.
- The user explicitly confirmed all six legal/policy attestations at the final
  submission step. The Submit action completed, and the final plugin details
  show **MCP configuration Configured**, **1.0.2 · In review** and
  **Publication Not published**. The portal list labels its associated initial
  MCP app version 1.0.0; the submitted package version is 1.0.2.
- A non-blocking category finding remained: the scanner could not confirm
  Productivity. There were no blocking findings at submission.

Do not submit the earlier hostname drafts or claim that ordinary users can
install this listing from the directory before approval and publication.

At initial submission no fighter was generated or published. The five recorded
account checks and initial video did not exercise successful registration; that
scope was disclosed in the private review instructions and video.

## Additional native Dots verification

After submission, the user explicitly authorized a real registration test on the
dedicated reviewer. Dots transferred an existing approved package (11 WebP files,
5,537,184 bytes), with test-only profile metadata, using native MCP file inputs.
Submission `131d7814-2c24-4a82-9707-1ebff7978f67` became registered fighter
`1c6160e0-a138-4e25-8b95-db023b8cc408`, named `ODDBOUT Review Test`.
The public MCP gateway independently returned the same immutable manifest hash
and `runtimeApproved: true`; seven read-only checks passed and their temporary
OAuth grant was revoked. The review account now contains that one test fighter.
No new artwork was generated. See [the registration record](../CLOUD-MCP.md#실제-파일-등록-검증--2026-10-24).

MCP function v7 clarifies intended-account checks, absolute host file inputs,
original-byte recovery from Library/Page files, and the distinction between VM
network policy and native connector access. Authentication and publication
validation are unchanged. The deletion-enabled 1.0.3 submission supersedes the
initial 1.0.2 review as described below.

## Deletion-enabled 1.0.3 review

The existing public plugin identity and branded MCP URL are preserved. The
previous review was cancelled, the 1.0.3 ZIP uploaded to the same plugin, and the
public endpoint rescanned. The portal now lists both `prepare_fighter_deletion`
and `delete_fighter` among eleven tools. Domain verification and the existing
reviewer OAuth connection were retained. The MCP scan reported no findings.

- Public and Korean listing text, capabilities, prompts and release notes cover
  verified ownership, the exact account/name/scope, live session/client binding,
  ten-minute confirmation expiry, snapshot recheck and idempotent retry.
- The deletion scope is explicit: remove active/public listings and new-match
  access, release the account slot, retain private originals and historical
  records, and allow already-issued asset links to expire within 600 seconds.
- All five positive and three negative review cases were imported from the ZIP.
  Preparation is a separate no-execution case; explicit deletion of the
  disposable reviewer fixture runs last. Already-deleted fixtures must be
  reported honestly and never recreated implicitly.
- The private reviewer instructions were updated for the now-populated test
  account and the deletion sequence. Existing credentials remained only in the
  portal's private reviewer fields; no credentials were added to the ZIP.
- Eleven fresh public-gateway checks passed through normal password login,
  DCR, PKCE and consent. Invalid tokens, wrong names and foreign ownership were
  rejected. The review fixture remained registered and the test grant was revoked.
- The public native deletion evidence is anonymized and explicitly describes a
  separate authorized owner case; it does not claim the reviewer fixture was
  deleted during these boundary checks.
- Evidence: https://oddbout.com/cloud-plugin/review-20261024/deletion-checks.json
  and https://oddbout.com/cloud-plugin/review-20261024/native-deletion-evidence.json.
- Video: https://oddbout.com/cloud-plugin/review-20261024/walkthrough-with-deletion.mp4
  (140.917 seconds, 1,500,577 bytes). It combines actual authentication and
  service-response screenshots, not a recording of a ChatGPT conversation.
- The five changed/new public evidence files returned HTTP 200 and matched the
  final local bytes. Publication-preservation and ZIP integrity checks passed.
- Source release: `cc45cff3a0288b6169539ce5127dc37ccff67b1b`; website deployment
  commit `4ceee92`, buildId `84f9e01c-c8fb-49b5-bf31-f1809cd7fc1f`.
- ZIP SHA-256: `beb1c6da37a137c62069a933b109e1d411aadf1af70e80a9d6776b63f52f5ded`.
- The only metadata finding was the existing non-blocking category warning
  that the scanner could not confirm Productivity. There were no blocking findings.
- The user confirmed all six legal/policy attestations for 1.0.3 at the final
  action. Submit was clicked on 2026-10-24 at approximately 11:53 UTC.
  The portal returned to the plugin list with In review; reopening the same
  plugin confirmed **1.0.3 · In review**, **MCP configuration Configured** and
  **Publication Not published**. The list still labels the associated initial
  MCP app version 1.0.0; the submitted package details show 1.0.3.
  CI was not run. Await the external decision; this is not approval/publication.

## 2026-10-25 supplement without replacing the pending review

The user requested retention disclosures, actual file-registration reproduction
and corrected tool safety annotations while preserving the current review.
The 1.0.3 ZIP and submission `appsub_c4f81422604c81919f02f879be61a50f`
are unchanged. Do not cancel or resubmit solely to refresh the tool snapshot.

- Live database inspection confirmed no scheduled erasure of original packages,
  account/ownership records, registration results, match history or deletion
  receipts. The EN/KR privacy notice now says these have no fixed retention end.
  Upload closure (24h), deletion-confirmation validity (10m) and signed-link
  expiry (at most 10m) do not erase underlying data. The active hourly job removes
  analytics context/outbox records older than 29 days; this does not describe
  provider-side retention. Ownership-verified erasure requests go to support and
  are complete only after actual processing, not merely disconnecting/deleting.
- MCP function v9 separates private confirmation writes from open-world actions.
  `prepare_fighter_deletion` is write/non-destructive/closed-world; file imports
  and public roster changes retain `openWorldHint: true`, and final registration
  and deletion retain `destructiveHint: true`. Auth and ownership gates are unchanged.
  The live 14-file bundle was preserved except this annotation change; public
  `https://mcp.oddbout.com/mcp` returned the corrected eleven-tool list.
- A new actual native host-file run used the dedicated normal reviewer. The local
  Codex connector uploaded fighter.json and 11 unchanged approved WebP files
  (5,537,184 bytes) to the cloud MCP. Submission
  `31995d93-a3e9-4b6c-aecf-54344f013b6e` became active registered fighter
  `9a363794-a8d6-47ff-bb3b-c3d7ea1029ac` with `runtimeApproved: true`.
  `get_registered_fighter` and `list_my_fighters` confirmed ownership and the
  same immutable manifest hash. The older review fixture is also preserved.
- Manifest SHA-256: `47a2ba95bf3c99a4376fccb94697129a29203b510dedfd01bd4591001da1a2ef`.
  Sample ZIP SHA-256: `f831f87409fd5e1521260ca108c2ce4683a23bc938fe80d78bd029faaf7db362`.
  Reusing the recorded idempotency key resumes that result; a fresh test requires
  explicit intent, an available slot, changed test metadata and a fresh key.
- Supplemental EN/KR instructions, sample ZIP, sanitized native responses and
  62-second EN/KR-captioned video live under `/cloud-plugin/review-20261025/`.
  The existing submitted evidence landing page links to this supplement. The
  video condenses nine screenshots captured during real native execution; it is
  explicitly not a Dots conversation or fresh cloud-VM recording. Earlier native
  Dots VM and independent public-gateway checks retain their original scope.
- The operator Google connection was restored and verified through get_profile;
  the temporary reviewer connection was removed. No credential appears in the
  sample, public evidence, video or source. No fixture was deleted by this run.
- Eleven targeted tests passed, including clean-publication preservation of both
  evidence folders and both retention disclosures. CI was not run.

Live metadata fixes do not rewrite the portal's frozen pending tool scan. If
reviewers require a new snapshot, prepare it only when the user-authorized
feedback workflow requires resubmission; keep the current submission meanwhile.
