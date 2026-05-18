# Dr.MRI.AI: Evidence-First Medical Imaging Review with Gemma 4

**Subtitle:** A privacy-first DICOM viewer that uses Gemma 4 and MedGemma to choose the evidence before asking a model to review images.

**Track:** Impact Track - Health & Sciences

## Summary

Dr.MRI.AI is an evidence-first medical imaging research tool built around Google's open Gemma model ecosystem. It lets a user load a DICOM study in the browser, ask a focused clinical question, and use Gemma models to select the relevant series and slices before multimodal analysis begins.

The core idea is simple: medical imaging AI should not start by sending hundreds of unfiltered slices to a model. It should first decide what evidence is relevant, show that plan to the user, and keep every conclusion tied back to the exact images reviewed.

The public demo is a static web app with no required backend and no bundled API key. The reproducible judge path uses `onnx-community/gemma-4-E2B-it-ONNX` through Transformers.js and WebGPU. The advanced local workflow uses Ollama with `alibayram/medgemma:4b` for medical text planning and `gemma4:latest` for local vision review. The submission visuals use a Google-inspired color system to make the Gemma 4 connection clear without implying official endorsement.

Educational and research use only. This is not a medical device and must not be used for clinical diagnosis.

## Problem

A DICOM study is not one image. A knee MRI can contain hundreds of slices across sagittal, coronal, and axial series. A CT can include multiple reconstructions with different kernels and window presets. Generic multimodal prompting often ignores that structure: the model sees too many images, the wrong series, or images without spatial context.

That weakens grounding and makes the output harder to audit. It also creates practical barriers for the communities this challenge highlights. Classrooms, rural sites, and privacy-sensitive review workflows need AI assistance that can run close to the data instead of uploading an entire study to a remote service.

## Solution

Dr.MRI.AI combines a real DICOM viewer with a Gemma-powered evidence planner.

1. The user loads local DICOM files or the bundled sample knee MRI.
2. The app extracts metadata with `dicom-parser`, groups files by series, detects anatomical plane from Image Orientation Patient, and sorts slices by position or instance number.
3. The user asks a focused question, such as "Evaluate ACL and menisci."
4. A text-only planning call returns structured JSON: selected series, slice range, sampling strategy, and windowing.
5. The plan is shown before analysis, and the user can accept or adjust it.
6. Cornerstone3D renders only the selected slices, applies window/level, and exports compact JPEG evidence.
7. Gemma reviews the images in small batches, then synthesizes an educational report that cites exact slice labels.
8. The report remains connected to the viewer through clickable slice references and an exportable evidence ZIP.

## How We Use Gemma 4 and MedGemma

The public path is **Gemma 4 Browser**:

- Model: `onnx-community/gemma-4-E2B-it-ONNX`
- Runtime: `@huggingface/transformers`
- Device: WebGPU
- Default dtype: `q4f16`
- Image budget: up to 16 selected JPEGs
- Batch size: up to 4 images
- Image token budget: 70, 140, or 280 tokens per image

Gemma 4 Browser powers three stages: metadata planning, multimodal batch review, and text-only follow-up synthesis. This makes the demo reproducible as a static site: DICOM files stay local, the model runs in the browser, and no server is needed.

The optional local Ollama workflow uses a stronger specialization split inside the same Gemma family story. `alibayram/medgemma:4b` handles the first text-only planning call, where medical terminology and sequence selection matter. `gemma4:latest` handles the second multimodal image-analysis call. Both are local models controlled by the user.

## Architecture

The app is built with React, TypeScript, Vite, Tailwind CSS, Cornerstone3D, and a provider-agnostic LLM layer. Every provider implements the same interface: `getSelectionPlan`, `analyzeSlices`, and `sendFollowUp`.

The two-stage architecture is the important technical choice. Call 1 reasons over metadata, not pixels. Call 2 receives only the selected evidence. This lowers the image burden, reduces irrelevant context, and creates an audit trail from prompt to plan to reviewed slices to final report.

The evidence pipeline also exports a ZIP containing markdown, JSON, a manifest, and the exact JPEG slices reviewed. That makes the output portable and inspectable.

## Novelty

Most AI imaging demos focus on the final generated answer. Dr.MRI.AI focuses on the step before the answer: evidence selection. The model must decide which series and slices matter, and the user can inspect that decision before image review starts.

The app also avoids brittle shortcuts. It does not trust free-text series descriptions alone. It computes anatomical plane from DICOM direction cosines, filters localizer/scout series, preserves slice labels, and applies windowing before export so the model sees clinically meaningful grayscale images.

## Safety and Trust

Dr.MRI.AI is intentionally conservative:

- Every prompt and report includes non-clinical-use language.
- The model is asked to cite exact slices for findings.
- The synthesis step may only use findings supported by batch notes.
- The UI exposes limitations when structures are under-sampled.
- Users can click findings back to the source slice.
- Evidence bundles preserve what was actually reviewed.

The goal is not to replace a radiologist. The goal is to make AI-assisted image review more local, transparent, and grounded.

## Real-World Utility

Dr.MRI.AI can help students, builders, and researchers understand how multimodal models reason over medical imaging studies without hiding the evidence. It is useful for teaching sequence selection, testing local model behavior, and exploring privacy-preserving workflows where sensitive image data should stay close to the user.

## Links

- Live demo: https://rabimba.github.io/drmriai/
- Code: https://github.com/rabimba/drmriai
- Video: TODO
