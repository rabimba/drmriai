# Final Submission Checklist

Deadline context: submit before the Kaggle deadline shown on the competition page. Draft Writeups do not count.

## 1. Track And Positioning

- Select **Impact Track - Health & Sciences**.
- Position Dr.MRI.AI as **evidence-first educational imaging review**, not automated diagnosis.
- Use **Gemma 4 Browser** as the judge-reproducible path.
- Mention **MedGemma + Gemma 4 via Ollama** as an optional advanced local workflow, not the only demo path.
- Avoid clinical-performance claims unless backed by a reproducible benchmark.

## 2. Required Kaggle Assets

- Kaggle Writeup: paste `kaggle-writeup.md`.
- Cover image: upload `cover-image.png` to the Media Gallery.
- Video: upload/publish to YouTube, then attach the direct YouTube link to the Media Gallery.
- Public code repo: attach `https://github.com/rabimba/drmriai` under Project Links.
- Live demo: attach `https://rabimba.github.io/drmriai/` under Project Links.
- Extra media if time allows:
  - Landing screen with privacy/evidence language.
  - Settings panel showing **Gemma 4 Browser** and WebGPU.
  - Optional settings shot showing **MedGemma 4B** and **Gemma 4** under Ollama.
  - Plan preview showing selected series/slices.
  - Final report with clickable slice references or Evidence ZIP export.

## 3. Pre-Submit QA

- Run `npm run build`.
- Open the live demo from an incognito window.
- Load the bundled sample knee MRI.
- In Settings, choose **Gemma 4 Browser**.
- Confirm:
  - WebGPU is available, if your recording machine supports it.
  - Model ID is `onnx-community/gemma-4-E2B-it-ONNX`.
  - Dtype is `q4f16`.
  - Max images is 16.
  - Batch/image-token controls are visible.
- Warm the Gemma Browser model cache before recording.
- Ask: `Evaluate ACL and menisci on this knee MRI.`
- Confirm:
  - Plan preview appears before analysis.
  - Selected series/slices are visible and editable.
  - Analysis produces a report.
  - Slice references are clickable.
  - Evidence ZIP downloads and includes report, JSON, manifest, and reviewed JPEG slices.
- Check there are no committed API keys, PHI, or private DICOM files.

## 4. Optional Ollama QA For Video

- Start Ollama locally with browser CORS configured if recording from the hosted demo.
- Confirm `alibayram/medgemma:4b` is installed for text planning.
- Confirm `gemma4:latest` is installed for vision review.
- Show this as the "advanced local workflow" only. Judges should not need it to understand or try the public demo.

## 5. Kaggle Submission Steps

1. Open the competition page and click **New Writeup**.
2. Add title: `Dr.MRI.AI: Evidence-First Medical Imaging Review with Gemma 4`.
3. Add subtitle from `kaggle-writeup.md`.
4. Select **Health & Sciences** as the track.
5. Paste the body from `kaggle-writeup.md`.
6. Add project links: GitHub repo, live demo, YouTube video.
7. Upload `cover-image.png` as the cover image.
8. Attach the YouTube video to the Media Gallery.
9. Save the Writeup.
10. Click **Submit** in the top right.
11. Re-open the Writeup and verify it says submitted, not draft.

## 6. Last-Hour Priorities

1. Public YouTube video under 3 minutes.
2. Kaggle Writeup submitted, not draft.
3. Public GitHub repo link.
4. Live demo link.
5. Cover image.
6. Extra screenshots.
