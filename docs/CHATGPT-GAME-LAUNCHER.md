# ODDBOUT × ChatGPT: iframe launcher (A안)

**Status: draft / disabled by default / not deployed.** This repository adds a ChatGPT MCP UI launcher for the existing Phaser game. **No production ChatGPT gameplay has been verified.** The private game source and release environment are maintained separately.

## High-risk findings from adversarial review (2026-11-11)

| Severity | Issue | Mitigation | Still required |
| --- | --- | --- | --- |
| CRITICAL | No proof Phaser can run in a nested ChatGPT iframe | Fail-closed readiness; origin + nonce-verified handshake | Implement game-side ready notification and test actual host |
| CRITICAL | ChatGPT OAuth does not grant an iframe game session | No access tokens passed in URL | One-time server-side game session exchange |
| CRITICAL | Digital-goods/credits checkout conflicts with current public ChatGPT plugin policy | Launcher gated OFF by default | Disable all purchase/upsell routes in embedded game on client + server |
| HIGH | iframe load can fire for blocked and blank pages | Load is unverified; late load after stop is ignored | Verify WebGL, controls, audio, and match result |
| HIGH | Main CI skips draft PRs | Focused draft-PR workflow plus adversarial tests | Confirm successful CI and full repo suite |
| MEDIUM | Duplicate standalone launcher diverged from real MCP UI | Redundant standalone version deleted | Keep canonical MCP resource only |

Official sources: https://developers.openai.com/plugins/plugin-guidelines ,
https://developers.openai.com/plugins/reference ,
https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx .

## Code map

- MCP UI module: mcp/cloud/game-launcher-ui.mjs
- Cloud tool / resource registration and feature flag: mcp/cloud.mjs
- Edge staging-only flag: supabase/functions/ai-fighter-mcp/index.ts
- Fixed URL response-header diagnostic: scripts/check-chatgpt-iframe.mjs
- Adversarial behavior tests: test/game-launcher.test.mjs
- Focused draft CI: .github/workflows/chatgpt-launcher-smoke.yml

The OAuth-protected tool is named **open_game_launcher**. Its UI resource is **ui://oddbout/game-launcher-v1.html**, with MIME **text/html;profile=mcp-app**. The frame allowlist is exactly https://oddbout.com, declared in both standard and compatibility UI CSP metadata. The existing ODDBOUT widget origin is reused. Fullscreen support is declared during MCP UI initialization and checked against the host's advertised modes before requesting.

## Feature gate and staging

The cloud server defaults to **launcherEnabled=false** for every environment. The Supabase Edge entry point opts in only when deployment configuration includes **ODDBOUT_CHATGPT_GAME_LAUNCHER=1**. This flag only exposes the tool; it does not make fighter.html embeddable.

1. Deploy this code to an isolated **staging** Supabase project and MCP endpoint, not to the approved production app or mcp.oddbout.com.
2. Enable the launcher environment flag in staging only. Do not copy production service-role credentials.
3. Attach that staging MCP endpoint to a separate private ChatGPT development app.
4. Invoke the launcher and visibly confirm the Phaser game rendering in the nested frame.
5. Test frame ancestry, OAuth/session, WebGL, input, audio and game result. Keep the flag disabled in production until all gates pass.

## Launcher-to-game protocol

Upon pressing Start, the widget loads the fixed URL https://oddbout.com/fighter.html. It creates a new 128-bit random nonce. After the frame loads, it sends the following JSON to the **exact game origin** by postMessage:

    { "channel": "oddbout-launcher-v1", "type": "launcher:hello", "nonce": "<32 hexadecimal characters>" }

The separate Phaser game frontend must implement a receiver:
- Require event.source === window.parent.
- Verify the exact parent origin seen in staging. Do not use wildcard origins or assume an opaque "null" parent origin is safe.
- Validate the channel, message type and nonce format.
- Reply **only after actual Phaser scene/game readiness**, echoing the same nonce, as type "game:ready".
- For missing authentication reply "game:auth-required"; for a game failure reply "game:error". Do not include raw errors, identity or tokens.

The widget accepts game messages only from its active iframe window, **exactly https://oddbout.com**, with the current nonce. It does not treat an iframe load event as success. A successful "game:ready" handshake proves **frontend initialization only**, not account sign-in or a persisted match. Without a game-side receiver it remains **unverified**, even if part of the web page becomes visible.

## Session integration (NOT implemented)

ChatGPT's connected OAuth identity is separate from the nested game's browser cookies. Third-party storage restrictions and framed Google sign-in can break login.

If existing game auth does not work, design an OAuth-verified, short-lived, single-use **game-session exchange**:
- Start only after explicit user interaction and validate the intended ODDBOUT account at the backend.
- Send a narrowly scoped one-time launch proof through a verified message channel or server-to-server exchange; never put an OAuth access token in an iframe URL, query string, browser history or model-visible tool result.
- Redeem the proof once on the authoritative game server; deny replay, expired proofs, wrong origin, wrong account or mismatched session.
- Verify the identity on both MCP and game sides before any state-changing operation. Test multiple accounts separately.

Do not implement this against guessed game endpoints; the Phaser frontend and game backend are maintained outside this repository.

## Digital purchases and policy (NOT resolved)

Current public ChatGPT plugin guidelines do not permit direct or indirect selling of digital credits, subscriptions, or virtual goods. A fully embedded game containing paid skins, generation credits, banners, payment buttons, purchase errors or external checkout links could fail review. **Remove or safely disable all such flows in embedded mode, on server and client**. The same guidelines also prohibit advertisements in plugin UI; audit banners, rewarded ads, video ad SDKs and navigation that reveals ad placements in the embedded game. Merely hiding a buy button in the launcher does not suffice. Existing paid entitlements can be considered under the published guidance. Obtain policy confirmation where unclear.

An iframe of the same registrable domain is eligible for consideration, but requires justification during app review and may still be denied. Previous ODDBOUT app approval does not guarantee approval of a new game iframe.

## Test commands

    node --test test/game-launcher.test.mjs
    node --check mcp/cloud/game-launcher-ui.mjs
    node scripts/check-chatgpt-iframe.mjs

The header diagnostic requests a fixed URL and refuses redirects; even perfect headers do not prove a nested Phaser game works. The main CI skips draft PRs intentionally. The dedicated smoke workflow does not replace full lint, typecheck, end-to-end or device tests.

## Acceptance criteria

- **P0 embedded runtime:** Open launcher inside ChatGPT; real Phaser renders; valid readiness handshake received; keyboard/mouse/touch and audio verified.
- **P1 identity:** Correct already-connected account is identified inside the game; iframe reload and session expiry behave safely; no account crossover.
- **P2 persistence:** Complete one full match and independently verify the result on the authoritative backend; test restart and failure recovery.
- **P3 release compliance:** No prohibited embedded commerce; desktop and mobile verified; additional app-review requirements satisfied.

If iframe policies, browser security or the game code prevent P0, mark **A안 blocked**. Do not relabel opening an external browser as embedded game success.

## Rollback

Disable the staging flag and redeploy. The launcher tool and resource disappear from the MCP edition; the approved app and production game remain untouched while the PR is draft.
