# Policy and review-video preparation

Prepared 2026-10-22. The user selected **Lucas Foundation** as the operator/publisher.
The existing public support address is `turbo08@gmail.com`.

## Deliverables

- `website/ai-fighter-creator/content.mjs`: English and Korean privacy/terms, product overview and support copy.
- `website/ai-fighter-creator/style.css`: responsive, dependency-free presentation. No analytics or remote fonts.
- `scripts/build-plugin-policy-site.mjs`: renders six static pages. Local previews retain the banner and `noindex`; the site build uses publication mode with effective dates and canonical URLs.
- `website/ai-fighter-creator/review.html`: video, captions, policy links and explicit coverage limits.
- `scripts/run-plugin-review-demo.mjs`: runs actual stdio MCP calls against a supplied installed portable package in an isolated home/workspace. It neither generates nor signs in/uploads. It reads current public game context.
- `scripts/render-plugin-review-video.mjs`: encodes actual captured browser frames with their capture timing and writes English/Korean captions and provenance.
- `scripts/serve-plugin-review.mjs`: loopback-only, allowlisted local preview; does not expose private run folders.

Generated material is under ignored `output/plugin-review-20261022/`. The shareable archive contains only
`site/`, provenance and the review README, never `private-run/`, first-attempt evidence, browser captures,
the approval correspondence, or account files. That archive preserves the original preparation preview;
the policy publication described below is a separate site release.

## What the video proves

The installed portable **0.2.0** package completed nine tool-level checks: local discovery, setup inspection,
dialogue-only project creation, a real process restart, project recovery, refusal of a generation job in
dialogue-only mode, path traversal refusal, native WebP package validation, and final project listing.
The workspace and OS home are isolated. A previously initialized hash-addressed runtime was reused for
the successful recording; the project and authentication home were new.

The video is a screen capture of a purpose-built reviewer console displaying real MCP responses,
**not a recording of a Codex conversation**. The geometric fixture is explicitly labeled as a format test.
No generation, visual approval, login or fighter registration was performed. Do not mark the proposed
five positive/three negative conversational cases in `PLUGIN-REVIEW-CASES.md` complete on this evidence.

The first run correctly rejected a job with `dialogue-only-no-execution`; the demonstration's assertion
initially expected `dialogue-only`. The assertion was corrected and the run repeated. The original
failure record is retained locally. No product behavior was changed to make the demonstration pass.

## Policy evidence map

| Statement | Source inspected |
| --- | --- |
| Per-user runtime and workspace; no generation at plugin launch | `plugins/ai-fighter/launcher.mjs` |
| Project brief, versions, reviews, feedback, profile, hashes | `mcp/creation-store.mjs` |
| Commands, provider choices, job records, timestamps and logs | `mcp/creation-jobs.mjs`, `scripts/run-creation-job.mjs` |
| Structured data returned to the assistant, including nested objects | `mcp/creator-tools.mjs`, `mcp/server.mjs` |
| Public game-context requests | `mcp/creation-context.mjs`, `deploy/creation-context-source.json` |
| Local access/refresh tokens; logout versus account deletion | `api/client.mjs`, `scripts/login.mjs` |
| One-use creator-homepage sign-in link | `mcp/remote-tools.mjs`, `mcp/creator-handoff.mjs` |
| Submitted asset bytes, hashes and final server status | `mcp/remote-tools.mjs`, `api/handler.mjs` |
| No self-service account deletion endpoint | `api/account.mjs` |
| Existing public data/provider disclosures and support address | `https://oddbout.com/privacy.html`, read 2026-10-22; `../crashbang-heroes/kaito_web/privacy.html` |

No exact cloud log/backup retention periods, processing regions or legal entity address were invented.
The copy describes the known behavior. Before public policy publication, the operator should resolve
its actual retention schedule, configured processing countries and any jurisdiction-specific disclosures.
The prepared copy is not a certification of legal compliance.

## Policy publication — 2026-10-22

The six policy/product/support pages and their stylesheet/icon are deployed. The normal publisher
verified the actual HTTPS bytes for those files, the root privacy notice and existing site assets.

- Source/build commit: `8f758f73404aecb12e586616328f3c3b1a53f4b1`.
- Pages commit: `9597054e14ee66ea15091b4da5c049b0d51ab4de`.
- Live build: `11b3e3e2-2efe-4c41-b816-4ed2cc5035ec`.
- Existing game source: `eb5ff1695c4a2f0269c68e0a5eace2770bf67d63`, unchanged.

Verified public locations:

- `https://oddbout.com/ai-fighter-creator/index.html`
- `https://oddbout.com/ai-fighter-creator/privacy.html`
- `https://oddbout.com/ai-fighter-creator/terms.html`
- `https://oddbout.com/ai-fighter-creator/support.html`
- `https://oddbout.com/ai-fighter-creator/privacy.ko.html`
- `https://oddbout.com/ai-fighter-creator/terms.ko.html`

The incomplete review video was not published. Its functional demonstration and the outstanding
generation/revision/registration footage remain separate from policy publication.

The 0.2.1 manifest sets `developerName` to Lucas Foundation and includes the four published listing URLs
in `extensions.com.openai.interface`; see `PLUGIN-DISTRIBUTION.md`. It is built as a new version rather
than rewriting the 0.2.0 package. The original demo still documents 0.2.0. Do not add this partial demo
to submitted release metadata as though full review preparation were complete.

The main ODDBOUT public privacy page now names Lucas Foundation and links to the plugin policies.
The standalone site build applies that change; the shared `crashbang-heroes/kaito_web` checkout was
not overwritten. Compared with the prior live release, 2,689 existing files are byte-identical;
only the root privacy document, deployment marker and eight new policy files changed.
The normal site build requires clean committed source/build provenance. Do not bypass those checks,
copy an unrelated old site release over production, or run CI just to publish these pages.

Before submission: complete actual creation/revision/registration footage, execute the full conversational
review cases, keep the published policy accurate as operational arrangements change, publish the completed video,
obtain partner organization eligibility and provide review credentials securely if required.

## References

- [OpenAI plugin submission](https://developers.openai.com/plugins/deploy/submission): review cases,
  recording, listing links and secure reviewer access; fetched 2026-10-22. Local stdio eligibility is
  a separate partner approval; the final partner workflow may specify additional requirements.
- [PIPC privacy-notice guidance, April 2026](https://pipc.go.kr/np/cop/bbs/selectBoardArticle.do?bbsId=BS217&mCode=D010030000&nttId=12018):
  current official guidance listing consulted; operational facts still require verification before publication.

## Reproduction

```powershell
node scripts/build-plugin-policy-site.mjs
Copy-Item website/ai-fighter-creator/review.html output/plugin-review-20261022/site/review.html
Copy-Item website/ai-fighter-creator/review-console.html output/plugin-review-20261022/site/review-console.html
node scripts/serve-plugin-review.mjs output/plugin-review-20261022/site 4318
```

To perform a fresh functional demonstration, pass the absolute portable package directory to
`run-plugin-review-demo.mjs`. It creates a new disposable project under the review output directory.
Keep any full conversational generation/registration run separate and follow the repository's creation
and provider-account instructions. Preparation of review materials is not itself authorization to generate.
