# Broadcast Studio assets and design

The November 2026 refresh follows the live [ODDBOUT site](https://oddbout.com/):
cream paper, deep ink, lime accents and familiar fighter portraits. The compact
Google account control replaces the duplicated account card. A single wallet and
checkout row leads into budget and rehearsal controls; server payloads live in a
disclosure instead of the main reading flow. Rehearsal state remains explicit.

References reviewed 2026-11-03:

- [Twitch brand principles](https://blog.twitch.tv/en/2019/09/26/nice-to-meet-you-again-for-the-first-time-/):
  playful gaming identity with a clear product hierarchy; no Twitch marks reused.
- [Google sign-in branding](https://developers.google.com/identity/branding-guidelines):
  use the supplied, unmodified light pill button with readable action text.
- [PayPal design guidance](https://developer.paypal.com/log-in/designer-guide):
  preserve official marks and recognizable payment treatment.

Asset sources:

- `oddbout-logo.webp`: ODDBOUT Cup `public/art/ui/oddbout-logo.webp`.
- Fighter portraits: ODDBOUT Cup `public/art/ui/oddbout-faces-v1/`.
- `paypal.png`: https://www.paypalobjects.com/webstatic/mktg/Logo/pp-logo-100px.png
- `google-signin.png`: Google's official
  https://developers.google.com/static/identity/images/signin-assets.zip,
  Android + Web / PNG @2x / Light / text Yes / Pill. Original aspect ratio retained.
- DM Sans and Space Grotesk: variable fonts from the official
  [Google Fonts repository](https://github.com/google/fonts/tree/main/ofl),
  `dmsans/DMSans[opsz,wght].ttf` and `spacegrotesk/SpaceGrotesk[wght].ttf`, served locally. Their SIL Open Font
  Licenses are retained alongside the fonts (`*-OFL.txt`).
- Inline interface icons are simple authored SVG geometry, decorative with named
  controls. No icon runtime or external asset requests are needed.

Logos retain their owners' trademark rights. These assets identify the connected
services; they do not imply endorsement.

- `don.svg`: original lime coin with a D monogram for the DON service balance.
