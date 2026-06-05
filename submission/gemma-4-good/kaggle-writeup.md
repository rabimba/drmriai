# Dr.MRI.AI — Evidence-First Medical Imaging Review with Gemma 4

**Subtitle:** A privacy-first DICOM viewer that lets Gemma 4 pick the right evidence *before* it reviews any image. Three Gemma 4 deployment paths, one provider-agnostic interface, zero upload.

**Track:** Impact Track — Health & Sciences

---

## The moment this project started

A few months ago I sat with my partner in a hospital corridor, scrolling through a CD-ROM of her MRI on a borrowed laptop. The study had over 200 slices across eight series. A single image, looked at in isolation, told me nothing. The radiologist had circled three slices out of the entire study. Three slices were "the answer." The other 197 were context.

That is the fundamental ergonomics problem of every multimodal medical AI demo today. We hand the model the entire haystack and ask it to find the needle, then act surprised when it hallucinates or grounds its answer in the wrong slice. The hard part of medical imaging AI isn't generating a paragraph. It's deciding *what evidence the paragraph should be grounded in.*

**Dr.MRI.AI inverts the usual pattern. The first thing Gemma 4 does is *not* look at images. It looks at the study's structure and decides what to look at.**

## What it does, in 60 seconds

1. Drag a DICOM folder into the browser. Files are parsed locally with `dicom-parser`; nothing is uploaded.
2. Type a clinical question — e.g. *"Evaluate ACL and menisci on this knee MRI."*
3. **Call 1 — Gemma 4 plans.** A text-only prompt is sent to a Gemma 4 model (your pick of three deployment paths, below). The model receives structured DICOM metadata and returns a JSON `SelectionPlan`: which series, which slice range, sampling strategy, window/level.
4. **The plan is shown to the user before any image is touched.** This is the trust contract.
5. **Call 2 — Gemma 4 reviews.** Cornerstone3D renders only the selected slices, applies the planned windowing, exports compact JPEGs (≤768 px long edge, ~140 image tokens), and feeds them to Gemma 4 in batches of four.
6. **Call 3 — Gemma 4 synthesizes.** A final text-only pass merges batch notes into a grounded report with clickable slice references.

Click any finding → the viewer jumps to that exact slice. Export an Evidence ZIP containing the markdown report, JSON manifest, and the exact JPEGs reviewed.

## The number that matters

| Stage | Images Gemma sees | Compute cost |
|---|---|---|
| Naive "send everything" baseline | 200+ DICOM slices | ~314k image tokens (1.6k/img) |
| Dr.MRI.AI evidence-first pipeline | **up to 16 selected JPEGs** | **~2.2k image tokens (140/img)** |

A **~99% reduction in image tokens** while keeping the diagnostically relevant frames. That's the difference between *"I cannot run a multimodal model on my laptop"* and *"I just did."*

## Three ways to run Gemma 4 in Dr.MRI.AI

Dr.MRI.AI ships with a provider-agnostic `LLMService` interface (`getSelectionPlan`, `analyzeSlices`, `sendFollowUp`). All three of the deployment paths below speak that same interface. Judges, clinicians, and enterprise users can each pick the path that fits their constraints — no code change.

**1. Gemma 4 Browser — WebGPU + Transformers.js (the public demo)**
- Model: `onnx-community/gemma-4-E2B-it-ONNX`
- Runtime: `@huggingface/transformers` on WebGPU, `q4f16` quantization
- Zero server, zero API key, zero upload. The whole pipeline lives in a browser tab.
- First-load cached in <2 min on a 2023 Chromebook; subsequent runs are cache-hot.
- This is the path judges will see in the live demo.

**2. Ollama local — MedGemma planner + Gemma 4 vision (the clinician path)**
- Planner (Call 1): `alibayram/medgemma:4b` — MedGemma is the domain-tuned Gemma vertical that already knows medical terminology, sequence selection, and clinical sequence semantics.
- Reviewer (Call 2): `gemma4:latest` — the multimodal Gemma 4 vision model running locally through Ollama.
- For users on hardened clinical workstations who want stronger medical-text reasoning at the planning step. Everything still runs on the user's own machine.
- One CORS-friendly `ollama serve` invocation is all the setup required.

**3. OpenAI-compatible Gemma 4 endpoint — the enterprise gateway path**
- Point Dr.MRI.AI at any `/v1`-compatible chat completions endpoint. Works with Google's own Gemini OpenAI-compat endpoint, with private Gemma 4 hosting on vLLM / TGI / Together / Fireworks / Groq, or with an internal hospital gateway.
- BYOK: the API key is entered at runtime through the Settings panel and never bundled into the build.
- Vision-model detection auto-discovers Gemma 4 multimodal models via `/models` and the model-name regex (`gemma[-_.]?4|gemma4|medgemma`); judges can type any model ID manually too.
- A `npm run openai-proxy` helper ships a local CORS bridge for gateways that don't expose CORS to a static page.

The same `SelectionPlan` JSON contract, the same multimodal batch format, the same Evidence ZIP export — across all three. That portability is the point: medical imaging shouldn't be locked to one vendor's hosting story.

## Why Gemma 4 specifically

Three properties of the Gemma 4 family made this architecture viable.

**Small enough for the browser.** Gemma 4 E2B at `q4f16` is the smallest model size that can run a real multimodal medical pipeline on commodity hardware. This is what makes "frontier intelligence at the edge" stop being a slogan.

**One model serves planner *and* reviewer *and* synthesizer.** Gemma 4 is multimodal and a strong text reasoner. We use one model for all three calls in the pipeline — text-only structured-JSON planning, then multimodal batched review, then text-only synthesis. No model swap, no second context window, no cross-model orchestration.

**An open family with a medical vertical.** Because Gemma is open, an OpenAI-compatible self-host is reasonable, a local Ollama deployment is reasonable, and a domain-tuned MedGemma model already exists for the planning step. Three reproducible deployment paths spring out of one open family.

## Architecture

```
                User: "Evaluate ACL and menisci"
                              │
                              ▼
  ┌───────────────────────────────────────────────────┐
  │  DICOM metadata extraction  (dicom-parser)        │
  │  • 8 series × 200+ slices                         │
  │  • Plane from Image Orientation Patient (0020,0037)│
  │  • Localizers/scouts filtered                     │
  └───────────────────────┬───────────────────────────┘
                          │ structured JSON
                          ▼
              ╔═════════════════════════╗
              ║  Call 1 — Gemma 4       ║   text-only
              ║  Selection Planner      ║   ≤512 tokens out
              ╚═══════════╦═════════════╝
                          │ SelectionPlan JSON
                          ▼
            ┌───── Plan preview shown to user ─────┐
            │  Series #8 sag PD-FS, slices 13-27   │
            │  W/L: 1200 / 350                     │
            │           [Accept] [Edit]            │
            └───────────────┬──────────────────────┘
                            ▼
  ┌───────────────────────────────────────────────────┐
  │  Cornerstone3D renders → windows → exports JPEGs  │
  │  ≤16 images @ 768 px long edge, ~140 tokens each  │
  └───────────────────────┬───────────────────────────┘
                          ▼
              ╔═════════════════════════╗
              ║  Call 2 — Gemma 4       ║   multimodal
              ║  Batched reviewer       ║   batch size 4
              ╚═══════════╦═════════════╝
                          │ batch notes
                          ▼
              ╔═════════════════════════╗
              ║  Call 3 — Gemma 4       ║   text-only
              ║  Synthesis              ║   cites slice labels
              ╚═══════════╦═════════════╝
                          ▼
   Report with clickable slice refs + Evidence ZIP
```

The three Gemma 4 endpoints — WebGPU, Ollama, OpenAI-compat — each plug into the same shape.

## The technical choices, and why they were right

**Three-call decomposition.** Pixels in the planner waste context. Metadata in the reviewer wastes a multimodal call. Each Gemma 4 invocation does one thing well.

**Plane detection from direction cosines, not series text.** We compute anatomical plane from DICOM tag `(0020,0037)` rather than parsing free-text "AX T2," "T2 axial," "AXIAL". The difference between a demo and something a radiologist won't laugh at.

**Window/level applied *before* JPEG export.** Raw DICOM pixel values are uninterpretable. We apply rescale slope/intercept and planned windowing to canvas pixels first, so Gemma sees what a radiologist sees.

**Image-token budget as a first-class control.** We expose 70 / 140 / 280 tokens per image. Higher budgets are disabled because they exceed browser ONNX tensor limits — surfaced honestly in the UI.

## Safety and trust

- Every prompt and every report carry the **"educational and research use only, not for clinical diagnosis"** disclaimer.
- The synthesis step is prompted with the explicit constraint that **findings must cite a slice label** that appears in the batch notes. The model cannot invent.
- The plan is **shown to the user before any image review.** Accept, edit, or reject. That's the meaningful human-in-the-loop affordance most demos lack.
- The Evidence ZIP makes the workflow **auditable**: exact JPEGs, JSON manifest, and markdown report exported together.
- **No PHI is ever transmitted** in the public demo path. Files stay on the user's machine.

## Real-world utility

- **Teaching.** Students see why a sequence matters: change the question, watch Gemma pick a different series.
- **Builders.** Fork the evidence-selection pattern. It generalizes to CT, ultrasound, even pathology tiles.
- **Privacy-sensitive review.** Run a frontier multimodal model against local studies without sending pixels anywhere.
- **Enterprise gateways.** Hospitals with an internal Gemma 4 deployment plug in with an `/v1` URL.

## What's next

A Gemma 4 LoRA fine-tune on RadGraph-style structured findings to push synthesis from "educational summary" toward "structured report draft a radiologist would edit." All three deployment paths can host the fine-tuned weights without code change.

---

**Live demo:** https://rabimba.github.io/drmriai/ &nbsp;·&nbsp; **Code:** https://github.com/rabimba/drmriai &nbsp;·&nbsp; **Video:** https://www.youtube.com/watch?v=sIceYp5vTQc
