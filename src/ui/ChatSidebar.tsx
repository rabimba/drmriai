import { useState, useRef, useEffect, useImperativeHandle, forwardRef, useMemo } from 'react';
import {
  X,
  Send,
  Trash2,
  AlertCircle,
  Loader2,
  ClipboardList,
  MessageSquare,
  Download,
  Sparkles,
  ArrowRight,
  Save,
  FileJson,
  Archive,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import type { ChatMessage, SavedAnalysisRecord, SelectionPlan } from '../llm/types';
import type { StudyMetadata } from '../dicom/types';
import type { ChatStatus, PipelineState, SliceMapping } from '../llm/useLLMChat';
import { detectBodyPart, getChecklist, buildSurveyHint } from '../llm/anatomyChecklists';
import PipelineView from './PipelineView';
import AssistantMessage from './AssistantMessage';
import PlanPreviewCard from './PlanPreviewCard';

export interface ChatSidebarHandle {
  focusInput: () => void;
}

interface ChatSidebarProps {
  messages: ChatMessage[];
  status: ChatStatus;
  statusText: string;
  error: string | null;
  pipeline: PipelineState | null;
  currentPlan: SelectionPlan | null;
  studyMetadata: StudyMetadata | null;
  onConfirmPlan: (plan: SelectionPlan) => void;
  onCancelPlan: () => void;
  onStartAnalysis: (hint: string, options?: { surveyMode?: boolean }) => void;
  onSendFollowUp: (text: string) => void;
  onClear: () => void;
  onClose: () => void;
  onNavigateToSlice: (mapping: SliceMapping) => void;
  onSaveLatest: () => void;
  onDownloadLatest: (format?: 'md' | 'json') => void;
  onDownloadEvidenceBundle: () => void;
  onDownloadSaved: (recordId: string, format?: 'md' | 'json') => void;
  hasEvidenceBundle: boolean;
  savedAnalyses: SavedAnalysisRecord[];
}

export default forwardRef<ChatSidebarHandle, ChatSidebarProps>(function ChatSidebar({
  messages,
  status,
  statusText,
  error,
  pipeline,
  currentPlan,
  studyMetadata,
  onConfirmPlan,
  onCancelPlan,
  onStartAnalysis,
  onSendFollowUp,
  onClear,
  onClose,
  onNavigateToSlice,
  onSaveLatest,
  onDownloadLatest,
  onDownloadEvidenceBundle,
  onDownloadSaved,
  hasEvidenceBundle,
  savedAnalyses,
}, ref) {
  const [input, setInput] = useState('');
  const [surveyActive, setSurveyActive] = useState(false);
  const [showDeeperPrompts, setShowDeeperPrompts] = useState(false);
  const [selectedStructures, setSelectedStructures] = useState<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const busy = status !== 'idle' && status !== 'error' && status !== 'awaiting-confirmation';

  const detectedBodyPart = useMemo(
    () => (studyMetadata ? detectBodyPart(studyMetadata) : 'unknown'),
    [studyMetadata],
  );
  const checklist = useMemo(() => getChecklist(detectedBodyPart), [detectedBodyPart]);
  const starterPrompts = useMemo(() => getStarterPrompts(detectedBodyPart), [detectedBodyPart]);
  const deeperPrompts = useMemo(() => getDeepDivePrompts(detectedBodyPart), [detectedBodyPart]);
  const latestAssistantIndex = findLastMessageIndex(messages, 'assistant');
  const latestAssistant = latestAssistantIndex >= 0 ? messages[latestAssistantIndex] : null;

  useEffect(() => {
    setShowDeeperPrompts(false);
  }, [latestAssistant?.id]);

  useEffect(() => {
    setSelectedStructures(
      new Set(checklist.structures.filter((s) => s.defaultChecked).map((s) => s.id)),
    );
  }, [checklist]);

  useEffect(() => {
    if (messages.length === 0) {
      setSurveyActive(false);
    }
  }, [messages.length]);

  useImperativeHandle(ref, () => ({
    focusInput: () => inputRef.current?.focus(),
  }));

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, status, pipeline, currentPlan]);

  const sendPrompt = (prompt: string, options?: { surveyMode?: boolean }) => {
    const trimmed = prompt.trim();
    if (!trimmed || busy) return;
    if (messages.length === 0) {
      onStartAnalysis(trimmed, options);
    } else {
      onSendFollowUp(trimmed);
    }
    setInput('');
  };

  const handleSend = () => {
    sendPrompt(input);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      <div className="shrink-0 border-b border-white/10 px-4 py-4 sm:px-6 sm:py-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-[0.24em] text-amber-200/60">
              Dr.MRI.AI
            </div>
            <h2 className="mt-2 text-lg font-semibold tracking-[-0.03em] text-white sm:text-xl">
              {latestAssistant ? 'Interrogate the report and keep the evidence close.' : 'Start the AI read with one focused clinical question.'}
            </h2>
            <p className="mt-2 text-sm leading-6 text-white/60">
              {studyMetadata
                ? `${studyMetadata.studyDescription} · ${studyMetadata.modality} · export the report alone or bundle it with the reviewed slices.`
                : 'Load a study, ask what matters clinically, and let Dr.MRI.AI plan the evidence set before analyzing it.'}
            </p>
          </div>
          <div className="grid grid-cols-4 gap-2 sm:flex sm:flex-wrap sm:items-center sm:justify-end xl:max-w-[26rem]">
            <button
              onClick={onSaveLatest}
              title="Save latest analysis"
              aria-label="Save latest analysis"
              disabled={!latestAssistant}
              className="inline-flex items-center justify-center gap-2 rounded-full border border-white/12 bg-white/6 px-3 py-2 text-xs font-medium text-white/80 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-35"
            >
              <Save className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Save</span>
            </button>
            <button
              onClick={() => onDownloadLatest('md')}
              title="Export markdown"
              aria-label="Export markdown"
              disabled={!latestAssistant}
              className="inline-flex items-center justify-center gap-2 rounded-full border border-white/12 bg-white/6 px-3 py-2 text-xs font-medium text-white/80 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-35"
            >
              <Download className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Export MD</span>
            </button>
            <button
              onClick={() => onDownloadLatest('json')}
              title="Export JSON"
              aria-label="Export JSON"
              disabled={!latestAssistant}
              className="inline-flex items-center justify-center gap-2 rounded-full border border-white/12 bg-white/6 px-3 py-2 text-xs font-medium text-white/80 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-35"
            >
              <FileJson className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Export JSON</span>
            </button>
            <button
              onClick={onDownloadEvidenceBundle}
              title="Download evidence ZIP"
              aria-label="Download evidence ZIP"
              disabled={!hasEvidenceBundle}
              className="inline-flex items-center justify-center gap-2 rounded-full border border-white/12 bg-white/6 px-3 py-2 text-xs font-medium text-white/80 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-35"
            >
              <Archive className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Evidence ZIP</span>
            </button>
            {messages.length > 0 && (
              <button
                onClick={onClear}
                title="Clear chat"
                className="rounded-full border border-white/10 bg-white/[0.03] p-2 text-white/55 transition-colors hover:bg-white/8 hover:text-white"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
            <button
              onClick={onClose}
              className="rounded-full border border-white/10 bg-white/[0.03] p-2 text-white/55 transition-colors hover:bg-white/8 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">
        {savedAnalyses.length > 0 && (
          <div className="mb-5">
            <SavedResultsShelf records={savedAnalyses} onDownload={onDownloadSaved} />
          </div>
        )}

        {hasEvidenceBundle && latestAssistant && (
          <div className="mb-5 rounded-[24px] border border-teal-300/16 bg-teal-300/[0.06] p-4">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-teal-100/65">
              <Archive className="h-4 w-4" />
              Evidence Ready
            </div>
            <p className="mt-2 text-sm leading-6 text-white/70">
              Download a ZIP with the current report plus the exact JPEG slices used for the latest image-analysis pass.
            </p>
            <button
              onClick={onDownloadEvidenceBundle}
              className="mt-4 inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-teal-300 to-amber-300 px-4 py-2 text-sm font-medium text-slate-950 transition-transform hover:-translate-y-0.5"
            >
              <Archive className="h-4 w-4" />
              Download Evidence Bundle
            </button>
          </div>
        )}

        {messages.length === 0 && !busy && !pipeline && (
          studyMetadata ? (
            <AnalysisLaunchpad
              surveyActive={surveyActive}
              onToggleSurvey={setSurveyActive}
              checklist={checklist}
              selectedStructures={selectedStructures}
              onToggleStructure={(id) => {
                setSelectedStructures((prev) => {
                  const next = new Set(prev);
                  if (next.has(id)) next.delete(id);
                  else next.add(id);
                  return next;
                });
              }}
              onRunSurvey={() => {
                const ids = Array.from(selectedStructures);
                const hint = buildSurveyHint(detectedBodyPart, ids);
                sendPrompt(hint, { surveyMode: true });
              }}
              starterPrompts={starterPrompts}
              onUsePrompt={sendPrompt}
            />
          ) : (
            <div className="rounded-[24px] border border-white/10 bg-white/[0.03] p-5 text-sm text-white/60">
              Load a local study to start Dr.MRI.AI.
            </div>
          )
        )}

        <div className="space-y-4">
          {messages.map((msg, i) => {
            const isFirstUser = msg.role === 'user' && i === 0;
            const isLatestAssistant = msg.role === 'assistant' && i === latestAssistantIndex;

            return (
              <div key={msg.id} className="space-y-3">
                {msg.role === 'user' ? (
                  <UserBubble message={msg} />
                ) : (
                  <AssistantCard
                    content={msg.content}
                    sliceMappings={pipeline?.sliceMappings ?? []}
                    onNavigateToSlice={onNavigateToSlice}
                    onDownloadLatest={isLatestAssistant ? onDownloadLatest : undefined}
                  />
                )}

                {isFirstUser && pipeline && <PipelineView pipeline={pipeline} />}
              </div>
            );
          })}
        </div>

        {status === 'awaiting-confirmation' && currentPlan && studyMetadata && (
          <div className="mt-4">
            <PlanPreviewCard
              plan={currentPlan}
              metadata={studyMetadata}
              onAccept={onConfirmPlan}
              onCancel={onCancelPlan}
            />
          </div>
        )}

        {busy && statusText && status === 'following-up' && (
          <div className="mt-4 flex items-center gap-2 rounded-full border border-teal-300/20 bg-teal-300/8 px-4 py-2 text-xs text-teal-100/90">
            <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
            {statusText}
          </div>
        )}
      </div>

      {error && (
        <div className="mx-4 mb-3 rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-xs text-red-100/90 sm:mx-6">
          <div className="flex items-start gap-2">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        </div>
      )}

      <div className="shrink-0 border-t border-white/10 bg-black/15 px-4 pb-4 pt-3 backdrop-blur-md sm:px-6">
        {latestAssistant && (
          <CompactPromptTray
            prompts={deeperPrompts}
            onSelect={sendPrompt}
            disabled={busy}
            expanded={showDeeperPrompts}
            onToggle={() => setShowDeeperPrompts((value) => !value)}
          />
        )}

        <div className="flex items-end gap-3 rounded-2xl border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.02))] px-3 py-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            placeholder={messages.length > 0 ? 'Challenge a finding, ask for differentials, or request more uncertainty.' : 'Describe what the model should evaluate and why it matters.'}
            disabled={busy}
            className="min-h-10 max-h-20 flex-1 resize-none bg-transparent py-2 text-sm leading-6 text-white placeholder:text-white/35 outline-none disabled:opacity-50"
          />
          <button
            onClick={handleSend}
            disabled={busy || !input.trim()}
            className="inline-flex shrink-0 items-center gap-2 rounded-full bg-gradient-to-r from-amber-400 to-teal-300 px-4 py-2 text-sm font-medium text-slate-950 transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-35"
          >
            <Send className="h-4 w-4" />
            Send
          </button>
        </div>

        <div className="mt-3 text-center text-[10px] uppercase tracking-[0.24em] text-white/28">
          Dr.MRI.AI · Educational use only · Not for clinical diagnosis
        </div>
      </div>
    </div>
  );
});

function SavedResultsShelf({
  records,
  onDownload,
}: {
  records: SavedAnalysisRecord[];
  onDownload: (recordId: string, format?: 'md' | 'json') => void;
}) {
  return (
    <div className="rounded-[24px] border border-white/10 bg-white/[0.03] p-4">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-white/35">
        <Save className="h-4 w-4" />
        Saved Analyses
      </div>
      <div className="mt-4 space-y-3">
        {records.slice(0, 6).map((record) => {
          const excerpt = record.latestAnalysis.replace(/\s+/g, ' ').slice(0, 170);
          return (
            <div
              key={record.id}
              className="rounded-[20px] border border-white/8 bg-black/15 p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-white">{record.title}</div>
                  <div className="mt-1 text-[11px] uppercase tracking-[0.16em] text-white/35">
                    {new Date(record.savedAt).toLocaleString()} · {record.providerLabel}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    onClick={() => onDownload(record.id, 'md')}
                    className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[11px] text-white/75 transition-colors hover:bg-white/8 hover:text-white"
                  >
                    <Download className="h-3.5 w-3.5" />
                    MD
                  </button>
                  <button
                    onClick={() => onDownload(record.id, 'json')}
                    className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[11px] text-white/75 transition-colors hover:bg-white/8 hover:text-white"
                  >
                    <FileJson className="h-3.5 w-3.5" />
                    JSON
                  </button>
                </div>
              </div>
              <p className="mt-3 text-sm leading-6 text-white/60">
                {excerpt}
                {record.latestAnalysis.length > excerpt.length ? '…' : ''}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface AnalysisLaunchpadProps {
  surveyActive: boolean;
  onToggleSurvey: (active: boolean) => void;
  checklist: ReturnType<typeof getChecklist>;
  selectedStructures: Set<string>;
  onToggleStructure: (id: string) => void;
  onRunSurvey: () => void;
  starterPrompts: string[];
  onUsePrompt: (prompt: string) => void;
}

function AnalysisLaunchpad({
  surveyActive,
  onToggleSurvey,
  checklist,
  selectedStructures,
  onToggleStructure,
  onRunSurvey,
  starterPrompts,
  onUsePrompt,
}: AnalysisLaunchpadProps) {
  const selectedCount = selectedStructures.size;

  return (
    <div className="space-y-4">
      <div className="rounded-[28px] border border-white/10 bg-[linear-gradient(135deg,rgba(255,255,255,0.05),rgba(255,255,255,0.02))] p-5">
        <div className="text-[11px] uppercase tracking-[0.22em] text-amber-200/55">
          AI launchpad
        </div>
        <h3 className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-white">
          Choose how Dr.MRI.AI should approach this study.
        </h3>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-white/60">
          Start with a direct clinical ask or switch to guided survey mode for a systematic anatomy-first review.
        </p>

        <div className="mt-5 flex gap-2 rounded-full border border-white/10 bg-black/15 p-1">
          <button
            onClick={() => onToggleSurvey(false)}
            className={`flex-1 rounded-full px-4 py-2 text-sm font-medium transition-colors ${
              !surveyActive ? 'bg-white/12 text-white' : 'text-white/50 hover:text-white'
            }`}
          >
            Free Text
          </button>
          <button
            onClick={() => onToggleSurvey(true)}
            className={`flex-1 rounded-full px-4 py-2 text-sm font-medium transition-colors ${
              surveyActive ? 'bg-white/12 text-white' : 'text-white/50 hover:text-white'
            }`}
          >
            Guided Survey
          </button>
        </div>
      </div>

      {!surveyActive && (
        <PromptStrip title="Suggested starts" prompts={starterPrompts} onSelect={onUsePrompt} />
      )}

      {surveyActive && (
        <div className="rounded-[24px] border border-white/10 bg-white/[0.03] p-5">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.2em] text-white/40">
            <ClipboardList className="h-4 w-4" />
            Guided survey
          </div>
          <div className="mt-3 text-sm text-white/80">
            Detected body part: <span className="font-medium text-white">{checklist.displayName}</span>
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {checklist.structures.map((item) => (
              <label
                key={item.id}
                className="flex items-center gap-3 rounded-2xl border border-white/8 bg-black/15 px-3 py-3 text-sm text-white/75 transition-colors hover:bg-white/[0.04]"
              >
                <input
                  type="checkbox"
                  checked={selectedStructures.has(item.id)}
                  onChange={() => onToggleStructure(item.id)}
                  className="rounded border-white/20 bg-transparent text-amber-300 focus:ring-amber-300 focus:ring-offset-0"
                />
                <span>{item.label}</span>
              </label>
            ))}
          </div>
          <button
            onClick={onRunSurvey}
            disabled={selectedCount === 0}
            className="mt-5 inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-amber-400 to-teal-300 px-5 py-2.5 text-sm font-medium text-slate-950 transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Sparkles className="h-4 w-4" />
            Run Survey ({selectedCount})
          </button>
        </div>
      )}
    </div>
  );
}

function AssistantCard({
  content,
  sliceMappings,
  onNavigateToSlice,
  onDownloadLatest,
}: {
  content: string;
  sliceMappings: SliceMapping[];
  onNavigateToSlice: (mapping: SliceMapping) => void;
  onDownloadLatest?: (format?: 'md' | 'json') => void;
}) {
  return (
    <div className="rounded-[24px] border border-white/10 bg-white/[0.03] p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[11px] uppercase tracking-[0.22em] text-teal-200/60">Findings</div>
        {onDownloadLatest && (
          <button
            onClick={() => onDownloadLatest('md')}
            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs text-white/75 transition-colors hover:bg-white/8 hover:text-white"
          >
            <Download className="h-3.5 w-3.5" />
            Download
          </button>
        )}
      </div>

      <div className="mt-3">
        <AssistantMessage
          content={content}
          sliceMappings={sliceMappings}
          onNavigate={onNavigateToSlice}
        />
      </div>
    </div>
  );
}

function CompactPromptTray({
  prompts,
  onSelect,
  disabled,
  expanded,
  onToggle,
}: {
  prompts: string[];
  onSelect: (prompt: string) => void;
  disabled: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  if (prompts.length === 0) return null;

  return (
    <div className="mb-2 rounded-2xl border border-white/8 bg-white/[0.025] px-3 py-2">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2 text-left text-[11px] uppercase tracking-[0.22em] text-white/45 transition-colors hover:text-white/70"
      >
        <MessageSquare className="h-4 w-4" />
        <span>Go deeper</span>
        <span className="ml-auto rounded-full border border-white/10 px-2 py-0.5 text-[10px] tracking-normal text-white/35">
          {prompts.length}
        </span>
        {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
      </button>
      {expanded && (
        <div className="mt-2 max-h-24 overflow-y-auto pr-1">
          <div className="flex gap-2 overflow-x-auto pb-1 sm:flex-wrap sm:overflow-visible">
            {prompts.map((prompt) => (
              <button
                key={prompt}
                onClick={() => onSelect(prompt)}
                disabled={disabled}
                className="inline-flex max-w-full shrink-0 items-center gap-2 rounded-full border border-white/10 bg-black/15 px-3 py-1.5 text-left text-xs text-white/70 transition-colors hover:bg-white/8 hover:text-white disabled:cursor-not-allowed disabled:opacity-40 sm:shrink"
              >
                <ArrowRight className="h-3.5 w-3.5 shrink-0 text-amber-200/70" />
                <span className="truncate sm:whitespace-normal">{prompt}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PromptStrip({
  title,
  prompts,
  onSelect,
  disabled = false,
}: {
  title: string;
  prompts: string[];
  onSelect: (prompt: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="rounded-[24px] border border-white/10 bg-white/[0.03] p-4">
      <div className="mb-3 flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-white/35">
        <MessageSquare className="h-4 w-4" />
        {title}
      </div>
      <div className="flex flex-wrap gap-2">
        {prompts.map((prompt) => (
          <button
            key={prompt}
            onClick={() => onSelect(prompt)}
            disabled={disabled}
            className="rounded-full border border-white/10 bg-black/15 px-3 py-2 text-left text-xs text-white/70 transition-colors hover:bg-white/8 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            {prompt}
          </button>
        ))}
      </div>
    </div>
  );
}

function UserBubble({ message }: { message: ChatMessage }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[88%] rounded-[22px] rounded-br-md bg-gradient-to-r from-amber-400 to-teal-300 px-4 py-3 text-sm font-medium text-slate-950 shadow-[0_10px_30px_rgba(45,212,191,0.18)]">
        {message.content}
      </div>
    </div>
  );
}

function findLastMessageIndex(messages: ChatMessage[], role: 'user' | 'assistant'): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === role) return i;
  }
  return -1;
}

function getStarterPrompts(bodyPart: string): string[] {
  switch (bodyPart) {
    case 'knee':
      return [
        'Evaluate ACL integrity and grade any tear.',
        'Look for meniscal tear patterns and root involvement.',
        'Summarize marrow edema, effusion, and ligament injury.',
      ];
    case 'brain':
      return [
        'Look for acute infarct, hemorrhage, or mass effect.',
        'Summarize the dominant abnormality and confidence.',
        'Describe what remains indeterminate on the provided slices.',
      ];
    case 'chest':
      return [
        'Evaluate for pulmonary nodules, consolidation, or pleural disease.',
        'Summarize the dominant thoracic finding and confidence.',
        'Describe what additional series or windows would reduce uncertainty.',
      ];
    case 'abdomen':
      return [
        'Evaluate for focal liver lesion or other dominant abdominal finding.',
        'Summarize the key abnormality, location, and confidence.',
        'Explain what phase or supplementary series would help most.',
      ];
    default:
      return [
        'Summarize the dominant imaging finding and confidence.',
        'Run a systematic survey and state what is not adequately visualized.',
        'Identify the most important limitation in the current slice sample.',
      ];
  }
}

function getDeepDivePrompts(bodyPart: string): string[] {
  const prompts = [
    'What is the strongest finding and what makes you confident?',
    'What differential diagnoses fit this pattern?',
    'Which structures remain under-sampled or uncertain?',
    'What extra series or windowing would most improve confidence?',
  ];

  if (bodyPart === 'knee') {
    prompts.unshift('Compare the ligament findings with associated meniscal or marrow changes.');
  }

  if (bodyPart === 'brain') {
    prompts.unshift('Differentiate whether this looks acute, subacute, or chronic and why.');
  }

  return prompts.slice(0, 5);
}
