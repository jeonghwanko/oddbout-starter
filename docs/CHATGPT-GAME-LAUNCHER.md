# ChatGPT embedded ODDBOUT launcher — A plan (iframe)

Status: **cloud MCP tool + UI resource implemented on draft PR branch; not deployed or end-to-end verified**.

## Source and integration

- `mcp/cloud/game-launcher-ui.mjs` defines an HTML MCP Apps widget at `ui://oddbout/game-launcher-v1.html`.
- `mcp/cloud.mjs` registers `open_game_launcher` in the full cloud edition (not the limited Claude directory edition). It is authenticated via the existing cloud wrapper.
- `_meta.ui.resourceUri` and `openai/outputTemplate` associate the tool with the widget.
- The widget uses `frameDomains: ["https://oddbout.com"]`, a narrow CSP, the existing ODDBOUT widget origin, MCP Apps initialization/size notifications, and optional ChatGPT fullscreen.
- Start explicitly sets the iframe URL to `https://oddbout.com/fighter.html`. Back clears the URL. No access token is embedded in a URL.
- `test/game-launcher.test.mjs` covers resource metadata, allowed frame origin, basic host bridge and tool registration.
- `apps/chatgpt-game-launcher/` holds the earlier standalone prototype; the actual MCP resource is the embedded module described above.
- The existing Phaser engine stays in its separately maintained deployment.

## Running local verification

```bash
node --test test/game-launcher.test.mjs
node scripts/check-chatgpt-iframe.mjs
npm run typecheck
```

The iframe diagnostic only verifies publicly visible headers where reachable. It does not prove the game is rendered in ChatGPT.

## Remaining deployment and game integration work

1. Run CI/typecheck/tests in a checkout (not executed by the GitHub connector).
2. Connect the modified cloud MCP to an isolated development/staging ChatGPT app. Do **not** change the already approved app until staging passes.
3. Check the current `fighter.html` response headers: `Content-Security-Policy: frame-ancestors`, `X-Frame-Options`; ensure actual ChatGPT iframe ancestor chain is allowed without globally disabling framing security.
4. Invoke `open_game_launcher` from ChatGPT. Confirm widget appears and the embedded game visibly renders. The iframe `load` event is insufficient.
5. Test third-party cookie/storage rules in the nested frame. The existing cloud OAuth account does not automatically sign the embedded web game in. If sign-in is blocked, implement a backend-authenticated, one-time short-lived exchange that binds the MCP identity to the game identity and never exposes OAuth bearer tokens in the frame URL.
6. Confirm keyboard/mouse/touch, WebGL, image/audio loading, responsive sizing and game restart, especially iOS/Android.
7. Complete one real match with the same verified account and confirm the result is saved on the existing game backend.
8. Review nested-frame policy, CSP and a new app version before promoting the change to the approved production plugin.

## Security and acceptance

The game origin is a constant, not model-supplied or argument-supplied. Tool invocation is read-only and cannot enter a fighter, spend gold or start a cup. App and iframe permissions must remain limited. User confirmation is required for game account mutations.

**P0 complete only when the actual Phaser renderer runs inside ChatGPT.**
**P1 complete only when the existing account is authenticated in that renderer.**
**P2 complete only when a full match completes and persistence is independently observed.**

If ChatGPT framing policy or the game's security model prevents safe iframe play, document the blocker; do not silently call an external-link launcher a successful A-plan implementation.

## Current limitation

The branch includes the MCP integration code, but a live ChatGPT developer-app session and the game's authoritative iframe/auth environment were not available in this development session. Staging deploy and live gameplay verification remain undone.
