import type { StudyMetadata } from '../dicom/types';
import type { AnalysisDepth, ProviderConfig, SeriesSelection } from './types';
import { DEFAULT_GEMMA_TRANSFORMERS_MAX_IMAGES } from './gemmaTransformersConfig';

export const DEFAULT_ANALYSIS_DEPTH: AnalysisDepth = 'standard';

export interface AnalysisDepthPolicy {
  depth: AnalysisDepth;
  providerDepth: AnalysisDepth;
  standardBudget: number;
  maxImages: number;
  batchSize: number;
  fullEnabled: boolean;
  warning?: string;
}

function clampGemmaImages(value: number | undefined): number {
  return Math.max(1, Math.min(
    DEFAULT_GEMMA_TRANSFORMERS_MAX_IMAGES,
    Math.round(value ?? DEFAULT_GEMMA_TRANSFORMERS_MAX_IMAGES),
  ));
}

export function getAnalysisDepth(config: ProviderConfig): AnalysisDepth {
  return config.analysisDepth ?? DEFAULT_ANALYSIS_DEPTH;
}

export function getDepthLabel(depth: AnalysisDepth): string {
  if (depth === 'fast') return 'Fast';
  if (depth === 'full') return 'Full';
  return 'Standard';
}

export function getAnalysisDepthPolicy(
  config: ProviderConfig,
  requestedDepth: AnalysisDepth = getAnalysisDepth(config),
): AnalysisDepthPolicy {
  if (config.provider === 'gemma-transformers') {
    const maxImages = clampGemmaImages(config.gemmaTransformersMaxImages);
    const providerDepth = requestedDepth === 'full' ? 'standard' : requestedDepth;
    return {
      depth: requestedDepth,
      providerDepth,
      standardBudget: maxImages,
      maxImages: providerDepth === 'fast' ? Math.min(20, maxImages) : maxImages,
      batchSize: Math.max(1, Math.min(4, maxImages)),
      fullEnabled: false,
      warning: requestedDepth === 'full'
        ? 'Full coverage is unavailable for Gemma Browser because browser memory is the limiting factor.'
        : undefined,
    };
  }

  if (config.provider === 'ollama') {
    const full = requestedDepth === 'full';
    return {
      depth: requestedDepth,
      providerDepth: requestedDepth,
      standardBudget: 40,
      maxImages: full ? Number.POSITIVE_INFINITY : requestedDepth === 'fast' ? 20 : 40,
      batchSize: 12,
      fullEnabled: true,
    };
  }

  const full = requestedDepth === 'full';
  return {
    depth: requestedDepth,
    providerDepth: requestedDepth,
    standardBudget: 60,
    maxImages: full ? Number.POSITIVE_INFINITY : requestedDepth === 'fast' ? 20 : 60,
    batchSize: 24,
    fullEnabled: true,
  };
}

export function getSeriesForSelection(
  metadata: StudyMetadata,
  selection: SeriesSelection,
): StudyMetadata['series'][number] | undefined {
  return metadata.series.find((series) => String(series.seriesNumber) === selection.seriesNumber);
}

export function isLocalizerSeries(series: StudyMetadata['series'][number] | undefined): boolean {
  const description = (series?.seriesDescription ?? '').toLowerCase();
  return /\b(loc|localizer|scout|survey|topogram|pilot)\b/.test(description);
}

export function estimateSelectionCount(selection: SeriesSelection): number {
  const rangeSize = selection.sliceRange[1] - selection.sliceRange[0] + 1;
  if (selection.samplingStrategy === 'uniform' && selection.samplingParam != null) {
    return Math.min(selection.samplingParam, rangeSize);
  }
  if (
    selection.samplingStrategy === 'every_nth' &&
    selection.samplingParam != null &&
    selection.samplingParam > 0
  ) {
    return Math.ceil(rangeSize / selection.samplingParam);
  }
  return rangeSize;
}

export function estimateSelectedSeriesTotal(
  metadata: StudyMetadata,
  selections: SeriesSelection[],
): number {
  const seriesNumbers = new Set<string>();
  let total = 0;
  for (const selection of selections) {
    if (seriesNumbers.has(selection.seriesNumber)) continue;
    const series = getSeriesForSelection(metadata, selection);
    if (!series || isLocalizerSeries(series)) continue;
    seriesNumbers.add(selection.seriesNumber);
    total += series.slices.length;
  }
  return total;
}

export function distributeBudgetBySeries(
  metadata: StudyMetadata,
  selections: SeriesSelection[],
  totalBudget: number,
): Map<string, number> {
  const diagnosticSelections = selections.filter((selection, index, array) => {
    if (array.findIndex((item) => item.seriesNumber === selection.seriesNumber) !== index) return false;
    const series = getSeriesForSelection(metadata, selection);
    return !!series && !isLocalizerSeries(series);
  });
  const totalAvailable = estimateSelectedSeriesTotal(metadata, diagnosticSelections);
  const budget = Math.max(1, Math.min(totalBudget, totalAvailable || totalBudget));
  const allocation = new Map<string, number>();
  if (diagnosticSelections.length === 0) return allocation;

  const exactShares = diagnosticSelections.map((selection) => {
    const series = getSeriesForSelection(metadata, selection);
    const count = series?.slices.length ?? estimateSelectionCount(selection);
    return {
      seriesNumber: selection.seriesNumber,
      available: count,
      exact: totalAvailable > 0 ? (count / totalAvailable) * budget : budget / diagnosticSelections.length,
    };
  });

  let assigned = 0;
  for (const share of exactShares) {
    const value = Math.max(1, Math.min(share.available, Math.floor(share.exact)));
    allocation.set(share.seriesNumber, value);
    assigned += value;
  }

  const byRemainder = [...exactShares].sort((a, b) => {
    const aCurrent = allocation.get(a.seriesNumber) ?? 0;
    const bCurrent = allocation.get(b.seriesNumber) ?? 0;
    return (b.exact - Math.floor(b.exact)) - (a.exact - Math.floor(a.exact))
      || b.available - bCurrent - (a.available - aCurrent);
  });

  let guard = 0;
  while (assigned < budget && guard < budget * 2) {
    guard += 1;
    let changed = false;
    for (const share of byRemainder) {
      if (assigned >= budget) break;
      const current = allocation.get(share.seriesNumber) ?? 0;
      if (current >= share.available) continue;
      allocation.set(share.seriesNumber, current + 1);
      assigned += 1;
      changed = true;
    }
    if (!changed) break;
  }

  return allocation;
}
