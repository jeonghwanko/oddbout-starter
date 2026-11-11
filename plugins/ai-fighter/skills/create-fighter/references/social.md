# Share on X

The skill body's hard rules win if this page disagrees. Detail: `docs/SOCIAL-EXPORT.md`. A kit older than 0.6.22 has neither `fighter:social` nor `export_social_media` / `prepare_grok_face_clip` (its `package.json` version says which): say the export needs kit 0.6.22, and do not update a kit with a character in progress just to get it.

A finished fighter can be posted on X as the user's own character: moves as short videos, a showcase ending on the fighter's card, and the six faces as reaction GIFs (X has no custom stickers or emoji; a reply GIF is X's "emoji"). The export only reads the package and the profile set and writes a new folder. It generates nothing, spends no generation quota and never touches a submitted package.

1. Offer it once after registration, or when the user asks to share or post the fighter. A no ends it.
2. Run workspace `export_social_media` (or `npm run fighter:social -- --package <package> --profile-set <set> --out output/<name>-x`) with the package that was registered and its profile set. Without a profile set there are no faces; without an expression sheet every face is the front's face square with its own move.
3. Show the actual `showcase.mp4` and two reactions (`reactions/sideeye.gif`, `reactions/ko.gif`). Paths and text are not previews. Then point to `POST.md`: caption links, the four-picture set and where the link goes (the first reply, not the post).
4. The user posts from their own X account. Do not post, sign in to X or ask for X credentials. `social.json` checks X's published limits; only an upload shows X accepted a file.
5. The ODDBOUT end card and corner mark are on by default. Turn them off (`endcard: false`, `--no-endcard`) only when the user asks.

## A Grok clip of a face

Only on the user's explicit request for a generated clip; the export's preset moves need no generation.

1. `prepare_grok_face_clip` (or `npm run fighter:social -- grok-face --profile-set <set> --face <face> --out <new folder>`) writes a square still and a prompt and returns the `npm run sprite -- video` command. It does not generate.
2. Run that command with the user's own Grok sign-in. It uses their Grok quota. The still opens and closes the clip, so it loops. An unknown outcome is recovered with `npm run sprite -- video-resume` from the report; never send it again.
3. Show the clip. Bring it into an export with `addClips` (`--add-clip <clip.mp4>`) into a new output folder.
