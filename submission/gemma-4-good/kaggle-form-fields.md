# Kaggle Submission Form — Paste-Ready Values

Open this file side by side with the Kaggle Writeup form. Every section below maps 1:1 to a field on the form. Copy the value between the `---START---` and `---END---` markers.

---

## ✅ Form Field 1 — Title (max 80 chars)

Recommended (61 / 80 chars):

---START---
Dr.MRI.AI: Evidence-First Medical Imaging Review with Gemma 4
---END---

Backup options if you want a shorter or different angle:

- `Dr.MRI.AI — Gemma 4 picks the evidence before reviewing your scan` (65 chars)
- `Dr.MRI.AI: Plan-first DICOM review with Gemma 4 in your browser` (63 chars)

---

## ✅ Form Field 2 — Writeup URL slug

Kaggle auto-generates this from the Title. Don't touch it unless it ends up ugly. If you want to force a clean slug, type:

---START---
drmriai-evidence-first-gemma-4
---END---

---

## ✅ Form Field 3 — Subtitle (max 140 chars)

Recommended (132 / 140 chars):

---START---
A privacy-first DICOM viewer that lets Gemma 4 pick the right evidence before it reviews any image. Runs in your browser. No upload.
---END---

Backup options:

- `Gemma 4 picks which slices to review before it looks at any image. 200+ slices to 16, entirely in your browser on WebGPU.` (121 chars)
- `Evidence-first medical imaging with Gemma 4 E2B running on WebGPU in the browser, plus an optional MedGemma + Gemma 4 local path.` (129 chars)

---

## ✅ Form Field 4 — Card and Thumbnail Image (560 × 280)

Upload this file from the submission folder:

---START---
thumbnail-560x280.png
---END---

Higher-resolution backup (Kaggle will downscale gracefully):

---START---
thumbnail-560x280@2x.png
---END---

If the form will not accept either thumbnail file, fall back to `cover-image.png` — Kaggle will crop it to the card aspect ratio.

---

## ✅ Form Field 5 — Submission Tracks (select)

Primary track (required, pick this one):

---START---
Impact Track — Health & Sciences
---END---

If the form lets you select more than one, also add (in order of relevance):

1. `Impact Track — Safety & Trust` (the evidence audit trail + plan preview directly addresses this track)
2. `Impact Track — Digital Equity & Inclusivity` (runs on a mid-range laptop with no cloud, no API key)

Do **not** also pick Main Track unless the form requires it — the Main Track is judged automatically across all submissions according to the competition rules, you don't need to opt in.

---

## ✅ Form Field 6 — Media Gallery (Videos / Images)

Upload in this exact order. Kaggle uses the first image as the gallery cover.

| # | File | Type | Purpose |
|---|---|---|---|
| 1 | `https://www.youtube.com/watch?v=sIceYp5vTQc` | Video | The 3-minute demo |
| 2 | `cover-image.png` | Image | Hero cover (1600×900) |
| 3 | `asset-architecture.png` | Image | Three-call pipeline diagram |
| 4 | `asset-before-after.png` | Image | 200+ slices → 16 selected |
| 5 | `asset-why-gemma.png` | Image | Why Gemma 4 specifically |
| 6 | (optional) screenshot of plan preview from live demo | Image | Show the trust moment |
| 7 | (optional) screenshot of the final report with slice references | Image | Show the grounded output |

---

## ✅ Form Field 7 — Project Description (≤ 1,500 words)

Open `kaggle-writeup.md` in this folder. Copy everything from the `## The moment this project started` heading to the closing line `**Live demo:** ... **Video:** see Media Gallery`. Paste into the Project Description editor.

Current word count: **1,495 / 1,500**. Do not add prose without removing equivalent prose elsewhere.

After pasting, spot-check that:

- The ASCII architecture diagram is in a code fence (looks monospaced).
- Bullet lists render cleanly.
- The "200+ slices → 16 / ~99% reduction" table renders as a table.
- All `https://` links are clickable.

---

## ✅ Form Field 8 — Project Links

Add three links, in this order:

| Order | Label | URL |
|---|---|---|
| 1 | Live demo | `https://rabimba.github.io/drmriai/` |
| 2 | Code repository | `https://github.com/rabimba/drmriai` |
| 3 | Video | YouTube URL after upload (paste once you upload the video) |

If the form has a single "Add a link" button per row, click it three times and use these label / URL pairs:

---START Link 1---
Label: Live demo
URL:   https://rabimba.github.io/drmriai/
---END Link 1---

---START Link 2---
Label: GitHub repository
URL:   https://github.com/rabimba/drmriai
---END Link 2---

---START Link 3---
Label: Demo video on YouTube
URL:   https://www.youtube.com/watch?v=sIceYp5vTQc
---END Link 3---

---

## ✅ Form Field 9 — Files (optional, ≤ 100 MB total, up to 7 files)

Do not upload the full repo as files. Use the GitHub link instead. If the form will accept supplementary uploads, the highest-value additions are:

1. `cover-image.png` (for offline reviewers).
2. `asset-architecture.png` (the diagram judges will quote).
3. `asset-before-after.png`.
4. `asset-why-gemma.png`.
5. The Evidence ZIP produced by a real run of the live demo (rename it `dr-mri-ai-evidence-sample.zip`). This is a powerful artifact because it shows the actual output. **Do not** upload one made from any real or identifiable patient data.

Skip files entirely if you're short on time. The GitHub link is sufficient.

---

## ✅ Submission Checklist (the form's own 7-item gate)

The form will not allow Submit until all of these are green:

- [ ] **Title** — paste from Field 1.
- [ ] **Subtitle** — paste from Field 3.
- [ ] **Card and Thumbnail Image** — upload `thumbnail-560x280.png` from Field 4.
- [ ] **Submission Tracks** — select Health & Sciences (and optionally Safety & Trust, Digital Equity & Inclusivity).
- [ ] **Video** — upload to YouTube as **Public**, paste link into Media Gallery.
- [ ] **Project Description** — paste from `kaggle-writeup.md`.
- [ ] **Project Links** — add three: live demo, GitHub, YouTube.

Then click **Submit** in the top right. **Drafts do not count.** Reopen the writeup once more and confirm it says "Submitted", not "Draft".

---

## Final order of operations on submission day

1. **Pre-flight QA** (30 min) — open live demo + GitHub in incognito, confirm they load. Warm the WebGPU Gemma model.
2. **Record video** (60–90 min) — follow `video-script.md`.
3. **Edit + upload** (60 min) — trim to 2:40–2:55, export 1080p, upload to YouTube as **Public**. Use the description from `project-links.md`. Copy the YouTube URL.
4. **Open Kaggle Writeup form** — paste each field from this file in order.
5. **Save**, then **Submit**.
6. **Verify** — reopen the writeup from an incognito window. Confirm it shows "Submitted", confirm all 4 media gallery images load, confirm the YouTube video plays, confirm all three project links resolve. Screenshot the "Submitted" header.

---

## If you're under time pressure (last 30 minutes)

Skip these without hurting your scoring:

- Optional supplementary file uploads (Field 9).
- Optional extra screenshots (rows 6-7 of Field 6).
- The shorter backup Title and Subtitle variants — just use the recommended ones.

Do **not** skip:

- Setting the YouTube video to **Public**.
- Uploading the 560×280 thumbnail.
- Clicking **Submit** (the form does not auto-submit drafts).
