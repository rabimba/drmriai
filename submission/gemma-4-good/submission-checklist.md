# Final Submission Guide — 5-Hour Plan

Deadline: the Kaggle deadline shown on the competition page. **Drafts do not count.** You must click **Submit** before the timer hits zero.

This guide assumes you're starting from the current state of the `submission/gemma-4-good/` folder. Follow it top to bottom.

---

## What's in this folder

```
submission/gemma-4-good/
├── README.md                  ← this folder's index
├── kaggle-writeup.md          ← paste into Kaggle Writeup body (≤1,500 words, currently 1,495)
├── video-script.md            ← shot-by-shot plan for the 3-min YouTube video
├── submission-checklist.md    ← this file
├── project-links.md           ← URLs to paste into Kaggle
├── cover-image.svg / .png     ← Media Gallery COVER IMAGE (required)
├── asset-architecture.svg/.png  ← Media Gallery — three-call architecture
├── asset-before-after.svg/.png  ← Media Gallery — 200+ slices vs 16
└── asset-why-gemma.svg/.png     ← Media Gallery — why Gemma 4
```

Submission track: **Impact Track — Health & Sciences**. The writeup also reads strongly for **Safety & Trust** (evidence audit trail) and **Digital Equity & Inclusivity** (runs on a mid-range laptop with no upload). Pick whichever the Kaggle form lets you select; Health & Sciences is the primary.

---

## Hour 1 — Pre-flight QA

1. Open https://rabimba.github.io/drmriai/ in an **incognito Chrome window**. Confirm the page loads without login.
2. Open https://github.com/rabimba/drmriai in an **incognito window**. Confirm the repo is public.
3. In the live demo: load the bundled sample knee MRI. Open Settings → choose **Gemma 4 Browser**. Confirm:
   - Model ID `onnx-community/gemma-4-E2B-it-ONNX`
   - dtype `q4f16`
   - Max images 16, image-token budget 140
4. **Pre-warm** the model: run one full pipeline end to end with the prompt `Evaluate ACL and menisci on this knee MRI.` Verify a plan appears, a report appears, slice refs are clickable, and the Evidence ZIP downloads.
5. If anything fails: fall back to local `npm run dev` for the recording — the UI is identical.
6. Sanity-check there are **no API keys, no PHI, no private DICOM files** committed to the repo.

## Hour 2 — Record the video

Open `video-script.md`. Recording tips:

- 1080p screen capture. macOS: Cmd-Shift-5; Windows: Xbox Game Bar; Linux: OBS.
- Mic: anything quiet. Audacity or QuickTime work for narration.
- Hide bookmarks, notifications, system tray.
- Record narration **separately** from screen capture so you can edit independently.
- Record once full-take, then 2–3 partial retakes for any rough sections.

**Critical scenes that must be in the cut:**
1. Cold open: the 200+ slice MRI (12 s).
2. Settings panel with `Gemma 4 Browser` highlighted (8 s).
3. Plan preview card before Accept (3 s minimum static frame).
4. Pipeline progress + final report (15 s).
5. Click a slice reference → viewer jumps (3 s).
6. Evidence ZIP download (3 s).
7. Closing card with URL + disclaimer (5 s).

Don't skip the "plan before review" moment — it's the differentiator from every other multimodal-AI demo.

## Hour 3 — Edit + upload video

1. Edit to 2:40–2:55 in iMovie, CapCut, DaVinci Resolve, or your tool of choice.
2. Add captions for accessibility (the YouTube auto-captions work but proofread).
3. Export as 1080p MP4.
4. Upload to YouTube:
   - **Visibility: Public** (judges must view without login).
   - Title: `Dr.MRI.AI — Evidence-First Medical Imaging with Gemma 4 (Gemma 4 Good Hackathon)`
   - Description: paste from `project-links.md`.
   - Tags: gemma, gemma-4, dicom, medical-ai, webgpu, transformers-js, ollama, medgemma, kaggle, hackathon.
   - Thumbnail: upload `cover-image.png`.
5. Copy the YouTube URL. Paste it into `project-links.md` replacing the `TODO`.

## Hour 4 — Build the Kaggle Writeup

1. Sign in at https://www.kaggle.com/competitions/gemma-4-good-hackathon.
2. Click **New Writeup**.
3. **Title:** `Dr.MRI.AI: Evidence-First Medical Imaging Review with Gemma 4`
4. **Subtitle:** `A privacy-first DICOM viewer that lets Gemma 4 pick the right evidence before it reviews any image. Runs entirely in your browser. No backend. No upload.`
5. **Track:** select **Impact Track — Health & Sciences**.
6. **Body:** open `kaggle-writeup.md`, copy everything from the first `## The moment this project started` heading to the end. Paste into the writeup editor. Spot-check that the code-fenced architecture diagram is monospaced and renders correctly.
7. **Attachments → Project Links:**
   - Code: `https://github.com/rabimba/drmriai`
   - Live Demo: `https://rabimba.github.io/drmriai/`
   - Video: your YouTube URL
8. **Media Gallery — upload in this order** (Kaggle uses the first one as the cover):
   1. `cover-image.png` ← **cover image, required**
   2. `asset-architecture.png`
   3. `asset-before-after.png`
   4. `asset-why-gemma.png`
   5. Optional bonus: a screenshot of the live app's plan preview card or final report (capture while recording).
9. **Click Save.**

## Hour 5 — Submit and verify

1. Reopen the writeup. Confirm formatting is intact, all four images render, every link works.
2. Click the **Submit** button in the top-right.
3. Reopen the writeup once more. The header should now say **Submitted**, not **Draft**.
4. Sanity check from an incognito window: confirm the writeup is public, the YouTube link plays, the GitHub repo loads, the live demo loads.
5. Take a screenshot of the "Submitted" status as proof.

---

## Common gotchas (and how to dodge them)

- **You forget to click Submit.** Drafts don't count. Even seasoned hackathon submitters lose to this every cycle.
- **YouTube video set to Unlisted.** Judges may not be able to view. Set to **Public**.
- **Kaggle Writeup over 1,500 words.** Current writeup is 1,495. Don't add prose without trimming elsewhere.
- **Cover image not uploaded.** It's required. Without it the Writeup may not validate.
- **Live demo broken at submission time.** Right before submitting, hit the live demo in incognito and confirm it loads.
- **WebGPU unavailable on the judge's machine.** That's why the writeup explicitly mentions the Ollama / MedGemma fallback. It's intentional defense-in-depth.
- **Repo has secrets committed.** Run `git log -p | grep -i "api_key\|sk-\|gsk_"` once before submission day. Rotate anything you find.

## After submission

- Post the YouTube link to wherever you'd normally share work (X, LinkedIn, Hacker News, r/MedicalAI). The Kaggle leaderboard explicitly references "the wow factor" — judge sentiment can move with external traction.
- Open at least one tracked GitHub issue with a milestone label (e.g., `roadmap: LoRA fine-tune for synthesis`) so the repo looks alive rather than abandoned.
- Save the submitted-state screenshot.

---

## Optional bonuses if you have time after submitting

- Record a 30-second "extended cut" showing the MedGemma + Gemma 4 split via Ollama and post as a follow-up YouTube video, linked from the writeup as an addendum.
- Add a `BENCHMARKS.md` to the repo with the actual measured cold-start / warm-start times you saw during recording. Judges who dig into the repo love this.
- Add 2-3 GIFs to the repo README showing the spotlight prompt → plan → report flow.
