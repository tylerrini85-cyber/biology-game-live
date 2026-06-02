"""Local-AI sidecars (run on the user's machine; heavy deps are imported lazily).

These turn raw footage into the smarter signals the engine consumes:
  * reframe.py   (#11) — subject-tracking auto-reframe (MediaPipe)
  * broll.py     (#12) — semantic b-roll search (OpenCLIP + FAISS)
(#13 Whisper polish lives in vibecut/oneshot.py.)

Each module imports its heavy dependency only when its model functions run, so
importing the package (and unit-testing the pure helpers) needs no extra deps.
Install the AI extras with:  pip install -r requirements-ai.txt
"""
