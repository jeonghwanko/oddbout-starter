# Hosted creation

The skill body's hard rules win if this page disagrees. In particular, `delegate: true` is only for an explicit appearance-choice delegation, `idempotencyKey` is required on step `request`, and `enter_fighter` is never automatic.

When the connected ODDBOUT tools list `request_hosted_fighter`, ODDBOUT can make the fighter on its own worker. No workspace, kit or generation account of the user's is needed. Offer it first when the user wants ODDBOUT to make the fighter or has no generation setup. The workspace route stays the user's choice.

Pass the user's words, and their own pictures only with their confirmation of rights: attached files where the host attaches them, else `request_hosted_fighter` step `picture_ticket` (with the host you will request), whose link the user opens, or with `terminal: true` whose command sends a picture file you have. `get_hosted_fighter` view `upload` before resending one that got no answer. Show the pictures before passing them. Then follow each result's `next`.

Show both looks. They are front views, and the pick is also the fighter's profile picture. Pass the user's pick or one change. Show the motion previews, which are made from a side view ODDBOUT draws from the pick. Hosted creation includes registration into production. Do not wait for motion approval. The server continues to packaging and registration. For an older job at `motion_ready`, call `submit_fighter_registration` with `kind: hosted` to continue the requested creation. Honor an explicit hold or revision request. Only the owner reviews and enters the registered fighter on the website.

Use `statusSummary` to report the stage, required action and last check. Say that stage in one sentence. Stage progress 100% is not registration completion. Wait with `get_hosted_fighter` `waitSeconds` rather than repeated reads. Reading the job does not cancel it. If the chat stops, provide `siteUrl`. Do not promise background chat notifications. Do not generate locally for a hosted job.

If the user runs a generation host on their own PC (`npm run host -- join` from the site), pass `host: mine`. Their own subscription makes it, with no consent to give and without using their tokens (each account starts with 500,000; ODDBOUT's own worker takes off what it spends). Another person's host (`browse_oddbout` view `hosts`) takes none of their tokens and needs the user's consent first.

Before calling `request_hosted_fighter`, read `get_profile` and `get_my_fighters` view `list`. A full roster is `fighter-quota`. Reuse the original `idempotencyKey` for an identical retry. If the reply is lost, read `get_hosted_fighter` with that key. Do not send a second request to find out whether the first one landed.

A hosted job's cost is whatever the tool result reports (`tokens` granted, spent and balance, or `tokensCharged`). Do not invent a total when the result does not include one. Dummy results spend nothing; that is not a live price.
