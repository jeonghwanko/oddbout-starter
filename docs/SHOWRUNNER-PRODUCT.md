# ODDBOUT Showrunner · Spotlight

The customer flow is **choose a broadcast card → add sponsor video and URL → preview and publish → My broadcasts**.
DON balance, top-up action and purchased broadcast tickets share the wallet above the products.
Tickets show their four assigned fighters with portraits and names. Each product card has its own purchase
button; uncertain purchases resume from that same card while other products stay disabled.
This is the existing isolated PayPal Sandbox service, not live-money billing.
The hero reads “Your brand. In the ring.” / “Your promo. In the heart of the action.”
Sandbox disclosure and general operation status appear in the small page footer.

## Broadcast products

| Card | Program duration | Included ad time | DON |
| --- | --- | --- | --- |
| Spotlight · 1 hour | 60 minutes | 10 minutes | 300 |
| Spotlight · 2 hours | 120 minutes | 20 minutes | 600 |
| Spotlight · 3 hours | 180 minutes | 30 minutes | 900 |

Ad time is included in the program duration. Each hour contains two five-minute sponsor breaks,
at minute 0 and minute 30. An uploaded MP4 loops within its slot. Four distinct fighters are randomly
selected once per purchase from the nine built-in ODDBOUT characters. The owner explicitly designated
this pool as this product's SS tier; it is not a game ranking or a claim of third-party IP rights.
The same lineup survives retries, media changes and device changes.

Names, spending limits, hosts and fighter selection are absent from the customer purchase form.
Prices and duration come from the server catalog. Purchase atomically debits the fixed price once,
with an append-only ledger and owner-scoped idempotency key. There is no additional per-cup charge
for this product. An insufficient balance creates neither an order nor a debit.

## Media and publication

Each owner uploads an MP4 (up to 50 MiB and five minutes) to private storage or supplies a YouTube
video / Twitch video, clip or channel URL. MP4 uploads are checked against actual stored bytes,
container metadata and duration. Linked media is strictly parsed into a provider and identifier;
its `link-format-only` verification does not certify availability, length or playback. The owner
previews it in the official player before saving, then confirms playback before publishing.
The separate promotion destination is an HTTPS URL. The server never fetches user-supplied URLs.

AI writes a paid-sponsor introduction using the destination hostname. It does not claim to have
watched the clip or researched the advertiser. The owner reviews the video, introduction and URL,
then explicitly publishes. The resulting unlisted watch link exposes those materials to its viewers.
Uploaded video URLs are temporary signed capabilities; the storage bucket remains private.
YouTube and Twitch links use their official players, with the actual host as Twitch's `parent`.
Private, removed, restricted or embedding-disabled videos cannot be guaranteed to play.
YouTube video looping is requested; Twitch clips/VODs may finish before the five-minute slot ends,
and live channels must be online. Autoplay can require a viewer gesture. Below Twitch's 400-pixel
minimum width, the page offers an original-player link rather than a cropped embed. See the
[YouTube player parameters](https://developers.google.com/youtube/player_parameters) and
[Twitch embed requirements](https://dev.twitch.tv/docs/embed/video-and-clips/).

Order states are `awaiting_media`, `ready`, and `started`. The last state is labelled **Published**:
it records publication, not verified delivery. Elapsed time does not mark a purchase fulfilled.
Unknown purchase/upload/save responses retain their original keys and paths for recovery.

## Playback boundary

The watch page schedules sponsor slots and actual ODDBOUT browser-rendered exhibition bouts against
the server start time. The arena's same-origin `spotlight.html` adapter uses the normal fighter
player protocol and validates bout identity before displaying results. Joining mid-bout starts
local playback. This is an ODDBOUT web program, not a Twitch stream or synchronized video feed.
No audience reach, DAU, ad impressions or uninterrupted delivery is guaranteed or inferred.
Client-rendered results do not authorize creator payouts. AI introductions are captions with
optional browser speech after a user gesture, not guaranteed prerecorded narration.

The existing metered producer, PayPal reconciliation and creator-payout console remains at
`/broadcast/operator/`; original operation links retain their routing. Its 25-credit completed-cup
billing and appearance-fee approvals remain separate from Spotlight. Customer navigation does not
expose the former “Set up your show” or “Run the ring” panels.

## Funding and deployment

DON are prepaid service units, separate from game gold. Existing PayPal Starter
(USD 10 / 1,000 credits) and Series (USD 50 / 5,000 credits) packs remain secondary top-ups.
There is no subscription or auto-renewal. Existing orders retain their original quantities and amounts.

After the migrations in [PAID-TASK-RECOVERY](PAID-TASK-RECOVERY.md), apply
`supabase/sandbox/20261103154930_commerce_campaigns.sql`, followed by
`supabase/sandbox/20261103170232_commerce_campaign_links.sql`, only to the isolated Sandbox project.
They create the private campaign tables/RPC, `campaign-media` bucket and service-role-only link RPC.
The link migration preserves existing MP4 records and purchase semantics. Deploy the game's
`spotlight.html`, `spotlight-player.mjs` and `spotlight-contract.mjs` adapter before the API/UI release.
Use the existing explicitly selected `ODDBOUT_BROADCAST_MODEL` and `OPENAI_API_KEY` for introductions.
`/readyz` checks campaign schema access. Run `npm run campaign:check` and `npm run typecheck`.

Render remains Free at the owner's request and may sleep. Always-on hosting, production payments,
commercial refund terms and independently measured delivery remain separate launch decisions.
See [BROADCAST-HOSTING](BROADCAST-HOSTING.md) for existing hosting and payment setup.
