// Native preview surface (Phase-0 build-out, spec §11).
//
// This is the one piece a web page can't do: render decoded video frames to a
// GPU surface for smooth, frame-accurate playback/scrubbing of the edit model.
// It is a documented scaffold — wire it up locally with `wgpu` + `ffmpeg-next`
// (uncomment the deps in Cargo.toml). It does NOT compile until those deps and
// the decode loop are added; the FFmpeg export path in main.rs works today.
//
// Intended flow (see the engineering brief / design spec §11):
//   1. Create a wgpu surface bound to a native child window placed beside the
//      Tauri WebView (the `wry` / `tauri-wgpu` multi-surface pattern).
//   2. Decode the source with ffmpeg-next using hardware acceleration, uploading
//      frames into a wgpu texture (zero-copy where the platform allows).
//   3. A render pass samples the texture; effects (reframe crop, punch-in zoom,
//      color grade) run as WGSL shaders in linear-light float (Movit/Olive
//      technique) so preview matches export.
//   4. Playback walks the shared edit model's kept ranges (skipping cuts) and
//      applies the same caption/zoom/transition timing the engine computed.
//
// Sketch (pseudocode — fill in with the real wgpu/ffmpeg-next APIs):
//
// pub struct Preview { /* surface, device, queue, pipeline, texture */ }
//
// impl Preview {
//     pub fn new(window: &impl raw_window_handle::HasWindowHandle) -> Self { todo!() }
//     pub fn upload_frame(&mut self, rgba: &[u8], w: u32, h: u32) { todo!() }
//     pub fn render(&mut self, t_seconds: f64, model: &serde_json::Value) { todo!() }
// }
//
// The edit model is the same JSON the browser Studio and the Python engine use,
// so the preview and the FFmpeg export stay perfectly in sync.

#![allow(dead_code)]

/// Placeholder so the module is referenceable; replace with the real Preview.
pub fn preview_available() -> bool {
    false // becomes true once the wgpu surface + decode loop are implemented
}
