# Project Links — Paste-Ready

These go into the Kaggle Writeup attachments and the YouTube description.

## Public Code Repository

https://github.com/rabimba/drmriai

Verify public from an incognito window before submitting.

## Live Demo

https://rabimba.github.io/drmriai/

Verify it loads in incognito and the bundled sample knee MRI can be loaded.

## YouTube Demo Video

https://www.youtube.com/watch?v=sIceYp5vTQc

Requirements satisfied:

- 3 minutes or less.
- Visibility: **Public** (verify from an incognito window before pasting into Kaggle).
- Attached to the Kaggle Writeup Media Gallery, not only linked in the body.

## Kaggle Writeup

**TODO: paste the final Kaggle Writeup URL here after submitting.**

## Suggested YouTube Title

`Dr.MRI.AI — Evidence-First Medical Imaging with Gemma 4 (Gemma 4 Good Hackathon)`

## Suggested YouTube Description

```
Dr.MRI.AI is a privacy-first DICOM viewer that asks Gemma 4 to pick the
right evidence before it reviews any image. A knee MRI can have 200+
slices across 8 series — we use a text-only Gemma 4 call to plan which
series and slice range are clinically relevant, show that plan to the
user, then send only the 16 selected JPEGs to a multimodal Gemma 4 call.

The public demo runs entirely in your browser on WebGPU using
onnx-community/gemma-4-E2B-it-ONNX via Transformers.js. No upload, no
server, no API key. For users on hardened workstations, the same
provider-agnostic interface also accepts MedGemma + Gemma 4 via Ollama.

Live demo: https://rabimba.github.io/drmriai/
Code:      https://github.com/rabimba/drmriai
Submission: Gemma 4 Good Hackathon · Impact Track · Health & Sciences

Built with React 19, Cornerstone3D v4, dicom-parser, Transformers.js,
WebGPU, and the Gemma 4 model family.

Educational and research use only. Not a medical device. Not for
clinical diagnosis.

Chapters
0:00 The problem
0:25 Gemma 4 in the browser
0:42 The clinical question
1:02 The plan (trust contract)
1:25 Evidence review
1:55 Grounded output
2:20 MedGemma + Gemma 4 (local)
2:40 Close
```

## Suggested YouTube Tags

`gemma, gemma 4, gemma-4-e2b, dicom, medical ai, mri, multimodal ai, webgpu, transformers.js, ollama, medgemma, kaggle, hackathon, on-device ai, privacy first`

## Suggested Social Post (after submitting)

> Just submitted Dr.MRI.AI to the Gemma 4 Good Hackathon. It's an evidence-first DICOM viewer that asks Gemma 4 to pick the right slices *before* it reviews any image — 200+ slices down to 16, 100% in your browser on WebGPU, zero upload. Built around `gemma-4-E2B-it-ONNX` via Transformers.js, with an optional MedGemma + Gemma 4 local path via Ollama for clinical workstations.
>
> Demo: rabimba.github.io/drmriai
> Code: github.com/rabimba/drmriai
> Video: <YouTube URL>
