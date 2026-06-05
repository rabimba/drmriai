# Gemma 4 Good Hackathon — Submission Package

**Track:** Impact Track — Health & Sciences
**Project:** Dr.MRI.AI
**Repo:** https://github.com/rabimba/drmriai
**Live demo:** https://rabimba.github.io/drmriai/

## What goes where

| File | Where it goes |
|---|---|
| `kaggle-form-fields.md` | **Start here on submission day.** Paste-ready value for every Kaggle form field. |
| `kaggle-writeup.md` | Paste body into the Kaggle Writeup editor. 1,495 words, under the 1,500 limit. |
| `video-script.md` | Use as the shooting plan. Don't paste this anywhere. |
| `submission-checklist.md` | 5-hour playbook from QA through Submit. |
| `project-links.md` | Source of truth for URLs and YouTube copy. |
| `thumbnail-560x280.png` | **Card and Thumbnail Image** — required by the Kaggle form (560 × 280). |
| `thumbnail-560x280@2x.png` | Retina backup if Kaggle accepts higher-res. |
| `cover-image.png` | Upload to Kaggle Media Gallery (1600 × 900 hero). |
| `asset-architecture.png` | Upload to Media Gallery (wide pipeline overview). |
| `asset-brain-architecture.png` | Use in the blog post inside the "Brain" section (focused three-call diagram with SliceExporter). |
| `asset-before-after.png` | Upload to Media Gallery (200+ slices → 16). |
| `asset-why-gemma.png` | Upload to Media Gallery (the three Gemma 4 properties). |
| `*.svg` | Source files for the PNGs. Edit copy and re-render to PNG via `cairosvg`. |

## Submission positioning

- **Primary message:** Dr.MRI.AI asks Gemma 4 to pick the evidence *before* it reviews any image. Plan first, review second, synthesize third — same cached model, three calls, zero upload.
- **Primary Gemma 4 claim:** `onnx-community/gemma-4-E2B-it-ONNX` running in the browser via `@huggingface/transformers` on WebGPU at `q4f16`.
- **Secondary Gemma 4 claim:** Optional local Ollama workflow with `alibayram/medgemma:4b` (medical text planner) + `gemma4:latest` (vision reviewer), behind the same provider-agnostic interface.
- **Why Gemma 4 specifically:** small enough for the browser (E2B), one model serves planner + reviewer + synthesizer, domain-tuned vertical (MedGemma) lives in the same family.
- **Numbers that anchor the story:** 200+ slices → 16 selected (≈99% fewer image tokens), ~140 image tokens per JPEG, ≤512 planner output tokens, <2 min first-load on a 2023 Chromebook.

## Visual direction

- Google/Gemma palette: `#4285f4` (blue), `#ea4335` (red), `#fbbc04` (yellow), `#34a853` (green).
- Inter or system sans-serif typography.
- Strong typographic hierarchy, generous whitespace, no clip art.
- **Never** use Google logos or wording that implies official Google endorsement. The hackathon naming guidelines allow "Gemma 4" branding but not Google trademarks.

## Final reminders

- Drafts do not count. Click **Submit** before the deadline.
- The cover image is required. Without it the writeup may not validate.
- Set the YouTube video to **Public**, not Unlisted.
- The writeup explicitly carries the "educational and research use only, not a medical device" disclaimer. Keep it.

Open `submission-checklist.md` next.
