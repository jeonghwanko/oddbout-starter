# ChatGPT embedded ODDBOUT game launcher — A plan

Status: prototype scaffold only; NOT integrated into the approved production app.

## Goal
Run the existing ODDBOUT Phaser web game inside a ChatGPT Apps SDK iframe without opening a separate browser. The game engine remains in its existing deployment, not in this repository.

## Prototype
- `apps/chatgpt-game-launcher/launcher.html` and `launcher.js` provide a minimal launcher.
- The iframe loads `https://oddbout.com/fighter.html` on an explicit click.
- Back removes the iframe source; fullscreen uses the host display-mode API when available.
- The load event is **not** proof of successful rendering, sign-in, or gameplay.
- No token, game session, or user information is placed in the URL.

## Integration tasks
1. Add a dedicated Apps SDK tool with an HTML widget resource (correct MIME type `text/html;profile=mcp-app` and host-specific resource metadata).
2. Configure the widget's CSP and `frameDomains` for the actual game origin. Review ChatGPT iframe policy and permitted domains before submission.
3. Serve launcher assets from a trusted HTTPS origin. Confirm the existing game's `Content-Security-Policy: frame-ancestors` and `X-Frame-Options` allow the actual ChatGPT sandbox ancestor chain. Do not weaken production security globally.
4. Confirm the OAuth identity mapping; third-party cookie restrictions can prevent existing web sign-in from working. If required, add a server-side short-lived, one-time session exchange with strict origin and replay checks; never pass OAuth access tokens to the iframe.
5. Verify WebGL, Phaser asset requests, keyboard focus, pointer/touch input, autoplay audio unlock, responsive viewport, page lifecycle, and memory usage.
6. Verify gameplay from lobby to bout result and server persistence.
7. Test desktop, iOS and Android hosts. Stage in a development app and obtain any required review before updating the approved app.

## Security
- Allowlist the game origin; never accept arbitrary URLs or untrusted tool-supplied iframe targets.
- Use restrictive CSP, narrow frame permissions and authenticated backend operations.
- Keep the existing approved production app and the `main` branch untouched until acceptance.

## Acceptance criteria
- ChatGPT renders launcher.
- Clicking Start shows a working, authenticated Phaser game inside ChatGPT.
- User can complete one match, see the result saved on ODDBOUT, return to launcher, and reopen without stale sessions.
- Error and timeout states are understandable; mobile controls work.
- No browser redirect is needed for the gameplay path.

## Go/no-go
If ChatGPT host policy or the existing game's framing/auth architecture prevents safe iframe execution, do not silently substitute an external-link launcher. Report the blocker and separately evaluate direct widget bundling (plan B).
