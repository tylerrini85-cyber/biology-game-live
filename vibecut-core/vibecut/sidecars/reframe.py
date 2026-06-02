"""Subject-tracking auto-reframe (#11).

Tracks the speaker across the shot (MediaPipe) and emits a smoothed crop path
so vertical/square reframes FOLLOW the subject instead of a static center crop.

Needs (on the user's machine):  pip install mediapipe opencv-python
The pure helpers (smoothing, crop-path, ffmpeg expression) need nothing and are
unit-tested; only `track_subject` needs MediaPipe + OpenCV.

CLI:  python -m vibecut.sidecars.reframe --video clip.mp4 --aspect 9:16 --out reframe.json
"""
from __future__ import annotations

import argparse
import json

ASPECT_WH = {"9:16": (9, 16), "1:1": (1, 1), "4:5": (4, 5), "16:9": (16, 9)}


def track_subject(video_path: str, sample_fps: float = 6.0):
    """Return [(t_seconds, cx, cy)] with the subject center normalized 0..1.

    Uses MediaPipe face detection, falling back to pose. Lazy imports so the
    module loads without the heavy deps installed.
    """
    try:
        import cv2  # noqa: F401
        import mediapipe as mp
    except ImportError as exc:  # pragma: no cover - needs deps
        raise SystemExit("reframe needs MediaPipe + OpenCV:  pip install mediapipe opencv-python\n"
                         f"(import failed: {exc})")
    import cv2
    cap = cv2.VideoCapture(video_path)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    step = max(1, int(round(fps / sample_fps)))
    det = mp.solutions.face_detection.FaceDetection(model_selection=1, min_detection_confidence=0.4)
    track, idx = [], 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        if idx % step == 0:
            res = det.process(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
            if res.detections:
                box = res.detections[0].location_data.relative_bounding_box
                cx = min(max(box.xmin + box.width / 2, 0.0), 1.0)
                cy = min(max(box.ymin + box.height / 2, 0.0), 1.0)
                track.append((round(idx / fps, 3), round(cx, 4), round(cy, 4)))
        idx += 1
    cap.release()
    return track


# ---- pure helpers (no deps; unit-tested) ----------------------------------

def ema_smooth(track: list, alpha: float = 0.25) -> list:
    """Exponential-moving-average smoothing of the (cx, cy) path."""
    if not track:
        return []
    out = [track[0]]
    px, py = track[0][1], track[0][2]
    for t, cx, cy in track[1:]:
        px = alpha * cx + (1 - alpha) * px
        py = alpha * cy + (1 - alpha) * py
        out.append((t, round(px, 4), round(py, 4)))
    return out


def crop_path(track: list, src_w: int, src_h: int, aspect: str) -> list:
    """Turn the subject path into [(t, crop_x, crop_y, crop_w, crop_h)] for a
    centered-on-subject crop of the target aspect, clamped to the frame."""
    aw, ah = ASPECT_WH.get(aspect, (9, 16))
    # largest crop of target aspect that fits in the source
    if src_w / src_h > aw / ah:
        crop_h = src_h
        crop_w = int(round(src_h * aw / ah))
    else:
        crop_w = src_w
        crop_h = int(round(src_w * ah / aw))
    out = []
    for t, cx, cy in track:
        x = int(round(cx * src_w - crop_w / 2))
        y = int(round(cy * src_h - crop_h / 2))
        x = max(0, min(src_w - crop_w, x))
        y = max(0, min(src_h - crop_h, y))
        out.append((t, x, y, crop_w, crop_h))
    return out


def ffmpeg_crop_expr(path: list, src_w: int, src_h: int) -> str:
    """Build a single ffmpeg `crop` filter whose x/y follow the path over time
    (piecewise-constant per sample via nested if(lt(t,..))). Scale-to-output is
    applied separately by the renderer."""
    if not path:
        return "crop=iw:ih"
    _, _, _, cw, ch = path[0]
    # build x and y expressions: pick the sample whose time is the largest <= t
    def expr(axis_idx):
        e = str(path[-1][axis_idx])
        for t, x, y, _, _ in reversed(path[:-1]):
            v = x if axis_idx == 1 else y
            e = f"if(lt(t,{t:.3f}),{v},{e})"
        return e
    return f"crop={cw}:{ch}:x='{expr(1)}':y='{expr(2)}'"


def analyze(video_path: str, aspect: str = "9:16") -> dict:
    """Track the subject, smooth, and return the reframe dict (path + ffmpeg
    crop expression), reading source dimensions from the video (needs OpenCV)."""
    import cv2
    track = ema_smooth(track_subject(video_path))
    cap = cv2.VideoCapture(video_path)
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)) or 1920
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)) or 1080
    cap.release()
    path = crop_path(track, w, h, aspect)
    return {"aspect": aspect, "path": path, "ffmpeg_crop": ffmpeg_crop_expr(path, w, h)}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="vibecut.sidecars.reframe")
    ap.add_argument("--video", required=True)
    ap.add_argument("--aspect", default="9:16", choices=list(ASPECT_WH))
    ap.add_argument("--width", type=int, default=1920)
    ap.add_argument("--height", type=int, default=1080)
    ap.add_argument("--out", default="reframe.json")
    args = ap.parse_args(argv)
    track = ema_smooth(track_subject(args.video))
    path = crop_path(track, args.width, args.height, args.aspect)
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump({"aspect": args.aspect, "path": path,
                   "ffmpeg_crop": ffmpeg_crop_expr(path, args.width, args.height)}, fh, indent=2)
    print(f"wrote {args.out}: {len(path)} keyframes")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
