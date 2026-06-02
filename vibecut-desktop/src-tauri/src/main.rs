// VibeCut desktop — Phase 0 spike.
// Tauri shell that reuses the shared edit-model + FFmpeg export, with a
// documented seam for the native wgpu preview surface (the piece a web page
// can't do). NOTE: build locally (needs Rust + Tauri CLI + a GPU); it is not
// compiled in the research sandbox.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::process::Command;

/// Check FFmpeg is available (the export backend). Returns its first line.
#[tauri::command]
fn probe_ffmpeg() -> Result<String, String> {
    match Command::new("ffmpeg").arg("-version").output() {
        Ok(out) if out.status.success() => Ok(String::from_utf8_lossy(&out.stdout)
            .lines()
            .next()
            .unwrap_or("ffmpeg")
            .to_string()),
        Ok(_) => Err("ffmpeg present but returned an error".into()),
        Err(_) => Err("FFmpeg not found on PATH. Install it (https://ffmpeg.org).".into()),
    }
}

/// Render the final MP4 by running an FFmpeg argv (the exact list the engine
/// produces — see vibecut-core `render.build_ffmpeg_args`). Hardware encoders.
#[tauri::command]
fn run_export(args: Vec<String>) -> Result<String, String> {
    let status = Command::new("ffmpeg")
        .args(&args)
        .status()
        .map_err(|e| format!("failed to launch ffmpeg: {e}"))?;
    if status.success() {
        Ok("export complete".into())
    } else {
        Err(format!("ffmpeg exited with {status}"))
    }
}

// TODO (Phase-0 build-out, spec §11): create a wgpu surface alongside the
// WebView and render decoded frames to it for live playback/scrubbing.
//   mod preview;  // wgpu compositor: decode (ffmpeg-next) -> GPU texture -> present
// The edit-model JSON (shared with the browser Studio) drives both preview and
// export, so this command set already covers final rendering today.

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![probe_ffmpeg, run_export])
        .run(tauri::generate_context!())
        .expect("error while running VibeCut desktop");
}
