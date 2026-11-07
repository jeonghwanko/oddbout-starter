# Side models for the side take's `side` check — 2026-11-07

**Do not wire the pass into hybrid yet.** On the 10 real side takes available, the tier made no wrong calls and settled
8 of them, which would cut hybrid's codex calls on those takes from 10 to 2. But every head in that set is a profile or a
near-profile. The set has no three-quarter head, which is the case codex failed twice in the 2026-11-05 probe, so the tier's
behaviour there is unmeasured. Its thresholds were also placed after looking at these same signals: the agreement below is
in-sample. Measure again on an archive with pictures before turning it on.

## The question

The side judge asks codex five checks; `side` is "the character is seen from the side and faces right"
(`host/generation-stages.mjs` `sideJudgePrompt`). The pixel judge (`host/motions.py` `pixel_judge_side`, `pixels-v1`)
always answers `side: unknown`. So in hybrid mode codex is asked on nearly every side take (10 of the 10 here), at
10–15 s a call.

## What was built

`host/side_models.py` is an opt-in tier in its own venv (onnxruntime, NumPy, Pillow; never the kit's sprite-gen venv). It is
not wired into the worker. On CPU it runs:

| Model | Licence | What is read |
| --- | --- | --- |
| WD14 tagger v3 SwinV2 (`SmilingWolf/wd-swinv2-tagger-v3` @627aef9, 467 MB) | Apache-2.0 | `profile`, `from_side`, `looking_at_viewer`, `from_behind` |
| deepghs anime head detector, nano (`head_detect_v2.0_n` @06604fe, 12 MB) | MIT | the head box |
| deepghs anime face detector, nano (`face_detect_v1.4_n` @784dc4c, 12 MB) | MIT | the face box inside the head box |

`dx` is the face box's centre right of the head box's centre, in head widths. The rule (`decide`) works as follows:

- **fail:** `from_behind` ≥ 0.5; or the face turned left (`dx` ≤ −0.06); or a front view (`|dx|` < 0.05,
  `looking_at_viewer` ≥ 0.5 and the larger of `profile`/`from_side` under 0.10).
- **pass:** the face turned right (`dx` ≥ 0.06) and the tagger sees a side view (the larger of `profile`/`from_side` ≥ 0.30).
- **unknown:** anything else, including no confident head and face (scores under 0.5).

The `pixel-judge` command has `motions.py`'s signature. It runs the same pixel judge (imported) and replaces `side` with
the models' answer. Its model is `pixels-v1+side-models-v1-<hash>`, where the hash covers the weights, the packages and the
rule, so a judge key built from it changes with any of them (`host/side-models.test.mjs`). Wiring it in would mean setting
`PIXEL_JUDGE.model` to that name. `setup <dir>` makes the venv and fetches the weights from their pinned revisions, each
checked against its sha256.

`npm run judge:eval -- <archive> --rerun --python <side-models venv python> --judge host/side_models.py` reruns an archive's
pictures through it.

## Data

There is no judgment archive yet. PR #378 merged today, and office-stable has no `judge-archive` folder. Its user install's
worker.env has no `ODDBOUT_GENERATION_JUDGE_IMAGES` (the service install's worker.env was not readable from this account). The 2026-11-05 probe takes could not be found: nothing records their host or folder, and office-stable has no job
folder from that day.

The measurement used every judged side take on office-stable (`/srv/oddbout-gen/kit/output`, jobs 2026-10-31 to 11-06):

- **11 takes, 10 distinct pictures.** `20261101-d242-retest` reused the d242 take, and is counted once below.
- **Codex `side` verdicts:** 9 pass and 1 fail. The fail is a raccoon facing **left** ("faces left instead of right"), not a
  three-quarter view. With a single fail, agreement on `side` fails cannot be measured yet.
- **The take PNGs the judges read are readable by the service user only.** The group-readable raw pictures
  (`take-N.png.raw.png`, before the matte, on a flat magenta ground) were keyed to transparency here and used instead. This
  is close to, but not byte-identical with, what the worker would judge.
- **Two built sets, labels known by construction, never judged by codex:**
  - the 10 takes mirrored, so they face left (expected fail, or pass for the mirrored raccoon);
  - the 7 distinct fronts (expected fail: a front is not a side view).
- **Head crops, viewed by eye:** every take's head is a profile or near-profile (one eye, the nose on the outline), even where
  the body turns slightly toward the viewer.

## Results

| Set (distinct pictures) | n | decided | agree | wrong |
| --- | --- | --- | --- | --- |
| Real takes vs codex `side` | 10 | 8 (7 pass, 1 fail) | 8 | 0 |
| Mirrored takes | 10 | 9 | 9 | 0 |
| Fronts | 7 | 6 | 6 | 0 |

- **Unknowns:** the potato mascot (no head found, in all three sets), and the boxer take (`dx` +0.09, but `profile` 0.16 and
  `from_side` 0.12).
- **Detectors only:** the same rule with the tagger dropped (pass on `dx` ≥ 0.06) also made no wrong calls and settled 9 of
  10 real takes. It costs a fraction of the time. On this set the tagger only kept the boxer at `unknown`. Whether it catches
  a three-quarter head the detectors would pass is exactly what is unmeasured.
- **Separation, in-sample:** `|dx|` was 0.009–0.029 on fronts and 0.083–0.27 on every take with a face, in either direction.
  The tagger's `facing_viewer` stayed 0.00 on every front, so `looking_at_viewer` (0.60–0.86) is used instead. `profile`
  never rose above 0.31, even on these profile heads.
- **Hybrid:** with `side` settled, the pixel judge's other checks left only 2 of the 10 takes open (the potato: `match`
  unknown too; the boxer: `side`). Hybrid would ask codex on 2 takes instead of 10.

## Time (CPU only)

The machine was an Intel Core Ultra 7 155H laptop, with about 43 % of its CPU busy with unrelated work throughout. Treat
these times as upper bounds.

| Per take, a fresh process (as the worker calls it) | p50 | p95 | range |
| --- | --- | --- | --- |
| Whole call, Python start included | 9.1 s | 11.6 s | 6.0–12.1 s |
| Models in the process (load and run) | 7.7 s | 9.8 s | 4.7–9.9 s |
| pixels-v1 inside it | 0.35 s | 0.60 s | |

- **Loading:** the tagger takes 1.4 s, each detector 0.2 s.
- **A session's first inference is slow** (about 3 s for the head detector). The next runs took 0.15–0.5 s per detector.
- **Tagger, warm:** 0.46–0.53 s with free cores, 2.5–4 s under the contention above.
- **A resident process** (as the hosts already keep for RIFE) would bring a take to about a second plus the pixel judge.
  Spawned per take, the tier costs more than half of the codex call it replaces.

## Recommendation

1. **Keep the pass out of hybrid** until it has been measured on three-quarter takes, under codex's own verdicts and labels.
   A right-facing three-quarter head is likely to get `dx` > 0.06 and a moderate `from_side`, so this rule would pass it,
   where codex failed such takes in the probe.
2. **Collect the set:** an operator turns on `ODDBOUT_GENERATION_JUDGE_IMAGES` on a host (it copies requester pictures;
   that is their decision). Rerun with `judge:eval --rerun --judge host/side_models.py`, and label the disagreements first.
   That also puts the matted take PNGs, rather than keyed raws, under the measurement.
3. **A fail-only first step is the part the data supports:** the face turned left, a front, or the back. All of it was
   right here, including the one real codex `side` fail. But it is rare (1 in 10 takes), and in hybrid a pixel fail is
   final and buys a paid redraw. Turn it on only with the archive watching it.
4. **Before any wiring:** run the tier as a resident process, and decide between the full rule and detectors only on the
   new set.
