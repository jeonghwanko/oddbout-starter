# Independent AI Fighter hosting

Public URL: https://oddbout.com/creator.html
Homepage: https://oddbout.com/
Game URL: https://oddbout.com/fighter.html

The site root serves the homepage directly from `index.html`, without changing
the browser address. Public navigation and canonical metadata use `/`. Existing
`league.html` serves the same homepage and normalizes its address to `/` without
a reload, preserving language and anchors even with a cached former root redirect. Legacy root
creator parameters and handoff hashes still open `creator.html`; public homepage
anchors (`#main`, `#fighters`, `#match`, `#join`) and campaign tags remain on the homepage. The build
replaces the game's public `404.html` with an AI Fighter page that links home.
Validator health: https://ai-fighter-validator.onrender.com/health

GitHub Pages serves the `codex/creator-pages` branch of this public repository.
The branch contains both built pages, the original public assets and license
notices, and `.nojekyll`. GitHub performs its Pages publication; source tests
and the page build run locally. The game's runtime no longer uses FindThem.

The original source remains `kaito_web/creator.html`, `fighter.html` and `src/`
in `jeonghwanko/crashbang-heroes`. Build that source into a new empty directory:

```sh
node scripts/build-creator-site.mjs /path/to/crashbang-heroes/kaito_web output/creator-site-new
```

The migration build used source commit `7e7fd491b56c3fcbd82ddc08c73c9a0e39a38f96`.

Public build settings are in `deploy/creator-site.json`. The builder does not
read the source checkout's environment files. It includes only the publishable
Supabase key, copies the public assets, and checks the deployed asset paths.
The standalone build replaces the legacy creator origin and rejects bundles
containing the old host. Existing source checkout files are not edited.
The builder does not read the game's `vite.config.ts`. It loads the game's own
plugin lists when the source has them: `tools/ai-fighter/site-build-plugins.mjs`
(plugins that shape the shipped bundle, such as the sound registry without its
source records) and `tools/ai-fighter/bout-share-pages.mjs`. Older sources build without them.
The game's updates plugin also emits `updates-manifest.json`, listing its static
landing/detail pages and official artwork. `scripts/site-updates.mjs` validates
that optional output; the builder adds its pages to the sitemap and publication
checks cover every listed page, image and linked stylesheet. Older revisions
without the landing page remain buildable; partial updates output fails validation.
Publish the resulting files to the existing Pages branch after local review.

The existing Supabase project `ztfxxhtmtrvxvuxlqmgz` continues to own login,
registered fighters, storage, and API operations. Its Auth redirect allowlist
includes `https://jeonghwanko.github.io/oddbout-starter/creator.html**`
so English and Korean Google login return URLs work. Existing redirect entries
remain available. No service key belongs in the website.

Dot's default one-use sign-in links now target the Pages URL. The former
`https://rupin.pryzm.gg/creator.html` remains an explicitly allowed legacy target.

## Free validation service

Render service `ai-fighter-validator` (`srv-dbbohr8m7kps73flja7g`) uses the Free
instance in Singapore, with no payment card added. It deploys the
`main` branch. Auto-deploy is off; deploy reviewed commits
manually. `render.yaml` records the configuration.

- Build: `npm ci --omit=dev`
- Start: `node worker/server.mjs`
- Health path: `/health`
- Environment: `NODE_VERSION=22.22.2`, `AI_FIGHTER_PROJECT_URL`,
  `AI_FIGHTER_WORKER_TOKEN`, `AI_FIGHTER_WAKE_TOKEN`

The worker key can claim validation jobs and finish leased jobs; it is not a
Supabase service-role key. Its hash is registered as `render-free validator`.
The current key expires **2027-01-18 UTC**. Rotate it in `af_workers` and Render's
environment before expiry. Keep values out of source, logs and website files.
A rejected key shows as `queue.status: "credential-rejected"` in `/health` and as a
`worker-credential-rejected` log line. `/health` itself stays 200 because this instance
also serves the MCP gateway; watch the `queue` field, not the HTTP status.

Every API answer of 500 or more writes one JSON line to stderr (`logFailure` in `api/http.mjs`, 2026-11-03): the
`ai-fighter` and `ai-fighter-mcp` function logs in Supabase, and the Render log for the routes the worker serves.
Search for `"stage":"api-failure"`. The line names the route family (`scope`), method, path, status and the code the
caller got, and what failed: the error's name and message, and for a database failure the Postgres code and hint
behind the route's `…-unavailable` code. It never holds the query string, headers, body or Postgres `details`, which can
carry tokens or row values. A 4xx is the caller's and writes nothing.

Startup runs the real child-process WebP validator against the existing
geometric test fixture. Health is available only after it passes. No fighter
registration or gameplay approval is created by this readiness check.

`20261021090001_ai_fighter_worker_dispatch.sql` installs a private dispatch
function and submission trigger. Supabase Vault stores
`ai_fighter_worker_url` (the Render `/wake` URL) and `ai_fighter_wake_token`.
Supabase Cron checks pending work each minute, and pg_net sends authenticated
requests only for queued work or an expired validation lease. An empty queue
sends no keep-alive. A failed trigger does not roll back a submission.
Render handles one validator job at a time; Supabase retains the durable queue,
asset storage and results across restarts.
Hosted pg_net keeps its own PUBLIC grants despite attempted revokes by postgres.
The signed-dispatch migration therefore sends a timestamp and HMAC valid for
three minutes, rather than putting the durable wake key in pg_net's queue.
Render rejects invalid/expired signatures. Replaying a valid signature can only
wake the existing durable queue; it cannot create jobs or choose packages.

The same worker drains a second queue: profile sets (2026-10-31,
`worker/profile-sets.mjs`). When no package is waiting it claims a submitted set,
decodes its front painting in a child process (`worker/profile-set-check.mjs`),
stores the derived card and face under the lease and finishes it for the
operator's review. `20261031100100_oddbout_profile_set_dispatch.sql` makes the
same wake function and cron fire for queued sets.

Free instances sleep after inactivity; the first subsequent submission can
take an extra minute or longer. Render's free quota and Supabase Free quotas
still apply. See [Render Free](https://render.com/docs/free) and
[Supabase scheduling](https://supabase.com/docs/guides/functions/schedule-functions).

## Cutover verification (2026-10-21 KST)

- Pages commit `80d1612` built successfully; creator links to the independent game.
- Browser character selection and practice fight loaded with no console errors.
- Render commit `8770138`: real fixture validation passed in 7.190 seconds.
- HTTPS health returned 200; direct durable-key wake returned 401; signed wake
  returned 202. Supabase pg_net also received 202, and Render logged an idle queue.
- Dispatch permission, pending/expired-lease, worker concurrency, validation and
  creator-handoff tests passed. No new fighter was submitted for this migration.
- FindThem's `ai-fighter-worker.service` is stopped and disabled; its worker key
  (`findthem-prod systemd`) is disabled. Existing registered packages remain intact.

For rollback, deploy a previous reviewed Render commit. Do not silently restore
the old FindThem dependency. The source changes are tracked in PR #1 while
the Pages deployment branch contains the live built files.

## Founding League recruitment

`league.html` is the English recruitment page. The creator homepage links to it,
and its application links return to `creator.html?lang=en&apply=founding-league`.
The existing authenticated invitation request stores the introduction with a
`[Founding League]` prefix inside its existing note limit. Google sign-in retains
only this known campaign parameter and the selected language. Existing pending
requests can be updated; existing invitations are not automatically league entries.

The page uses existing arena character art as labelled examples. Cohort dates and
the proposed match format are plans, not a live tournament or remaining-seat counter.
The Pages builder includes the league entry alongside the creator page and game.

The top banner on `league.html` links to `about.html`, a product introduction with
Korean and English views (`?lang=ko` / `?lang=en`). It explains the game, character
creation, and creator/viewer participation using existing character art and an
actual practice-match screenshot. Broadcast formats are examples, not automated
broadcasting or clip-generation features. The source lives beside `league.html`
in `kaito_web`, and both the creator build and Pages build include the new entry.

## Repeatable deployment

The private `jeonghwanko/crashbang-heroes` repository owns
`.github/workflows/ai-fighter-deploy.yml`. It uses manual `workflow_dispatch`
and the existing `office-stable` runners. Choose `site`, `worker`, or `all`;
`hosting_ref` selects this repository's reviewed branch or full commit SHA.
There are no push/PR triggers or paid runner fallbacks.

The workflow builds `creator.html`, `fighter.html`, `league.html`, and `admin.html` from
private source, then publishes only the public artifact to `codex/creator-pages`.
The artifact includes `deployment.json` with source commits and a measured
SHA-256 digest. Publication rejects dirty source, changed bytes, source maps,
private source files, environment files and symlinks. A normal push rejects
concurrent updates; it never force-pushes. Success requires the live deployment
marker to match and all four pages to respond.

The publisher rechecks the copied checkout before committing, then compares
the live entry HTML and Vite manifest assets (including shared and lazy chunks)
with the local build bytes. HTML, JS, CSS and WASM must have their expected
content types; a 200 response containing an error page cannot pass.
Credential checks cover copied files and the deployment marker as well as JS:
Supabase secret/service-role keys, worker keys, private key blocks and Render
hook URLs are rejected without printing their values. Git control files and
workflow directories cannot be published as site artifacts.

The builder requires clean inputs, records source revisions before building,
and refuses changes to either revision during the build. Its output directory
must be outside the source tree. Saved MCP configurations containing the legacy
creator address are upgraded to GitHub Pages before a sign-in link is minted.
The 2026-10-21 review verified these guards with eight focused tests, a clean
four-entry build/dry run, and read-only comparison against the live HTML,
entry/shared/lazy assets and MIME types. No additional CI run or deployment
was started for this review.

From this checkout, with dependencies installed in the private source:

```bash
npm run site:build -- ../crashbang-heroes/kaito_web output/new-site
npm run site:publish -- output/new-site --dry-run
npm run site:publish -- output/new-site
npm run worker:deploy -- <full-reviewed-hosting-commit-sha> --dry-run
npm run worker:deploy -- <full-reviewed-hosting-commit-sha>
```

The private source also exposes `npm run publish:fighter -- --dry-run` and
`npm run publish:fighter` from `kaito_web`. It builds into a fresh temporary
directory and uses these same scripts. `AI_FIGHTER_HOSTING_DIR` can override
the default sibling checkout.

Required Actions secrets in the **private source repository**:

- `AI_FIGHTER_PAGES_DEPLOY_KEY`: SSH write deploy key scoped to this public
  repository. For local publishing, use the same environment variable or an
  authorized SSH identity. The script pins SSH host keys retrieved from
  GitHub's HTTPS metadata API and removes the temporary key after use.
- `AI_FIGHTER_RENDER_DEPLOY_HOOK`: the existing Render service's secret hook.
  The script sends the tested commit as `ref`, then waits until `/health`
  reports that exact `RENDER_GIT_COMMIT`. A response from the old deployment
  does not count as success. Keep the hook out of logs.

These permissions were connected on 2026-10-21 KST. The repository-scoped
write deploy key has ID `167084548`; both Actions secrets are stored in the
private source repository. Credential backups and access-restricted operating
records are stored in the owner's `.secret` directory, outside this repository.
Worker credentials and the Supabase service-role key do not belong in CI.
See [Render deploy hooks](https://render.com/docs/deploy-hooks) and
[GitHub Pages publishing](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site).

Supabase migrations and Edge Functions are outside this workflow. In particular,
the local empty `duel-engine.mjs` adapter must never replace the deployed game
engine. `publish:rupin` remains the original Wonder Lupin publishing command;
use `publish:fighter` for AI Fighter.

### Verified workflow deployment (2026-10-21 KST)

[Deployment run 39454712921](https://github.com/jeonghwanko/crashbang-heroes/actions/runs/39454712921)
completed successfully on `office-stable-1`: two artifact/deployment tests and
seven worker/dispatch tests passed. The build published 2,159 files from source
commit `5bdaf3fa7bb92bbfa8084e6433d2cb5586eeef44`, using hosting commit
`395f047cd39a383795e804e4f70ff7581c5a6463`.

[Pages run 39455458507](https://github.com/jeonghwanko/oddbout-starter/actions/runs/39455458507)
published commit `b1768dc72dacc80a36f8a7498f6737a77b9b0d3b`. The live
deployment marker matched the build, all three HTML entries and their entry
assets returned HTTP 200, and Render `/health` returned the exact hosting
commit above. This was one manually dispatched verification deployment;
push-triggered source CI and Render auto-deploy remain off.


## Application administration

Open `admin.html` on the same published site and sign in with a pre-provisioned
administrator's Google account. The creator homepage shows **Applications**
only after the API confirms that account's enabled `af_admins` membership.
Routine review requires no SQL: filter or search applications, read their
email and note, then confirm **Approve** or **Decline** with an optional
internal review note.

Approval atomically records the decision and grants at least 30 days of
creator submission access, subject to the existing 20-active-creator beta
capacity. The recruitment target remains 16 creators. Fighter visual/runtime
admission is still a separate review. Decline applies the existing seven-day
reapplication cooldown and does not revoke a separate active invitation.
Review notes stay private; no notification email is sent automatically.
Applicants can check their status on the creator homepage and contact
[turbo08@gmail.com](mailto:turbo08@gmail.com) with questions.

`api/admin.mjs` verifies the bearer user's identity; the database checks the
enabled administrator membership again. Applicant emails come from Auth on
the server only. Browser roles cannot read the administrator/review tables
or execute the administrator RPCs. Review versions reject stale decisions,
and identical retries reuse the original audit record. Provision additional
administrators only through a trusted server-side operation; there is no
public role-management endpoint.

## ODDBOUT domain configuration

The custom domain is `oddbout.com`, with `www.oddbout.com` pointing to the same
GitHub Pages site. The build uses base `/`, rewrites previous public-site
metadata links, and includes `CNAME` in both its measured artifact and live
verification. Every later deployment must retain that file.

The Supabase API hostname, project, billing plan and database remain unchanged.
Only Auth return URLs need to include the new creator page for Google login.
Existing allowed return URLs remain available. Saved MCP homepage URLs on the
previous GitHub Pages host are upgraded before issuing one-use links.

## Plugin policies

The normal build includes the six static pages under `/ai-fighter-creator/`,
plus their local stylesheet and icon, before measuring `deployment.json`.
`build-plugin-policy-site.mjs` owns the renderer; `website/ai-fighter-creator/content.mjs`
owns the English/Korean copy and effective date. Standalone rendering defaults
to a marked, noindex preview. `--publish` renders effective-date metadata and
canonical URLs locally; only `publish-creator-site.mjs` publishes the site.

The standalone build updates the root privacy notice's operator to Lucas Foundation
and adds links to plugin privacy, terms and support. The shared game checkout remains
unchanged. Unexpected privacy source structure fails the build for review.
Artifact validation requires every policy file, and live verification compares their
actual bytes as well as the main site's entry documents and Vite assets.

## ODDBOUT Analytics

The independent ODDBOUT Analytics account (412927960) and ODDBOUT property
(560123237) belong to the site owner. Dashboard:
https://analytics.google.com/analytics/web/#/a412927960p560123237/reports/intelligenthome
The web stream is ODDBOUT Web (stream ID 16179726903), at https://oddbout.com.
Reporting uses Asia/Seoul and KRW. The public measurement ID is G-XPZRDR2LQP,
configured by analyticsMeasurementId in deploy/creator-site.json.

The Pages builder adds scripts/site-analytics.mjs through the Vite module graph to
the main Vite pages, so its hashed module is covered by artifact and live asset checks.
Static translated updates pages and update details receive the same runtime inline
after the build; their complete HTML bytes are covered by the same artifact and live
checks. The language-neutral updates.html redirect has no tag, so only the selected
language's destination sends a page view.
The tag runs only on the configured HTTPS host, excludes the admin page and incoming
sign-in secrets, sends one page view per document, and respects Global Privacy Control.
It keeps standard campaign tags but drops other query parameters and fragments;
referrers are reduced to origins. Account IDs, emails, and uploads are not event fields.
Google signals and ad personalization are disabled in the tag. Enhanced measurement
is off in the web stream to avoid automatic URL/history, form, and outbound-link collection.
The privacy page is updated during the same build to disclose Analytics and cookies.

Analytics account data-sharing choices remain at their initial defaults unless
the owner explicitly approves a later change. No existing ads-coffee property is used.

### Social profile links

Use these links in the corresponding social profiles. The landing page selects a
language while preserving the campaign query values:

| Profile | URL |
| --- | --- |
| YouTube | https://oddbout.com/updates.html?utm_source=youtube&utm_medium=social&utm_campaign=profile |
| X | https://oddbout.com/updates.html?utm_source=x&utm_medium=social&utm_campaign=profile |
| Threads | https://oddbout.com/updates.html?utm_source=threads&utm_medium=social&utm_campaign=profile |
| Instagram | https://oddbout.com/updates.html?utm_source=instagram&utm_medium=social&utm_campaign=profile |
| TikTok | https://oddbout.com/updates.html?utm_source=tiktok&utm_medium=social&utm_campaign=profile |

In GA4 Reports → Acquisition → Traffic acquisition, use Session source / medium
to compare each platform's `social` visits and Session campaign to filter `profile`.
The updates pages also send `landing_start_click`, `update_open`,
`update_detail_click`, `world_link_click`, and `social_link_click`. Events include
only the page's supported `lang`, the published update `slug` or an allowed social
`platform` where relevant, and the same sanitized page/referrer addresses as page
views. Each update opening is counted once per document. No click label, arbitrary
attribute, or destination URL is collected. Event listeners respect the existing
privacy opt-outs and do not delay navigation. Register `lang`, `slug`, and `platform`
as event-scoped custom dimensions if they are needed in reports; collection does
not itself create custom dimensions. Standard reports may lag Realtime.

### GA4 milestones

The four key events use once-per-event counting and no default monetary value:

| Event | Trigger |
| --- | --- |
| game_start | First actual simulation step of a bout, or accepted legacy challenge; mode distinguishes play/watch/tournament. |
| match_complete | Actual bout result or forfeit after a tracked start, once per bout object. |
| creation_start | Successful clipboard copy of the website's creation request, as selected by the owner. |
| character_registered | A new server-validated fighter registration, with an eligible prior browser Analytics context. |

scripts/site-milestones.mjs adds exact, fail-fast source hooks at build time.
The game simulation itself is unchanged. Browser events allow only the event
name and enumerated mode/result/method fields; browser code cannot emit the
registration event.

After existing authenticated creator sign-in, the browser obtains real client_id
and session_id values from the Google tag. It posts only those values to the
configured same-project authenticated /analytics/context route. Backend account
IDs stay in Supabase. An opt-out visit to the authenticated creator clears the
saved link and cancels pending registration events. No generated identifier is
used for local-only creators or visitors whose tag is blocked.

20261022090007_oddbout_registration_analytics.sql creates service-only RLS tables
and an atomic registration outbox. An insert into af_fighters snapshots an eligible
context, with session attribution only for contexts updated within 24 hours.
Hourly deletion after 29 days keeps storage below the approved 30-day maximum.
The worker-finish API atomically claims a pending event, preventing concurrent
or repeated receipts from duplicating it. Unknown network outcomes are recorded
as unknown without automatic retries. Analytics failures do not fail registration.

The Edge Function needs GA4_MEASUREMENT_ID and GA4_API_SECRET in Supabase secrets.
The Measurement Protocol secret must never enter the public build or source.
Only the real Analytics client ID, optional session ID, registration time and event
name go to Google; emails, auth tokens, account/submission/fighter IDs and character
files do not. Advertising consent is denied. A successful HTTP response does not
prove event ingestion; use Google's debug validation endpoint for payload checks
and Realtime/reports for actual collection. Full attribution after a long local
creation session is not guaranteed.

## Google Search Console

The domain property `sc-domain:oddbout.com` is verified for the site owner
(`turbo08@gmail.com`) through a Google verification TXT record at Spaceship.
Keep that DNS record to retain verification. Console:
https://search.google.com/search-console?resource_id=sc-domain%3Aoddbout.com

The normal build writes `/sitemap.xml` from the final public HTML canonical URLs
and advertises it in `/robots.txt`. It omits the admin page, the legacy league URL,
noindex pages and URL parameters. Public plugin policy pages are included. No
last-modified dates are invented. Both files are required in the artifact and
verified byte-for-byte after publication before submitting the sitemap to Google.

## Official YouTube channel

The existing AI Fighter channel owned by the site owner is rebranded as ODDBOUT.
Channel ID: UCSWoSnUD0B4xEw32GVbLpsw. Public handle: https://www.youtube.com/@oddbout.
deploy/creator-site.json owns youtubeChannelUrl. The Vite social plugin adds it
to the shared public footer, with a static homepage fallback. It does not add
an embedded player or change the existing site's Analytics privacy choices.

The first channel profile link uses the YouTube updates link in Social profile links
above. Updating the channel profile is a separate account action after publication.

For ordinary video descriptions, use utm_source=youtube, utm_medium=organic_video,
utm_campaign=oddbout_channel, and
utm_content set to the public video ID. For Shorts, direct viewers to the profile
link; ordinary Shorts description/comment URLs are not clickable. GA4 Traffic
acquisition can report source/medium youtube / organic_video and the existing
game/creation key events. Standard report processing may lag Realtime. Browser
blocking and the existing registration context limits still apply. No Google Ads
connection, audience sharing or ad campaign is part of this setup.
