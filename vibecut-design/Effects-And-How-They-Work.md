# Captions vs. Adobe Premiere Pro — In‑App Effects & How They Actually Work

A mechanics‑focused reference: what each tool *does inside the app*, and the
algorithm/heuristic behind it. No pricing, no business — just the effects and
the engineering underneath them. Items the research couldn't fully confirm are
marked **⚠️ unverified**.

---

# PART 1 — CAPTIONS (now "Mirage" by captions.ai)

Captions is an AI‑first, mostly mobile/web app: you hand it raw footage and it
returns a finished short. Almost every "effect" is a decision made by a model,
not a manual control — though a real timeline sits underneath for fixing things.

## 1. AI Edit — the auto‑edit pipeline (the core)

**What it does:** raw clip in → fully edited video out: captions, trims,
transitions, sound effects, music, AI‑generated images, B‑roll, motion graphics,
and auto‑zooms, all chosen for you.

**How it works — the flow:**
1. **Prompt** — you describe the video/goal in plain language.
2. **Style** — pick an "AI Edit style" (the overall look — font + color +
   transition feel + effect density + energy bundled together).
3. **Media** — optionally add your own images/B‑roll (Custom Media) that the AI
   weaves in, or let it generate/source stock media itself.
4. **Video Plan** — before rendering, Captions builds a **reviewable, editable
   plan**. You adjust style, edit intensity, color, and media here, *then*
   generate the final video. (This "plan you can edit before commit" is the
   single most important idea — it's exactly the pattern our VibeCut editor
   copies with its edit‑model‑before‑render step.)

**The two master dials:**
- **Edit Intensity** — how much editing/how many effects: density of cuts,
  zooms, transitions, B‑roll, SFX. Higher = busier, more "edited" feel.
- **Color** — a brand color pushed through graphics and captions.

**What it auto‑adds:** silence/filler trimming, hard cuts, transitions chosen by
content pacing, supporting B‑roll, AI images, SFX, background music, motion
graphics, captions, and emphasis‑driven auto‑zooms.

**AI Edit "styles" (looks):** Each is a preset bundle. Categories: **Energetic**
(quick zooms, shakes, bold SFX), **Motivation** (dramatic zooms, bold filters),
**Scrapbook** (collage/handwritten/magazine), **Clean/Minimal**, and
**Professional** (LinkedIn‑friendly). Named styles seen in docs: Analog,
Cinematic II, Neon, Recess, Vinyl II, Core, Ignite, Impact II, Velocity, Prime,
Pulse, Volt, Ember, Film, Prism, Byline, Kai, Grit, Sonnet, etc.
**⚠️ The "21 styles" number is not authoritative** — Captions' own blog says
"hundreds," constantly growing.

## 2. Captions / subtitles
- **Transcription:** auto on upload; reportedly runs **OpenAI Whisper** with
  **word‑level timing** (same family of model we run locally in VibeCut).
- **Languages:** 100+ for captions/subtitles (text translation is cheap).
- **Styles:** 75+ caption styles, including **word‑by‑word / karaoke highlight**
  (each word lights up as spoken) and **Hormozi‑style** bold word‑by‑word.
- **Controls:** font, size, color, position/alignment, stroke/outline, shadow,
  background fill, **active‑word emphasis color**, and animation. Click text to
  fix wording live; drag timing in the timeline.
- **SRT:** export supported; import referenced but **⚠️ less documented.**

## 3. AI Eye Contact
Corrects gaze so an off‑camera reader appears to look into the lens. It
generatively **re‑renders the eye region and stabilizes gaze per clip**, but
**preserves intentional glances/look‑aways** so delivery stays natural — it does
not lock eyes rigidly forward. Toggle per clip (only where needed); stays
compatible with captions/translation.

## 4. Audio tools
- **AI Denoise:** removes echo, wind, crowd, background hiss per shot toward a
  studio sound.
- **Source separation:** splits the **vocal track from the background track**
  ("Manage Audio Tracks") — keep/remove either, set per‑track volume/mute,
  extract audio from added clips.
- **AI Voiceover:** pick from a voice library (tones/accents) or import; can use
  a cloned voice (§7).
- **AI Music:** generate a track from text (two music‑model integrations) or
  import; separate **Sound Effects** library.

## 5. Auto‑zoom / punch‑ins
The AI inserts zooms automatically, keying off **vocal emphasis** — louder
volume, pitch changes, pauses, punchlines — plus scene changes. Density scales
with Edit Intensity. You can also drop manual zooms at exact moments.
**⚠️** The exact trigger heuristic isn't published, but emphasis/volume/pitch is
well‑attested for this class of tool.

## 6. AI Dubbing / translation (Lipdub lip‑sync)
**Pipeline:** transcribe source → translate → **regenerate a new voice track** in
the target language (can preserve the speaker's timbre) → **re‑render the mouth
region** to match the new phonemes/timing while preserving expression.
- **Languages:** ~28–30+ for dubbing (fewer than captions, because voice+lips
  must be regenerated). Run **Denoise first** — music/noise/multi‑speaker audio
  degrades the dub.
- **⚠️ Name collision:** Captions' **Lipdub** is its *own* proprietary feature
  (launched Oct 2023). A *different* "LipDub" is **Lightricks' LTX‑Video**
  open‑source LoRA — unrelated. Don't attribute LTX‑Video tech to Captions.

## 7. AI Twin / AI Actors / voice cloning — ⚠️ all fully generative
*(Listed for completeness — this is exactly the synthetic‑actor category VibeCut
deliberately excludes.)*
- **AI Twin:** a digital double built from uploaded footage, a short recording,
  or a selfie (video gives the best match).
- **Voice cloning:** record a ~1‑minute calibration script in a quiet room; the
  clone learns cadence/tone/inflection.
- **Customization:** change outfits, appearance, backgrounds, even add products.
- **AI Actors:** a library of licensed AI presenters; add a script → the actor
  performs on screen. Powers the AI Ad / spokesperson generator.

## 8. Other tools & the editor
- **AI Title & AI Hashtags:** generated from the transcript for discovery.
- **AI Shorts:** upload a long video or paste a YouTube URL → it finds the best
  moments and outputs multiple captioned, vertical‑reframed clips.
- **Conversational/chat editor:** a chat box — "edit like you text"; plain
  commands apply effects, transitions, B‑roll, pacing, captions. (This is the
  exact "vibe again with a new prompt" interaction VibeCut is built around.)
- **Manual timeline:** real trim (auto or manual), split & merge, layered tracks
  (video overlays / audio / captions / music), per‑track volume/mute, audio
  extraction, caption‑timing tweaks. A **Scenes** tab houses voiceover/B‑roll.
- **Platforms:** iOS, Android, Web, plus desktop via Mirage Studio. **⚠️**
  iOS‑first — Android/desktop lag in features/stability.
- **Export:** aspect ratios 1:1, 4:5, 9:16, 16:9 with AI auto‑reframe; one‑tap
  share to TikTok / Reels / Shorts. **⚠️** Max resolution/fps/codec not clearly
  published; users report occasional export/sync bugs.

## 9. Underlying tech — the Mirage foundation model
From the *Seeing Voices* paper (arXiv 2506.08279, 2025):
- **Mirage** is an **audio‑to‑video foundation model for A‑roll** — generates
  expressive talking‑person video from images + text + audio with realistic
  lip/gesture sync.
- **Architecture:** a **Diffusion Transformer (DiT)** with **asymmetric
  self‑attention** mixing audio + image‑sequence modalities.
- **Training:** a "warm‑up and stitching" recipe that balances attention across
  video/audio/text; works from scratch or by fine‑tuning a silent video model.
- **Why it matters:** treating audio/video/text equally lets the model learn
  phrasing, pacing, pose, micro‑expressions, and framing from data — which is
  what Captions credits for its auto‑edit pacing and the realism of
  Twins/Actors/Lipdub.

---

# PART 2 — ADOBE PREMIERE PRO

Premiere is the opposite philosophy: manual, deterministic, parameter‑driven
control over every pixel — with a growing layer of (mostly on‑device) AI bolted
on top. This is the "edit like Adobe with all the same effects" half of VibeCut.

## 1. Lumetri Color (the color engine)

**Basic Correction:** White Balance (Temperature warms/cools by shifting toward
amber/blue; Tint shifts green↔magenta; an eyedropper neutralizes a gray),
WB selector, Tone (Exposure, Contrast, Highlights, Shadows, Whites, Blacks,
plus "Auto" using Sensei), and global Saturation. An **Input LUT** slot applies a
technical log→709 normalization first.

**Creative:** a **Look** (stylistic LUT preset) with an Intensity slider; plus
Faded Film, Sharpen, Vibrance, Saturation, and **Shadow Tint / Highlight Tint**
color wheels for split‑toning with a Tint Balance slider.

**Curves:**
- *RGB Curves* — drag a tonal point up/down to brighten/darken that range; an
  S‑curve adds contrast; per‑channel R/G/B dots isolate color.
- *Hue/Saturation Curves* (five selective curves): **Hue vs Hue** (remap one hue
  to another), **Hue vs Sat** (raise/lower saturation of a hue range), **Hue vs
  Luma** (brighten/darken specific hues), **Luma vs Sat** (change saturation in a
  brightness range), **Sat vs Sat** (compress/boost within a saturation range).
  You click 3 points: outer two pin the range, the center is dragged.

**Color Wheels & Match:** three wheels (Shadows/Midtones/Highlights), each a
hue/sat wheel plus a luminance slider, using "gear‑ratio" dragging for
precision. **Color Match** shows Reference vs Current in a split Comparison View;
**Apply Match** uses **Sensei** to auto‑set the wheels + saturation.
**Face Detection is on by default** — skin‑tone regions get higher weight.

**HSL Secondary:** key a specific color (eyedropper + add/remove), refine the
H/S/L ranges (widen/narrow + feather), clean the mask (Denoise + Blur), then
grade **only the keyed region** with its own wheel + temp/tint/contrast/sat.

**Vignette:** Amount (dark/bright), Midpoint (clear‑center size), Roundness
(oval↔circle), Feather (edge softness).

**LUT mechanics:** a `.cube` is a 3D lookup table — a fixed RGB grid (17³ or 33³
nodes) mapping input RGB→output RGB, with **trilinear interpolation** between
nodes. Two roles: Input LUT (technical normalization) vs Creative Look (style).

**Lumetri Scopes:** Waveform (intensity vs horizontal position, 0–100 IRE),
Vectorscope (hue = angle, saturation = distance; skin‑tone "I" line), RGB Parade
(R/G/B isolated side‑by‑side — the cast‑neutralizing tool), Histogram (pixel
count per tonal value).

**Color management:** auto‑detects Log/Raw and transforms to a working space
(Rec.709, Wide Gamut Tone‑Mapped, or HDR Rec.2100 PQ/HLG); tone mapping
compresses HDR/wide‑gamut highlights into SDR.

## 2. Video Effects (the effect stack)

Effects render **top‑to‑bottom** in Effect Controls; fixed effects (Motion,
Opacity, Time Remapping) render last. Every spatial/numeric parameter has a
stopwatch to enable **keyframing**.

**Keyframes:** a keyframe stores a value at a time; in‑betweens are interpolated.
- *Temporal:* Linear (constant rate), Bezier (handles bend the velocity curve),
  Ease In/Out (decelerate in / accelerate out), Auto Bezier, Hold (jump, no
  interpolation).
- *Spatial:* motion paths get their own Bezier handles, separate from timing.

**Key effects & their mechanism:**
- **Gaussian Blur** — convolution blur; amount + H/V/Both dimensions; Repeat
  Edge Pixels avoids dark edges.
- **Directional Blur** — blur along an angle by a length; fakes linear motion
  blur.
- **Transform** — anchor/position/scale/skew/rotation/opacity, but rendered
  *inside* the effect stack (orderable) and adds true motion blur via shutter
  angle.
- **Crop** — L/R/T/B percentage + Edge Feather + Zoom (refill frame).
- **Lens Distortion** — Curvature (barrel/pincushion) + decentering.
- **Ultra Key (chroma key)** — pick key color → Matte Generation
  (Transparency/Highlight/Shadow/Tolerance/Pedestal) → Matte Cleanup
  (Choke/Soften/Contrast) → Spill Suppression (kills green spill) → Color
  Correction of the subject. Output modes Composite/Alpha/Color for tuning. It
  isolates the chroma background and zeros its alpha.
- **Track Matte Key** — a second clip on another track is the stencil; reveal by
  its Luma (light = reveal) or Alpha (e.g., text reveals video).
- **Warp Stabilizer** — Stage 1 analyzes the clip and tracks feature points;
  Stage 2 applies inverse transforms. Smooth Motion vs No Motion; methods
  Position → Subspace Warp (mesh warp); framing options incl. Stabilize+Crop+
  Auto‑scale and Synthesize Edges; Rolling‑Shutter Ripple fixes CMOS skew.
- **Lens Flare, Mosaic** (pixelate for face‑hiding), **Noise, Posterize,
  Replicate, Mirror** — each parameter‑driven and keyframable.
- **⚠️ Glow:** native "Alpha Glow" (edge glow on alpha) is real; a general
  luminance Glow with threshold/radius/intensity is usually built manually or in
  After Effects.

## 3. Masking & Tracking
Every effect (and Opacity) supports masks via three tools: **Ellipse**,
**Rectangle**, **Pen** (Bezier free‑draw). Parameters: Mask Path (keyframable),
Feather, Opacity, Expansion (grow/shrink the border), Inverted.
- **Mask Tracking** auto‑keyframes the Mask Path forward/backward to follow
  motion.
- **AI Object Mask** (Premiere 26, Jan 2026): an **on‑device** model — hover over
  a person/object → overlay snaps to it → one click generates a precise mask that
  auto‑tracks forward and backward through motion and partial occlusion, with
  near‑real‑time preview. Refine with lasso/rectangle/feather. Runs entirely
  locally; used for face blur, isolated grading, relighting.

## 4. Transitions
Applied at cuts; alignment Center/Start/End. Default video transition = Cross
Dissolve (~30 frames); default audio = Constant Power. Apply default with
Cmd/Ctrl+D.
- **Dissolves:** Cross Dissolve (gamma‑space fade), Film Dissolve (linear‑light,
  filmic), Dip to Black, Dip to White, Additive Dissolve (sums luminance — bright
  mid‑spike), Non‑Additive Dissolve (per‑pixel brighter‑of‑A/B).
- **Geometric:** Wipe, Slide, Push, Split, Iris, Zoom/Cross Zoom, Page Peel
  (mostly legacy/stylized).
- **Audio crossfades:** **Constant Power** (equal‑power curve, no mid‑dip —
  default), **Constant Gain** (linear, can dip), **Exponential** (logarithmic,
  most gradual).
- **Morph Cut:** hides jump cuts in talking‑head footage by combining **face
  tracking + optical‑flow frame interpolation** — it analyzes both clips in the
  background and synthesizes intermediate frames across the cut. Needs a static
  background, single head, minimal motion.

## 5. Speed / Time
- **Speed/Duration** — set Speed % (linked to duration), Reverse, Maintain Pitch,
  Ripple.
- **Time Remapping** — a rubber‑band over the clip; add speed keyframes, split &
  drag halves apart to make a **speed ramp** with Bezier handles; supports
  reverse segments and freeze holds.
- **Freeze Frame** — Frame Hold or a Time‑Remapping hold.
- **Time interpolation** (how new frames are made): **Frame Sampling**
  (duplicate/drop — choppy), **Frame Blending** (dissolve adjacent frames — soft
  ghosting), **Optical Flow** (analyze pixel motion vectors and synthesize brand‑
  new frames — smoothest slow‑mo, but warps on complex motion).
  **⚠️** Optical Flow/Frame Blending reportedly don't apply on Time‑Remapping
  ramps — only via Speed/Duration.

## 6. Audio
**Essential Sound** — tag each clip Dialogue / Music / SFX / Ambience to unlock
tailored controls:
- *Dialogue:* Loudness (Auto‑Match), Repair (Reduce Noise/Rumble/DeHum/DeEss/
  Reduce Reverb), Clarity (Enhance Speech, Dynamics, EQ), Creative.
- *Music:* Loudness, Duration (Remix), **Auto‑Duck** against dialogue.
- *SFX/Ambience:* Loudness, reverb/room, Pan, Stereo Width.

- **Enhance Speech** — AI (now also **on‑device**) that isolates and
  re‑synthesizes dialogue to a studio voice, with an Amount/Mix slider to blend
  against the original.
- **DeNoise/DeReverb** — broadband noise + room‑echo reduction (AI or normal).
- **Auto‑Ducking** — detects speech and keyframes music/ambience volume down;
  params Sensitivity, Duck Amount (dB), Fade Duration/Position; "Generate
  Keyframes" writes the automation.
- **Loudness/Normalization** — Audio Gain (Set/Adjust/Normalize Peak); true
  loudness targeting is LUFS/LKFS via Loudness Radar/Meter.
- **EQ** — Parametric (multi‑band freq/gain/Q + shelves) and Graphic (10/20/30‑
  band).
- **Compression** — Dynamics, Multiband, Tube, Single‑band, Hard/Soft Limiter.

## 7. Titles / Graphics
- **Type & Shape tools** draw directly in the Program Monitor, creating layered
  Graphic clips.
- **Properties panel** (v25.0+): per‑layer Text (font/size/tracking/leading/
  align), Appearance (Fill, multiple Strokes, Background box, multiple Shadows),
  Transform, Align/Distribute.
- **Responsive Design** — *Time* protects intro/outro keyframe regions when a clip
  is trimmed; *Position* pins layers to each other or frame edges so elements
  reflow.
- **MOGRTs** (`.mogrt`) — packaged After‑Effects/Premiere templates exposing
  curated editable controls; drag from the Graphics Templates panel.
- **Captions** — Speech‑to‑Text → Create Captions → style via **Track Styles**
  (font/fill/edge/background/align/position), saved and reused across a sequence;
  export as SRT sidecar or burned‑in.

## 8. AI features (mechanics)
- **Speech to Text** — on‑device, time‑coded transcript with speaker labels;
  feeds the rest.
- **Text‑Based Editing** — edit the sequence by editing the transcript: delete
  words to ripple‑remove the matching footage; copy/paste reorders clips; a
  filter detects/removes **filler words** ("um/uh/like") and **pauses**.
- **Auto Reframe** (Sensei) — salient‑subject detection + tracking re‑crops/pans
  to a new aspect ratio (9:16/1:1/custom), keeping the subject framed; writes a
  keyframe‑editable Motion crop.
- **Scene Edit Detection** — analyzes a flattened clip, detects hard cuts, adds
  edit points/markers — for re‑editing delivered files.
- **Generative Extend** (Firefly, cloud, 2025) — synthesizes ~2s of new video /
  ~10s of audio at a clip edge; audio extension is room‑tone/ambience only
  (dialogue muted); generated frames carry Content Credentials.
- **Remix** (Sensei) — retimes music to a target length by analyzing beats/phrase
  structure and reassembling existing phrases with crossfades (not generated
  audio).
- **Media Intelligence search** (on‑device, 2025) — builds a semantic index
  (objects, scenes, lighting, camera angle + transcript) in a `.prmi` sidecar;
  natural‑language search ("drone shot at sunrise") returns ranked matches,
  locally.
- **Color Match / Auto Color** — Sensei‑driven, face‑weighted (§1).

---

# PART 3 — HOW THE TWO COMPARE (and what VibeCut takes from each)

| Dimension | Captions | Premiere Pro |
|---|---|---|
| Philosophy | AI decides, you review a **plan** | You decide, every parameter manual |
| Entry point | A **prompt** + style | A timeline + effect stack |
| Cuts | Auto filler/silence trim | Text‑Based Editing (transcript delete) |
| Captions | 75+ animated styles, karaoke | Track Styles, SRT, manual styling |
| Reframe | Auto vertical on export | Auto Reframe (Sensei, keyframe‑editable) |
| Color | One "Color" brand dial | Full Lumetri (curves/wheels/HSL/LUT/scopes) |
| Audio | AI Denoise + source split | Essential Sound + Enhance Speech + ducking |
| Zoom | Emphasis‑driven auto punch‑ins | Manual keyframed Transform/Motion |
| Transitions | AI‑chosen by pacing | Full manual library + Morph Cut |
| Speed | Style‑driven | Time Remapping ramps + Optical Flow |
| AI ceiling | Generative actors/voices/dubbing | On‑device masking/search; cloud Gen Extend |
| Runs | Mobile‑first / web / desktop | Desktop, GPU |

**What VibeCut deliberately takes:**
- **From Captions** — the *prompt → editable plan → render* loop, emphasis‑driven
  auto‑zoom, word‑level karaoke captions, auto filler/silence trim, vertical
  auto‑reframe, "vibe again" chat re‑editing — **minus** any generative
  actor/voice/lip‑sync (excluded by design).
- **From Premiere** — deterministic, keyframable, parameter‑driven effects:
  Lumetri‑style color (curves/LUT), the full transition family (dissolves, dips,
  wipes, audio constant‑power crossfades), speed ramps with frame interpolation,
  Essential‑Sound‑style audio (denoise/ducking/loudness), masks, and Track‑Style
  captions — so after the AI pass you can hand‑finish like a pro.

The key shared insight both apps converge on — and the spine of VibeCut — is the
**editable edit‑decision layer**: Captions calls it the "Video Plan," Premiere
expresses it as the transcript/effect stack. VibeCut makes that layer an explicit
JSON edit model that an LLM writes from your prompt and you can then tweak by
hand or re‑vibe.

---

*Sources: Adobe HelpX / Adobe Blog (Lumetri, effects, masking, transitions,
audio, graphics, AI), the Captions/Mirage help docs & blog, the* Seeing Voices
*paper (arXiv 2506.08279), and corroborating tutorial/review coverage. Full URL
lists are in the two research briefs that back this report. Direct fetches of
captions.ai, mirage.app, and helpx.adobe.com return 403 to automated tools, so
some exact slider ranges are paraphrased from documentation snippets and flagged
⚠️ above.*
