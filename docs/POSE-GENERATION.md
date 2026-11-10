# Pose generation for new motion frames

Use this when an image model paints new frames for a fighter. Packaging still follows [AUTHORING.md](AUTHORING.md). This page does not authorize generation by itself.

## What to generate

Motion frames are a **right-facing side view only**. The contract fixes `appearance.sourceFacing` to `right` and `appearance.leftFacing` to `mirror`. The game flips that side for the other direction. A front-facing frame does not belong in a motion sheet.

Keep the figure at the package scale: `appearance.bodyHeight` is **400**. Do not invent a new height per clip. Cell size may differ from 400; the body in the frame should stay at that height. `pixelScale` is a later fit of an oversized sheet, not a prompt to draw the figure at another size.

Every generation carries the spec's colouring text and attaches the house style anchor as the **last** reference:

`https://oddbout.com/art/oddbout/style-anchor-front.webp`

The anchor is the house's plain cel colouring. It is a front view used for colour, not a pose to copy. This repository also keeps a copy at `host/style-anchor-front.webp` for offline inspection. Attach the URL above as the last reference when the image tool accepts a URL.

## Checklist before the frame is kept

Look at the actual image, not only the prompt.

- The body faces right. Eyes, chest and hips are in profile. A frame that turns toward the viewer is a miss.
- No extra props. A stray microphone, a second tie, a doubled weapon or a leftover from the reference does not belong unless the user asked for it.
- Scale matches the chosen front and the other clips. The head, shoulders and soles should not jump between frames or between clips.
- The same clothes, colours and body. The style anchor is last so it colours the figure; it should not replace the character.
- Feet and hands are complete. A cropped sole or a melted hand is a miss even when the sheet later passes file checks.

## Landmarks that borrow another clip

`dash` windup and recover, and `fall` get-up cells, may name `{ "clip", "frame" }` on another clip. The frame number is that clip's image frame, not a playback step. If the source clip is later replaced, the number can stay in range and validation still passes, while this pose silently changes.

Prefer a frame of the clip itself (`{ "clip": "dash", "frame": <n> }` for a dash pose). `npm run validate` and `validate_fighter_package` add `warnings` with code `BORROWED_LANDMARK` and, when the source asset is known, `sourceSha256`. The warning does not fail `ok` and does not block registration. If the borrow stays, keep that hash and look again after the source clip changes.

## What `inspect-motion` `needs-review` means

`inspect-motion` (sprite-gen) can measure foot contact for a gait when it is given both manual contacts and a single-foot region. Without that region it reports that ground contact is unknown and the verdict is `needs-review`.

That verdict is expected on action clips (combo, slam, dash, block, hit, groggy, fall, and the optional skill, entrance and victory clips). Those sheets are not walked with a foot region. Read the frame count, the edges and any duplicate frames. Do not treat `needs-review` as a packaging or registration failure, and do not regenerate a clip only to clear it.

Walk and run are the clips where foot contact is optional later quality work (`docs/GAIT-REVIEW.md`). A missing foot measurement there is also not a gate. The user still chooses the motion by watching it.
