#!/usr/bin/env python3
"""Side models (2026-11-07, prototype, opt-in): a local answer to the side judge's `side` check — "the character is seen from the side and
faces right" (generation-prompts.mjs sideJudgePrompt) — which the pixel judge (motions.py pixel_judge_side, pixels-v1) always leaves
"unknown", so hybrid asks codex on nearly every side take.

It runs in its own venv with onnxruntime (never the kit's sprite-gen venv; `setup` makes the venv and fetches the pinned weights, sha256
checked), on CPU:
  - WD14 tagger v3 SwinV2 (SmilingWolf/wd-swinv2-tagger-v3, Apache-2.0): the tags `profile`, `from_side`, `looking_at_viewer` and
    `from_behind` on the whole figure (`facing_viewer` is read too but stayed 0.00 on every front). There is no three-quarter tag.
  - deepghs anime head and face detectors, nano (deepghs/anime_head_detection head_detect_v2.0_n, deepghs/anime_face_detection
    face_detect_v1.4_n, MIT): where the face box sits inside the head box. A face turned to the viewer's right sits right of the head's
    centre (dx > 0), a front view on it, a face turned left left of it.
It answers pass or fail only when its signals are confident and agree, and "unknown" otherwise (codex still decides). See
docs/research/SIDE-MODELS-2026-11-07.md for what it was measured on and why it is not wired into hybrid.

  side_models.py setup <dir> [--python <bootstrap python>]   make <dir>/venv and <dir>/weights (needs the network once)
  side_models.py side <front> <take> <out.json>              the side answer: {kind, model, side, notes, measures}
  side_models.py pixel-judge side|loop <a> <b> <out.json>    motions.py's pixel judge with `side` settled here (judge-eval --judge)
  side_models.py signals <take>                              what the models see, as JSON (no decision)
  side_models.py decide <signals.json>                       the rule alone on recorded signals (no models; for tests)

The weights folder is ODDBOUT_SIDE_MODELS (default: `side-models/weights` beside the host root's bin, else beside this file).
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
SIDE_MODEL = "side-models-v1"
# What the weights are, pinned to a revision and a hash: the model name below carries them, so the judge key changes with any of them.
WEIGHTS = (
    {"name": "wd14", "repo": "SmilingWolf/wd-swinv2-tagger-v3", "revision": "627aef95638667ddcaa3ac8ae625e88ea5b02f51", "license": "Apache-2.0",
     "files": {"model.onnx": "e6774bff34d43bd49f75a47db4ef217dce701c9847b546523eb85ff6dbba1db1",
               "selected_tags.csv": "298633d94d0031d2081c0893f29c82eab7f0df00b08483ba8f29d1e979441217"}},
    {"name": "head", "repo": "deepghs/anime_head_detection", "revision": "06604feee81983792a57c21081e539c0ae229833", "license": "MIT",
     "files": {"head_detect_v2.0_n/model.onnx": "69b069d15c9b97e0d7e6db33ac1c3fd480b1be67b078922c29beacfac81ad9ac",
               "head_detect_v2.0_n/threshold.json": "f8d934097606a7b241289703bdeca6d106b23e79c2bad278da966740ef4828ca"}},
    {"name": "face", "repo": "deepghs/anime_face_detection", "revision": "784dc4c0bb692351ddcdbe6131a050b17d3025d5", "license": "MIT",
     "files": {"face_detect_v1.4_n/model.onnx": "fd860b650a4377046842c3cd80d01b0b408bdfbdb4acee5759630f82c6ef04a9",
               "face_detect_v1.4_n/threshold.json": "d53e35441fc92c5c8931c855ea2d0d9fe2597ac1ab0183017f8cec9992d0eab8"}},
)
# The versions the venv gets (setup); the answer names the onnxruntime that ran.
PACKAGES = ("onnxruntime==1.23.2", "numpy==2.2.6", "pillow==12.3.0")

TAGS = ("profile", "from_side", "facing_viewer", "looking_at_viewer", "from_behind", "looking_to_the_side", "facing_away")
WD14_SIZE = 448
DETECT_SIZE = 640          # the detectors' longest side (imgutils' default), both sides a multiple of 32
NMS_IOU = 0.7

# The rule (uncalibrated: set on 11 real side takes, their mirrors and 8 fronts, 2026-11-07; see the record). A face is confident when
# the head and a face inside it were found above these scores; dx is the face box's centre right of the head box's, in head widths.
RULE = {
    "head": 0.5, "face": 0.5,
    "dx_turned": 0.06,      # |dx| from this the face is turned to one side (fronts 0.009-0.029, takes 0.083-0.27 either way)
    "dx_front": 0.05,       # |dx| under this the face is on the head's centre: a front view
    "side_tag": 0.30,       # profile or from_side from this: the tagger sees a side view (takes 0.16-0.62, fronts 0.00)
    "no_side_tag": 0.10,    # and under this it sees none
    "front_tag": 0.5,       # looking_at_viewer from this (fronts 0.60-0.86; facing_viewer stayed 0.00 on every front)
    "behind_tag": 0.5,      # from_behind from this: the back, never a pass
}
# The answer's model: the tier's version and a hash of what decides its answers (weights, packages, rule), short enough for the judge's
# record (generation-prompts.mjs checkedPixels keeps 40 characters of a model; with the pixel judge's name in front it stays under). Any
# change to a weight, a package or a threshold makes a new name, so a judge key built from it changes with it. The revisions are in
# the measures (`weights`).
MODEL_NAME = f"{SIDE_MODEL}-" + hashlib.sha256(json.dumps([WEIGHTS, PACKAGES, RULE], sort_keys=True).encode()).hexdigest()[:6]


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def weights_dir() -> Path:
    if os.environ.get("ODDBOUT_SIDE_MODELS"):
        return Path(os.environ["ODDBOUT_SIDE_MODELS"])
    for candidate in (HERE.parent / "side-models" / "weights", HERE / "side-models" / "weights"):
        if candidate.is_dir():
            return candidate
    return HERE.parent / "side-models" / "weights"


def weight(entry: dict, name: str) -> Path:
    return weights_dir() / entry["repo"].replace("/", "__") / name


def verify(root: Path | None = None) -> list[str]:
    """The weight files missing or with another hash than pinned (empty: all there)."""
    bad = []
    for entry in WEIGHTS:
        for name, digest in entry["files"].items():
            path = (root or weights_dir()) / entry["repo"].replace("/", "__") / name
            if not path.is_file() or _sha256(path) != digest:
                bad.append(f"{entry['repo']}/{name}")
    return bad


# ------------------------------------------------------------------------------------------------ the rule (no models)

def decide(s: dict) -> tuple[str, list[str]]:
    """pass, fail or unknown from the signals (`tags` scores, `head`/`face` scores, `dx`), with the reasons. Pure: tests run it without
    onnxruntime. A fail needs one strong reason (the face turned left, a front view, the back); a pass needs the face turned right AND the
    tagger seeing a side view. Anything else, or signals that disagree, is unknown."""
    r, tags = RULE, s.get("tags", {})
    side_tag = max(tags.get("profile", 0.0), tags.get("from_side", 0.0))
    face_ok = s.get("head", 0.0) >= r["head"] and s.get("face", 0.0) >= r["face"] and s.get("dx") is not None
    dx = s.get("dx") if face_ok else None
    why = [f"side tag {side_tag:.2f} (profile {tags.get('profile', 0):.2f}, from_side {tags.get('from_side', 0):.2f}), "
           f"looking_at_viewer {tags.get('looking_at_viewer', 0):.2f}, from_behind {tags.get('from_behind', 0):.2f}",
           f"face dx {dx:+.2f} head widths" if dx is not None else
           f"no confident face in a head (head {s.get('head', 0):.2f}, face {s.get('face', 0):.2f})"]
    if tags.get("from_behind", 0.0) >= r["behind_tag"]:
        return "fail", why + ["seen from behind"]
    if dx is not None and dx <= -r["dx_turned"]:
        return "fail", why + ["the face is turned to the left"]
    if dx is not None and abs(dx) < r["dx_front"] and tags.get("looking_at_viewer", 0.0) >= r["front_tag"] and side_tag < r["no_side_tag"]:
        return "fail", why + ["a front view: the face on the head's centre and the tagger sees it facing the viewer"]
    if dx is not None and dx >= r["dx_turned"] and side_tag >= r["side_tag"]:
        return "pass", why + ["the face turned to the right and the tagger sees a side view"]
    return "unknown", why + ["not confident: left to codex"]


# ------------------------------------------------------------------------------------------------ the models

_SESSIONS: dict = {}


def _session(path: Path):
    import onnxruntime as ort  # the side-models venv only
    key = str(path)
    if key not in _SESSIONS:
        options = ort.SessionOptions()
        options.log_severity_level = 3
        _SESSIONS[key] = ort.InferenceSession(key, options, providers=["CPUExecutionProvider"])
    return _SESSIONS[key]


def _on_white(path: Path):
    from PIL import Image
    image = Image.open(path)
    if image.mode != "RGBA":
        image = image.convert("RGBA")
    white = Image.new("RGBA", image.size, (255, 255, 255, 255))
    white.alpha_composite(image)
    return white.convert("RGB")


def _tags(image) -> dict:
    import numpy as np
    from PIL import Image
    entry = WEIGHTS[0]
    names = [line.split(",")[1] for line in weight(entry, "selected_tags.csv").read_text(encoding="utf-8").splitlines()[1:]]
    w, h = image.size
    side = max(w, h)
    square = Image.new("RGB", (side, side), (255, 255, 255))
    square.paste(image, ((side - w) // 2, (side - h) // 2))
    x = np.asarray(square.resize((WD14_SIZE, WD14_SIZE), Image.BICUBIC), dtype=np.float32)[:, :, ::-1]  # BGR, 0-255, NHWC
    session = _session(weight(entry, "model.onnx"))
    scores = session.run(None, {session.get_inputs()[0].name: np.ascontiguousarray(x[None])})[0][0]
    return {tag: round(float(scores[names.index(tag)]), 4) for tag in TAGS}


def _boxes(image, entry: dict, folder: str) -> list[tuple[float, float, float, float, float]]:
    """Boxes (x0, y0, x1, y1 in the picture's pixels, score) above the model's own threshold, best first, after NMS."""
    import numpy as np
    from PIL import Image
    threshold = json.loads(weight(entry, f"{folder}/threshold.json").read_text())["threshold"]
    w, h = image.size
    ratio = DETECT_SIZE / max(w, h)
    W, H = max(32, int(round(w * ratio / 32)) * 32), max(32, int(round(h * ratio / 32)) * 32)
    x = np.asarray(image.resize((W, H), Image.BILINEAR), dtype=np.float32).transpose(2, 0, 1)[None] / 255.0
    session = _session(weight(entry, f"{folder}/model.onnx"))
    out = session.run(None, {session.get_inputs()[0].name: x})[0][0]
    if out.shape[0] < out.shape[1]:
        out = out.T
    out = out[out[:, 4] >= threshold]
    out = out[np.argsort(-out[:, 4])]
    kept = []
    for cx, cy, bw, bh, score in out[:, :5]:
        box = (float((cx - bw / 2) * w / W), float((cy - bh / 2) * h / H), float((cx + bw / 2) * w / W), float((cy + bh / 2) * h / H), float(score))
        if all(_iou(box, k) < NMS_IOU for k in kept):
            kept.append(box)
    return kept


def _iou(a, b) -> float:
    ix = max(0.0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0.0, min(a[3], b[3]) - max(a[1], b[1]))
    inter = ix * iy
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / union if union > 0 else 0.0


def signals(take: Path) -> dict:
    """What the models see in a take: tag scores, the best head and the best face inside it, dx (face centre right of head centre, in head
    widths) and the face's width against the head's."""
    image = _on_white(take)
    started = time.perf_counter()
    tags = _tags(image)
    tagged = time.perf_counter()
    heads = _boxes(image, WEIGHTS[1], "head_detect_v2.0_n")
    faces = _boxes(image, WEIGHTS[2], "face_detect_v1.4_n")
    detected = time.perf_counter()
    s = {"tags": tags, "heads": len(heads), "faces": len(faces), "head": 0.0, "face": 0.0, "dx": None, "faceWidth": None}
    if heads:
        head = heads[0]
        inside = [f for f in faces if head[0] <= (f[0] + f[2]) / 2 <= head[2] and head[1] <= (f[1] + f[3]) / 2 <= head[3]]
        s["head"] = round(head[4], 4)
        if inside:
            face = inside[0]
            hw = head[2] - head[0]
            s["face"] = round(face[4], 4)
            s["dx"] = round(float(((face[0] + face[2]) / 2 - (head[0] + head[2]) / 2) / hw), 4)
            s["faceWidth"] = round(float((face[2] - face[0]) / hw), 4)
    s["ms"] = {"tagger": round((tagged - started) * 1000), "detectors": round((detected - tagged) * 1000)}
    return s


def side_answer(front: Path, take: Path) -> dict:
    started = time.perf_counter()
    import onnxruntime
    s = signals(take)
    state, why = decide(s)
    s["ms"]["all"] = round((time.perf_counter() - started) * 1000)
    s["onnxruntime"] = onnxruntime.__version__
    s["weights"] = {entry["name"]: f"{entry['repo']}@{entry['revision'][:7]}" for entry in WEIGHTS}
    return {"kind": "side-models", "model": MODEL_NAME, "side": state, "notes": f"side ({SIDE_MODEL}): {state}; " + "; ".join(why) + ".",
            "measures": s}


def pixel_judge(kind: str, args: list[str]) -> dict:
    """motions.py's pixel judge (the same file, imported), with the side take's `side` from the models: the answer names both models."""
    sys.path.insert(0, str(HERE))
    import motions  # noqa: E402 — host/motions.py needs only NumPy and Pillow, which this venv has
    answer = motions.pixel_judge(kind, args)
    if kind != "side":
        return answer
    models = side_answer(Path(args[0]), Path(args[1]))
    answer["model"] = f"{answer['model']}+{models['model']}"
    answer["checks"]["side"] = models["side"]
    # The pixel judge's own side note ("not judged by pixels", with its numbers) gives way to the models' answer.
    notes = re.sub(r"side: not judged by pixels \([^)]*\)\.\s*", "", answer["notes"]).strip()
    answer["notes"] = motions._pj_notes([notes, models["notes"]])
    answer["measures"]["sideModels"] = models["measures"]
    return answer


# ------------------------------------------------------------------------------------------------ setup

def setup(target: Path, python: str) -> None:
    """<target>/venv with PACKAGES, and <target>/weights with WEIGHTS fetched from their pinned revisions and checked."""
    import subprocess
    import urllib.request
    venv = target / "venv"
    if not venv.exists():
        subprocess.run([python, "-m", "venv", str(venv)], check=True)
    py = venv / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    subprocess.run([str(py), "-m", "pip", "install", "--disable-pip-version-check", "-q", *PACKAGES], check=True)
    weights = target / "weights"
    for entry in WEIGHTS:
        for name, digest in entry["files"].items():
            path = weights / entry["repo"].replace("/", "__") / name
            if path.is_file() and _sha256(path) == digest:
                continue
            path.parent.mkdir(parents=True, exist_ok=True)
            part = path.with_name(path.name + ".part")
            url = f"https://huggingface.co/{entry['repo']}/resolve/{entry['revision']}/{name}"
            with urllib.request.urlopen(url) as response, open(part, "wb") as f:
                while chunk := response.read(1 << 20):
                    f.write(chunk)
            if _sha256(part) != digest:
                part.unlink()
                raise SystemExit(f"side-models: {entry['repo']}/{name} does not have the pinned sha256")
            part.replace(path)
    print(json.dumps({"venv": str(py), "weights": str(weights), "model": MODEL_NAME}))


def main(argv: list[str]) -> int:
    if not argv:
        print(__doc__)
        return 2
    command, *rest = argv
    if command == "setup" and rest:
        python = rest[rest.index("--python") + 1] if "--python" in rest else sys.executable
        setup(Path(rest[0]), python)
    elif command == "side" and len(rest) == 3:
        Path(rest[2]).write_text(json.dumps(side_answer(Path(rest[0]), Path(rest[1]))) + "\n")
    elif command == "pixel-judge" and len(rest) == 4:
        Path(rest[3]).write_text(json.dumps(pixel_judge(rest[0], rest[1:3])) + "\n")
    elif command == "decide" and len(rest) == 1:
        state, why = decide(json.loads(Path(rest[0]).read_text()))
        print(json.dumps({"side": state, "why": why}))
    elif command == "signals" and len(rest) == 1:
        print(json.dumps(signals(Path(rest[0]))))
    else:
        print(__doc__)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
