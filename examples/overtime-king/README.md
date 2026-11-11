# Overtime King Mr. Park: a real fighter package

A complete ODDBOUT fighter, exactly as it is registered: [`fighter.json`](fighter.json) and 14 sprite sheets in
[`assets/`](assets). Use it to see what a package that passes looks like, whatever tool you draw with. You do not need
ODDBOUT's generation tools: a package that follows the format below validates, uploads and plays.

The artwork is licensed separately from the code: see [LICENSE.md](LICENSE.md) (CC BY 4.0, credit ODDBOUT).

The format's source of truth is the contract, not this page. This page shows where each rule appears in the example.

| You want | Read |
| --- | --- |
| Every field, limit and enum, machine-readable | [`contracts/ai-fighter/v1/spec.json`](../../contracts/ai-fighter/v1/spec.json) |
| The JSON Schema of `fighter.json` | [`contracts/ai-fighter/v1/fighter.schema.json`](../../contracts/ai-fighter/v1/fighter.schema.json) |
| Optional clips, skills and fighting style | [`contracts/ai-fighter/v1/README.md`](../../contracts/ai-fighter/v1/README.md) |
| The rules in prose (Korean) | [`docs/AUTHORING.md`](../../docs/AUTHORING.md) |

## What is in a package

```text
overtime-king/
  fighter.json        the manifest: profile, combat, appearance, assets, clips
  assets/<id>.webp    one sprite sheet per clip
```

`fighter.json` has eight top-level fields: `schemaVersion`, `specVersion`, `localId`, `profile`, `combat`,
`appearance`, `assets` and `clips`.

## Who the fighter is

Besides the pictures, `fighter.json` must say these. The rest of `profile` and `combat` is optional.

| Field | Rule | In this example |
| --- | --- | --- |
| `localId` | Your own id for the package: lower-case letters, digits and hyphens, starting with a letter | `gen-e78385c7` |
| `profile.name` | Up to 40 characters | `야근왕 박과장` |
| `profile.description` | Up to 600 characters | one sentence |
| `profile.portrait`, `profile.preview` | `{ "assetId", "crop": { "x", "y", "width", "height" } }`: a rectangle of a sheet, in pixels of the **whole sheet**, not of a cell. It must lie inside the sheet and show something | both cut from `idle` |
| `combat.kitId` | `standard-duel` | `standard-duel` |
| `combat.stats` (optional) | `power`, `toughness`, `speed`, 1–5 each, adding up to 9 | 3, 4, 2 |

You do not submit hit points, damage, reach or code: the game's own rules set those.

## Drawing rules

- **One sheet per clip, static WebP with an alpha channel.** The background is transparent. An animated WebP is refused.
- **A grid of equal cells.** The sheet is `frameWidth × columns` wide and `frameHeight × rows` tall. Frames are numbered
  from 0, top row first, left to right. Unused cells at the end stay empty. Here `walk` is 22 frames of 330 × 419 in an
  8 × 3 grid: a 2640 × 1257 sheet.
- **Side view, facing right.** The game mirrors the sheet for the left, so lettering and one-sided marks flip too.
- **One scale for every clip: a standing body 400 pixels tall** (`appearance.bodyHeight`). A cell may be taller or
  wider than the body (a raised arm, a lunge), but the body is not redrawn at another size from clip to clip.
- **The same character in every clip**: body shape, outfit and colours.

## Where the body stands

Each frame has an entry in `origins`, in pixels from the cell's top-left corner:

```json
{ "originX": 85, "originY": 408, "groundContacts": [{ "x": 71.5, "y": 408, "rx": 30.5, "ry": 4 }] }
```

`originX`, `originY` is the point of the cell the game puts on the fighter's spot on the floor. Measure it so the feet
do not jump when the cell size changes between clips. `groundContacts` holds up to two ellipses where the body touches
the ground (centre `x`, `y`, radii `rx`, `ry`); a frame in the air has an empty list.

## Timing

- `idle`, `walk` and `run` carry one `durationMs`: the time of **one frame**. A cycle is `durationMs × frames`.
  `walk` also needs `stridePixels`, a number from 1 to 1600.
- Every other clip carries a `sequence` of `{ "frame", "durationMs" }` steps. A step may repeat a frame.
- `hitSequenceIndices` marks the steps where a blow lands. They are **step numbers in `sequence`, not frame numbers**.
- `landmarks` names other steps the game needs (see the table). They are step numbers too, except a `{ "clip", "frame" }`
  pair, which points at a frame.

## The eleven required clips

| Clip | What to draw | Frames and marks | In this example |
| --- | --- | --- | --- |
| `idle` | Standing still | 1 frame | 1 |
| `walk` | One walk cycle, feet taking turns | 12–32 frames, `stridePixels` | 22 |
| `run` | One run cycle | 10–16 frames | 16 |
| `fightIdle` | Ready stance, looping | no contact | 2 |
| `combo` | A string of blows | 3–8 contacts, `landmarks.spinStart` | 16 frames, 3 contacts |
| `slam` | One heavy blow | 1 contact | 10 |
| `dash` | A charge | 0–1 contact, `landmarks.windup`, `recover` | 11 |
| `block` | Guard and block | 1 contact | 6 |
| `hit` | Taking a blow | 1 contact, `landmarks.recoil`, `stagger`, `recover` | 4 |
| `groggy` | Dazed, looping | no contact | 2 |
| `fall` | Knocked down | 1 contact, `landmarks.lieSequenceIndex`, `getUp` | 9 |

This example also carries the three optional clips, `entrance`, `victory` and `skill`
([contract README](../../contracts/ai-fighter/v1/README.md#optional-clips)).

## Limits

From `spec.json` `limits`; the validator enforces them.

| Limit | Value |
| --- | --- |
| A cell | 1024 × 1024 pixels at most, in a grid of at most 8 × 8 |
| A sheet | 4096 pixels on its longest side, 16,777,216 pixels, 4,000,000 bytes |
| The package | 16 sheets, 10,000,000 bytes, 33,554,432 pixels |
| `fighter.json` | 262,144 bytes |
| A clip's playing time | 10,000 ms |

## The asset list

Every sheet is declared in `assets` with its size and hash, and the validator compares them with the file:

```json
{ "id": "idle", "path": "assets/idle.webp", "mediaType": "image/webp", "sha256": "8728db5a…", "bytes": 15594, "width": 159, "height": 416 }
```

`sha256sum assets/idle.webp` (or `certutil -hashfile assets\idle.webp SHA256` on Windows) gives the hash. Change a
file and its `sha256` and `bytes` change with it.

## Check a package

```sh
npm ci --ignore-scripts
npm run validate -- examples/overtime-king/fighter.json
```

It reads the JSON, the schema and the cross-references, then every file's bytes, hash and pixels, and generates
nothing. `"ok": true` means the files follow the format. It does not judge how the animation looks: `pending` lists the
stages that come after (preview in the game, review, registration). The
[site guide](https://oddbout.com/docs.html?lang=en#bring-your-own) has a checker that runs in a browser, with no sign-in.

## Upload it

On [My fighters](https://oddbout.com/creator.html?lang=en) choose New fighter → Other ways → Upload a finished package.
From this checkout, `npm run fighter:register -- --dir <package>` is a dry run that needs no sign-in, and `--submit`
sends it with your own account.

**Do not upload this example as your fighter.** It is here to read and to test tools against. Make your own character.
