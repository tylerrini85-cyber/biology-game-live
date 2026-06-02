"""VibeCut core — reference implementation of the edit "brain".

This package is the platform-independent logic described in the Master Design
Spec (§6 edit model, §7 analysis, §8 vibe pipeline, §9 op catalog). It proves
the central thesis end-to-end with zero third-party dependencies:

    vibe text  ->  constrained edit plan  ->  deterministic engine
               ->  non-destructive edit model  ->  FFmpeg command + .ass captions

It is intentionally stdlib-only and headless so it runs and is unit-tested
without a GPU, display, or any network/model. The hot paths here port directly
into the Rust core; the Python analysis tools (Whisper, Silero, PySceneDetect,
etc.) attach as the "analysis layer" that feeds it.
"""

__version__ = "0.1.0"
