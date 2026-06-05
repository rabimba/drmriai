# Three-Minute Demo Video — Final Script

**Target length:** 2:40 – 2:55. Hard ceiling 3:00.
**Tone:** Calm, confident, personal. Not a sales pitch. You're showing a tool you'd actually use.
**Branding:** Google/Gemma color accents only. Never imply official Google endorsement.

---

## Pre-Record Checklist (do all of these BEFORE you hit record)

1. Open the public demo at **https://rabimba.github.io/drmriai/** in an incognito Chrome window with WebGPU enabled.
2. Open Settings → choose **Gemma 4 Browser**. Confirm:
   - Model ID: `onnx-community/gemma-4-E2B-it-ONNX`
   - dtype: `q4f16`
   - Max images: 16, image-token budget: 140
3. **Warm the cache** — load the bundled sample knee MRI, run one full pipeline so the model weights are cached. Then refresh.
4. Hide bookmarks bar, notifications, system clock seconds. Close unrelated tabs.
5. Set browser zoom to 100%.
6. Pick the cleanest microphone you have. Record narration in a quiet room.
7. If WebGPU is unavailable on the recording machine, fall back to the local Vite dev server with `npm run dev` — exact same UI.

---

## Shot-By-Shot Script

### 0:00 – 0:12 — Personal hook (cold open)

**Visual:** Hold the Gemma-color cover image on screen for 1 second. Cut to a wide shot of the loaded MRI with the series list visible — many series, hundreds of slices.

**Narration:**
> A few months ago I sat with my partner in a hospital and scrolled through an MRI with two hundred slices. The radiologist had circled three. Three slices out of two hundred were the answer. The rest was context.

### 0:12 – 0:25 — The real problem

**Visual:** Cut to the series-browser panel. Slowly scroll the slice slider — let the viewer *see* there are hundreds of frames.

**Narration:**
> Every multimodal medical AI demo does the same thing — it sends the entire haystack to the model. That wastes context, hurts grounding, and makes the answer hard to audit. Dr.MRI.AI starts one step earlier. It asks Gemma 4 to choose the evidence first.

### 0:25 – 0:42 — Privacy + Gemma 4 setup

**Visual:** Open Settings panel. Hover over the **Gemma 4 Browser** option. Show the model ID, dtype, and WebGPU indicator.

**Narration:**
> The whole pipeline runs in your browser. No upload, no server, no API key. The model is Gemma 4 E2B instruction-tuned, in ONNX, running on WebGPU through Transformers.js. The DICOM files never leave your laptop.

### 0:42 – 1:02 — Ask the question

**Visual:** Close Settings. Hit Cmd-K. Type slowly: `Evaluate ACL and menisci on this knee MRI.` Hit enter.

**Narration:**
> One sentence. That's the entire input. Gemma 4's first job is text-only: it reads the DICOM metadata — series descriptions, MRI weighting, slice orientation, current viewport — and decides which series and which slice range are actually relevant.

### 1:02 – 1:25 — The plan (the trust beat)

**Visual:** Plan preview card appears. Highlight: target series, slice range, sampling strategy, window/level. Let it sit on screen for 3 full seconds.

**Narration:**
> This is the trust moment. Before any image is reviewed, the plan is shown back to me. Series eight, sagittal proton-density fat-saturated, slices thirteen to twenty-seven, uniform sampling, windowing applied. I can accept it, edit it, or reject it. *Then* the model looks at images.

### 1:25 – 1:55 — Evidence review

**Visual:** Click Accept. Pipeline view shows: selecting slices → exporting JPEGs → analyzing batch 1 → batch 2 → synthesizing. Speed up the wait portion with a 2× cut.

**Narration:**
> Cornerstone3D renders only the selected slices, applies the windowing, and exports them as compact JPEGs. Gemma 4 reviews them in batches of four. A final text-only synthesis pass merges the batch notes into a grounded report. We went from two hundred slices to sixteen. Same model, three calls, one cached weight file.

### 1:55 – 2:20 — Grounded output

**Visual:** Final report appears in the chat sidebar. Click a slice reference — the viewer jumps to that slice. Click another. Then click "Export Evidence ZIP" — show the file appearing in the downloads folder.

**Narration:**
> Findings cite slice labels. Each citation is clickable — the viewer jumps to the exact image the model saw. Everything reviewed is exportable as a ZIP: the report, a JSON manifest, and the exact JPEGs the model received. The workflow is auditable end to end.

### 2:20 – 2:40 — The MedGemma option

**Visual:** Reopen Settings. Switch to Ollama. Show `alibayram/medgemma:4b` for text and `gemma4:latest` for vision. Close it.

**Narration:**
> For users on hardened workstations, the same interface accepts a stronger medical split: MedGemma for the text planner, Gemma 4 for vision review, both local through Ollama. One architecture, two paths — judge-reproducible in the browser, clinician-friendly on the desktop.

### 2:40 – 2:55 — Close

**Visual:** Title card again. URL on screen: `rabimba.github.io/drmriai`. Educational-use-only disclaimer in the corner.

**Narration:**
> Dr.MRI.AI is open source. It runs as a static web app. It's not a medical device — it's a research tool that shows what becomes possible when Gemma 4 is small enough to live next to sensitive data instead of in someone else's cloud.

---

## Fallback Plans

- **Gemma model load is slow on first record.** Pre-warm the cache. If load still takes >15 s, record 3 s of the progress UI, then jump-cut to the completed plan. Narrate: *"On first run the model downloads into browser cache; subsequent runs are instant."*
- **WebGPU unavailable.** Switch the recording to a different machine, or fall back to local Vite + Ollama with `gemma4:latest`. The narration only needs the words "Gemma 4" to remain accurate.
- **You're over 3:00.** Cut the 0:00–0:12 cold open down to 8 seconds. Cut the MedGemma section to 12 seconds. Don't cut the trust beat (1:02–1:25) — that's the differentiator.

---

## B-Roll / Shots To Capture (record extras even if you don't use all)

1. Gemma-color title card (cover image, 1080p).
2. Empty viewer with drag-and-drop hint.
3. Bundled sample MRI loading + progress bar.
4. Series browser with multiple series visible.
5. Settings panel — Gemma 4 Browser highlighted.
6. Cmd-K spotlight prompt with the clinical question.
7. Plan preview card — full screen.
8. Pipeline view mid-run (batch progress).
9. Report with at least three clickable slice references.
10. A click that jumps the viewer to a referenced slice.
11. Evidence ZIP download appearing in Finder/Explorer.
12. Quick Ollama settings shot with MedGemma + Gemma 4.
13. Closing title card with URL + disclaimer.

## YouTube Upload Settings

- Title: `Dr.MRI.AI — Evidence-First Medical Imaging with Gemma 4 (Gemma 4 Good Hackathon)`
- Visibility: **Public** (judges must view without login).
- Description: paste the suggested copy from `project-links.md`.
- Tags: gemma, gemma-4, dicom, medical-ai, webgpu, transformers-js, ollama, medgemma, kaggle, hackathon.
- Thumbnail: use the cover image (or a clean screenshot of the plan preview).
- After upload, paste the YouTube URL into `project-links.md` and the Kaggle Writeup attachments.
