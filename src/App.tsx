import { Suspense, lazy, useState, useEffect, useCallback, useRef } from 'react';
import type { StackViewport } from '@cornerstonejs/core';
import type { LoadResult } from './viewer/DicomDropZone';
import type { ActiveToolName, LayoutType, OrientationMarkerType } from './viewer/ViewportGrid';
import LoadingOverlay from './viewer/LoadingOverlay';
import type { ChatSidebarHandle } from './ui/ChatSidebar';
import DisclaimerModal from './ui/DisclaimerModal';
import LandingScreen from './ui/LandingScreen';
import type { AnatomicalPlane } from './dicom/orientationUtils';
import type { StudyMetadata } from './dicom/types';
import type {
  ChatMessage,
  ProviderConfig,
  SavedAnalysisRecord,
  ViewportContext,
} from './llm/types';
import {
  DEFAULT_GEMMA_TRANSFORMERS_DTYPE,
  DEFAULT_GEMMA_TRANSFORMERS_IMAGE_TOKEN_BUDGET,
  DEFAULT_GEMMA_TRANSFORMERS_MAX_IMAGES,
  DEFAULT_GEMMA_TRANSFORMERS_MODEL_ID,
} from './llm/gemmaTransformersConfig';
import { DEFAULT_OLLAMA_URL, normalizeOllamaBaseUrl } from './llm/ollamaConfig';
import { useLLMChat, type SliceMapping } from './llm/useLLMChat';
import { logger } from './utils/logger';

const STORAGE_KEY = 'dr-mri-ai-llm-config';
const SAVED_ANALYSES_KEY = 'dr-mri-ai-saved-analyses';
const LEGACY_STORAGE_KEY = 'dicomassist-llm-config';
const LEGACY_SAVED_ANALYSES_KEY = 'dicomassist-saved-analyses';
const OLLAMA_DEFAULT_TEXT_MODEL = 'alibayram/medgemma:4b';
const OLLAMA_DEFAULT_VISION_MODEL = 'gemma4:latest';
const REMOVED_MEDIAPIPE_PROVIDER = ['gemma', 'web'].join('-');

function getDefaultProviderConfig(): ProviderConfig {
  return {
    provider: 'ollama',
    geminiModel: 'gemini-2.5-flash',
    ollamaTextModel: OLLAMA_DEFAULT_TEXT_MODEL,
    ollamaVisionModel: OLLAMA_DEFAULT_VISION_MODEL,
    ollamaUrl: DEFAULT_OLLAMA_URL,
    openAiCompatibleBaseUrl: '',
    openAiCompatibleApiKey: '',
    openAiCompatibleTextModel: '',
    openAiCompatibleVisionModel: '',
    gemmaTransformersModelId: DEFAULT_GEMMA_TRANSFORMERS_MODEL_ID,
    gemmaTransformersDtype: DEFAULT_GEMMA_TRANSFORMERS_DTYPE,
    gemmaTransformersMaxImages: DEFAULT_GEMMA_TRANSFORMERS_MAX_IMAGES,
    gemmaTransformersImageTokenBudget: DEFAULT_GEMMA_TRANSFORMERS_IMAGE_TOKEN_BUDGET,
  };
}

function loadConfig(): ProviderConfig {
  const defaults = getDefaultProviderConfig();
  try {
    const saved = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved) as Record<string, unknown>;
      const merged: ProviderConfig = { ...defaults, ...(parsed as Partial<ProviderConfig>) };
      const savedProvider = typeof parsed.provider === 'string' ? parsed.provider : undefined;
      if (savedProvider === 'claude') {
        merged.provider = 'gemini';
      }
      if (savedProvider === REMOVED_MEDIAPIPE_PROVIDER) {
        merged.provider = 'gemma-transformers';
      }
      if (
        merged.provider === 'ollama' &&
        (merged.ollamaVisionModel === 'llava:7b' || merged.ollamaVisionModel === 'gemma3:4b')
      ) {
        merged.ollamaVisionModel = OLLAMA_DEFAULT_VISION_MODEL;
      }
      merged.ollamaUrl = normalizeOllamaBaseUrl(merged.ollamaUrl);
      merged.gemmaTransformersMaxImages = Math.max(
        1,
        Math.min(DEFAULT_GEMMA_TRANSFORMERS_MAX_IMAGES, Number(merged.gemmaTransformersMaxImages) || DEFAULT_GEMMA_TRANSFORMERS_MAX_IMAGES),
      );
      merged.gemmaTransformersImageTokenBudget = Math.max(
        70,
        Math.min(280, Number(merged.gemmaTransformersImageTokenBudget) || DEFAULT_GEMMA_TRANSFORMERS_IMAGE_TOKEN_BUDGET),
      );
      return merged;
    }
  } catch { /* ignore */ }
  return defaults;
}

function saveConfig(config: ProviderConfig) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

function loadSavedAnalyses(): SavedAnalysisRecord[] {
  try {
    const saved = localStorage.getItem(SAVED_ANALYSES_KEY) ?? localStorage.getItem(LEGACY_SAVED_ANALYSES_KEY);
    if (!saved) return [];
    const parsed = JSON.parse(saved);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((record): record is SavedAnalysisRecord => (
      record &&
      typeof record.id === 'string' &&
      typeof record.sourceMessageId === 'string' &&
      typeof record.latestAnalysis === 'string' &&
      typeof record.markdown === 'string'
    ));
  } catch {
    return [];
  }
}

function saveSavedAnalyses(records: SavedAnalysisRecord[]) {
  localStorage.setItem(SAVED_ANALYSES_KEY, JSON.stringify(records));
}

function getLatestMessage(messages: ChatMessage[], role: 'user' | 'assistant') {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === role) return messages[i];
  }
  return null;
}

function sanitizeFilenameSegment(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'analysis';
}

function formatFileTimestamp(timestamp: number): string {
  return new Date(timestamp).toISOString().replace(/:/g, '-').slice(0, 16);
}

function getProviderLabel(config: ProviderConfig): string {
  if (config.provider === 'gemma-transformers') return 'Gemma 4 Browser';
  if (config.provider === 'openai-compatible') return 'OpenAI-Compatible';
  if (config.provider === 'ollama') return 'Ollama';
  return 'Gemini API';
}

function buildAnalysisRecord({
  latestAssistantMessage,
  latestUserMessage,
  messages,
  providerConfig,
  studyMetadata,
  savedAt,
}: {
  latestAssistantMessage: ChatMessage | null;
  latestUserMessage: ChatMessage | null;
  messages: ChatMessage[];
  providerConfig: ProviderConfig;
  studyMetadata: StudyMetadata | null;
  savedAt: number;
}): SavedAnalysisRecord | null {
  if (!latestAssistantMessage) return null;

  const title = studyMetadata?.studyDescription || 'Dr.MRI.AI Analysis';
  const prompt = latestUserMessage?.content || 'No prompt recorded';
  const transcript = messages
    .map((message) => `## ${message.role === 'assistant' ? 'Assistant' : 'User'}\n\n${message.content}`)
    .join('\n\n');
  const providerLabel = getProviderLabel(providerConfig);
  const markdown = [
    `# ${title}`,
    '',
    `Saved: ${new Date(savedAt).toLocaleString()}`,
    `Provider: ${providerLabel}`,
    studyMetadata?.modality ? `Modality: ${studyMetadata.modality}` : '',
    studyMetadata?.bodyPartExamined ? `Body Part: ${studyMetadata.bodyPartExamined}` : '',
    '',
    '## Latest Analysis Prompt',
    '',
    prompt,
    '',
    '## Latest Analysis',
    '',
    latestAssistantMessage.content,
    '',
    '## Conversation',
    '',
    transcript,
    '',
    'Not for clinical diagnosis.',
  ].filter(Boolean).join('\n');

  return {
    id: latestAssistantMessage.id,
    sourceMessageId: latestAssistantMessage.id,
    savedAt,
    title,
    providerLabel,
    prompt,
    latestAnalysis: latestAssistantMessage.content,
    transcript,
    markdown,
    messages: messages.map((message) => ({ ...message })),
    study: {
      studyDescription: studyMetadata?.studyDescription,
      modality: studyMetadata?.modality,
      bodyPartExamined: studyMetadata?.bodyPartExamined,
      patientAge: studyMetadata?.patientAge,
      patientSex: studyMetadata?.patientSex,
      studyDate: studyMetadata?.studyDate,
      institutionName: studyMetadata?.institutionName,
    },
  };
}

function downloadAnalysisRecord(record: SavedAnalysisRecord, format: 'md' | 'json' = 'md') {
  const studyPart = sanitizeFilenameSegment(record.study.studyDescription || 'study');
  const timePart = formatFileTimestamp(record.savedAt);
  const filename = `dr-mri-ai-${studyPart}-${timePart}.${format}`;
  const payload = format === 'md'
    ? record.markdown
    : JSON.stringify({
      savedAt: new Date(record.savedAt).toISOString(),
      title: record.title,
      provider: record.providerLabel,
      prompt: record.prompt,
      latestAnalysis: record.latestAnalysis,
      transcript: record.transcript,
      messages: record.messages,
      study: record.study,
      disclaimer: 'Not for clinical diagnosis.',
    }, null, 2);
  const blob = new Blob([payload], {
    type: format === 'md' ? 'text/markdown;charset=utf-8' : 'application/json;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

const DicomDropZone = lazy(() => import('./viewer/DicomDropZone'));
const ViewportGrid = lazy(() => import('./viewer/ViewportGrid'));
const Toolbar = lazy(() => import('./viewer/Toolbar'));
const MetadataPanel = lazy(() => import('./ui/MetadataPanel'));
const SeriesBrowser = lazy(() => import('./ui/SeriesBrowser'));
const ChatSidebar = lazy(() => import('./ui/ChatSidebar'));
const SettingsPanel = lazy(() => import('./ui/SettingsPanel'));

let cornerstoneCorePromise: Promise<typeof import('@cornerstonejs/core')> | null = null;
let cornerstoneInitPromise: Promise<void> | null = null;

function loadCornerstoneCore() {
  if (!cornerstoneCorePromise) {
    cornerstoneCorePromise = import('@cornerstonejs/core');
  }
  return cornerstoneCorePromise;
}

async function ensureCornerstoneReady() {
  if (!cornerstoneInitPromise) {
    cornerstoneInitPromise = import('./viewer/CornerstoneInit').then(({ initCornerstone }) =>
      initCornerstone()
    );
  }
  await cornerstoneInitPromise;
}

function SuspenseFallback({
  label,
  className = 'flex h-full items-center justify-center text-sm text-white/60',
}: {
  label: string;
  className?: string;
}) {
  return <div className={className}>{label}</div>;
}

export default function App() {
  const [disclaimerAccepted, setDisclaimerAccepted] = useState(false);
  const [viewerBooting, setViewerBooting] = useState(false);
  const [viewerError, setViewerError] = useState<string | null>(null);
  const [imageIds, setImageIds] = useState<string[]>([]);
  const [primaryAxis, setPrimaryAxis] = useState<AnatomicalPlane>('axial');
  const [orientation, setOrientation] = useState<AnatomicalPlane>('axial');
  const [activeTool, setActiveTool] = useState<ActiveToolName>('WindowLevel');
  const [layout, setLayout] = useState<LayoutType>('1x1');
  const [orientationMarkerType, setOrientationMarkerType] = useState<OrientationMarkerType>('cube');
  const [prefetchProgress, setPrefetchProgress] = useState({ loaded: 0, total: 0 });
  const [studyMetadata, setStudyMetadata] = useState<StudyMetadata | null>(null);
  const [showMetadata, setShowMetadata] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [providerConfig, setProviderConfig] = useState<ProviderConfig>(loadConfig);
  const [savedAnalyses, setSavedAnalyses] = useState<SavedAnalysisRecord[]>(loadSavedAnalyses);
  const [showSeriesBrowser, setShowSeriesBrowser] = useState(false);
  const [activeSeriesUID, setActiveSeriesUID] = useState<string>('');
  const [invert, setInvert] = useState(false);
  const [flipH, setFlipH] = useState(false);
  const [flipV, setFlipV] = useState(false);
  const [cineEnabled, setCineEnabled] = useState(false);
  const resetRef = useRef<(() => void) | null>(null);
  const chatSidebarRef = useRef<ChatSidebarHandle>(null);

  const {
    messages,
    status,
    statusText,
    error,
    currentPlan,
    pipeline,
    latestEvidenceBundle,
    startAnalysis,
    confirmPlan,
    cancelPlan,
    sendFollowUp,
    clearChat,
  } = useLLMChat(studyMetadata, providerConfig);
  const latestAssistantMessage = getLatestMessage(messages, 'assistant');
  const latestUserMessage = getLatestMessage(messages, 'user');

  const handleFilesLoaded = useCallback(async (result: LoadResult) => {
    setViewerBooting(true);
    setViewerError(null);
    try {
      await ensureCornerstoneReady();
      setImageIds(result.imageIds);
      setPrimaryAxis(result.primaryAxis);
      setOrientation(result.primaryAxis);
      setStudyMetadata(result.studyMetadata);
      setActiveSeriesUID(result.studyMetadata.primarySeriesUID);
      setShowChat(true);
      setShowMetadata(false);
      if (result.studyMetadata.series.length > 1) {
        setShowSeriesBrowser(true);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to initialize the viewer.';
      logger.warn('[Viewer] Failed to initialize after file load:', error);
      setViewerError(message);
    } finally {
      setViewerBooting(false);
    }
  }, []);

  // Prefetch all images after they're set
  useEffect(() => {
    if (imageIds.length === 0) return;

    let cancelled = false;
    const total = imageIds.length;
    let loaded = 0;

    setPrefetchProgress({ loaded: 0, total });

    const BATCH_SIZE = 6;
    async function prefetch() {
      const { imageLoader } = await loadCornerstoneCore();
      for (let i = 0; i < total; i += BATCH_SIZE) {
        if (cancelled) return;
        const batch = imageIds.slice(i, i + BATCH_SIZE);
        const promises = batch.map((id) =>
          imageLoader.loadAndCacheImage(id).catch(() => {})
        );
        await Promise.all(promises);
        loaded += batch.length;
        if (!cancelled) {
          setPrefetchProgress({ loaded: Math.min(loaded, total), total });
        }
      }
    }

    prefetch();

    return () => {
      cancelled = true;
    };
  }, [imageIds]);

  // Apply SelectionPlan to viewport (W/L + scroll + switch series if needed)
  useEffect(() => {
    if (!currentPlan || !studyMetadata) return;

    const targetSeries = studyMetadata.series.find(
      (s) => String(s.seriesNumber) === currentPlan.targetSeries,
    );

    // If the plan targets a different series, switch the viewport to it
    if (targetSeries) {
      const targetImageIds = targetSeries.slices.map((s) => s.imageId);
      if (targetImageIds.length > 0 && targetImageIds[0] !== imageIds[0]) {
        setImageIds(targetImageIds);
        // W/L and scroll will be applied after the viewport reloads with new imageIds
      }
      setActiveSeriesUID(targetSeries.seriesInstanceUID);
    }

    // Apply W/L and scroll (may run before or after series switch)
    let attempts = 0;
    let cancelled = false;
    const applyPlan = async () => {
      try {
        const { getRenderingEngine } = await loadCornerstoneCore();
        if (cancelled) return;
        const engine = getRenderingEngine('dicomRenderingEngine');
        if (!engine) {
          // Viewport not ready yet — retry
          if (attempts++ < 5) setTimeout(() => void applyPlan(), 200);
          return;
        }
        const viewport = engine.getViewport('CT_STACK') as StackViewport | undefined;
        if (!viewport) {
          if (attempts++ < 5) setTimeout(() => void applyPlan(), 200);
          return;
        }

        const viewportIds = viewport.getImageIds();
        if (viewportIds.length === 0) {
          if (attempts++ < 5) setTimeout(() => void applyPlan(), 200);
          return;
        }

        const { windowCenter, windowWidth } = currentPlan;
        viewport.setProperties({ voiRange: { lower: windowCenter - windowWidth / 2, upper: windowCenter + windowWidth / 2 } });

        if (targetSeries) {
          const [rangeStart, rangeEnd] = currentPlan.sliceRange;
          const midInstance = Math.round((rangeStart + rangeEnd) / 2);
          // Find the slice closest to midInstance in the target series
          const sliceIdx = targetSeries.slices.findIndex((s) => s.instanceNumber >= midInstance);
          if (sliceIdx >= 0 && sliceIdx < viewportIds.length) {
            viewport.setImageIdIndex(sliceIdx);
          }
        }

        viewport.render();
      } catch {
        // viewport may not be ready yet — retry
        if (attempts++ < 5) setTimeout(() => void applyPlan(), 200);
      }
    };

    // Delay to let series switch + viewport setup take effect
    const timer = window.setTimeout(() => {
      void applyPlan();
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- imageIds changes as part of applying the plan and would create a loop.
  }, [currentPlan, studyMetadata]);

  // When plan arrives, ensure sidebar is open
  useEffect(() => {
    if (status === 'awaiting-confirmation') {
      setShowChat(true);
      setShowMetadata(false);
    }
  }, [status]);

  // Auto-open chat when analysis completes
  useEffect(() => {
    if (messages.length > 0 && status === 'idle') {
      setShowChat(true);
    }
  }, [messages.length, status]);

  const handleFocusAnalysis = useCallback(() => {
    setShowChat(true);
    setShowMetadata(false);
    requestAnimationFrame(() => chatSidebarRef.current?.focusInput());
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;

      if (mod && e.key === 'k') {
        e.preventDefault();
        if (imageIds.length > 0 && studyMetadata) {
          handleFocusAnalysis();
        }
      }

      if (e.key === 'Escape') {
        if (status === 'awaiting-confirmation') {
          cancelPlan();
        } else if (settingsOpen) {
          setSettingsOpen(false);
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [imageIds.length, studyMetadata, settingsOpen, status, cancelPlan, handleFocusAnalysis]);

  // Fall back to W/L if leaving MPR while Crosshairs is active
  useEffect(() => {
    if (layout !== 'mpr' && activeTool === 'Crosshairs') {
      setActiveTool('WindowLevel');
    }
  }, [layout, activeTool]);

  const handleReset = useCallback(() => {
    resetRef.current?.();
    setInvert(false);
    setFlipH(false);
    setFlipV(false);
    setCineEnabled(false);
  }, []);

  const handleAcceptDisclaimer = useCallback(() => {
    setDisclaimerAccepted(true);
  }, []);

  const handleConfigChange = useCallback((config: ProviderConfig) => {
    setProviderConfig(config);
    saveConfig(config);
  }, []);

  const handleSaveLatestAnalysis = useCallback(() => {
    const now = Date.now();
    setSavedAnalyses((current) => {
      const existing = latestAssistantMessage
        ? current.find((record) => record.sourceMessageId === latestAssistantMessage.id)
        : null;
      const record = buildAnalysisRecord({
        latestAssistantMessage,
        latestUserMessage,
        messages,
        providerConfig,
        studyMetadata,
        savedAt: existing?.savedAt ?? now,
      });
      if (!record) return current;
      const next = [record, ...current.filter((item) => item.sourceMessageId !== record.sourceMessageId)].slice(0, 18);
      saveSavedAnalyses(next);
      return next;
    });
  }, [latestAssistantMessage, latestUserMessage, messages, providerConfig, studyMetadata]);

  const handleDownloadLatestAnalysis = useCallback((format: 'md' | 'json' = 'md') => {
    const record = buildAnalysisRecord({
      latestAssistantMessage,
      latestUserMessage,
      messages,
      providerConfig,
      studyMetadata,
      savedAt: Date.now(),
    });
    if (!record) return;
    downloadAnalysisRecord(record, format);
  }, [latestAssistantMessage, latestUserMessage, messages, providerConfig, studyMetadata]);

  const handleDownloadSavedAnalysis = useCallback((recordId: string, format: 'md' | 'json' = 'md') => {
    const record = savedAnalyses.find((item) => item.id === recordId);
    if (!record) return;
    downloadAnalysisRecord(record, format);
  }, [savedAnalyses]);

  const handleDownloadEvidenceBundle = useCallback(async () => {
    const record = buildAnalysisRecord({
      latestAssistantMessage,
      latestUserMessage,
      messages,
      providerConfig,
      studyMetadata,
      savedAt: Date.now(),
    });
    if (!record || !latestEvidenceBundle) return;

    const { default: JSZip } = await import('jszip');
    const zip = new JSZip();

    zip.file('report.md', record.markdown);
    zip.file('report.json', JSON.stringify({
      savedAt: new Date(record.savedAt).toISOString(),
      title: record.title,
      provider: record.providerLabel,
      prompt: record.prompt,
      latestAnalysis: record.latestAnalysis,
      transcript: record.transcript,
      messages: record.messages,
      study: record.study,
      disclaimer: 'Not for clinical diagnosis.',
    }, null, 2));

    zip.file('evidence/manifest.json', JSON.stringify({
      analysisId: latestEvidenceBundle.analysisId,
      createdAt: new Date(latestEvidenceBundle.createdAt).toISOString(),
      prompt: latestEvidenceBundle.prompt,
      surveyMode: latestEvidenceBundle.surveyMode,
      plan: latestEvidenceBundle.plan,
      images: latestEvidenceBundle.images.map((image, index) => ({
        order: index + 1,
        fileName: image.fileName,
        label: image.label,
        seriesNumber: image.seriesNumber,
        instanceNumber: image.instanceNumber,
        zPosition: image.zPosition,
        sizeBytes: image.blob.size,
      })),
    }, null, 2));

    latestEvidenceBundle.images.forEach((image) => {
      zip.file(`evidence/${image.fileName}`, image.blob);
    });

    const archive = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(archive);
    const anchor = document.createElement('a');
    const studyPart = sanitizeFilenameSegment(studyMetadata?.studyDescription || 'study');
    anchor.href = url;
    anchor.download = `dr-mri-ai-${studyPart}-${formatFileTimestamp(Date.now())}-evidence.zip`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }, [
    latestAssistantMessage,
    latestEvidenceBundle,
    latestUserMessage,
    messages,
    providerConfig,
    studyMetadata,
  ]);

  const handleStartAnalysis = useCallback(async (hint: string, options?: { surveyMode?: boolean }) => {
    // Capture current viewport position as context for slice selection
    let viewportContext: ViewportContext | undefined;
    try {
      const { getRenderingEngine } = await loadCornerstoneCore();
      const engine = getRenderingEngine('dicomRenderingEngine');
      const viewport = engine?.getViewport('CT_STACK') as StackViewport | undefined;
      if (viewport && studyMetadata) {
        const sliceIndex = viewport.getCurrentImageIdIndex();
        // Find which series is currently displayed
        const currentIds = viewport.getImageIds();
        const currentSeries = studyMetadata.series.find((s) =>
          s.slices.length === currentIds.length && s.slices[0]?.imageId === currentIds[0],
        ) ?? studyMetadata.series.find((s) =>
          s.slices.some((sl) => sl.imageId === currentIds[0]),
        );
        if (currentSeries && sliceIndex >= 0 && sliceIndex < currentSeries.slices.length) {
          const slice = currentSeries.slices[sliceIndex];
          viewportContext = {
            currentInstanceNumber: slice.instanceNumber,
            currentZPosition: slice.imagePositionPatient[2],
            seriesNumber: String(currentSeries.seriesNumber),
            totalSlicesInSeries: currentSeries.slices.length,
          };
          logger.log('[Dr.MRI.AI] Viewport context:', viewportContext);
        }
      }
    } catch { /* viewport may not be ready */ }

    await startAnalysis(hint, viewportContext, options);
  }, [startAnalysis, studyMetadata]);

  const navigateTargetRef = useRef<{ instanceNumber: number; imageId: string; seriesNumber: string } | null>(null);

  const handleNavigateToSlice = useCallback(async (mapping: SliceMapping) => {
    if (!studyMetadata || !currentPlan) return;

    // Use the mapping's seriesNumber (multi-series aware) to find the correct series
    const seriesNum = mapping.seriesNumber || currentPlan.targetSeries;
    const targetSeries = studyMetadata.series.find(
      (s) => String(s.seriesNumber) === seriesNum,
    );
    if (!targetSeries) return;

    // Check if we need to switch series first
    const needsSeriesSwitch = targetSeries.seriesInstanceUID !== activeSeriesUID;

    if (needsSeriesSwitch) {
      logger.log(`[Navigate] Switching from series ${activeSeriesUID} → ${targetSeries.seriesInstanceUID} (${targetSeries.seriesDescription})`);
      // Store the target so we can scroll after series loads
      navigateTargetRef.current = { instanceNumber: mapping.instanceNumber, imageId: mapping.imageId, seriesNumber: seriesNum };
      const targetImageIds = targetSeries.slices.map((s) => s.imageId);
      setImageIds(targetImageIds);
      setActiveSeriesUID(targetSeries.seriesInstanceUID);
      const plane = targetSeries.anatomicalPlane === 'oblique' ? 'axial' : targetSeries.anatomicalPlane;
      setPrimaryAxis(plane);
      setOrientation(plane);
      setLayout('1x1');
      return; // scrollToSlice will be called by the effect below once images load
    }

    // Already on the correct series — scroll directly
    await scrollToSlice(mapping.instanceNumber, mapping.imageId, targetSeries);
  }, [studyMetadata, currentPlan, activeSeriesUID]);

  // After a series switch triggered by slice navigation, scroll to the target slice
  useEffect(() => {
    const target = navigateTargetRef.current;
    if (!target || !studyMetadata) return;

    const targetSeries = studyMetadata.series.find(
      (s) => String(s.seriesNumber) === target.seriesNumber,
    );
    if (!targetSeries || targetSeries.seriesInstanceUID !== activeSeriesUID) return;

    // Series is now active — try to scroll (with retries for viewport readiness)
    let attempts = 0;
    const tryScroll = async () => {
      const success = await scrollToSlice(target.instanceNumber, target.imageId, targetSeries);
      if (!success && attempts++ < 5) {
        setTimeout(() => void tryScroll(), 200);
      } else {
        navigateTargetRef.current = null;
      }
    };
    const timer = setTimeout(() => void tryScroll(), 100);
    return () => clearTimeout(timer);
  }, [activeSeriesUID, studyMetadata]);

  async function scrollToSlice(
    instanceNumber: number,
    imageId: string,
    targetSeries: StudyMetadata['series'][number],
  ): Promise<boolean> {
    try {
      const { getRenderingEngine } = await loadCornerstoneCore();
      const engine = getRenderingEngine('dicomRenderingEngine');
      if (!engine) return false;

      let viewport = engine.getViewport('CT_STACK') as StackViewport | undefined;
      if (!viewport) {
        viewport = engine.getViewport('CT_SINGLE_VOL') as StackViewport | undefined;
      }
      if (!viewport) return false;

      const viewportIds = viewport.getImageIds();
      if (viewportIds.length === 0) return false;

      // Strategy 1: Find by instance number in the target series metadata
      const sliceIdx = targetSeries.slices.findIndex(
        (s) => s.instanceNumber === instanceNumber,
      );
      if (sliceIdx >= 0 && sliceIdx < viewportIds.length) {
        logger.log(`[Navigate] Instance #${instanceNumber} → series index ${sliceIdx}`);
        viewport.setImageIdIndex(sliceIdx);
        viewport.render();
        return true;
      }

      // Strategy 2: Direct imageId match
      const exactIdx = viewportIds.indexOf(imageId);
      if (exactIdx >= 0) {
        logger.log(`[Navigate] Exact imageId match at index ${exactIdx}`);
        viewport.setImageIdIndex(exactIdx);
        viewport.render();
        return true;
      }

      // Strategy 3: Partial imageId match
      const partialIdx = viewportIds.findIndex(
        (id: string) => id.includes(imageId) || imageId.includes(id),
      );
      if (partialIdx >= 0) {
        logger.log(`[Navigate] Partial imageId match at index ${partialIdx}`);
        viewport.setImageIdIndex(partialIdx);
        viewport.render();
        return true;
      }

      logger.warn(`[Navigate] Failed to find slice for instance #${instanceNumber}`, {
        imageId,
        viewportIdCount: viewportIds.length,
      });
      return false;
    } catch {
      return false;
    }
  }

  const handleToggleMetadata = useCallback(() => {
    if (!studyMetadata) return;
    setShowMetadata((v) => !v);
  }, [studyMetadata]);

  const handleSelectSeries = useCallback((seriesUID: string) => {
    if (!studyMetadata || seriesUID === activeSeriesUID) return;
    const series = studyMetadata.series.find((s) => s.seriesInstanceUID === seriesUID);
    if (!series) return;
    setImageIds(series.slices.map((s) => s.imageId));
    setActiveSeriesUID(seriesUID);
    const plane = series.anatomicalPlane === 'oblique' ? 'axial' : series.anatomicalPlane;
    setPrimaryAxis(plane);
    setOrientation(plane);
    setLayout('1x1');
  }, [studyMetadata, activeSeriesUID]);

  if (imageIds.length === 0) {
    return (
      <div className="h-full overflow-y-auto">
        {!disclaimerAccepted && <DisclaimerModal onAccept={handleAcceptDisclaimer} />}
        <LandingScreen>
          <Suspense fallback={<SuspenseFallback label="Loading uploader..." />}>
            <DicomDropZone onFilesLoaded={handleFilesLoaded} />
          </Suspense>
          {(viewerBooting || viewerError) && (
            <div className="mt-6 rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white/75 backdrop-blur-md">
              {viewerBooting ? 'Preparing the viewer workspace...' : viewerError}
            </div>
          )}
        </LandingScreen>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-[radial-gradient(circle_at_top_left,_rgba(251,191,36,0.12),_transparent_28%),radial-gradient(circle_at_85%_15%,_rgba(45,212,191,0.1),_transparent_26%),linear-gradient(180deg,_#060816_0%,_#090b12_45%,_#05060a_100%)]">
      <div className="border-b border-white/8 bg-black/25 backdrop-blur-xl">
        <Suspense fallback={<SuspenseFallback label="Loading viewer controls..." className="flex h-16 items-center justify-center text-sm text-white/55" />}>
          <Toolbar
            activeTool={activeTool}
            onToolChange={setActiveTool}
            layout={layout}
            onLayoutChange={setLayout}
            onReset={handleReset}
            showSeriesBrowser={showSeriesBrowser}
            onToggleSeriesBrowser={studyMetadata && studyMetadata.series.length > 1 ? () => setShowSeriesBrowser((v) => !v) : undefined}
            showMetadata={showMetadata}
            onToggleMetadata={studyMetadata ? handleToggleMetadata : undefined}
            onOpenSpotlight={handleFocusAnalysis}
            onOpenSettings={() => setSettingsOpen((v) => !v)}
            orientationMarkerType={orientationMarkerType}
            onOrientationMarkerTypeChange={setOrientationMarkerType}
            invert={invert}
            onInvertToggle={() => setInvert((v) => !v)}
            flipH={flipH}
            onFlipHToggle={() => setFlipH((v) => !v)}
            flipV={flipV}
            onFlipVToggle={() => setFlipV((v) => !v)}
            cineEnabled={cineEnabled}
            onCineToggle={() => setCineEnabled((v) => !v)}
          />
        </Suspense>
      </div>

      <div className="flex-1 min-h-0 p-4">
        <div className={`grid h-full min-h-0 gap-4 ${showChat ? 'lg:grid-cols-[minmax(0,0.94fr)_minmax(32rem,1.06fr)] xl:grid-cols-[minmax(0,0.82fr)_minmax(42rem,1.18fr)] 2xl:grid-cols-[minmax(0,0.72fr)_minmax(48rem,1.28fr)]' : 'grid-cols-1'}`}>
          <div className="min-h-0 overflow-hidden rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(9,14,24,0.92),rgba(6,9,17,0.86))] shadow-[0_30px_100px_rgba(0,0,0,0.45)]">
            <div className="flex h-full min-h-0">
              {showSeriesBrowser && studyMetadata && studyMetadata.series.length > 1 && (
                <Suspense fallback={<SuspenseFallback label="Loading series browser..." className="flex w-72 items-center justify-center border-r border-white/8 text-sm text-white/55" />}>
                  <SeriesBrowser
                    metadata={studyMetadata}
                    activeSeriesUID={activeSeriesUID}
                    onSelectSeries={handleSelectSeries}
                    onClose={() => setShowSeriesBrowser(false)}
                  />
                </Suspense>
              )}
              <div className="relative flex-1 min-w-0 overflow-hidden">
                <div className="pointer-events-none absolute left-5 top-5 z-10 rounded-full border border-white/10 bg-black/40 px-3 py-1 text-[11px] uppercase tracking-[0.22em] text-amber-200/80 backdrop-blur-md">
                  Evidence Viewer
                </div>
                <div className="pointer-events-none absolute right-5 top-5 z-10 hidden rounded-full border border-white/10 bg-black/35 px-3 py-1 text-[11px] text-white/70 backdrop-blur-md md:block">
                  {studyMetadata?.studyDescription || 'Study loaded'}
                </div>
                <div className="absolute inset-0">
                  <Suspense fallback={<SuspenseFallback label="Loading viewport..." className="flex h-full items-center justify-center text-sm text-white/60" />}>
                    <ViewportGrid
                      imageIds={imageIds}
                      activeTool={activeTool}
                      layout={layout}
                      orientation={orientation}
                      primaryAxis={primaryAxis}
                      orientationMarkerType={orientationMarkerType}
                      onResetRef={resetRef}
                      invert={invert}
                      flipH={flipH}
                      flipV={flipV}
                      cineEnabled={cineEnabled}
                      studyMetadata={studyMetadata}
                    />
                  </Suspense>
                </div>
                <LoadingOverlay
                  loaded={prefetchProgress.loaded}
                  total={prefetchProgress.total}
                />
              </div>
              {showMetadata && studyMetadata && (
                <Suspense fallback={<SuspenseFallback label="Loading study context..." className="flex w-80 items-center justify-center border-l border-white/8 text-sm text-white/55" />}>
                  <MetadataPanel
                    metadata={studyMetadata}
                    activeSeriesUID={activeSeriesUID}
                    onClose={() => setShowMetadata(false)}
                  />
                </Suspense>
              )}
            </div>
          </div>

          {showChat && (
            <div className="min-h-0 overflow-hidden rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(11,17,28,0.96),rgba(7,10,17,0.96))] shadow-[0_30px_100px_rgba(0,0,0,0.45)]">
              <Suspense fallback={<SuspenseFallback label="Loading analysis console..." className="flex h-full items-center justify-center text-sm text-white/60" />}>
                <ChatSidebar
                  ref={chatSidebarRef}
                  messages={messages}
                  status={status}
                  statusText={statusText}
                  error={error}
                  pipeline={pipeline}
                  currentPlan={currentPlan}
                  studyMetadata={studyMetadata}
                  onConfirmPlan={confirmPlan}
                  onCancelPlan={cancelPlan}
                  onStartAnalysis={handleStartAnalysis}
                  onSendFollowUp={sendFollowUp}
                  onClear={clearChat}
                  onClose={() => setShowChat(false)}
                  onNavigateToSlice={handleNavigateToSlice}
                  onSaveLatest={handleSaveLatestAnalysis}
                  onDownloadLatest={handleDownloadLatestAnalysis}
                  onDownloadEvidenceBundle={handleDownloadEvidenceBundle}
                  onDownloadSaved={handleDownloadSavedAnalysis}
                  hasEvidenceBundle={Boolean(latestEvidenceBundle)}
                  savedAnalyses={savedAnalyses}
                />
              </Suspense>
            </div>
          )}
        </div>
      </div>

      {settingsOpen && (
        <Suspense fallback={null}>
          <SettingsPanel
            open={settingsOpen}
            onClose={() => setSettingsOpen(false)}
            config={providerConfig}
            onConfigChange={handleConfigChange}
          />
        </Suspense>
      )}
    </div>
  );
}
