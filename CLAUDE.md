# CLAUDE.md — Dr.MRI.AI

## Project Overview

A web-based DICOM viewer with LLM chat integration. The core innovation is **smart slice filtering**: instead of dumping 400+ slices into an LLM, we intelligently select relevant slices based on a clinical hint (what the doctor suspects), DICOM metadata, and a two-call LLM architecture. Analysis depth (fast/standard/full) controls how far the seed plan is expanded. Reports can be exported alone or as an evidence bundle ZIP (report + manifest + reviewed JPEGs).

This is a portfolio project. Public GitHub repo + demo video. Goal: showcase clinical product knowledge + technical engineering skills.

## Tech Stack

- **Frontend**: React 19 + Vite + TypeScript
- **Viewer**: Cornerstone3D v4 (`@cornerstonejs/core@^4`, `@cornerstonejs/tools@^4`, `@cornerstonejs/dicom-image-loader@^4`)
- **Styling**: Tailwind CSS v4
- **Icons**: lucide-react
- **LLM**: Abstracted service layer with 4 providers (provider-agnostic `LLMService` interface):
  - **Gemini API** (hosted, e.g. gemini-2.5-flash, OpenAI-compatible endpoint)
  - **OpenAI-compatible** (any /v1 chat-completions endpoint, optional local CORS proxy `npm run openai-proxy`)
  - **Ollama** (split text/vision models, local)
  - **Gemma Browser** (Transformers.js + WebGPU, fully in-browser, model downloaded to browser cache)
- **LLM API access**: Client-side calls with user-provided API key (runtime input, stored in localStorage, not bundled)
- **Data**: Local DICOM files only (drag-and-drop / file picker), no backend. Sample knee MRI bundled under `public/sample-data/`

## Vite Configuration (Critical)

Cornerstone3D requires specific Vite config. This is non-negotiable:

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteCommonjs } from '@originjs/vite-plugin-commonjs';

export default defineConfig({
  plugins: [
    react(),
    viteCommonjs(), // Required: dicom-parser is still CommonJS
  ],
  optimizeDeps: {
    exclude: ['@cornerstonejs/dicom-image-loader'],
    include: ['dicom-parser'],
  },
  worker: {
    format: 'es',
  },
  assetsInclude: ['**/*.wasm'], // needed for codec WASM files
});
```

## Project Structure

```
Dr.MRI.AI/
├── src/
│   ├── viewer/              # Cornerstone3D setup, viewports, toolbar
│   │   ├── CornerstoneInit.ts       # One-time init of core + tools + imageLoader
│   │   ├── ViewportGrid.tsx          # Viewport layout (stack + MPR + grid), SliceSlider
│   │   ├── viewportUtils.ts          # Shared viewport info extraction helpers
│   │   ├── EmptyViewportOverlay.tsx  # Series picker for empty grid slots
│   │   ├── Toolbar.tsx               # Tool buttons (W/L, Zoom, Pan, Length, layouts, etc.)
│   │   ├── DicomDropZone.tsx         # Drag-and-drop + file picker + sample-data loading
│   │   └── LoadingOverlay.tsx        # Prefetch progress indicator
│   ├── dicom/               # Metadata extraction and parsing
│   │   ├── MetadataExtractor.ts      # Extract DICOM tags, group by series, compute fields
│   │   ├── orientationUtils.ts       # Anatomical plane detection from direction cosines
│   │   └── types.ts                  # DICOM metadata type definitions
│   ├── filtering/           # Slice selection logic
│   │   ├── SliceSelector.ts          # Apply LLM selection plan to actual slices
│   │   ├── SliceExporter.ts          # Windowed DICOM → JPEG (MONOCHROME1/RGB aware)
│   │   └── types.ts                  # SelectedSlice type
│   ├── llm/                 # LLM integration (provider-agnostic)
│   │   ├── LLMServiceFactory.ts      # Gemini + OpenAI-compatible + Ollama + Gemma services
│   │   ├── PromptBuilder.ts          # Constructs prompts from metadata + hint
│   │   ├── useLLMChat.ts             # React hook: pipeline orchestration + state
│   │   ├── analysisDepth.ts          # Fast/Standard/Full coverage policies per provider
│   │   ├── anatomyChecklists.ts      # Body-part detection + guided survey structures
│   │   ├── GemmaTransformersRuntime.ts  # Transformers.js WebGPU session + generation
│   │   ├── gemmaTransformersConfig.ts   # Gemma Browser defaults + WebGPU detection
│   │   ├── ollamaConfig.ts           # Ollama URL normalization + mixed-content guard
│   │   └── types.ts                  # LLMService interface, SelectionPlan, ChatMessage
│   ├── ui/                  # App-level UI components
│   │   ├── LandingScreen.tsx         # Marketing/landing page with upload zone
│   │   ├── DisclaimerModal.tsx       # Research-use disclaimer gate
│   │   ├── ChatSidebar.tsx           # Analysis console: launchpad, chat, exports
│   │   ├── PipelineView.tsx          # Pipeline step visualization
│   │   ├── PlanPreviewCard.tsx       # Editable selection plan + depth picker
│   │   ├── AssistantMessage.tsx      # Formatted LLM response with interactive slice refs
│   │   ├── SeriesBrowser.tsx         # Series list for grid slot selection
│   │   ├── MetadataPanel.tsx         # Shows extracted DICOM metadata summary
│   │   └── SettingsPanel.tsx         # LLM provider configuration (all 4 providers)
│   ├── utils/
│   │   ├── sampleDataLoader.ts       # Downloads + unzips bundled sample knee MRI
│   │   └── logger.ts                 # Dev-gated console logging
│   ├── App.tsx
│   └── main.tsx
├── public/sample-data/      # Bundled sample knee MRI zip (~32MB)
├── screenshots/             # Screenshots for README
├── AGENTS.md
├── README.md
└── package.json
```

## Core User Flow

This is the single end-to-end workflow the MVP must support:

```
1. User drags DICOM folder onto the app
2. App loads files via Cornerstone3D fileManager (progressive loading with progress bar)
3. Metadata extracted from all DICOM headers (fast, no pixel decoding)
4. Files organized by series, sorted by instance/position
5. Viewer displays the primary axial series with standard tools
   - Primary series = axial series with the most slices (tie-break: lowest series number)
   - Axial detection uses Image Orientation Patient direction cosines, NOT series description
6. User hits Cmd+K → chat sidebar opens and its prompt input is focused
7. User types clinical hint: "Patient with hepatitis C history, evaluate for HCC"
8. FIRST LLM CALL (text-only, cheap):
   - Input: metadata summary + clinical hint
   - Output: structured SelectionPlan (which series, slice range, window/level, sampling)
   - If the LLM returns invalid JSON, a metadata heuristic fallback plan is used (all providers)
9. Plan preview card appears (editable: series, range, count, W/L, depth) — user confirms or cancels
10. App applies the plan:
    - Viewer scrolls to relevant slice range
    - Window/level adjusts to recommended values
    - Selected slices exported as JPEG (resized to ≤1568px long edge)
11. SECOND LLM CALL (multimodal, batched when image count exceeds provider batch size):
    - Input: selected JPEG images + metadata context + clinical hint
    - Output: clinical analysis text
12. Response appears in chat sidebar; slice references are clickable and navigate the viewer
13. User can ask follow-up questions (conversation continues in sidebar)
    - Follow-ups are text-only: bounded conversation history sent as context, no new images
    - For a fresh analysis with different slices/series, user starts a new two-call cycle
```

## Cornerstone3D Implementation Notes

### Initialization
Initialize once at app startup. All three init calls are async in v4:
```ts
import { init as csRenderInit } from '@cornerstonejs/core';
import { init as csToolsInit } from '@cornerstonejs/tools';
import { init as dicomImageLoaderInit } from '@cornerstonejs/dicom-image-loader';

await csRenderInit();
await csToolsInit();
dicomImageLoaderInit({ maxWebWorkers: navigator.hardwareConcurrency || 1 });
```

Optional: configure camera FOV behavior (v4 removed the 10% padding from v3):
```ts
await csRenderInit({
  rendering: {
    useLegacyCameraFOV: true, // restore v3-style 10% padding if needed
  },
});
```

### Loading Local Files
Use the fileManager to register dropped files:
```ts
import cornerstoneDICOMImageLoader from '@cornerstonejs/dicom-image-loader';

// For each file from the drop event:
const imageId = cornerstoneDICOMImageLoader.wadouri.fileManager.add(file);
// Collect all imageIds, then set as stack on viewport
```

### Tool Registration
Register tools and bind to mouse buttons via ToolGroup. Note: `StackScrollMouseWheelTool` was renamed to `StackScrollTool` in v2+. Use `MouseBindings` enum instead of raw numbers:
```ts
import {
  addTool,
  ToolGroupManager,
  WindowLevelTool,
  PanTool,
  ZoomTool,
  StackScrollTool,          // renamed from StackScrollMouseWheelTool
  LengthTool,
  Enums as csToolsEnums,
} from '@cornerstonejs/tools';

// Register tools globally (once)
addTool(WindowLevelTool);
addTool(PanTool);
addTool(ZoomTool);
addTool(StackScrollTool);
addTool(LengthTool);

// Create tool group and add tools
const toolGroup = ToolGroupManager.createToolGroup('mainTools');
toolGroup.addTool(WindowLevelTool.toolName);
toolGroup.addTool(PanTool.toolName);
toolGroup.addTool(ZoomTool.toolName);
toolGroup.addTool(StackScrollTool.toolName);
toolGroup.addTool(LengthTool.toolName);

// Associate viewport with tool group
toolGroup.addViewport(viewportId, renderingEngineId);

// Default bindings using MouseBindings enum
toolGroup.setToolActive(WindowLevelTool.toolName, {
  bindings: [{ mouseButton: csToolsEnums.MouseBindings.Primary }],      // Left click
});
toolGroup.setToolActive(PanTool.toolName, {
  bindings: [{ mouseButton: csToolsEnums.MouseBindings.Auxiliary }],     // Middle click
});
toolGroup.setToolActive(ZoomTool.toolName, {
  bindings: [{ mouseButton: csToolsEnums.MouseBindings.Secondary }],     // Right click
});
toolGroup.setToolActive(StackScrollTool.toolName, {
  bindings: [{ mouseButton: csToolsEnums.MouseBindings.Wheel }],         // Scroll wheel
});
```

### Toolbar UI
Simple row of icon buttons. Each button calls `toolGroup.setToolActive(toolName, { bindings: [{ mouseButton: csToolsEnums.MouseBindings.Primary }] })` for left-click binding. Use lucide-react icons. Active tool gets a highlighted state. This is NOT complex — it's a basic React component with ~50-80 lines.

### Viewport Types
- **StackViewport** (`Enums.ViewportType.STACK`): For scrolling through a 2D stack of axial slices (primary view)
- **VolumeViewport** (`Enums.ViewportType.ORTHOGRAPHIC`): For MPR (axial, coronal, sagittal reconstructions). Note: use `ORTHOGRAPHIC`, not `VOLUME`.

Both come out of the box from Cornerstone3D. Start with StackViewport. MPR can be added as a layout toggle — Cornerstone3D handles the rendering, we just create VolumeViewports and load the volume.

```ts
import { RenderingEngine, Enums, volumeLoader, setVolumesForViewports } from '@cornerstonejs/core';

// Stack viewport setup:
const renderingEngine = new RenderingEngine('myRenderingEngine');
renderingEngine.enableElement({
  viewportId: 'CT_STACK',
  element: htmlDivElement,
  type: Enums.ViewportType.STACK,
});
const viewport = renderingEngine.getViewport('CT_STACK');
viewport.setStack(imageIds, 0); // 0 = initial slice index
viewport.render();

// Volume/MPR viewport setup (for later phases):
renderingEngine.setViewports([
  {
    viewportId: 'CT_AXIAL',
    element: element1,
    type: Enums.ViewportType.ORTHOGRAPHIC,
    defaultOptions: { orientation: Enums.OrientationAxis.AXIAL },
  },
  {
    viewportId: 'CT_SAGITTAL',
    element: element2,
    type: Enums.ViewportType.ORTHOGRAPHIC,
    defaultOptions: { orientation: Enums.OrientationAxis.SAGITTAL },
  },
]);
const volume = await volumeLoader.createAndCacheVolume('myVolume', { imageIds });
volume.load();
setVolumesForViewports(renderingEngine, [{ volumeId: 'myVolume' }], ['CT_AXIAL', 'CT_SAGITTAL']);
```

### Performance
300-500MB DICOM datasets will work client-side. Cornerstone3D uses:
- Web Workers for multi-threaded decoding
- Progressive loading (user can scroll before all slices are decoded)
- GPU-accelerated rendering via WebGL

Expect 10-20 second initial load for large datasets. Show a progress bar. Memory usage can be ~2x the file size due to web worker buffer duplication.

## DICOM Metadata Tags to Extract

### Study-Level (extract once from first file)
| Tag | Name | Purpose |
|-----|------|---------|
| (0008,1030) | Study Description | "CT CHEST WITH CONTRAST" — scan context |
| (0018,0015) | Body Part Examined | "CHEST", "ABDOMEN" — unreliable (~15% error), use as hint only |
| (0008,0060) | Modality | CT, MR, US — determines analysis approach |
| (0010,1010) | Patient's Age | Clinical context for LLM |
| (0010,0040) | Patient's Sex | Clinical context for LLM |
| (0008,0020) | Study Date | Temporal context |
| (0008,0080) | Institution Name | Context |

### Series-Level (extract per unique series)
| Tag | Name | Purpose |
|-----|------|---------|
| (0008,103E) | Series Description | "AXIAL 3mm", "LUNG WINDOW" — human-readable series ID |
| (0020,0011) | Series Number | Series ordering |
| (0018,0050) | Slice Thickness | Resolution — thin slices = more detail |
| (0018,0088) | Spacing Between Slices | Continuity and coverage |
| (0018,1210) | Convolution Kernel | "LUNG", "BONE", "SOFT" — reconstruction type, critical for series selection |
| (0028,1050) | Window Center | Preset viewing parameters |
| (0028,1051) | Window Width | Preset viewing parameters |

### Per-Slice Spatial (for filtering)
| Tag | Name | Purpose |
|-----|------|---------|
| (0020,0032) | Image Position Patient | xyz coordinates — essential for z-range slice selection |
| (0020,0037) | Image Orientation Patient | Direction cosines — reliable axial/coronal/sagittal detection |
| (0020,0013) | Instance Number | Slice ordering within series |
| (0020,1041) | Slice Location | z-position shorthand |

### Key Insight
Image Orientation Patient (0020,0037) is MORE reliable than Series Description for determining the anatomical plane. Compute the plane from direction cosines rather than parsing free-text descriptions.

## LLM Integration Architecture

### Type Definitions
```ts
// --- DICOM Metadata Types (src/dicom/types.ts) ---

interface SliceMetadata {
  instanceNumber: number;
  imagePositionPatient: [number, number, number]; // x, y, z
  imageOrientationPatient: [number, number, number, number, number, number];
  sliceLocation?: number;
  imageId: string; // Cornerstone imageId for this slice
}

interface SeriesMetadata {
  seriesInstanceUID: string;
  seriesNumber: number;
  seriesDescription: string;
  modality: string;
  sliceThickness?: number;
  spacingBetweenSlices?: number;
  convolutionKernel?: string;
  windowCenter?: number;
  windowWidth?: number;
  anatomicalPlane: 'axial' | 'coronal' | 'sagittal' | 'oblique';
  zMin: number;                   // Computed: min z-position across slices
  zMax: number;                   // Computed: max z-position
  zCoverageInMm: number;          // Computed: zMax - zMin
  instanceNumberRange: [number, number]; // Computed: [min, max] instance numbers
  slices: SliceMetadata[];
}

interface StudyMetadata {
  studyDescription: string;
  bodyPartExamined?: string;
  modality: string;
  patientAge?: string;
  patientSex?: string;
  studyDate?: string;
  institutionName?: string;
  primarySeriesUID: string;       // UID of the auto-selected primary series
  series: SeriesMetadata[];
}

// --- LLM Types (src/llm/types.ts) ---

interface SeriesSelection {
  seriesNumber: string;         // Series Number as string, e.g., "3" (NOT Series UID)
  role: 'primary' | 'supplementary';
  rationale: string;
  sliceRange: [number, number]; // Inclusive instance number range [start, end]
  samplingStrategy: 'every_nth' | 'uniform' | 'all';
  samplingParam?: number;       // Required for every_nth and uniform, ignored for all
  windowCenter: number;
  windowWidth: number;
}

interface SelectionPlan {
  reasoning: string;              // LLM explains why these selections
  selections: SeriesSelection[];  // 1 primary + 0-2 supplementary series
  totalImages: number;
  analysisDepth?: AnalysisDepth;  // 'fast' | 'standard' | 'full'
  // Legacy shortcuts mirroring selections[0] — used by App.tsx viewport logic:
  targetSeries: string;
  sliceRange: [number, number];
  windowCenter: number;
  windowWidth: number;
  samplingStrategy: 'every_nth' | 'uniform' | 'all';
  samplingParam?: number;
}

// samplingStrategy semantics:
//   'every_nth' — samplingParam = N, take every Nth slice (e.g., 5 → slices 1,6,11,16...)
//   'uniform'   — samplingParam = N, pick exactly N slices evenly spaced across the range
//   'all'       — take every slice in the range
// Hard guardrail (fixSelectionPlan in useLLMChat.ts): clamp ranges to metadata,
// sanitize window/level, drop localizer series, cap total ≤20 (seed) or depth budget.

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

type ProviderType = 'gemini' | 'ollama' | 'openai-compatible' | 'gemma-transformers';

interface ProviderConfig {
  provider: ProviderType;
  apiKey?: string;                // Gemini only
  geminiModel?: string;           // Gemini hosted model
  ollamaTextModel?: string;      // Ollama model for Call 1 (text-only planning)
  ollamaVisionModel?: string;    // Ollama model for Call 2 (multimodal analysis)
  ollamaUrl?: string;            // Ollama base URL override
  openAiCompatibleBaseUrl?: string;   // OpenAI-compatible /v1 endpoint
  openAiCompatibleApiKey?: string;
  openAiCompatibleTextModel?: string;
  openAiCompatibleVisionModel?: string;
  analysisDepth?: AnalysisDepth;  // default coverage depth
  gemmaTransformersModelId?: string;  // Gemma Browser model repo id
  gemmaTransformersDtype?: string;    // e.g. q4f16
  gemmaTransformersMaxImages?: number;
  gemmaTransformersImageTokenBudget?: number;
}

interface ViewportContext {
  currentInstanceNumber: number;
  currentZPosition: number;
  seriesNumber: string;
  totalSlicesInSeries: number;
}

interface LLMService {
  getSelectionPlan(metadata: StudyMetadata, clinicalHint: string, viewportContext?: ViewportContext): Promise<SelectionPlan>;
  analyzeSlices(images: Blob[], metadata: StudyMetadata, clinicalHint: string, plan: SelectionPlan, sliceLabels: string[]): Promise<string>;
  sendFollowUp(conversationHistory: ChatMessage[], metadata: StudyMetadata): Promise<string>;
}
```

### Two-Call Architecture
**Call 1 — Selection Planning (text-only)**
- Send: structured metadata JSON + clinical hint + viewport context (current slice position)
- Receive: SelectionPlan JSON
- Purpose: LLM uses clinical reasoning to pick the right series, slice range, window/level

**Call 2 — Image Analysis (multimodal)**
- Send: 10-20 JPEG images + metadata context + clinical hint + selection reasoning + slice labels
- Receive: clinical analysis text (plain text, not structured JSON — rendered with markdown formatting)
- Purpose: actual visual analysis of selected slices

**Follow-up Messages (text-only)**
- Send: full conversation history + metadata context
- Receive: text response
- Purpose: "elaborate on finding #2", differential diagnosis, etc.

### LLM Providers
All providers implement the same `LLMService` interface in `LLMServiceFactory.ts`:

**Gemini API** — Hosted, e.g. `gemini-2.5-flash`, via Google's OpenAI-compatible endpoint. API key entered at runtime, stored in localStorage.

**OpenAI-compatible** — Any `/v1` chat-completions endpoint (LM Studio, vLLM, hosted routers). Separate text/vision model selection; capability inferred from model metadata. `npm run openai-proxy` runs a local CORS proxy helper.

**Ollama** — Split text/vision models (e.g., `alibayram/medgemma:4b` for Call 1, `gemma4:latest` for Call 2). Runs locally, no API key. Requires `OLLAMA_ORIGINS=*` for CORS.

**Gemma Browser** — Transformers.js + WebGPU, `onnx-community/gemma-4-E2B-it-ONNX` fully in-browser. No server. Bounded image budget + tensor-limit retry logic. Full coverage depth unavailable.

All providers fall back to a metadata heuristic selection plan when Call 1 returns invalid JSON.

### Image Preparation for LLM
- Convert selected DICOM slices to JPEG using canvas (OffscreenCanvas with DOM fallback)
- Apply the recommended window/level BEFORE export (LLM sees what a radiologist would see)
- MONOCHROME1 (inverted grayscale) and RGB color pixel data handled explicitly
- Resize to max 1568px on the long edge (768px for Gemma Browser)
- Target 10-20 images per request; batched with a synthesis pass when over the provider batch size
- Base64 encode (chunked) for API transmission

### Hosted API Constraints (reference)
- Keep batches ≤24 images per request; JPEG ≤1568px long edge
- Full coverage depth on hosted providers is capped at 120 images (cost/runtime bound)
- 300s request timeout on all providers

### Prompt Construction
PromptBuilder constructs system and user prompts. Key principles:
- Include disclaimer: "This is a research/portfolio tool, not for clinical diagnosis"
- Structure metadata as a clear clinical summary, not raw JSON dump
- Ask for structured JSON output from Call 1
- For Call 2, label images as "Image 1: (slice 45, z=-120mm):", "Image 2: ..." with position context
- Include the SelectionPlan reasoning so the analysis LLM knows why these slices were chosen

## UI Design

### Layout
```
┌─────────────────────────────────────────────────────────┐
│ Toolbar: [W/L] [Zoom] [Pan] [Length] [Reset] [Layout▼] │
├────────────────────────────────────┬────────────────────┤
│                                    │                    │
│                                    │   Chat Sidebar     │
│       DICOM Viewport               │   (collapsible)    │
│       (or MPR grid)                │                    │
│                                    │   - Chat history   │
│                                    │   - LLM responses  │
│                                    │   - Findings       │
│                                    │                    │
├────────────────────────────────────┴────────────────────┤
│ Status: Series info | Slice 45/187 | W:400 C:40         │
└─────────────────────────────────────────────────────────┘

### Analysis Console (chat sidebar)
- The prompt input lives at the bottom of the chat sidebar (no separate overlay)
- Cmd+K / Ctrl+K opens the sidebar and focuses the input
- Analysis launchpad (empty state): free-text prompt vs. guided survey mode with per-structure checklist
- Conversation history: user prompts + LLM responses rendered as formatted markdown
- Interactive slice references in responses navigate the viewer
- Plan preview card (editable) gates image analysis; Escape cancels a pending plan
- Export: save analysis, download MD/JSON report, or evidence bundle ZIP

### Keyboard Shortcuts Summary
| Shortcut | Action |
|---|---|
| Cmd+K / Ctrl+K | Open chat sidebar + focus prompt |
| Escape | Cancel pending plan / close settings |

### Metadata Panel
- Collapsible accordion section at the **top of the sidebar**, above chat history
- Collapsed by default, "Study Info" header expands on click
- Shows extracted study/series metadata summary
- Useful for demo: show metadata and chat simultaneously for storytelling

## Build Phases

### Phase 1: Viewer Foundation
- [x] Project setup (React + Vite + Cornerstone3D + Tailwind)
- [x] Cornerstone3D initialization
- [x] Drag-and-drop DICOM file loading with progress bar
- [x] Stack viewport with axial slice scrolling
- [x] Toolbar (W/L, Zoom, Pan, Scroll, Length, Reset)
- [x] Status bar (series info, slice number, window values)

### Phase 2: Metadata Extraction
- [x] Extract study-level metadata
- [x] Extract series-level metadata, group files by series
- [x] Extract per-slice spatial data
- [x] Build structured metadata summary object
- [x] Metadata panel UI

### Phase 3: LLM Integration
- [x] LLMService interface
- [x] Gemini + OpenAI-compatible + Ollama + Gemma Browser: Call 1 (text-only selection plan)
- [x] PromptBuilder for metadata + hint
- [x] SliceSelector: apply SelectionPlan to image data
- [x] SliceExporter: DICOM → windowed JPEG conversion
- [x] Call 2 (multimodal analysis) across all providers, with batching + synthesis
- [x] Provider config: runtime settings UI (all 4 providers)

### Phase 4: UI Integration
- [x] Chat sidebar prompt input (Cmd+K focuses it)
- [x] Chat sidebar component with pipeline visualization
- [x] Wire up full flow: prompt → Call 1 → viewer adjust → Call 2 → chat
- [x] Viewer auto-scrolls to selected range
- [x] Viewer auto-applies window/level from plan
- [x] Loading states and error handling
- [x] Interactive slice references in LLM responses
- [x] Follow-up conversation support
### Phase 5: Polish
- [x] README with architecture diagram, screenshots, setup instructions
- [x] Sample DICOM data download instructions
- [x] Error handling edge cases
- [x] Keyboard shortcuts documentation
- [x] "Not for clinical use" disclaimer in UI

## Sample DICOM Data

A sample anonymized knee MRI is bundled at `public/sample-data/sample-knee-mri.zip` (~32MB) and loadable via the "Try Sample Knee MRI" button (`src/utils/sampleDataLoader.ts` downloads + unzips it client-side).

For additional testing, use LDCT-and-Projection-Data from TCIA:
- URL: https://www.cancerimagingarchive.net/collection/ldct-and-projection-data/
- Contains: head, chest, abdomen CT scans with clinical annotations
- Has: real pathology findings confirmed by biopsy/follow-up
- Format: Standard DICOM P10 files
- Includes: clinical data reports in Excel alongside images
- License: TCIA Data Usage Policy (free for research, requires citation)

Include download instructions in README. Do NOT commit DICOM files to git.

## Important Conventions

- All TypeScript, strict mode
- Functional React components with hooks only
- Cornerstone3D initialization in a single module — never scatter init calls
- LLM service is provider-agnostic: interface first, implementation second
- Always include "not for clinical use" disclaimer in LLM prompts and UI
- DICOM files never leave the client (privacy-first, all processing client-side)
- API key entered at runtime via UI (stored in localStorage), never bundled in build
- `.env.local` supported as optional fallback for local dev, never committed
- No patient PHI in git (even from de-identified public datasets)

## Known Pitfalls

1. **Cornerstone3D + Vite**: The viteCommonjs plugin and optimizeDeps exclusion are required. Without them, dicom-parser fails silently. This is still true in v4.
2. **Local file loading**: Use `wadouri.fileManager.add(file)` — NOT URL-based loading for local files.
3. **Memory**: ~500MB dataset can use ~1GB browser memory. Expected behavior, not a bug.
4. **Image Orientation**: Use (0020,0037) direction cosines for plane detection. Series Description is unreliable free text.
5. **Body Part Examined**: (0018,0015) is wrong ~15% of the time. Treat as hint, not ground truth.
6. **JPEG export**: Must apply window/level (rescale slope/intercept + windowing) to pixel data BEFORE JPEG conversion. Raw DICOM pixel values produce unusable images.
7. **Image sizing for LLM**: Resize to ≤1568px long edge before sending. Larger images auto-downscale on the API side, wasting latency with no quality benefit.
8. **Cornerstone3D has NO built-in toolbar UI**: It provides tool behaviors (zoom, pan, W/L, etc.) but NOT buttons or icons. We build a simple toolbar in React with lucide-react icons.
9. **StackScrollMouseWheelTool renamed**: In v2+ it's `StackScrollTool`. The mouse wheel is now a binding (`MouseBindings.Wheel`), not part of the tool name.
10. **Volume viewport type**: Use `Enums.ViewportType.ORTHOGRAPHIC` for MPR viewports, not `VOLUME`.
11. **v4 camera FOV**: v4 removed the 10% padding around images. Use `useLegacyCameraFOV: true` in init if the edge-to-edge display looks wrong.
12. **Node.js 20+ required**: Cornerstone3D v4 requires Node.js 20 or later.
13. **Ollama CORS**: Ollama must be started with `OLLAMA_ORIGINS=*` to allow browser requests. Without this, fetch calls to `localhost:11434` fail silently.
14. **Ollama timeouts**: Large vision models (e.g., llava:34b) can take 60-120+ seconds. The app uses a 120s timeout for Ollama calls.
15. **Ollama vision model limitations**: Not all Ollama models support multimodal input. Only models explicitly listed as "vision" (llava, bakllava, etc.) work for Call 2. Text-only models will fail on the image analysis call.
