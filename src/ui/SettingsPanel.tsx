import { useState, useEffect, useRef, useCallback } from 'react';
import { X, CheckCircle, XCircle, Loader2, Download, ChevronDown, Copy, Check, RefreshCw } from 'lucide-react';
import type { AnalysisDepth, ProviderConfig, ProviderType } from '../llm/types';
import {
  DEFAULT_GEMMA_TRANSFORMERS_DTYPE,
  DEFAULT_GEMMA_TRANSFORMERS_IMAGE_TOKEN_BUDGET,
  DEFAULT_GEMMA_TRANSFORMERS_MAX_IMAGES,
  DEFAULT_GEMMA_TRANSFORMERS_MODEL_ID,
  GEMMA_TRANSFORMERS_DTYPES,
  GEMMA_TRANSFORMERS_IMAGE_TOKEN_BUDGETS,
  hasTransformersWebGpuSupport,
} from '../llm/gemmaTransformersConfig';
import {
  DEFAULT_GEMINI_MODEL,
  fetchOpenAiCompatibleModels,
  inferOpenAiCompatibleModelCapabilities,
  normalizeOpenAiCompatibleBaseUrl,
  type OllamaModelInfo,
  type OpenAiCompatibleModelInfo,
} from '../llm/LLMServiceFactory';
import {
  DEFAULT_OLLAMA_URL,
  getOllamaUrlProblem,
  normalizeOllamaBaseUrl,
} from '../llm/ollamaConfig';
import {
  getAnalysisDepth,
  getAnalysisDepthPolicy,
  getDepthLabel,
} from '../llm/analysisDepth';

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
  config: ProviderConfig;
  onConfigChange: (config: ProviderConfig) => void;
}

interface RecommendedModel {
  name: string;
  label: string;
  desc: string;
  role: 'text' | 'vision' | 'both';
}

interface ModelDropdownItem {
  name: string;
  size?: number;
  capabilities?: string[];
  family?: string;
  families?: string[];
  owned_by?: string;
}

const RECOMMENDED_MODELS: RecommendedModel[] = [
  { name: 'alibayram/medgemma:4b', label: 'MedGemma 4B', desc: 'Medical text planning, no vision (2.5GB)', role: 'text' },
  { name: 'gemma4:latest', label: 'Gemma 4', desc: 'Installed vision-capable Gemma model', role: 'both' },
  { name: 'gemma3:4b', label: 'Gemma 3 4B', desc: 'Official Google, text + vision (3.3GB)', role: 'both' },
  { name: 'llava:7b', label: 'LLaVA 7B', desc: 'Proven vision support (4.7GB)', role: 'vision' },
  { name: 'llama3.2:latest', label: 'Llama 3.2 3B', desc: 'Fast general text (2GB)', role: 'text' },
];

const COMMON_OPENAI_COMPATIBLE_MODEL_NAMES = [
  'gpt-5',
  'gpt-5-mini',
  'gpt-4o',
  'gpt-4o-mini',
  'gpt-4.1-mini',
  'o4-mini',
  'gemini-2.5-flash',
  'gemini-2.5-pro',
  'claude-sonnet-4-6',
  'claude-opus-4-6',
  'llama33-70b',
];

const COMMON_OPENAI_COMPATIBLE_MODELS: OpenAiCompatibleModelInfo[] = COMMON_OPENAI_COMPATIBLE_MODEL_NAMES.map((name) => ({
  id: name,
  name,
  object: 'model',
  capabilities: inferOpenAiCompatibleModelCapabilities(name),
}));

function formatSize(bytes?: number): string {
  if (!bytes || bytes <= 0) return '';
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(1)}GB`;
  return `${(bytes / (1024 * 1024)).toFixed(0)}MB`;
}

let llmFactoryPromise: Promise<typeof import('../llm/LLMServiceFactory')> | null = null;

function loadLlmFactory() {
  if (!llmFactoryPromise) {
    llmFactoryPromise = import('../llm/LLMServiceFactory');
  }
  return llmFactoryPromise;
}

function modelSupportsVision(model: ModelDropdownItem | undefined): boolean {
  return !!model?.capabilities?.includes('vision');
}

export default function SettingsPanel({ open, onClose, config, onConfigChange }: SettingsPanelProps) {
  const [ollamaStatus, setOllamaStatus] = useState<'unknown' | 'checking' | 'online' | 'offline'>('unknown');
  const [installedModels, setInstalledModels] = useState<OllamaModelInfo[]>([]);
  const [openAiStatus, setOpenAiStatus] = useState<'unknown' | 'checking' | 'online' | 'offline'>('unknown');
  const [openAiModels, setOpenAiModels] = useState<OpenAiCompatibleModelInfo[]>([]);
  const [openAiError, setOpenAiError] = useState<string | null>(null);
  const [pulling, setPulling] = useState<{ model: string; status: string; percent: number | null } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const baseUrl = normalizeOllamaBaseUrl(config.ollamaUrl);
  const ollamaUrlProblem = getOllamaUrlProblem(baseUrl);
  const openAiBaseUrl = normalizeOpenAiCompatibleBaseUrl(config.openAiCompatibleBaseUrl);
  const openAiApiKey = config.openAiCompatibleApiKey?.trim() ?? '';
  const webGpuAvailable = hasTransformersWebGpuSupport();
  const analysisDepth = getAnalysisDepth(config);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open, onClose]);

  const refreshModels = useCallback(async () => {
    if (ollamaUrlProblem) {
      setOllamaStatus('offline');
      setInstalledModels([]);
      return;
    }

    const { pingOllama, fetchOllamaModels } = await loadLlmFactory();
    setOllamaStatus('checking');
    const online = await pingOllama(baseUrl);
    setOllamaStatus(online ? 'online' : 'offline');
    if (online) {
      const models = await fetchOllamaModels(baseUrl);
      setInstalledModels(models);
    } else {
      setInstalledModels([]);
    }
  }, [baseUrl, ollamaUrlProblem]);

  const refreshOpenAiModels = useCallback(async () => {
    if (!openAiBaseUrl || !openAiApiKey) {
      setOpenAiStatus('offline');
      setOpenAiModels([]);
      setOpenAiError('Enter an endpoint URL and API key before loading models.');
      return;
    }

    setOpenAiStatus('checking');
    setOpenAiError(null);
    try {
      const models = await fetchOpenAiCompatibleModels(openAiBaseUrl, openAiApiKey);
      setOpenAiModels(models);
      setOpenAiStatus('online');
      if (models.length === 0) {
        setOpenAiError('The endpoint responded, but no models were listed. You can still enter model names manually.');
      }
    } catch (error) {
      setOpenAiModels(COMMON_OPENAI_COMPATIBLE_MODELS);
      setOpenAiStatus('offline');
      setOpenAiError(error instanceof Error ? error.message : 'Could not load models from the OpenAI-compatible endpoint.');
    }
  }, [openAiApiKey, openAiBaseUrl]);

  // Check Ollama when panel opens or provider changes to ollama
  useEffect(() => {
    if (open && config.provider === 'ollama') {
      refreshModels();
    }
  }, [open, config.provider, refreshModels]);

  useEffect(() => {
    if (!open || config.provider !== 'ollama' || ollamaStatus !== 'online') return;
    const selectedVisionModel = config.ollamaVisionModel || 'gemma4:latest';
    const selected = installedModels.find((m) => m.name === selectedVisionModel);
    const firstVisionModel = installedModels.find(modelSupportsVision);
    if (firstVisionModel && !modelSupportsVision(selected)) {
      onConfigChange({ ...config, ollamaVisionModel: firstVisionModel.name });
    }
  }, [open, config, ollamaStatus, installedModels, onConfigChange]);

  useEffect(() => {
    if (!open || config.provider !== 'openai-compatible' || openAiStatus !== 'online' || openAiModels.length === 0) return;
    const textCandidates = openAiModels.filter((model) => model.capabilities.includes('text'));
    const textModels = textCandidates.length ? textCandidates : openAiModels;
    const visionCandidates = openAiModels.filter(modelSupportsVision);
    const currentTextModel = config.openAiCompatibleTextModel;
    const currentVisionModel = config.openAiCompatibleVisionModel;
    const textModelExists = currentTextModel && textModels.some((model) => model.name === currentTextModel);
    const visionModelExists = currentVisionModel && openAiModels.some((model) => model.name === currentVisionModel);
    const nextTextModel = textModelExists ? currentTextModel : textModels[0]?.name;
    const nextVisionModel = visionModelExists
      ? currentVisionModel
      : visionCandidates[0]?.name ?? nextTextModel;

    if (
      nextTextModel &&
      (nextTextModel !== currentTextModel || nextVisionModel !== currentVisionModel)
    ) {
      onConfigChange({
        ...config,
        openAiCompatibleTextModel: nextTextModel,
        openAiCompatibleVisionModel: nextVisionModel,
      });
    }
  }, [open, config, openAiStatus, openAiModels, onConfigChange]);

  const handlePull = async (modelName: string) => {
    const { pullOllamaModel } = await loadLlmFactory();
    setPulling({ model: modelName, status: 'Starting...', percent: null });
    const success = await pullOllamaModel(
      modelName,
      (status, percent) => setPulling({ model: modelName, status, percent }),
      baseUrl,
    );
    if (success) {
      await refreshModels();
    }
    // Keep the final status visible briefly
    setTimeout(() => setPulling(null), 1500);
  };

  if (!open) return null;

  const setProvider = (provider: ProviderType) => {
    onConfigChange({ ...config, provider });
  };

  const isInstalled = (name: string) =>
    installedModels.some((m) => m.name === name || m.name === name.replace(':latest', '') || m.name + ':latest' === name);

  const geminiModel = config.geminiModel || DEFAULT_GEMINI_MODEL;
  const textModel = config.ollamaTextModel || 'alibayram/medgemma:4b';
  const visionModel = config.ollamaVisionModel || 'gemma4:latest';
  const selectedVisionModelInfo = installedModels.find((m) => m.name === visionModel);
  const visionModels = installedModels.filter(modelSupportsVision);
  const openAiTextModels = openAiModels.filter((model) => model.capabilities.includes('text'));
  const openAiTextDropdownModels = openAiTextModels.length ? openAiTextModels : openAiModels;
  const openAiVisionModels = openAiModels.filter(modelSupportsVision);
  const openAiVisionDropdownModels = openAiVisionModels.length ? openAiVisionModels : openAiTextDropdownModels;
  const openAiTextModel = config.openAiCompatibleTextModel ?? '';
  const openAiVisionModel = config.openAiCompatibleVisionModel || openAiTextModel;
  const selectedOpenAiVisionModelInfo = openAiModels.find((model) => model.name === openAiVisionModel);
  const gemmaTransformersModelId = config.gemmaTransformersModelId || DEFAULT_GEMMA_TRANSFORMERS_MODEL_ID;
  const gemmaTransformersDtype = config.gemmaTransformersDtype || DEFAULT_GEMMA_TRANSFORMERS_DTYPE;
  const gemmaTransformersMaxImages = Math.max(
    1,
    Math.min(DEFAULT_GEMMA_TRANSFORMERS_MAX_IMAGES, config.gemmaTransformersMaxImages ?? DEFAULT_GEMMA_TRANSFORMERS_MAX_IMAGES),
  );
  const gemmaTransformersImageTokenBudget = Math.max(
    70,
    Math.min(280, config.gemmaTransformersImageTokenBudget ?? DEFAULT_GEMMA_TRANSFORMERS_IMAGE_TOKEN_BUDGET),
  );

  return (
    <div className="fixed inset-0 z-40" onClick={onClose}>
      <div
        ref={panelRef}
        className="absolute top-12 right-4 w-96 max-h-[80vh] bg-neutral-800 border border-neutral-600 rounded-xl shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-700 shrink-0">
          <span className="text-sm font-medium text-neutral-200">AI Model Settings</span>
          <button onClick={onClose} className="p-0.5 rounded hover:bg-neutral-700 text-neutral-400 hover:text-neutral-200">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="overflow-y-auto p-4 space-y-4">
          {/* Provider Toggle */}
          <div>
            <label className="text-xs text-neutral-400 block mb-1.5">Provider</label>
            <div className="grid grid-cols-2 gap-0.5 bg-neutral-900 rounded-lg p-0.5">
              <button
                onClick={() => setProvider('ollama')}
                className={`py-1.5 text-xs font-medium rounded-md transition-colors ${
                  config.provider === 'ollama' ? 'bg-blue-600 text-white' : 'text-neutral-400 hover:text-neutral-200'
                }`}
              >
                Ollama (Default)
              </button>
              <button
                onClick={() => setProvider('gemini')}
                className={`py-1.5 text-xs font-medium rounded-md transition-colors ${
                  config.provider === 'gemini' ? 'bg-blue-600 text-white' : 'text-neutral-400 hover:text-neutral-200'
                }`}
              >
                Gemini API
              </button>
              <button
                onClick={() => setProvider('openai-compatible')}
                className={`py-1.5 text-xs font-medium rounded-md transition-colors ${
                  config.provider === 'openai-compatible' ? 'bg-blue-600 text-white' : 'text-neutral-400 hover:text-neutral-200'
                }`}
              >
                OpenAI-Compatible
              </button>
              <button
                onClick={() => setProvider('gemma-transformers')}
                className={`py-1.5 text-xs font-medium rounded-md transition-colors ${
                  config.provider === 'gemma-transformers' ? 'bg-blue-600 text-white' : 'text-neutral-400 hover:text-neutral-200'
                }`}
              >
                Gemma 4 Browser
              </button>
            </div>
          </div>

          <div>
            <label className="text-xs text-neutral-400 block mb-1.5">Default Coverage</label>
            <div className="grid grid-cols-3 gap-0.5 bg-neutral-900 rounded-lg p-0.5">
              {(['fast', 'standard', 'full'] as AnalysisDepth[]).map((depth) => {
                const policy = getAnalysisDepthPolicy(config, depth);
                const disabled = depth === 'full' && !policy.fullEnabled;
                return (
                  <button
                    key={depth}
                    type="button"
                    onClick={() => !disabled && onConfigChange({ ...config, analysisDepth: depth })}
                    disabled={disabled}
                    title={disabled ? policy.warning : undefined}
                    className={`py-1.5 text-xs font-medium rounded-md transition-colors ${
                      analysisDepth === depth && !disabled
                        ? 'bg-blue-600 text-white'
                        : 'text-neutral-400 hover:text-neutral-200'
                    } disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:text-neutral-400`}
                  >
                    {getDepthLabel(depth)}
                  </button>
                );
              })}
            </div>
            <p className="text-[10px] text-neutral-500 mt-1">
              Fast caps at 20 images. Standard expands selected diagnostic series to the provider budget. Full sends every selected diagnostic slice when supported.
            </p>
            {analysisDepth === 'full' && !getAnalysisDepthPolicy(config, 'full').fullEnabled && (
              <p className="text-[10px] text-amber-300 mt-1">
                Gemma Browser stays memory-constrained; Standard uses its configured image limit.
              </p>
            )}
          </div>

          {/* Gemma 4 Transformers.js fields */}
          {config.provider === 'gemma-transformers' && (
            <>
              <div className="flex items-center gap-2 text-xs">
                {webGpuAvailable ? (
                  <>
                    <CheckCircle className="w-3.5 h-3.5 text-green-400" />
                    <span className="text-green-400">WebGPU available</span>
                  </>
                ) : (
                  <>
                    <XCircle className="w-3.5 h-3.5 text-red-400" />
                    <span className="text-red-400">WebGPU unavailable</span>
                  </>
                )}
                <span className="text-neutral-500 ml-auto">Runs fully in the browser</span>
              </div>

              <div className="bg-neutral-900 rounded-lg px-3 py-3 space-y-2">
                <p className="text-xs text-neutral-300">
                  Uses Transformers.js with Gemma 4 E2B ONNX on WebGPU.
                </p>
                <p className="text-[10px] text-neutral-500">
                  First run downloads a large model into the browser cache. Close GPU-heavy tabs if initialization fails, or reduce the image budget/token budget below.
                </p>
              </div>

              <div>
                <label className="text-xs text-neutral-400 block mb-1.5">Model ID</label>
                <input
                  type="text"
                  value={gemmaTransformersModelId}
                  onChange={(e) => onConfigChange({ ...config, gemmaTransformersModelId: e.target.value })}
                  placeholder={DEFAULT_GEMMA_TRANSFORMERS_MODEL_ID}
                  className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-100 placeholder-neutral-600 outline-none focus:border-blue-500"
                />
                <p className="text-[10px] text-neutral-500 mt-1">
                  Default: `onnx-community/gemma-4-E2B-it-ONNX`.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-neutral-400 block mb-1.5">Dtype</label>
                  <select
                    value={gemmaTransformersDtype}
                    onChange={(e) => onConfigChange({ ...config, gemmaTransformersDtype: e.target.value })}
                    className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-100 outline-none focus:border-blue-500"
                  >
                    {GEMMA_TRANSFORMERS_DTYPES.map((dtype) => (
                      <option key={dtype} value={dtype}>{dtype}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-xs text-neutral-400 block mb-1.5">Max Images <span className="text-neutral-600">(chunked)</span></label>
                  <input
                    type="number"
                    min={1}
                    max={DEFAULT_GEMMA_TRANSFORMERS_MAX_IMAGES}
                    value={gemmaTransformersMaxImages}
                    onChange={(e) => onConfigChange({
                      ...config,
                      gemmaTransformersMaxImages: Math.max(
                        1,
                        Math.min(DEFAULT_GEMMA_TRANSFORMERS_MAX_IMAGES, Number(e.target.value) || DEFAULT_GEMMA_TRANSFORMERS_MAX_IMAGES),
                      ),
                    })}
                    className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-100 outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs text-neutral-400 block mb-1.5">Image Token Budget</label>
                <select
                  value={gemmaTransformersImageTokenBudget}
                  onChange={(e) => onConfigChange({ ...config, gemmaTransformersImageTokenBudget: Number(e.target.value) })}
                  className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-100 outline-none focus:border-blue-500"
                >
                  {GEMMA_TRANSFORMERS_IMAGE_TOKEN_BUDGETS.map((budget) => (
                    <option key={budget} value={budget}>{budget} tokens/image</option>
                  ))}
                </select>
                <p className="text-[10px] text-neutral-500 mt-1">
                  Browser Gemma analyzes images in small batches and then synthesizes a final answer. Use 70 or 140 if ONNX reports tensor-size limits.
                </p>
              </div>
            </>
          )}

          {/* Gemini fields */}
          {config.provider === 'gemini' && (
            <>
              <div>
                <label className="text-xs text-neutral-400 block mb-1.5">Gemini API Key</label>
                <input
                  type="password"
                  value={config.apiKey ?? ''}
                  onChange={(e) => onConfigChange({ ...config, apiKey: e.target.value })}
                  placeholder="AIza..."
                  className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-100 placeholder-neutral-600 outline-none focus:border-blue-500"
                />
                <p className="text-[10px] text-neutral-500 mt-1">
                  Stored in localStorage only. For hosted demos, use a runtime bring-your-own-key flow instead of bundling a Gemini key into the static build.
                </p>
              </div>

              <div>
                <label className="text-xs text-neutral-400 block mb-1.5">Gemini Model</label>
                <input
                  type="text"
                  value={geminiModel}
                  onChange={(e) => onConfigChange({ ...config, geminiModel: e.target.value })}
                  placeholder={DEFAULT_GEMINI_MODEL}
                  className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-100 placeholder-neutral-600 outline-none focus:border-blue-500"
                />
                <p className="text-[10px] text-neutral-500 mt-1">
                  Default is the stable multimodal model `gemini-2.5-flash`.
                </p>
              </div>
            </>
          )}

          {/* OpenAI-compatible fields */}
          {config.provider === 'openai-compatible' && (
            <>
              <div className="bg-neutral-900 rounded-lg px-3 py-3 space-y-1.5">
                <p className="text-xs text-neutral-300">
                  Use any OpenAI-compatible `/v1` chat completions endpoint.
                </p>
                <p className="text-[10px] text-neutral-500">
                  The app queries `/models` for dropdowns, then uses a text model for slice planning and follow-ups plus a vision-capable model for image analysis.
                </p>
              </div>

              <div>
                <label className="text-xs text-neutral-400 block mb-1.5">Endpoint URL</label>
                <input
                  type="text"
                  value={config.openAiCompatibleBaseUrl ?? ''}
                  onChange={(e) => onConfigChange({ ...config, openAiCompatibleBaseUrl: e.target.value })}
                  onBlur={() => onConfigChange({
                    ...config,
                    openAiCompatibleBaseUrl: normalizeOpenAiCompatibleBaseUrl(config.openAiCompatibleBaseUrl),
                  })}
                  placeholder="https://your-gateway.example.com/v1"
                  className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-100 placeholder-neutral-600 outline-none focus:border-blue-500"
                />
                <p className="text-[10px] text-neutral-500 mt-1">
                  Paste the base endpoint, not `/chat/completions`. HTTPS endpoints must allow browser CORS.
                </p>
              </div>

              <div>
                <label className="text-xs text-neutral-400 block mb-1.5">API Key</label>
                <input
                  type="password"
                  value={config.openAiCompatibleApiKey ?? ''}
                  onChange={(e) => onConfigChange({ ...config, openAiCompatibleApiKey: e.target.value })}
                  placeholder="Bearer token"
                  className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-100 placeholder-neutral-600 outline-none focus:border-blue-500"
                />
                <p className="text-[10px] text-neutral-500 mt-1">
                  Stored in localStorage only. Do not bundle shared production secrets into a static deployment.
                </p>
              </div>

              <div className="flex items-center gap-2 text-xs">
                {openAiStatus === 'checking' && (
                  <>
                    <Loader2 className="w-3.5 h-3.5 text-blue-400 animate-spin" />
                    <span className="text-neutral-400">Loading models...</span>
                  </>
                )}
                {openAiStatus === 'online' && (
                  <>
                    <CheckCircle className="w-3.5 h-3.5 text-green-400" />
                    <span className="text-green-400">Endpoint reachable</span>
                    <span className="text-neutral-500">({openAiModels.length} model{openAiModels.length !== 1 ? 's' : ''})</span>
                  </>
                )}
                {openAiStatus === 'offline' && (
                  <>
                    <XCircle className="w-3.5 h-3.5 text-red-400" />
                    <span className="text-red-400">Model discovery failed</span>
                  </>
                )}
                {openAiStatus === 'unknown' && (
                  <span className="text-neutral-500">Load models after entering endpoint and key.</span>
                )}
                <button
                  onClick={refreshOpenAiModels}
                  disabled={openAiStatus === 'checking' || !openAiBaseUrl || !openAiApiKey}
                  className="text-neutral-500 hover:text-neutral-300 ml-auto text-xs disabled:opacity-40 disabled:hover:text-neutral-500"
                >
                  Refresh models
                </button>
              </div>

              {openAiError && (
                <div className="bg-neutral-900 rounded-lg px-3 py-2 space-y-1">
                  <p className="text-[10px] text-amber-300/90">{openAiError}</p>
                  {openAiModels.length > 0 && (
                    <p className="text-[10px] text-neutral-500">
                      Showing a fallback list of common model IDs. You can also type the exact model ID manually.
                    </p>
                  )}
                </div>
              )}

              <div>
                <label className="text-xs text-neutral-400 block mb-1.5">
                  Text Model <span className="text-neutral-600">(Call 1 + follow-ups)</span>
                </label>
                {openAiTextDropdownModels.length > 0 ? (
                  <ModelDropdown
                    value={openAiTextModel}
                    models={openAiTextDropdownModels}
                    onChange={(model) => onConfigChange({ ...config, openAiCompatibleTextModel: model })}
                    emptyLabel="No text models listed"
                  />
                ) : (
                  <input
                    type="text"
                    value={openAiTextModel}
                    onChange={(e) => onConfigChange({ ...config, openAiCompatibleTextModel: e.target.value })}
                    placeholder="model-name"
                    className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-100 placeholder-neutral-600 outline-none focus:border-blue-500"
                  />
                )}
              </div>

              <div>
                <label className="text-xs text-neutral-400 block mb-1.5">
                  Vision Model <span className="text-neutral-600">(Call 2: image analysis)</span>
                </label>
                {openAiVisionDropdownModels.length > 0 ? (
                  <ModelDropdown
                    value={openAiVisionModel}
                    models={openAiVisionDropdownModels}
                    onChange={(model) => onConfigChange({ ...config, openAiCompatibleVisionModel: model })}
                    emptyLabel="No vision models inferred"
                  />
                ) : (
                  <input
                    type="text"
                    value={openAiVisionModel}
                    onChange={(e) => onConfigChange({ ...config, openAiCompatibleVisionModel: e.target.value })}
                    placeholder="vision-model-name"
                    className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-100 placeholder-neutral-600 outline-none focus:border-blue-500"
                  />
                )}
                {openAiModels.length > 0 && selectedOpenAiVisionModelInfo && !modelSupportsVision(selectedOpenAiVisionModelInfo) && (
                  <p className="mt-1.5 text-[10px] text-amber-300/80">
                    Vision support is inferred from model names. If this model is actually multimodal, you can still try it.
                  </p>
                )}
                <p className="mt-1.5 text-[10px] text-neutral-500">
                  For GitHub Pages CORS workarounds, run `npm run openai-proxy -- --target ...` and use endpoint `http://localhost:8787`.
                </p>
              </div>
            </>
          )}

          {/* Ollama fields */}
          {config.provider === 'ollama' && (
            <>
              <div className="bg-neutral-900 rounded-lg px-3 py-3 space-y-1.5">
                <p className="text-xs text-neutral-300">
                  Ollama is the default analysis path for this app.
                </p>
                <p className="text-[10px] text-neutral-500">
                  Use a local text planner plus a local vision model to keep the workflow stable and fully under your control.
                </p>
              </div>

              {/* Status */}
              <div className="flex items-center gap-2 text-xs">
                {ollamaStatus === 'checking' && (
                  <>
                    <Loader2 className="w-3.5 h-3.5 text-blue-400 animate-spin" />
                    <span className="text-neutral-400">Connecting...</span>
                  </>
                )}
                {ollamaStatus === 'online' && (
                  <>
                    <CheckCircle className="w-3.5 h-3.5 text-green-400" />
                    <span className="text-green-400">Ollama running</span>
                    <span className="text-neutral-500">({installedModels.length} model{installedModels.length !== 1 ? 's' : ''})</span>
                  </>
                )}
                {ollamaStatus === 'offline' && (
                  <>
                    <XCircle className="w-3.5 h-3.5 text-red-400" />
                    <span className="text-red-400">Ollama not running</span>
                  </>
                )}
                <button
                  onClick={refreshModels}
                  className="text-neutral-500 hover:text-neutral-300 ml-auto text-xs"
                >
                  Refresh
                </button>
              </div>

              {ollamaStatus === 'offline' && (
                <OllamaOfflineHelp onRetry={refreshModels} baseUrl={baseUrl} urlProblem={ollamaUrlProblem} />
              )}

              {/* Ollama URL */}
              <div>
                <label className="text-xs text-neutral-400 block mb-1.5">Ollama URL</label>
                <input
                  type="text"
                  value={config.ollamaUrl ?? DEFAULT_OLLAMA_URL}
                  onChange={(e) => onConfigChange({ ...config, ollamaUrl: e.target.value })}
                  onBlur={() => onConfigChange({ ...config, ollamaUrl: normalizeOllamaBaseUrl(config.ollamaUrl) })}
                  placeholder={DEFAULT_OLLAMA_URL}
                  className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-100 placeholder-neutral-600 outline-none focus:border-blue-500"
                />
                <p className={`mt-1.5 text-[10px] ${ollamaUrlProblem ? 'text-amber-300/90' : 'text-neutral-500'}`}>
                  {ollamaUrlProblem ?? 'For GitHub Pages, use localhost or 127.0.0.1. Do not use 0.0.0.0; it is only a server bind address.'}
                </p>
              </div>

              {ollamaStatus === 'online' && (
                <>
                  {/* Text Model (Call 1) */}
                  <div>
                    <label className="text-xs text-neutral-400 block mb-1.5">
                      Text Model <span className="text-neutral-600">(Call 1: slice planning)</span>
                    </label>
                    <ModelDropdown
                      value={textModel}
                      models={installedModels}
                      onChange={(m) => onConfigChange({ ...config, ollamaTextModel: m })}
                    />
                  </div>

                  {/* Vision Model (Call 2) */}
                  <div>
                    <label className="text-xs text-neutral-400 block mb-1.5">
                      Vision Model <span className="text-neutral-600">(Call 2: image analysis)</span>
                    </label>
                    <ModelDropdown
                      value={visionModel}
                      models={visionModels}
                      onChange={(m) => onConfigChange({ ...config, ollamaVisionModel: m })}
                      emptyLabel="No installed vision-capable models"
                    />
                    {ollamaStatus === 'online' && !modelSupportsVision(selectedVisionModelInfo) && (
                      <p className="mt-1.5 text-[10px] text-amber-300/80">
                        The selected vision model is not installed or does not advertise Ollama vision support.
                        Use Gemma 4, Gemma 3, or LLaVA for image analysis.
                      </p>
                    )}
                  </div>

                  {/* Recommended Models */}
                  <div>
                    <label className="text-xs text-neutral-400 block mb-2">Available Models</label>
                    <div className="space-y-1.5">
                      {RECOMMENDED_MODELS.map((rm) => {
                        const installed = isInstalled(rm.name);
                        const isPulling = pulling?.model === rm.name;
                        return (
                          <div
                            key={rm.name}
                            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs ${
                              installed ? 'bg-neutral-900' : 'bg-neutral-900/50 border border-dashed border-neutral-700'
                            }`}
                          >
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="text-neutral-200 font-medium">{rm.label}</span>
                                <RoleBadge role={rm.role} />
                                {installed && <CheckCircle className="w-3 h-3 text-green-500" />}
                              </div>
                              <p className="text-neutral-500 text-[10px] mt-0.5">{rm.desc}</p>
                            </div>
                            {!installed && !isPulling && (
                              <button
                                onClick={() => handlePull(rm.name)}
                                disabled={!!pulling}
                                className="shrink-0 flex items-center gap-1 px-2 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white text-[10px] font-medium disabled:opacity-30"
                              >
                                <Download className="w-3 h-3" />
                                Pull
                              </button>
                            )}
                            {isPulling && (
                              <div className="shrink-0 text-right">
                                <div className="flex items-center gap-1 text-blue-400">
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                  <span className="text-[10px]">{pulling.percent != null ? `${pulling.percent}%` : '...'}</span>
                                </div>
                              </div>
                            )}
                            {installed && !isPulling && (
                              <div className="shrink-0 flex gap-1">
                                {(rm.role === 'text' || rm.role === 'both') && (
                                  <button
                                    onClick={() => onConfigChange({ ...config, ollamaTextModel: rm.name })}
                                    className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                      textModel === rm.name
                                        ? 'bg-purple-600 text-white'
                                        : 'bg-neutral-700 text-neutral-400 hover:text-neutral-200'
                                    }`}
                                  >
                                    Text
                                  </button>
                                )}
                                {(rm.role === 'vision' || rm.role === 'both') && (
                                  <button
                                    onClick={() => onConfigChange({ ...config, ollamaVisionModel: rm.name })}
                                    className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                      visionModel === rm.name
                                        ? 'bg-teal-600 text-white'
                                        : 'bg-neutral-700 text-neutral-400 hover:text-neutral-200'
                                    }`}
                                  >
                                    Vision
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Pull progress bar */}
                  {pulling && (
                    <div className="bg-neutral-900 rounded-lg px-3 py-2">
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="text-neutral-300 font-mono">{pulling.model}</span>
                        <span className="text-neutral-500">{pulling.percent != null ? `${pulling.percent}%` : pulling.status}</span>
                      </div>
                      {pulling.percent != null && (
                        <div className="h-1 bg-neutral-700 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-blue-500 rounded-full transition-all duration-300"
                            style={{ width: `${pulling.percent}%` }}
                          />
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// --- Offline Help ---

function OllamaOfflineHelp({
  onRetry,
  baseUrl,
  urlProblem,
}: {
  onRetry: () => void;
  baseUrl: string;
  urlProblem: string | null;
}) {
  const [copied, setCopied] = useState(false);
  const [polling, setPolling] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const serveCommand =
    typeof window !== 'undefined' && window.location.protocol === 'https:'
      ? `OLLAMA_ORIGINS=${window.location.origin} ollama serve`
      : 'ollama serve';

  const copyCommand = () => {
    navigator.clipboard.writeText(serveCommand);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const startPolling = () => {
    setPolling(true);
    // Check every 2 seconds
    intervalRef.current = setInterval(async () => {
      const { pingOllama } = await loadLlmFactory();
      const ok = await pingOllama(baseUrl);
      if (ok) {
        setPolling(false);
        if (intervalRef.current) clearInterval(intervalRef.current);
        onRetry();
      }
    }, 2000);
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  return (
    <div className="bg-neutral-900 rounded-lg px-3 py-3 space-y-2.5">
      <div className="text-xs text-neutral-400">
        {urlProblem ?? 'Ollama is not running. Start it in your terminal:'}
      </div>
      <div className="flex items-center gap-2">
        <code className="flex-1 bg-neutral-950 text-neutral-200 font-mono text-xs px-3 py-1.5 rounded">
          {serveCommand}
        </code>
        <button
          onClick={copyCommand}
          className="p-1.5 rounded bg-neutral-700 hover:bg-neutral-600 text-neutral-300 transition-colors"
          title="Copy command"
        >
          {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
        </button>
      </div>
      <div className="flex items-center gap-2">
        {!polling ? (
          <button
            onClick={startPolling}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium transition-colors"
          >
            <RefreshCw className="w-3 h-3" />
            Wait for Ollama...
          </button>
        ) : (
          <div className="flex items-center gap-1.5 text-xs text-blue-400">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Waiting for Ollama to start...
          </div>
        )}
      </div>
      <div className="text-[10px] text-neutral-600">
        Don't have Ollama? <a href="https://ollama.com/download" target="_blank" rel="noopener" className="text-blue-500 hover:text-blue-400 underline">Download it here</a>
      </div>
    </div>
  );
}

// --- Sub-components ---

function RoleBadge({ role }: { role: 'text' | 'vision' | 'both' }) {
  if (role === 'text') return <span className="px-1 py-0 rounded text-[9px] bg-purple-900/50 text-purple-400">text</span>;
  if (role === 'vision') return <span className="px-1 py-0 rounded text-[9px] bg-teal-900/50 text-teal-400">vision</span>;
  return <span className="px-1 py-0 rounded text-[9px] bg-amber-900/50 text-amber-400">text+vision</span>;
}

function ModelDropdown({
  value,
  models,
  onChange,
  emptyLabel = 'No models installed',
}: {
  value: string;
  models: ModelDropdownItem[];
  onChange: (model: string) => void;
  emptyLabel?: string;
}) {
  const [dropOpen, setDropOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!dropOpen) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setDropOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [dropOpen]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setDropOpen(!dropOpen)}
        className="w-full flex items-center justify-between bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-100 hover:border-neutral-600"
      >
        <span className="truncate">{value}</span>
        <ChevronDown className={`w-4 h-4 text-neutral-500 transition-transform ${dropOpen ? 'rotate-180' : ''}`} />
      </button>
      {dropOpen && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-neutral-800 border border-neutral-700 rounded-lg shadow-xl py-1 max-h-48 overflow-y-auto">
          {models.map((m) => (
            <button
              key={m.name}
              onClick={() => {
                onChange(m.name);
                setDropOpen(false);
              }}
              className={`flex items-center justify-between w-full px-3 py-1.5 text-sm text-left transition-colors ${
                value === m.name ? 'bg-blue-600/20 text-blue-400' : 'text-neutral-300 hover:bg-neutral-700'
              }`}
            >
              <span className="min-w-0 truncate">{m.name}</span>
              <span className="ml-2 flex shrink-0 items-center gap-1">
                {m.capabilities?.includes('vision') && (
                  <span className="rounded bg-teal-900/50 px-1 py-0 text-[9px] text-teal-300">vision</span>
                )}
                {m.owned_by && (
                  <span className="max-w-20 truncate text-[10px] text-neutral-500">{m.owned_by}</span>
                )}
                {m.size != null && m.size > 0 && (
                  <span className="text-[10px] text-neutral-500">{formatSize(m.size)}</span>
                )}
              </span>
            </button>
          ))}
          {models.length === 0 && (
            <div className="px-3 py-2 text-xs text-neutral-500">{emptyLabel}</div>
          )}
        </div>
      )}
    </div>
  );
}
