# ODDBOUT Showrunner · Spotlight

The customer flow is **buy a broadcast ticket → Set Promotion → schedule → On-Air Agent → Start → check settlement → approve creator fees**.
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
then saves a start date and time to their private On-Air Calendar. Scheduling does not publish,
start the clock or make another debit. On-Air Agent opens the authenticated host room for that order;
the owner previews the promotion and presses **Start**. The resulting unlisted watch link exposes
those materials to its viewers. The host room's **Watch broadcast** button opens the ODDBOUT web
watch page in its own tab, keeping the host controls available.
Uploaded video URLs are temporary signed capabilities; the storage bucket remains private.
YouTube and Twitch links use their official players, with the actual host as Twitch's `parent`.
Private, removed, restricted or embedding-disabled videos cannot be guaranteed to play.
YouTube video looping is requested; Twitch clips/VODs may finish before the five-minute slot ends,
and live channels must be online. Autoplay can require a viewer gesture. Below Twitch's 400-pixel
minimum width, the page offers an original-player link rather than a cropped embed. See the
[YouTube player parameters](https://developers.google.com/youtube/player_parameters) and
[Twitch embed requirements](https://dev.twitch.tv/docs/embed/video-and-clips/).

Order states remain `awaiting_media`, `ready`, and `started`. Ready tickets with a saved time display
**Scheduled**. The calendar stores the planned instant in UTC and the selected IANA time zone;
forms and the calendar display the current device's time zone explicitly. Dates must be in the
future, within one year, and can be changed before Start. Version checks prevent a stale device
from overwriting a newer schedule or starting from a stale host review. Saved request keys recover
uncertain responses without another reservation, model call or debit.

Start is always manual. The host may start earlier or later than planned, with an explicit “Starts now”
notice; the full purchased duration runs from the actual server `startedAt`. There is no scheduled
background execution or automatic start when the planned time passes. The host shows verified completed
cups, unresolved jobs and the session status. Elapsed time alone does not prove delivery.
Unknown purchase/upload/save responses retain their original keys and paths for recovery.

## Playback boundary

For new starts, the watch page schedules sponsor slots and replays the verified Agent-produced cups,
using their recorded fighters and seeds. It waits for the first completed cup instead of inventing
execution results. Earlier broadcasts retain their existing exhibitions. The arena's same-origin `spotlight.html` adapter uses the normal fighter
player protocol and validates bout identity before displaying results. Joining mid-bout starts
local playback. This is an ODDBOUT web program, not a Twitch stream or synchronized video feed.
No audience reach, DAU, ad impressions or uninterrupted delivery is guaranteed or inferred.
Client-rendered results do not authorize creator payouts. AI introductions are captions with
optional browser speech after a user gesture, not guaranteed prerecorded narration.

## One ticket, one execution and settlement

Start atomically binds the ticket to one Agent session. Its internal execution allowance comes from
the ticket price; cups consume that allowance without another wallet debit. Ending early or expiring
the allowance does not mint wallet credits. Legacy metered sessions keep their existing billing.
The selected graphical host must be connected and idle, and all four fighters must have configured
Sandbox payout receivers. A lost Start response reopens the same session. Database discovery resumes
active ticket sessions after an API restart; job fencing prevents duplicate completion charges.
Unusable AI responses display **Retry Agent**. Explicit retry preserves the same ticket, session,
model-call count and attempt history; unresolved cup mutations cannot be retried through this control.

The host page shows Agent decisions and completed cups. **End broadcast** stops new cups and lets a
running cup finish. Unknown jobs remain held for review. After completion, **Check settlement** matches
the ticket's actual FIFO-attributed wallet funding against PayPal through its official MCP. Successful
settlement creates an appearance-fee proposal for verified cups. The owner reviews the amount and
explicitly approves PayPal payout on this same page. Submission retries reuse the batch identity;
paid appearances cannot be proposed again. Settlement must be successful and less than 15 minutes old;
refund/reversal freezes prevent payment. The expandable records retain order, capture and payout IDs.

The older console at `/broadcast/operator/` remains available. Its payout entry points enforce these
same ticket settlement rules. Customer navigation does not expose its former setup panels.

## Funding and deployment

DON are prepaid service units, separate from game gold. Existing PayPal Starter
(USD 10 / 1,000 credits) and Series (USD 50 / 5,000 credits) packs remain secondary top-ups.
There is no subscription or auto-renewal. Existing orders retain their original quantities and amounts.

After the migrations in [PAID-TASK-RECOVERY](PAID-TASK-RECOVERY.md), apply
`supabase/sandbox/20261103154930_commerce_campaigns.sql`, followed by
`supabase/sandbox/20261103170232_commerce_campaign_links.sql`, then
`supabase/sandbox/20261103180002_commerce_campaign_schedule.sql`, then
`supabase/sandbox/20261103185105_commerce_campaign_execution.sql`, only to the isolated Sandbox project.
They create the private campaign tables/RPC, `campaign-media` bucket and service-role-only link RPC.
These migrations preserve existing purchases and started broadcasts. New starts require a saved
schedule; already-started records without one remain viewable. Deploy the game's
`spotlight.html`, `spotlight-player.mjs` and `spotlight-contract.mjs` adapter before the API/UI release.
Use the existing explicitly selected `ODDBOUT_BROADCAST_MODEL` and `OPENAI_API_KEY` for introductions.
Enable the existing auto-producer, reconciliation and payout settings. Set `ODDBOUT_CAMPAIGN_HOST_ID`
when more than one worker is configured; a sole configured worker is selected automatically. Start the
normal graphical runner; authenticated claim polling records its heartbeat. No new worker credentials
or production database access are introduced. `/readyz` checks execution schema access. Run
`node --test test/campaign-execution.test.mjs test/browser/campaign-shop.test.mjs` and `npm run typecheck`.

Render remains Free at the owner's request and may sleep. Always-on hosting, production payments,
commercial refund terms and independently measured delivery remain separate launch decisions.
See [BROADCAST-HOSTING](BROADCAST-HOSTING.md) for existing hosting and payment setup.
