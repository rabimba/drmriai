# Dr.MRI.AI

**AI-Powered Medical Image Analysis**

Smart slice selection meets multimodal AI analysis. Dr.MRI.AI is a web-based DICOM viewer that intelligently selects the right images before sending them to an LLM for analysis — because the hard part isn't the AI, it's knowing what to send it.

Developed by Rabimba.

> ⚠️ **Educational and research use only.** Not a certified medical device. Not intended for clinical diagnosis or treatment decisions.

## Motivation

I started building Dr.MRI.AI after spending time around my partner&apos;s scans and realizing how hard it is to quickly focus on the few slices that actually matter in a large study. The goal was not to replace a radiologist, but to build a privacy-first research tool that can narrow hundreds of images into a smaller, explainable subset for review, discussion, and experimentation.

https://rabimba.github.io/drmriai/

## How It Works

A knee MRI can have 200+ slices across 8+ series. Dumping them all to an AI gives garbage results. Dr.MRI.AI uses a **two-call architecture**:

1. **Load** — Drag and drop DICOM files or folders into the browser
2. **Analyze** — Describe what to evaluate (e.g., "evaluate for ACL tear grade")
3. **Plan** — The LLM analyzes study metadata and selects the optimal series, slice range, and windowing based on the clinical question
4. **Review** — Only the focused slices are sent for multimodal analysis, producing findings with interactive slice references you can click to navigate

## Key Features

- **Smart slice filtering** — AI reasons about which series orientation, weighting, and slice range are diagnostically relevant, then samples only those slices
- **Multi-series support** — Automatic scout detection, series metadata extraction (orientation, MRI weighting, resolution)
- **Interactive results** — Clickable slice references in findings jump the viewer to the referenced image
- **Privacy-first** — DICOM files are processed entirely in your browser. No data is uploaded to any server. Image data is only sent to the LLM provider you configure when you run an analysis, and Gemma 4 Browser keeps both planning and analysis on-device
- **Multiple layouts** — 1×1, 1×2, 2×1, 2×2 grid, and MPR (axial/sagittal/coronal)
- **Standard tools** — Window/Level, Zoom, Pan, Length measurement, Rotate, Flip, Invert, Cine playback
- **Provider-agnostic** — Works with Gemini API, OpenAI-compatible endpoints, local models via Ollama, or browser-local Gemma 4 models

## Getting Started

### Live demo

GitHub Pages: https://rabimba.github.io/drmriai/

### Run locally

```bash
npm install
npm run dev
```


### Configure AI analysis

1. Click the ⚙ Settings icon in the toolbar
2. Keep **Ollama** as the default local workflow, or switch to **Gemini API** / **OpenAI-Compatible** and enter your runtime endpoint credentials
3. Load DICOM files, open the AI workspace, and describe what to evaluate

For local models, install [Ollama](https://ollama.ai), pull a model (`ollama pull gemma3:4b`), and select Ollama in settings. Note: local models usually produce lower quality results for medical image analysis than the hosted Gemini path.

For private or enterprise gateways, select **OpenAI-Compatible**, enter the `/v1` endpoint URL and API key, then click **Refresh models**. The app calls `/models` to populate text and vision model dropdowns. Because OpenAI-compatible model metadata does not standardize multimodal capabilities, vision support is inferred from model names; if your gateway uses custom names, you can still type model IDs manually.

OpenAI-compatible endpoints must allow browser CORS for both model discovery and chat completions. If an endpoint works with `curl` but fails in the app, configure the gateway to allow the app origin, methods `GET, POST, OPTIONS`, and headers `Authorization, Content-Type`. For local development only, you can run Vite with a same-origin proxy:

```bash
VITE_OPENAI_COMPAT_PROXY_TARGET=https://your-gateway.example.com/v1 npm run dev
```

Then use `/openai-compatible-proxy` as the OpenAI-compatible endpoint in Settings. GitHub Pages cannot run this proxy; hosted static deployments need the upstream gateway to expose CORS or a separate serverless proxy.

The default provider is **Ollama** for a more stable local workflow. **Gemma 4 Browser** is available for fully browser-local analysis through Transformers.js + WebGPU:

- **Model**: `onnx-community/gemma-4-E2B-it-ONNX`
- **Runtime**: `@huggingface/transformers` with WebGPU and `q4f16`
- **Default image budget**: up to 16 sampled JPEGs at a reduced 768px browser-friendly export size
- **Analysis mode**: chunked browser inference. Images are reviewed in batches of up to 4, then synthesized with a final text-only pass.
- **Image token budget**: 70, 140, or 280 tokens/image. Higher budgets are intentionally disabled because they can exceed browser ONNX tensor limits.
- **Requirement**: a WebGPU-capable browser such as a recent Chrome or Edge build

On the first run, the pipeline shows Gemma model download/load status while the browser caches the model files. Debug logs are also exposed in the browser console under `[GemmaTransformers]` and `[Dr.MRI.AI]`. To copy the structured log buffer for debugging, run:

```js
window.__DRMRIAI_PRINT_DEBUG_LOGS__()
```


## Tech Stack

- **React 19** + TypeScript + Vite
- **Cornerstone3D v4** — medical image rendering, viewport management, tools
- **Gemini API** — optional hosted multimodal LLM for image analysis
- **OpenAI-compatible endpoints** — optional hosted/private chat completions gateways with runtime BYOK credentials
- **Ollama** — optional local model support
- **Gemma 4 Browser + Transformers.js/WebGPU** — optional browser-local on-device inference

## Deployment

This app is deployable as a static site on free tiers because there is no required backend. The important constraints are:

- Use Node 20+ for builds. `package.json` now declares that explicitly.
- Use the full `npm run build` command so TypeScript is checked before deploy.
- Do not put production Gemini or OpenAI-compatible API keys into `VITE_*` environment variables on a static host. Those values are bundled into client JavaScript. For hosted demos, keep the current runtime BYOK flow in the settings panel.
- Ollama only works for the person running Ollama locally. If you deploy to GitHub Pages, Vercel, or `*.pages.dev`, public visitors will not be able to use your local Ollama instance. On hosted HTTPS pages, keep the Ollama URL as `http://localhost:11434` or `http://127.0.0.1:11434`; do not use `0.0.0.0`.
- Gemma browser providers stay fully static, but first load is heavier because the browser downloads the model bundle and WebGPU runtime.

### GitHub Pages

This repo includes a GitHub Actions workflow at `.github/workflows/deploy-pages.yml` for the project Pages URL:

```text
https://rabimba.github.io/drmriai/
```

The workflow builds with `VITE_BASE_PATH=/drmriai/`, so Vite emits asset URLs under `/drmriai/` and the bundled sample knee MRI is loaded from `/drmriai/sample-data/sample-knee-mri.zip`.

For local Ollama from the hosted Pages app, start Ollama with the Pages origin allowed:

```bash
OLLAMA_ORIGINS=https://rabimba.github.io ollama serve
```

One-time repository setup:

1. Go to GitHub repo Settings → Pages.
2. Under Build and deployment, set Source to **GitHub Actions**.
3. Push to `main`, or run **Deploy GitHub Pages** manually from the Actions tab.

### Vercel

Vercel has first-class Vite support. The current Vercel docs show Vite as a supported frontend framework: [Vite on Vercel](https://vercel.com/docs/frameworks/frontend/vite).

1. Push the repo to GitHub.
2. Import the repo in Vercel.
3. Keep the output directory as `dist`.
4. Build with `npm run build`.
5. Deploy.

### Cloudflare Pages

Cloudflare Pages also supports this setup directly. Cloudflare’s build configuration docs list `React (Vite)` with `npm run build` as the build command and `dist` as the build directory: [Cloudflare Pages build configuration](https://developers.cloudflare.com/pages/configuration/build-configuration/).

1. Push the repo to GitHub.
2. Create a new Pages project from that repo.
3. Set the production branch to `main`.
4. Set the build command to `npm run build`.
5. Set the build output directory to `dist`.
6. Deploy.

### Gemini Notes

Google’s Gemini docs show an OpenAI-compatible chat completions endpoint at `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions`, which is what the hosted provider now uses. The current stable production naming guidance recommends specific stable model strings such as `gemini-2.5-flash`: [Gemini models](https://ai.google.dev/gemini-api/docs/models), [OpenAI compatibility](https://ai.google.dev/gemini-api/docs/openai).

Google also explicitly warns not to expose Gemini API keys client-side in production web apps: [Gemini API key guidance](https://ai.google.dev/gemini-api/docs/api-key). For this project, that means either:

- Keep the static deployment and require each user to paste their own Gemini key at runtime.
- Add a small serverless proxy later if you want a single managed project key.

## Architecture

```
User prompt ("evaluate ACL tear")
        │
        ▼
   ┌─────────┐     Study metadata
   │  Call 1  │◄─── (series list, orientations,
   │  (text)  │     slice counts, resolutions)
   └────┬────┘
        │ Selection plan:
        │ Series #8 sagittal PD-FS, slices 13-27
        ▼
   ┌──────────┐     Focused JPEG exports
   │  Call 2   │◄─── (15 slices, windowed,
   │ (vision)  │     with slice labels)
   └────┬─────┘
        │
        ▼
   Findings with slice references
```

## Contributing

Contributions are welcome! This is an open-source project — feel free to open issues, submit PRs, or suggest features.

## License

MIT

---

*Dr.MRI.AI is an educational tool built to demonstrate intelligent data preparation for AI-powered medical image analysis. It is not a certified medical device and must not be used for clinical decision-making.*
