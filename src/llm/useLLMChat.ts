import { useState, useCallback, useRef } from 'react';
import type { StudyMetadata } from '../dicom/types';
import type {
  AnalysisDepth,
  AnalysisEvidenceBundle,
  SelectionPlan,
  SeriesSelection,
  ChatMessage,
  ProviderConfig,
  ViewportContext,
} from './types';
import { logger } from '../utils/logger';
import {
  DEFAULT_GEMMA_TRANSFORMERS_EXPORT_LONG_EDGE,
  DEFAULT_GEMMA_TRANSFORMERS_MODEL_ID,
} from './gemmaTransformersConfig';
import {
  distributeBudgetBySeries,
  estimateSelectionCount,
  getAnalysisDepth,
  getAnalysisDepthPolicy,
  getDepthLabel,
  getSeriesForSelection,
  isLocalizerSeries,
  type AnalysisDepthPolicy,
} from './analysisDepth';
import {
  subscribeGemmaTransformersRuntime,
  type GemmaTransformersRuntimeEvent,
} from './GemmaTransformersRuntime';

export type ChatStatus = 'idle' | 'planning' | 'awaiting-confirmation' | 'exporting' | 'analyzing' | 'following-up' | 'error';

export interface PipelineStep {
  id: string;
  label: string;
  status: 'pending' | 'active' | 'done' | 'error';
  detail?: string;
  durationMs?: number;
}

export interface SliceMapping {
  imageIndex: number;   // 1-based position in the selected subset
  instanceNumber: number;
  imageId: string;
  zPosition: number;
  label: string;        // e.g. "SAG PD FAT SAT — Slice 45/187 (z=-120mm)"
  seriesNumber: string; // Series number for navigation
}

export interface PipelineState {
  steps: PipelineStep[];
  plan: SelectionPlan | null;
  sliceCount: number;
  totalSlices: number;
  analysisDepth?: AnalysisDepth;
  batchCount: number;
  exportedSizes: string[];
  sliceMappings: SliceMapping[];
}

interface UseLLMChatReturn {
  messages: ChatMessage[];
  status: ChatStatus;
  statusText: string;
  error: string | null;
  currentPlan: SelectionPlan | null;
  pipeline: PipelineState | null;
  latestEvidenceBundle: AnalysisEvidenceBundle | null;
  startAnalysis: (hint: string, viewportContext?: ViewportContext, options?: { surveyMode?: boolean }) => Promise<void>;
  confirmPlan: (adjustedPlan: SelectionPlan) => Promise<void>;
  cancelPlan: () => void;
  sendFollowUp: (text: string) => Promise<void>;
  clearChat: () => void;
}

const STATUS_LABELS: Record<ChatStatus, string> = {
  idle: '',
  planning: 'Analyzing metadata...',
  'awaiting-confirmation': 'Review selection plan...',
  exporting: 'Preparing images...',
  analyzing: 'Generating analysis...',
  'following-up': 'Thinking...',
  error: 'Error',
};

let llmFactoryPromise: Promise<typeof import('./LLMServiceFactory')> | null = null;
let sliceSelectorPromise: Promise<typeof import('../filtering/SliceSelector')> | null = null;
let sliceExporterPromise: Promise<typeof import('../filtering/SliceExporter')> | null = null;
const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';

function loadLlmFactory() {
  if (!llmFactoryPromise) {
    llmFactoryPromise = import('./LLMServiceFactory');
  }
  return llmFactoryPromise;
}

function loadSliceSelector() {
  if (!sliceSelectorPromise) {
    sliceSelectorPromise = import('../filtering/SliceSelector');
  }
  return sliceSelectorPromise;
}

function loadSliceExporter() {
  if (!sliceExporterPromise) {
    sliceExporterPromise = import('../filtering/SliceExporter');
  }
  return sliceExporterPromise;
}

function getModelLabel(modelPath?: string): string {
  if (!modelPath) return 'model';
  const normalized = modelPath.trim().replace(/\/+$/, '');
  return normalized.split('/').pop() || normalized;
}

function toEvidenceFileName(seriesNumber: string, instanceNumber: number, index: number): string {
  return `evidence-${String(index).padStart(2, '0')}-series-${seriesNumber}-slice-${instanceNumber}.jpg`;
}

function makeId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function updateStep(
  steps: PipelineStep[],
  id: string,
  updates: Partial<PipelineStep>,
): PipelineStep[] {
  return steps.map((s) => (s.id === id ? { ...s, ...updates } : s));
}

function isGemmaModelStage(stage: GemmaTransformersRuntimeEvent['stage']): boolean {
  return [
    'webgpu-check',
    'module-loading',
    'processor-loading',
    'model-loading',
    'session-ready',
    'cache-hit',
  ].includes(stage);
}

function formatGemmaRuntimeDetail(event: GemmaTransformersRuntimeEvent): string {
  const percent = typeof event.progress === 'number' ? ` ${Math.round(event.progress)}%` : '';
  const file = event.file ? ` · ${event.file}` : '';
  const elapsed = typeof event.elapsedMs === 'number' ? ` · ${(event.elapsedMs / 1000).toFixed(1)}s` : '';
  return `${event.message}${percent}${file}${elapsed}`;
}

function getProviderLabels(providerConfig: ProviderConfig): { textModel: string; visionModel: string } {
  if (providerConfig.provider === 'ollama') {
    return {
      textModel: providerConfig.ollamaTextModel || 'alibayram/medgemma:4b',
      visionModel: providerConfig.ollamaVisionModel || 'gemma4:latest',
    };
  }

  if (providerConfig.provider === 'gemma-transformers') {
    const label = providerConfig.gemmaTransformersModelId || DEFAULT_GEMMA_TRANSFORMERS_MODEL_ID;
    return {
      textModel: getModelLabel(label),
      visionModel: getModelLabel(label),
    };
  }

  if (providerConfig.provider === 'openai-compatible') {
    return {
      textModel: providerConfig.openAiCompatibleTextModel || 'OpenAI-compatible text model',
      visionModel: providerConfig.openAiCompatibleVisionModel || providerConfig.openAiCompatibleTextModel || 'OpenAI-compatible vision model',
    };
  }

  return {
    textModel: providerConfig.geminiModel || DEFAULT_GEMINI_MODEL,
    visionModel: providerConfig.geminiModel || DEFAULT_GEMINI_MODEL,
  };
}

function getProviderExportMaxLongEdge(providerConfig: ProviderConfig): number | undefined {
  if (providerConfig.provider === 'gemma-transformers') {
    return DEFAULT_GEMMA_TRANSFORMERS_EXPORT_LONG_EDGE;
  }
  return undefined;
}

/**
 * Fix a single SeriesSelection against its series metadata.
 */
function fixSelection(sel: SeriesSelection, metadata: StudyMetadata, maxBudget: number): SeriesSelection {
  const series = metadata.series.find((s) => String(s.seriesNumber) === sel.seriesNumber);
  if (!series) return sel;

  const [minInst, maxInst] = series.instanceNumberRange;
  let [start, end] = sel.sliceRange;

  if (start > end) [start, end] = [end, start];
  start = Math.max(minInst, start);
  end = Math.min(maxInst, end);

  let { samplingStrategy, samplingParam } = sel;
  const rangeSize = end - start + 1;

  if (samplingStrategy === 'all' && rangeSize > maxBudget) {
    samplingStrategy = 'uniform';
    samplingParam = maxBudget;
    logger.warn(`[PlanFix] "${sel.seriesNumber}" "all" on ${rangeSize} slices → uniform(${maxBudget})`);
  }

  if (samplingStrategy === 'uniform' && (samplingParam == null || samplingParam < 1)) {
    samplingParam = Math.min(maxBudget, rangeSize);
    logger.warn(`[PlanFix] "${sel.seriesNumber}" missing samplingParam → ${samplingParam}`);
  }

  if (samplingStrategy === 'uniform' && samplingParam != null && samplingParam > rangeSize) {
    samplingParam = rangeSize;
  }

  if (samplingStrategy === 'uniform' && samplingParam != null && samplingParam > maxBudget) {
    samplingParam = maxBudget;
  }

  if (start !== sel.sliceRange[0] || end !== sel.sliceRange[1]) {
    logger.warn(`[PlanFix] "${sel.seriesNumber}" clamped: [${sel.sliceRange}] → [${start},${end}]`);
  }

  return { ...sel, sliceRange: [start, end], samplingStrategy, samplingParam };
}

/**
 * Fix all selections in a plan. Enforce total ≤ maxTotal (reduce supplementary first).
 * Re-populate legacy fields from selections[0].
 */
function fixSelectionPlan(plan: SelectionPlan, metadata: StudyMetadata, maxTotal = 20): SelectionPlan {
  const MAX_TOTAL = Math.max(1, maxTotal);

  // Fix each selection individually with generous per-selection budget first
  let fixedSelections = plan.selections.map((sel) =>
    fixSelection(sel, metadata, MAX_TOTAL),
  );

  const nonLocalizerSelections = fixedSelections.filter((sel) => {
    const series = metadata.series.find((s) => String(s.seriesNumber) === sel.seriesNumber);
    if (!isLocalizerSeries(series)) return true;
    logger.warn(`[PlanFix] Removed localizer/scout series #${sel.seriesNumber} from the analysis plan`);
    return false;
  });
  if (nonLocalizerSelections.length > 0 && nonLocalizerSelections.length !== fixedSelections.length) {
    fixedSelections = nonLocalizerSelections.map((sel, index) => ({
      ...sel,
      role: index === 0 ? 'primary' : 'supplementary',
    }));
  }

  // Enforce total ≤ 20: reduce supplementary series first, then primary
  let total = fixedSelections.reduce((sum, s) => sum + estimateSelectionCount(s), 0);
  if (total > MAX_TOTAL) {
    // Reduce supplementary selections first (in reverse order)
    for (let i = fixedSelections.length - 1; i >= 0 && total > MAX_TOTAL; i--) {
      if (fixedSelections[i].role !== 'supplementary') continue;
      const current = estimateSelectionCount(fixedSelections[i]);
      const excess = total - MAX_TOTAL;
      const newCount = Math.max(2, current - excess);
      fixedSelections[i] = {
        ...fixedSelections[i],
        samplingStrategy: 'uniform',
        samplingParam: newCount,
      };
      total = fixedSelections.reduce((sum, s) => sum + estimateSelectionCount(s), 0);
      logger.warn(`[PlanFix] Reduced supplementary series #${fixedSelections[i].seriesNumber} to ${newCount} slices`);
    }

    // If still over, remove supplementary selections entirely
    if (total > MAX_TOTAL) {
      const primaryOnly = fixedSelections.filter((s) => s.role === 'primary');
      if (primaryOnly.length > 0) {
        fixedSelections = primaryOnly;
        total = fixedSelections.reduce((sum, s) => sum + estimateSelectionCount(s), 0);
        logger.warn('[PlanFix] Removed all supplementary selections to fit budget');
      }
    }

    // If primary alone exceeds, cap it
    if (total > MAX_TOTAL && fixedSelections.length > 0) {
      fixedSelections[0] = {
        ...fixedSelections[0],
        samplingStrategy: 'uniform',
        samplingParam: MAX_TOTAL,
      };
      logger.warn(`[PlanFix] Capped primary to ${MAX_TOTAL} slices`);
    }
  }

  // Re-populate legacy fields from selections[0]
  const primary = fixedSelections[0];
  if (!primary) {
    return {
      ...plan,
      selections: [],
      totalImages: 0,
    };
  }

  return {
    ...plan,
    selections: fixedSelections,
    totalImages: fixedSelections.reduce((sum, s) => sum + estimateSelectionCount(s), 0),
    targetSeries: primary.seriesNumber,
    sliceRange: primary.sliceRange,
    windowCenter: primary.windowCenter,
    windowWidth: primary.windowWidth,
    samplingStrategy: primary.samplingStrategy,
    samplingParam: primary.samplingParam,
  };
}

function finiteNumber(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? Number(value) : fallback;
}

function countSelectionAgainstMetadata(metadata: StudyMetadata, selection: SeriesSelection): number {
  const series = getSeriesForSelection(metadata, selection);
  if (!series) return estimateSelectionCount(selection);
  const [start, end] = selection.sliceRange;
  const inRange = series.slices.filter(
    (slice) => slice.instanceNumber >= start && slice.instanceNumber <= end,
  );
  const available = inRange.length > 0 ? inRange.length : series.slices.length;
  if (selection.samplingStrategy === 'all') return available;
  if (selection.samplingStrategy === 'uniform' && selection.samplingParam != null) {
    return Math.min(Math.max(1, Math.round(selection.samplingParam)), available);
  }
  if (
    selection.samplingStrategy === 'every_nth' &&
    selection.samplingParam != null &&
    selection.samplingParam > 0
  ) {
    return Math.ceil(available / selection.samplingParam);
  }
  return available;
}

function countSelectionsAgainstMetadata(metadata: StudyMetadata, selections: SeriesSelection[]): number {
  return selections.reduce((sum, selection) => sum + countSelectionAgainstMetadata(metadata, selection), 0);
}

function withLegacyPlanFields(
  plan: SelectionPlan,
  selections: SeriesSelection[],
  metadata: StudyMetadata,
  analysisDepth: AnalysisDepth,
): SelectionPlan {
  const primary = selections[0];
  if (!primary) {
    return { ...plan, selections, totalImages: 0, analysisDepth };
  }

  return {
    ...plan,
    selections,
    totalImages: countSelectionsAgainstMetadata(metadata, selections),
    analysisDepth,
    targetSeries: primary.seriesNumber,
    sliceRange: primary.sliceRange,
    windowCenter: primary.windowCenter,
    windowWidth: primary.windowWidth,
    samplingStrategy: primary.samplingStrategy,
    samplingParam: primary.samplingParam,
  };
}

function expandPlanForAnalysisDepth(
  plan: SelectionPlan,
  metadata: StudyMetadata,
  policy: AnalysisDepthPolicy,
): SelectionPlan {
  if (policy.providerDepth === 'fast') {
    const fastPlan = fixSelectionPlan(plan, metadata, policy.maxImages);
    return { ...fastPlan, analysisDepth: 'fast' };
  }

  const seedPlan = fixSelectionPlan(plan, metadata, Number.POSITIVE_INFINITY);
  const diagnosticSelections = seedPlan.selections.filter((selection, index, selections) => {
    if (selections.findIndex((item) => item.seriesNumber === selection.seriesNumber) !== index) return false;
    const series = getSeriesForSelection(metadata, selection);
    return !!series && !isLocalizerSeries(series);
  });

  if (diagnosticSelections.length === 0) {
    return { ...seedPlan, analysisDepth: policy.providerDepth };
  }

  const allocation = policy.providerDepth === 'standard'
    ? distributeBudgetBySeries(metadata, diagnosticSelections, policy.maxImages)
    : new Map<string, number>();

  const expandedSelections: SeriesSelection[] = diagnosticSelections.map((selection, index): SeriesSelection => {
    const series = getSeriesForSelection(metadata, selection);
    if (!series) return selection;

    const [minInst, maxInst] = series.instanceNumberRange;
    const available = series.slices.length;
    const budget = policy.providerDepth === 'full'
      ? available
      : Math.max(1, allocation.get(selection.seriesNumber) ?? Math.min(available, policy.maxImages));
    const useAll = budget >= available;

    return {
      ...selection,
      role: index === 0 ? 'primary' : 'supplementary',
      sliceRange: [minInst, maxInst] as [number, number],
      samplingStrategy: useAll ? 'all' : 'uniform',
      samplingParam: useAll ? undefined : budget,
      windowCenter: finiteNumber(selection.windowCenter, series.windowCenter ?? 40),
      windowWidth: Math.max(1, finiteNumber(selection.windowWidth, series.windowWidth ?? 400)),
    };
  });

  return withLegacyPlanFields(seedPlan, expandedSelections, metadata, policy.providerDepth);
}

export function useLLMChat(
  metadata: StudyMetadata | null,
  providerConfig: ProviderConfig,
): UseLLMChatReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<ChatStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [currentPlan, setCurrentPlan] = useState<SelectionPlan | null>(null);
  const [pipeline, setPipeline] = useState<PipelineState | null>(null);
  const [latestEvidenceBundle, setLatestEvidenceBundle] = useState<AnalysisEvidenceBundle | null>(null);
  const abortRef = useRef(false);
  const hintRef = useRef<string>('');
  const surveyModeRef = useRef(false);
  const planTimingRef = useRef<{ t0: number; t1: number }>({ t0: 0, t1: 0 });

  const attachGemmaRuntimeStatus = useCallback((activeStepId: string) => {
    if (providerConfig.provider !== 'gemma-transformers') {
      return () => {};
    }

    return subscribeGemmaTransformersRuntime((event) => {
      const stepId = isGemmaModelStage(event.stage) ? 'model' : activeStepId;
      const status = event.stage === 'error'
        ? 'error'
        : event.stage === 'session-ready' || event.stage === 'cache-hit'
          ? 'done'
          : 'active';

      setPipeline((p) => p && ({
        ...p,
        steps: updateStep(p.steps, stepId, {
          status,
          detail: formatGemmaRuntimeDetail(event),
        }),
      }));
    });
  }, [providerConfig.provider]);

  const startAnalysis = useCallback(async (hint: string, viewportContext?: ViewportContext, options?: { surveyMode?: boolean }) => {
    if (!metadata) return;
    abortRef.current = false;
    surveyModeRef.current = options?.surveyMode ?? false;
    setError(null);

    // Initialize pipeline
    const { textModel, visionModel } = getProviderLabels(providerConfig);
    const initialSteps: PipelineStep[] = [
      ...(providerConfig.provider === 'gemma-transformers'
        ? [{
            id: 'model',
            label: 'Loading Gemma 4 Browser model',
            status: 'pending' as const,
            detail: 'First run downloads model files into the browser cache.',
          }]
        : []),
      { id: 'plan', label: `Selection planning (${textModel})`, status: 'pending' },
      { id: 'select', label: 'Selecting slices', status: 'pending' },
      { id: 'export', label: 'Exporting images', status: 'pending' },
      { id: 'analyze', label: `Analyzing images (${visionModel})`, status: 'pending' },
    ];
    setPipeline({
      steps: initialSteps,
      plan: null,
      sliceCount: 0,
      totalSlices: 0,
      analysisDepth: getAnalysisDepth(providerConfig),
      batchCount: 0,
      exportedSizes: [],
      sliceMappings: [],
    });

    const userMsg: ChatMessage = {
      id: makeId(),
      role: 'user',
      content: hint,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg]);

    try {
      const { createLLMService } = await loadLlmFactory();
      const service = createLLMService(providerConfig);

      // Step 1: Selection planning
      setStatus('planning');
      const t0 = performance.now();
      setPipeline((p) => p && ({
        ...p,
        steps: updateStep(p.steps, 'plan', { status: 'active', detail: 'Sending metadata to LLM...' }),
      }));

      logger.group('[Dr.MRI.AI] Analysis Pipeline');
      logger.log('Clinical hint:', hint);
      logger.log('Study metadata:', {
        study: metadata.studyDescription,
        modality: metadata.modality,
        series: metadata.series.map((s) => ({
          '#': s.seriesNumber,
          desc: s.seriesDescription,
          plane: s.anatomicalPlane,
          slices: s.slices.length,
        })),
      });

      const unsubscribeGemmaStatus = attachGemmaRuntimeStatus('plan');
      let rawPlan: SelectionPlan;
      try {
        rawPlan = await service.getSelectionPlan(metadata, hint, viewportContext);
      } finally {
        unsubscribeGemmaStatus();
      }
      const t1 = performance.now();
      if (abortRef.current) { logger.groupEnd(); return; }

      logger.log('Call 1 — Raw plan:', rawPlan);
      const plan = {
        ...fixSelectionPlan(rawPlan, metadata, 20),
        analysisDepth: getAnalysisDepth(providerConfig),
      };
      if (plan.sliceRange[0] !== rawPlan.sliceRange[0] || plan.sliceRange[1] !== rawPlan.sliceRange[1]) {
        logger.log('Plan fixed:', `[${rawPlan.sliceRange}] → [${plan.sliceRange}]`);
      }

      setCurrentPlan(plan);
      const planDetail = `Series #${plan.targetSeries}, instances ${plan.sliceRange[0]}–${plan.sliceRange[1]}, W:${plan.windowWidth} C:${plan.windowCenter}`;
      setPipeline((p) => p && ({
        ...p,
        plan,
        steps: updateStep(p.steps, 'plan', {
          status: 'done',
          detail: planDetail,
          durationMs: Math.round(t1 - t0),
        }),
      }));

      // Store context for continuation after user confirms
      hintRef.current = hint;
      planTimingRef.current = { t0, t1 };
      setStatus('awaiting-confirmation');
      logger.log('Awaiting user confirmation of selection plan');
      logger.groupEnd();
    } catch (err) {
      logger.groupEnd();
      if (abortRef.current) return;
      const msg = err instanceof Error ? err.message : 'An unexpected error occurred';
      setPipeline((p) => p && ({
        ...p,
        steps: updateStep(p.steps, 'plan', {
          status: 'error',
          detail: msg,
        }),
      }));
      setError(msg);
      setStatus('error');
    }
  }, [metadata, providerConfig, attachGemmaRuntimeStatus]);

  const confirmPlan = useCallback(async (adjustedPlan: SelectionPlan) => {
    if (!metadata) return;
    abortRef.current = false;
    setError(null);

    const hint = hintRef.current;

    const policy = getAnalysisDepthPolicy(
      providerConfig,
      adjustedPlan.analysisDepth ?? getAnalysisDepth(providerConfig),
    );
    const executionPlan = expandPlanForAnalysisDepth(adjustedPlan, metadata, policy);

    // Update plan and pipeline with adjusted values
    setCurrentPlan(executionPlan);
    const planDetail = `Series #${executionPlan.targetSeries}, instances ${executionPlan.sliceRange[0]}–${executionPlan.sliceRange[1]}, W:${executionPlan.windowWidth} C:${executionPlan.windowCenter}`;
    setPipeline((p) => p && ({
      ...p,
      plan: executionPlan,
      analysisDepth: executionPlan.analysisDepth,
      steps: updateStep(p.steps, 'plan', {
        status: 'done',
        detail: planDetail,
        durationMs: Math.round(planTimingRef.current.t1 - planTimingRef.current.t0),
      }),
    }));

    try {
      const [
        { createLLMService },
        { selectSlicesForSelection },
        { exportSlicesToJpeg },
      ] = await Promise.all([
        loadLlmFactory(),
        loadSliceSelector(),
        loadSliceExporter(),
      ]);
      const service = createLLMService(providerConfig);
      const exportMaxLongEdge = getProviderExportMaxLongEdge(providerConfig);

      logger.group('[Dr.MRI.AI] Analysis Pipeline (continued)');
      logger.log('Confirmed plan:', executionPlan);

      // Step 2: Select slices across all series
      setPipeline((p) => p && ({
        ...p,
        steps: updateStep(p.steps, 'select', { status: 'active', detail: `Selecting from ${executionPlan.selections.length} series...` }),
      }));

      const allMappings: SliceMapping[] = [];
      const allBlobs: Blob[] = [];
      let totalSelectedCount = 0;
      let grandTotalSlices = 0;

      // Step 3: Export to JPEG (per-selection with per-selection W/L)
      setStatus('exporting');
      const t2 = performance.now();

      for (const sel of executionPlan.selections) {
        const selectedSlices = selectSlicesForSelection(metadata, sel, {
          maxSlices: policy.providerDepth === 'full'
            ? Number.POSITIVE_INFINITY
            : countSelectionAgainstMetadata(metadata, sel),
        });
        logger.log(`[${sel.role}] Series #${sel.seriesNumber}: selected ${selectedSlices.length} slices`);

        if (selectedSlices.length === 0) continue;

        const series = metadata.series.find((s) => String(s.seriesNumber) === sel.seriesNumber);
        const totalSlicesInSeries = series?.slices.length ?? selectedSlices.length;
        const seriesDesc = series?.seriesDescription || `Series #${sel.seriesNumber}`;
        const axisLetter = series?.anatomicalPlane === 'sagittal' ? 'x'
          : series?.anatomicalPlane === 'coronal' ? 'y' : 'z';

        totalSelectedCount += selectedSlices.length;
        grandTotalSlices += totalSlicesInSeries;

        setPipeline((p) => p && ({
          ...p,
          steps: updateStep(p.steps, 'export', { status: 'active', detail: `Rendering Series #${sel.seriesNumber} (${selectedSlices.length} slices, W:${sel.windowWidth} C:${sel.windowCenter})...` }),
        }));

        const exported = await exportSlicesToJpeg(selectedSlices, sel.windowCenter, sel.windowWidth, {
          maxLongEdge: exportMaxLongEdge,
        });
        if (abortRef.current) { logger.groupEnd(); return; }

        for (const e of exported) {
          const globalIdx = allBlobs.length + 1;
          allBlobs.push(e.blob);
          allMappings.push({
            imageIndex: globalIdx,
            instanceNumber: e.instanceNumber,
            imageId: selectedSlices.find((s) => s.instanceNumber === e.instanceNumber)?.imageId ?? '',
            zPosition: e.zPosition,
            label: `${seriesDesc} — Slice ${e.instanceNumber}/${totalSlicesInSeries} (${axisLetter}=${e.zPosition.toFixed(0)}mm)`,
            seriesNumber: sel.seriesNumber,
          });
        }

        if (exported.length < selectedSlices.length) {
          logger.warn(`[Export] Series #${sel.seriesNumber}: ${selectedSlices.length - exported.length} slices failed to render`);
        }
      }

      const t3 = performance.now();

      if (allBlobs.length === 0) {
        logger.groupEnd();
        setPipeline((p) => p && ({
          ...p,
          steps: updateStep(p.steps, 'select', { status: 'error', detail: 'No slices matched' }),
        }));
        throw new Error('No slices matched the selection plan. Try a different prompt.');
      }

      const sliceDetail = `${totalSelectedCount} slices from ${executionPlan.selections.length} series`;
      setPipeline((p) => p && ({
        ...p,
        sliceCount: totalSelectedCount,
        totalSlices: grandTotalSlices,
        steps: updateStep(p.steps, 'select', { status: 'done', detail: sliceDetail }),
      }));

      const sizes = allBlobs.map((b) => `${(b.size / 1024).toFixed(0)}KB`);
      const totalSize = allBlobs.reduce((sum, b) => sum + b.size, 0);
      const batchCount = Math.max(1, Math.ceil(allBlobs.length / policy.batchSize));
      const coverageDetail = `${getDepthLabel(executionPlan.analysisDepth ?? policy.providerDepth)} · ${allBlobs.length}/${grandTotalSlices} slices · ${batchCount} ${batchCount === 1 ? 'batch' : 'batches'}`;
      if ((executionPlan.analysisDepth ?? policy.providerDepth) === 'full' && allBlobs.length > 120) {
        logger.warn('[Coverage] Full mode exceeds 120 images; expect slower runtime, higher hosted-model cost, and possible local-model failures.');
      }
      logger.log(`Exported ${allBlobs.length} JPEG images (sizes: ${sizes.join(', ')})`);
      logger.log('Slice mappings:', allMappings.map((m) => m.label));
      logger.log('Coverage:', coverageDetail);

      setPipeline((p) => p && ({
        ...p,
        analysisDepth: executionPlan.analysisDepth ?? policy.providerDepth,
        batchCount,
        exportedSizes: sizes,
        sliceMappings: allMappings,
        steps: updateStep(p.steps, 'export', {
          status: 'done',
          detail: `${allBlobs.length} images (${(totalSize / 1024).toFixed(0)}KB total)`,
          durationMs: Math.round(t3 - t2),
        }),
      }));

      // Step 4: Analyze
      setStatus('analyzing');
      const t4 = performance.now();
      setPipeline((p) => p && ({
        ...p,
        steps: updateStep(p.steps, 'analyze', { status: 'active', detail: `Coverage: ${coverageDetail}` }),
      }));

      const sliceLabels = allMappings.map((m) => m.label);
      logger.log(`Call 2 — Sending ${allBlobs.length} images to LLM (${sliceLabels.join(', ')})...`);
      const unsubscribeGemmaStatus = attachGemmaRuntimeStatus('analyze');
      let analysisText: string;
      try {
        analysisText = await service.analyzeSlices(
          allBlobs,
          metadata,
          hint,
          executionPlan,
          sliceLabels,
          surveyModeRef.current,
          {
            batchSize: policy.batchSize,
            analysisDepth: executionPlan.analysisDepth ?? policy.providerDepth,
          },
        );
      } finally {
        unsubscribeGemmaStatus();
      }
      const t5 = performance.now();
      if (abortRef.current) { logger.groupEnd(); return; }

      logger.log('Call 2 — Analysis response:', analysisText.slice(0, 200) + '...');
      logger.groupEnd();

      setPipeline((p) => p && ({
        ...p,
        steps: updateStep(p.steps, 'analyze', {
          status: 'done',
          detail: `Response received · ${coverageDetail}`,
          durationMs: Math.round(t5 - t4),
        }),
      }));

      const assistantMsg: ChatMessage = {
        id: makeId(),
        role: 'assistant',
        content: analysisText,
        timestamp: Date.now(),
      };
      const evidenceBundle: AnalysisEvidenceBundle = {
        analysisId: assistantMsg.id,
        createdAt: assistantMsg.timestamp,
        prompt: hint,
        plan: executionPlan,
        analysisDepth: executionPlan.analysisDepth ?? policy.providerDepth,
        batchCount,
        surveyMode: surveyModeRef.current,
        images: allMappings.map((mapping, index) => ({
          fileName: toEvidenceFileName(mapping.seriesNumber, mapping.instanceNumber, index + 1),
          label: mapping.label,
          seriesNumber: mapping.seriesNumber,
          instanceNumber: mapping.instanceNumber,
          zPosition: mapping.zPosition,
          blob: allBlobs[index],
        })),
      };
      setLatestEvidenceBundle(evidenceBundle);
      setMessages((prev) => [...prev, assistantMsg]);
      setStatus('idle');
    } catch (err) {
      logger.groupEnd();
      if (abortRef.current) return;
      const msg = err instanceof Error ? err.message : 'An unexpected error occurred';
      setPipeline((p) => p && ({
        ...p,
        steps: updateStep(p.steps, 'analyze', {
          status: 'error',
          detail: msg,
        }),
      }));
      setError(msg);
      setStatus('error');
    }
  }, [metadata, providerConfig, attachGemmaRuntimeStatus]);

  const cancelPlan = useCallback(() => {
    abortRef.current = true;
    setStatus('idle');
    setCurrentPlan(null);
    setPipeline(null);
    // Remove the last user message (the hint that was added)
    setMessages((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      if (last.role === 'user') return prev.slice(0, -1);
      return prev;
    });
  }, []);

  const sendFollowUp = useCallback(async (text: string) => {
    if (!metadata) return;
    setError(null);

    const userMsg: ChatMessage = {
      id: makeId(),
      role: 'user',
      content: text,
      timestamp: Date.now(),
    };

    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);

    try {
      const { createLLMService } = await loadLlmFactory();
      const service = createLLMService(providerConfig);
      setStatus('following-up');

      const response = await service.sendFollowUp(updatedMessages, metadata);

      const assistantMsg: ChatMessage = {
        id: makeId(),
        role: 'assistant',
        content: response,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
      setStatus('idle');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'An unexpected error occurred';
      setError(msg);
      setStatus('error');
    }
  }, [metadata, providerConfig, messages]);

  const clearChat = useCallback(() => {
    abortRef.current = true;
    surveyModeRef.current = false;
    setMessages([]);
    setStatus('idle');
    setError(null);
    setCurrentPlan(null);
    setPipeline(null);
    setLatestEvidenceBundle(null);
  }, []);

  return {
    messages,
    status,
    statusText: STATUS_LABELS[status],
    error,
    currentPlan,
    pipeline,
    latestEvidenceBundle,
    startAnalysis,
    confirmPlan,
    cancelPlan,
    sendFollowUp,
    clearChat,
  };
}
