import { useState } from 'react';
import { CheckCircle, Loader2, Circle, AlertCircle, ChevronDown, ChevronRight } from 'lucide-react';
import type { SelectionPlan } from '../llm/types';
import type { PipelineState, PipelineStep, SliceMapping } from '../llm/useLLMChat';

export default function PipelineView({ pipeline }: { pipeline: PipelineState }) {
  const [expanded, setExpanded] = useState(true);
  const allDone = pipeline.steps.every((s) => s.status === 'done');

  return (
    <div className="my-2 overflow-hidden rounded-[22px] border border-white/10 bg-white/[0.03]">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-4 py-3 text-left text-xs font-medium uppercase tracking-[0.18em] text-white/60 hover:bg-white/[0.04]"
      >
        {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        <span>Pipeline {allDone ? '(complete)' : ''}</span>
        {!allDone && <Loader2 className="ml-auto h-3 w-3 animate-spin text-teal-200/80" />}
      </button>
      {expanded && (
        <div className="space-y-2 px-4 pb-4">
          {pipeline.steps.map((step) => (
            <StepRow key={step.id} step={step} />
          ))}
          {pipeline.plan && (
            <PlanDetail plan={pipeline.plan} />
          )}
          {pipeline.sliceMappings.length > 0 && (
            <SliceMappingDetail mappings={pipeline.sliceMappings} totalSlices={pipeline.totalSlices} />
          )}
        </div>
      )}
    </div>
  );
}

function StepRow({ step }: { step: PipelineStep }) {
  return (
    <div className="flex items-start gap-2">
      <div className="mt-0.5 shrink-0">
        {step.status === 'done' && <CheckCircle className="w-3.5 h-3.5 text-green-400" />}
        {step.status === 'active' && <Loader2 className="w-3.5 h-3.5 text-teal-200/80 animate-spin" />}
        {step.status === 'pending' && <Circle className="w-3.5 h-3.5 text-white/25" />}
        {step.status === 'error' && <AlertCircle className="w-3.5 h-3.5 text-red-400" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={`text-xs ${step.status === 'done' ? 'text-white/80' : step.status === 'active' ? 'text-teal-100/85' : 'text-white/42'}`}>
            {step.label}
          </span>
          {step.durationMs != null && (
            <span className="text-[10px] text-white/30">{(step.durationMs / 1000).toFixed(1)}s</span>
          )}
        </div>
        {step.detail && (
          <p className={`mt-0.5 text-[10px] ${step.status === 'error' ? 'text-red-300' : 'text-white/42'}`}>
            {step.detail}
          </p>
        )}
      </div>
    </div>
  );
}

function PlanDetail({ plan }: { plan: SelectionPlan }) {
  return (
    <div className="mt-1.5 ml-5.5 space-y-0.5 border-l border-white/10 pl-3 text-[10px] text-white/40">
      <p className="font-medium text-white/65">LLM reasoning:</p>
      <p className="italic">{plan.reasoning}</p>
    </div>
  );
}

function SliceMappingDetail({ mappings, totalSlices }: { mappings: SliceMapping[]; totalSlices: number }) {
  const [showAll, setShowAll] = useState(false);
  const labels = mappings.map((m) => m.label);
  const preview = showAll ? labels : labels.slice(0, 6);
  const hasMore = labels.length > 6;

  return (
    <div className="mt-1.5 ml-5.5 space-y-0.5 border-l border-white/10 pl-3 text-[10px] text-white/40">
      <p className="font-medium text-white/65">
        Sent to vision model: {mappings.length} of {totalSlices} slices
      </p>
      <div className="flex flex-wrap gap-1">
        {preview.map((label, i) => (
          <span key={i} className="rounded-full border border-white/8 bg-black/15 px-2 py-1 text-white/48">
            {label}
          </span>
        ))}
        {hasMore && !showAll && (
          <button
            onClick={() => setShowAll(true)}
            className="px-1.5 py-0.5 text-teal-200/80 hover:text-teal-100"
          >
            +{labels.length - 6} more
          </button>
        )}
      </div>
    </div>
  );
}
