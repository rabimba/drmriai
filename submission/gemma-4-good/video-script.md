# Three-Minute Demo Video Plan

Target length: 2:35 to 2:50. Keep it under 3:00.

## Recording Setup

- Use the public demo or local Vite app.
- Use the bundled sample/de-identified knee MRI only. Do not show private patient data.
- Use **Gemma 4 Browser** for the main reproducible demo.
- Use the Google/Gemma-inspired cover image as the opening title card.
- If you show Ollama, show it briefly as an advanced local option with `alibayram/medgemma:4b` for planning and `gemma4:latest` for vision.
- Warm the Gemma 4 Browser model cache before recording if possible.
- Keep browser zoom at 100 percent.
- Hide bookmarks, notifications, API keys, and unrelated tabs.

## Shot List And Narration

### 0:00-0:20 - Hook: The Real Problem

Visual: Google-color/Gemma-inspired title card, then quickly show a loaded MRI with many series/slices.

Narration:
> A medical study is not one picture. A knee MRI can contain hundreds of slices across many series. If we send all of that to an AI model, we make the answer slower, more expensive, and easier to ground in the wrong evidence. Dr.MRI.AI starts one step earlier: it asks Gemma to choose the evidence first.

### 0:20-0:40 - Impact And Privacy

Visual: Landing screen, local sample load, metadata/series panel.

Narration:
> This matters in classrooms, rural sites, and privacy-sensitive review workflows. The DICOM files are loaded locally in the browser. The goal is not clinical diagnosis. The goal is transparent educational review where every finding can be traced back to a slice.

### 0:40-1:00 - Model Story

Visual: Open Settings. Show **Gemma 4 Browser**, WebGPU available, model ID. Optional quick cut to Ollama settings with MedGemma/Gemma 4.

Narration:
> This is built around the Gemma ecosystem. The public demo uses Gemma 4 E2B instruction-tuned ONNX directly in the browser with Transformers.js and WebGPU. For a local advanced workflow, Dr.MRI.AI can use MedGemma through Ollama for medical text planning, then Gemma 4 for vision review.

### 1:00-1:25 - Smart Slice Planning

Visual: Ask: `Evaluate ACL and menisci on this knee MRI.`

Narration:
> The first model call is text-only. It reads DICOM metadata: series descriptions, orientation, slice counts, MRI weighting, and current viewport context. It returns structured JSON: the series to review, the slice range, the sampling strategy, and windowing.

### 1:25-1:50 - Human Confirmation

Visual: Plan preview card. Show selected series, slice counts, coverage mode, and Accept.

Narration:
> The plan appears before image analysis. That is the key trust feature. The user can inspect what the model selected, adjust it, and only then send the evidence forward.

### 1:50-2:20 - Multimodal Evidence Review

Visual: Pipeline steps: selecting slices, exporting JPEGs, analyzing batches. Speed up waiting.

Narration:
> Dr.MRI.AI renders only the selected DICOM slices, applies the planned windowing, resizes the evidence, and sends it to Gemma 4 in small multimodal batches. The final synthesis is instructed to cite only findings supported by those batch notes.

### 2:20-2:45 - Grounded Output

Visual: Final report, clickable slice reference, viewer jump, evidence ZIP export.

Narration:
> The output is not just text. Slice references jump back into the viewer, and the evidence ZIP exports the report, JSON manifest, and exact JPEG slices reviewed. AI does not replace a radiologist here; it makes evidence selection inspectable and local.

### 2:45-2:55 - Close

Visual: Live demo URL and GitHub URL.

Narration:
> Dr.MRI.AI is open source, runs as a static web app, and shows how Gemma 4 can bring useful multimodal reasoning closer to sensitive data.

## Fallback If Gemma Browser Loading Is Slow

- Preload the model before recording and start the capture after the model is cached.
- If model loading still takes too long, record the progress UI for 3 seconds, then cut to the completed plan/report.
- Narrate honestly: "The first run downloads the model into browser cache; subsequent runs reuse it."

## Captures To Keep

- Google/Gemma-inspired title card.
- Landing screen.
- Settings panel with Gemma 4 Browser visible.
- Optional 3-second Ollama settings shot showing MedGemma 4B planner and Gemma 4 vision.
- Metadata/series panel.
- Clinical prompt typed into the AI workspace.
- Plan preview before accepting.
- Pipeline progress.
- Final report with slice references.
- Click a slice reference.
- Evidence ZIP export.
