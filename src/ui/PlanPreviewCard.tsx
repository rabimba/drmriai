import { useState, useEffect, useCallback } from 'react';
import { ChevronUp, ChevronDown, X } from 'lucide-react';
import type { AnalysisDepth, ProviderConfig, SelectionPlan, SeriesSelection } from '../llm/types';
import type { StudyMetadata } from '../dicom/types';
import {
  estimateSelectedSeriesTotal,
  getAnalysisDepth,
  getAnalysisDepthPolicy,
  getDepthLabel,
} from '../llm/analysisDepth';

interface PlanPreviewCardProps {
  plan: SelectionPlan;
  metadata: StudyMetadata;
  providerConfig: ProviderConfig;
  onAccept: (plan: SelectionPlan) => void;
  onCancel: () => void;
}

function estimateSlices(sel: SeriesSelection): number {
  const rangeSize = sel.sliceRange[1] - sel.sliceRange[0] + 1;
  if (sel.samplingStrategy === 'uniform' && sel.samplingParam != null) {
    return Math.min(sel.samplingParam, rangeSize, 20);
  }
  if (sel.samplingStrategy === 'every_nth' && sel.samplingParam != null && sel.samplingParam > 0) {
    return Math.min(Math.ceil(rangeSize / sel.samplingParam), 20);
  }
  return Math.min(rangeSize, 20);
}

interface SelectionRowState {
  seriesNumber: string;
  role: 'primary' | 'supplementary';
  rationale: string;
  rangeStart: number;
  rangeEnd: number;
  numSlices: number;
  windowCenter: number;
  windowWidth: number;
}

function selectionToRowState(sel: SeriesSelection): SelectionRowState {
  return {
    seriesNumber: sel.seriesNumber,
    role: sel.role,
    rationale: sel.rationale,
    rangeStart: sel.sliceRange[0],
    rangeEnd: sel.sliceRange[1],
    numSlices: estimateSlices(sel),
    windowCenter: sel.windowCenter,
    windowWidth: sel.windowWidth,
  };
}

function rowStateToSelection(row: SelectionRowState): SeriesSelection {
  const rangeSize = row.rangeEnd - row.rangeStart + 1;
  const clampedSlices = Math.min(Math.max(row.numSlices, 1), rangeSize, 20);
  return {
    seriesNumber: row.seriesNumber,
    role: row.role,
    rationale: row.rationale,
    sliceRange: [row.rangeStart, row.rangeEnd],
    samplingStrategy: clampedSlices >= rangeSize ? 'all' : 'uniform',
    samplingParam: clampedSlices >= rangeSize ? undefined : clampedSlices,
    windowCenter: row.windowCenter,
    windowWidth: row.windowWidth,
  };
}

export default function PlanPreviewCard({ plan, metadata, providerConfig, onAccept, onCancel }: PlanPreviewCardProps) {
  const [expanded, setExpanded] = useState(true);
  const [analysisDepth, setAnalysisDepth] = useState<AnalysisDepth>(() => {
    const defaultDepth = getAnalysisDepth(providerConfig);
    const policy = getAnalysisDepthPolicy(providerConfig, defaultDepth);
    return policy.fullEnabled || defaultDepth !== 'full' ? defaultDepth : 'standard';
  });
  const [rows, setRows] = useState<SelectionRowState[]>(() =>
    plan.selections.map(selectionToRowState),
  );

  useEffect(() => {
    const defaultDepth = plan.analysisDepth ?? getAnalysisDepth(providerConfig);
    const policy = getAnalysisDepthPolicy(providerConfig, defaultDepth);
    setAnalysisDepth(policy.fullEnabled || defaultDepth !== 'full' ? defaultDepth : 'standard');
    setRows(plan.selections.map(selectionToRowState));
    setExpanded(true);
  }, [plan, providerConfig]);

  const seedSelections = rows.map(rowStateToSelection);
  const seedTotalSlices = seedSelections.reduce((sum, selection) => sum + estimateSlices(selection), 0);
  const selectedSeriesTotal = estimateSelectedSeriesTotal(metadata, seedSelections);
  const policy = getAnalysisDepthPolicy(providerConfig, analysisDepth);
  const estimatedImages = policy.providerDepth === 'fast'
    ? Math.min(seedTotalSlices, policy.maxImages)
    : policy.providerDepth === 'full'
      ? selectedSeriesTotal
      : Math.min(selectedSeriesTotal, policy.maxImages);
  const batchCount = Math.max(1, Math.ceil(Math.max(estimatedImages, 1) / policy.batchSize));
  const coverageText = `${getDepthLabel(policy.providerDepth)} · ${estimatedImages}/${selectedSeriesTotal || seedTotalSlices} slices · ${batchCount} ${batchCount === 1 ? 'batch' : 'batches'}`;
  const fullWarning = policy.providerDepth === 'full' && estimatedImages > 120
    ? 'Full coverage above 120 images can be slow, costly, and may fail on local models.'
    : policy.warning;

  const updateRow = useCallback((idx: number, updates: Partial<SelectionRowState>) => {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...updates } : r)));
  }, []);

  const removeRow = useCallback((idx: number) => {
    setRows((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const handleSeriesChange = useCallback((idx: number, newSeriesNum: string) => {
    const series = metadata.series.find((s) => String(s.seriesNumber) === newSeriesNum);
    if (series) {
      const [minInst, maxInst] = series.instanceNumberRange;
      const rangeSize = maxInst - minInst + 1;
      updateRow(idx, {
        seriesNumber: newSeriesNum,
        rangeStart: minInst,
        rangeEnd: maxInst,
        numSlices: Math.min(rows[idx].role === 'primary' ? 12 : 5, rangeSize, 20),
        windowCenter: series.windowCenter ?? rows[idx].windowCenter,
        windowWidth: series.windowWidth ?? rows[idx].windowWidth,
      });
    } else {
      updateRow(idx, { seriesNumber: newSeriesNum });
    }
  }, [metadata, rows, updateRow]);

  const handleAccept = useCallback(() => {
    const selections = rows.map(rowStateToSelection);
    const primary = selections[0];
    const adjustedPlan: SelectionPlan = {
      reasoning: plan.reasoning,
      selections,
      totalImages: selections.reduce((sum, s) => sum + estimateSlices(s), 0),
      analysisDepth: policy.providerDepth,
      targetSeries: primary.seriesNumber,
      sliceRange: primary.sliceRange,
      windowCenter: primary.windowCenter,
      windowWidth: primary.windowWidth,
      samplingStrategy: primary.samplingStrategy,
      samplingParam: primary.samplingParam,
    };
    onAccept(adjustedPlan);
  }, [rows, plan.reasoning, policy.providerDepth, onAccept]);

  // Collapsed summary
  const summaryParts = rows.map((r) => {
    const s = metadata.series.find((s) => String(s.seriesNumber) === r.seriesNumber);
    const desc = s ? `#${s.seriesNumber} ${s.seriesDescription || ''}` : `#${r.seriesNumber}`;
    return `${desc} (${r.numSlices})`;
  });

  return (
    <div className="bg-neutral-800 border border-neutral-600 rounded-lg overflow-hidden">
      {/* Collapsed bar */}
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="p-0.5 rounded hover:bg-neutral-700 text-neutral-400 hover:text-neutral-200"
          title={expanded ? 'Collapse' : 'Expand to edit'}
        >
          {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
        </button>

          <span className="text-[11px] text-neutral-300 truncate flex-1 leading-tight">
            <span className="text-neutral-500">Plan:</span>{' '}
          {summaryParts.join(' + ')} &middot; {coverageText}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 px-3 pb-2">
        {(['fast', 'standard', 'full'] as AnalysisDepth[]).map((depth) => {
          const optionPolicy = getAnalysisDepthPolicy(providerConfig, depth);
          const disabled = depth === 'full' && !optionPolicy.fullEnabled;
          return (
            <button
              key={depth}
              type="button"
              onClick={() => !disabled && setAnalysisDepth(depth)}
              disabled={disabled}
              title={disabled ? optionPolicy.warning : undefined}
              className={`rounded-full border px-2.5 py-1 text-[10px] font-medium transition-colors ${
                analysisDepth === depth && !disabled
                  ? 'border-blue-400/70 bg-blue-500/20 text-blue-100'
                  : 'border-neutral-700 bg-neutral-900 text-neutral-400 hover:border-neutral-500 hover:text-neutral-200'
              } disabled:cursor-not-allowed disabled:opacity-45`}
            >
              {getDepthLabel(depth)}
            </button>
          );
        })}
        <span className="text-[10px] text-neutral-500">{coverageText}</span>
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-2 px-3 pb-2">
        <button
          onClick={onCancel}
          className="flex-1 px-3 py-1.5 text-xs text-neutral-400 hover:text-neutral-200 rounded border border-neutral-600 hover:bg-neutral-700 transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleAccept}
          disabled={rows.length === 0}
          className="flex-1 px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Accept &amp; Analyze ({getDepthLabel(policy.providerDepth)} · {estimatedImages} images)
        </button>
      </div>

      {/* Expanded: one section per selection */}
      {expanded && (
        <div className="px-3 pb-3 pt-1 border-t border-neutral-700/50 space-y-3">
          {rows.map((row, idx) => {
            const series = metadata.series.find((s) => String(s.seriesNumber) === row.seriesNumber);
            const seriesRange = series?.instanceNumberRange ?? [1, 999];
            const rangeSize = row.rangeEnd - row.rangeStart + 1;

            return (
              <div key={idx} className="space-y-1.5">
                {/* Header row */}
                <div className="flex items-center gap-1.5">
                  <span className={`text-[9px] font-bold uppercase tracking-wider px-1 py-0.5 rounded ${
                    row.role === 'primary' ? 'bg-blue-900/50 text-blue-300' : 'bg-neutral-700 text-neutral-400'
                  }`}>
                    {row.role === 'primary' ? 'PRI' : 'SUP'}
                  </span>
                  <select
                    value={row.seriesNumber}
                    onChange={(e) => handleSeriesChange(idx, e.target.value)}
                    className="flex-1 bg-neutral-900 border border-neutral-700 rounded px-1.5 py-0.5 text-[11px] text-neutral-100 outline-none focus:border-blue-500 min-w-0"
                  >
                    {metadata.series.map((s) => (
                      <option key={s.seriesInstanceUID} value={String(s.seriesNumber)}>
                        #{s.seriesNumber} — {s.seriesDescription || 'No description'} ({s.slices.length}, {s.anatomicalPlane})
                      </option>
                    ))}
                  </select>
                  {row.role === 'supplementary' && (
                    <button
                      onClick={() => removeRow(idx)}
                      className="p-0.5 rounded hover:bg-neutral-700 text-neutral-500 hover:text-red-400"
                      title="Remove series"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>

                {/* Controls row */}
                <div className="flex items-center gap-2 flex-wrap pl-1">
                  <div className="flex items-center gap-1">
                    <label className="text-[9px] text-neutral-500">Range</label>
                    <input
                      type="number"
                      value={row.rangeStart}
                      onChange={(e) => updateRow(idx, { rangeStart: Math.max(seriesRange[0], parseInt(e.target.value) || seriesRange[0]) })}
                      min={seriesRange[0]}
                      max={row.rangeEnd}
                      className="w-12 bg-neutral-900 border border-neutral-700 rounded px-1 py-0.5 text-[11px] text-neutral-100 outline-none focus:border-blue-500"
                    />
                    <span className="text-neutral-500 text-[10px]">&ndash;</span>
                    <input
                      type="number"
                      value={row.rangeEnd}
                      onChange={(e) => updateRow(idx, { rangeEnd: Math.min(seriesRange[1], parseInt(e.target.value) || seriesRange[1]) })}
                      min={row.rangeStart}
                      max={seriesRange[1]}
                      className="w-12 bg-neutral-900 border border-neutral-700 rounded px-1 py-0.5 text-[11px] text-neutral-100 outline-none focus:border-blue-500"
                    />
                  </div>
                  <div className="flex items-center gap-1">
                    <label className="text-[9px] text-neutral-500">N</label>
                    <input
                      type="number"
                      value={row.numSlices}
                      onChange={(e) => updateRow(idx, { numSlices: Math.max(1, Math.min(20, parseInt(e.target.value) || 1)) })}
                      min={1}
                      max={20}
                      className="w-10 bg-neutral-900 border border-neutral-700 rounded px-1 py-0.5 text-[11px] text-neutral-100 outline-none focus:border-blue-500"
                    />
                    <span className="text-[9px] text-neutral-500">/ {Math.min(rangeSize, 20)}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <label className="text-[9px] text-neutral-500">C:</label>
                    <input
                      type="number"
                      value={row.windowCenter}
                      onChange={(e) => updateRow(idx, { windowCenter: parseInt(e.target.value) || 0 })}
                      className="w-12 bg-neutral-900 border border-neutral-700 rounded px-1 py-0.5 text-[11px] text-neutral-100 outline-none focus:border-blue-500"
                    />
                    <label className="text-[9px] text-neutral-500">W:</label>
                    <input
                      type="number"
                      value={row.windowWidth}
                      onChange={(e) => updateRow(idx, { windowWidth: parseInt(e.target.value) || 1 })}
                      min={1}
                      className="w-12 bg-neutral-900 border border-neutral-700 rounded px-1 py-0.5 text-[11px] text-neutral-100 outline-none focus:border-blue-500"
                    />
                  </div>
                </div>
              </div>
            );
          })}

          {/* Total count */}
          <div className="flex items-center justify-between pt-1 border-t border-neutral-700/30">
            <span className="text-[10px] text-neutral-500">
              Coverage: {coverageText}
            </span>
            {fullWarning && (
              <span className="text-[10px] text-amber-300">{fullWarning}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
