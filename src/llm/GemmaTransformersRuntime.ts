import {
  DEFAULT_GEMMA_TRANSFORMERS_ANALYSIS_TOKENS,
  DEFAULT_GEMMA_TRANSFORMERS_DTYPE,
  DEFAULT_GEMMA_TRANSFORMERS_IMAGE_TOKEN_BUDGET,
  DEFAULT_GEMMA_TRANSFORMERS_MODEL_ID,
  hasTransformersWebGpuSupport,
} from './gemmaTransformersConfig';
import { debugLog } from '../utils/logger';

export {
  DEFAULT_GEMMA_TRANSFORMERS_ANALYSIS_TOKENS,
  DEFAULT_GEMMA_TRANSFORMERS_DTYPE,
  DEFAULT_GEMMA_TRANSFORMERS_IMAGE_TOKEN_BUDGET,
  DEFAULT_GEMMA_TRANSFORMERS_MODEL_ID,
  hasTransformersWebGpuSupport,
} from './gemmaTransformersConfig';

type TransformersModule = typeof import('@huggingface/transformers');
type TextStreamerTokenizer = ConstructorParameters<TransformersModule['TextStreamer']>[0];
type TransformersDtype =
  | 'auto' | 'q4f16' | 'q4' | 'q8' | 'fp16' | 'fp32'
  | 'int8' | 'uint8' | 'bnb4' | 'q2' | 'q2f16' | 'q1' | 'q1f16';

type GemmaMessageContent =
  | string
  | Array<
    | { type: 'image' }
    | { type: 'text'; text: string }
  >;

export interface GemmaTransformersMessage {
  role: 'system' | 'user' | 'assistant';
  content: GemmaMessageContent;
}

interface TensorLike {
  dims?: number[];
  slice?: (start?: unknown, end?: unknown) => unknown;
}

type ProcessorCall = (
  prompt: string,
  images?: unknown,
  audio?: unknown,
  options?: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

type ProcessorLike = ProcessorCall & {
  tokenizer: unknown;
  apply_chat_template: (
    messages: GemmaTransformersMessage[],
    options: {
      enable_thinking?: boolean;
      add_generation_prompt?: boolean;
    },
  ) => string;
  batch_decode: (
    outputs: unknown,
    options: { skip_special_tokens?: boolean },
  ) => string[];
  image_processor?: {
    max_soft_tokens?: number;
    config?: {
      max_soft_tokens?: number;
    };
  };
};

interface ModelLike {
  generate: (inputs: Record<string, unknown>) => Promise<TensorLike>;
}

interface GemmaTransformersSession {
  processor: ProcessorLike;
  model: ModelLike;
  module: TransformersModule;
}

interface SessionOptions {
  modelId?: string;
  dtype?: string;
  imageTokenBudget?: number;
}

interface GenerateOptions extends SessionOptions {
  messages: GemmaTransformersMessage[];
  images?: Blob[];
  maxNewTokens?: number;
}

export type GemmaTransformersRuntimeStage =
  | 'webgpu-check'
  | 'module-loading'
  | 'processor-loading'
  | 'model-loading'
  | 'session-ready'
  | 'cache-hit'
  | 'image-loading'
  | 'tokenizing'
  | 'generating'
  | 'decoding'
  | 'error';

export interface GemmaTransformersRuntimeEvent {
  stage: GemmaTransformersRuntimeStage;
  message: string;
  modelId?: string;
  dtype?: string;
  imageTokenBudget?: number;
  file?: string;
  loaded?: number;
  total?: number;
  progress?: number;
  elapsedMs?: number;
  details?: unknown;
}

type GemmaTransformersRuntimeListener = (event: GemmaTransformersRuntimeEvent) => void;

let transformersModulePromise: Promise<TransformersModule> | null = null;
const sessionCache = new Map<string, Promise<GemmaTransformersSession>>();
const runtimeListeners = new Set<GemmaTransformersRuntimeListener>();
const consoleProgressMarks = new Map<string, number>();
const emittedStatusMarks = new Set<string>();

export function subscribeGemmaTransformersRuntime(listener: GemmaTransformersRuntimeListener): () => void {
  runtimeListeners.add(listener);
  return () => runtimeListeners.delete(listener);
}

function emitRuntimeEvent(event: GemmaTransformersRuntimeEvent) {
  runtimeListeners.forEach((listener) => listener(event));

  const progressKey = `${event.stage}:${event.file ?? ''}`;
  if (typeof event.progress === 'number') {
    const rounded = Math.round(event.progress);
    if (rounded <= 0 || rounded >= 100) {
      const edgeKey = `${progressKey}:${rounded <= 0 ? 0 : 100}`;
      if (emittedStatusMarks.has(edgeKey)) return;
      emittedStatusMarks.add(edgeKey);
    } else {
      const bucket = Math.floor(rounded / 10) * 10;
      const last = consoleProgressMarks.get(progressKey);
      if (last === bucket) return;
      consoleProgressMarks.set(progressKey, bucket);
    }
  } else if (event.file) {
    const statusKey = `${progressKey}:${event.message}`;
    if (emittedStatusMarks.has(statusKey)) return;
    emittedStatusMarks.add(statusKey);
  }

  if (event.stage === 'error') {
    debugLog('error', 'GemmaTransformers', event.message, event);
  } else {
    debugLog('info', 'GemmaTransformers', event.message, event);
  }
}

function loadTransformersModule(): Promise<TransformersModule> {
  if (!transformersModulePromise) {
    emitRuntimeEvent({
      stage: 'module-loading',
      message: 'Loading Transformers.js runtime chunk',
    });
    transformersModulePromise = import('@huggingface/transformers');
  }
  return transformersModulePromise;
}

function normalizeModelId(modelId?: string): string {
  const trimmed = modelId?.trim();
  return trimmed || DEFAULT_GEMMA_TRANSFORMERS_MODEL_ID;
}

function normalizeDtype(dtype?: string): TransformersDtype {
  const normalized = dtype?.trim() as TransformersDtype | undefined;
  const allowed = new Set<TransformersDtype>([
    'auto', 'q4f16', 'q4', 'q8', 'fp16', 'fp32',
    'int8', 'uint8', 'bnb4', 'q2', 'q2f16', 'q1', 'q1f16',
  ]);
  return normalized && allowed.has(normalized)
    ? normalized
    : DEFAULT_GEMMA_TRANSFORMERS_DTYPE;
}

function normalizeImageTokenBudget(value?: number): number {
  if (!Number.isFinite(value) || value == null) {
    return DEFAULT_GEMMA_TRANSFORMERS_IMAGE_TOKEN_BUDGET;
  }
  return Math.max(70, Math.min(280, Math.round(value)));
}

function sessionCacheKey(options: Required<SessionOptions>): string {
  return JSON.stringify(options);
}

function configureImageTokenBudget(processor: ProcessorLike, imageTokenBudget: number) {
  const imageProcessor = processor.image_processor;
  if (!imageProcessor) return;
  imageProcessor.max_soft_tokens = imageTokenBudget;
  if (imageProcessor.config) {
    imageProcessor.config.max_soft_tokens = imageTokenBudget;
  }
}

interface TransformersProgressPayload {
  status?: string;
  name?: string;
  file?: string;
  progress?: number;
  loaded?: number;
  total?: number;
}

function toProgressPayload(value: unknown): TransformersProgressPayload {
  if (!value || typeof value !== 'object') return {};
  const record = value as Record<string, unknown>;
  return {
    status: typeof record.status === 'string' ? record.status : undefined,
    name: typeof record.name === 'string' ? record.name : undefined,
    file: typeof record.file === 'string' ? record.file : undefined,
    progress: typeof record.progress === 'number' ? record.progress : undefined,
    loaded: typeof record.loaded === 'number' ? record.loaded : undefined,
    total: typeof record.total === 'number' ? record.total : undefined,
  };
}

function makeProgressHandler(
  stage: Extract<GemmaTransformersRuntimeStage, 'processor-loading' | 'model-loading'>,
  label: string,
  normalized: Required<SessionOptions>,
) {
  return (value: unknown) => {
    const progress = toProgressPayload(value);
    const percent = typeof progress.progress === 'number'
      ? ` (${Math.round(progress.progress)}%)`
      : '';
    const file = progress.file || progress.name;
    emitRuntimeEvent({
      stage,
      message: `${label}${file ? `: ${file}` : ''}${percent}`,
      modelId: normalized.modelId,
      dtype: normalized.dtype,
      imageTokenBudget: normalized.imageTokenBudget,
      file,
      loaded: progress.loaded,
      total: progress.total,
      progress: progress.progress,
      details: progress,
    });
  };
}

async function getGemmaTransformersSession(options: SessionOptions = {}): Promise<GemmaTransformersSession> {
  emitRuntimeEvent({
    stage: 'webgpu-check',
    message: 'Checking WebGPU support for Gemma 4 Browser',
  });
  if (!hasTransformersWebGpuSupport()) {
    emitRuntimeEvent({
      stage: 'error',
      message: 'Gemma 4 Browser requires WebGPU, but navigator.gpu is unavailable',
    });
    throw new Error(
      'Gemma 4 Browser requires WebGPU. Use the latest Chrome or Edge, or switch to Ollama/Gemini in Settings.',
    );
  }

  const normalized = {
    modelId: normalizeModelId(options.modelId),
    dtype: normalizeDtype(options.dtype),
    imageTokenBudget: normalizeImageTokenBudget(options.imageTokenBudget),
  };
  const cacheKey = sessionCacheKey(normalized);
  const cached = sessionCache.get(cacheKey);
  if (cached) {
    emitRuntimeEvent({
      stage: 'cache-hit',
      message: 'Using existing Gemma 4 Browser model session',
      modelId: normalized.modelId,
      dtype: normalized.dtype,
      imageTokenBudget: normalized.imageTokenBudget,
    });
    return cached;
  }

  const sessionPromise = (async () => {
    const startedAt = performance.now();
    const mod = await loadTransformersModule();
    emitRuntimeEvent({
      stage: 'module-loading',
      message: 'Transformers.js runtime loaded',
      modelId: normalized.modelId,
      dtype: normalized.dtype,
      imageTokenBudget: normalized.imageTokenBudget,
    });
    emitRuntimeEvent({
      stage: 'model-loading',
      message: 'Downloading/loading Gemma 4 Browser model files. First run can take several minutes.',
      modelId: normalized.modelId,
      dtype: normalized.dtype,
      imageTokenBudget: normalized.imageTokenBudget,
    });
    const [processor, model] = await Promise.all([
      mod.AutoProcessor.from_pretrained(normalized.modelId, {
        progress_callback: makeProgressHandler('processor-loading', 'Loading processor', normalized),
      } as Record<string, unknown>) as Promise<ProcessorLike>,
      mod.Gemma4ForConditionalGeneration.from_pretrained(normalized.modelId, {
        dtype: normalized.dtype,
        device: 'webgpu',
        progress_callback: makeProgressHandler('model-loading', 'Loading model', normalized),
      } as Record<string, unknown>) as Promise<ModelLike>,
    ]);

    configureImageTokenBudget(processor, normalized.imageTokenBudget);
    emitRuntimeEvent({
      stage: 'session-ready',
      message: 'Gemma 4 Browser model is ready',
      modelId: normalized.modelId,
      dtype: normalized.dtype,
      imageTokenBudget: normalized.imageTokenBudget,
      elapsedMs: Math.round(performance.now() - startedAt),
    });
    return { processor, model, module: mod };
  })().catch((error) => {
    sessionCache.delete(cacheKey);
    const message = error instanceof Error ? error.message : String(error);
    emitRuntimeEvent({
      stage: 'error',
      message: `Gemma 4 Browser model load failed: ${message}`,
      modelId: normalized.modelId,
      dtype: normalized.dtype,
      imageTokenBudget: normalized.imageTokenBudget,
      details: error,
    });
    if (/webgpu|adapter|device/i.test(message)) {
      throw new Error(
        'Gemma 4 Browser could not initialize WebGPU. Update Chrome/Edge, close other GPU-heavy tabs, or switch to Ollama/Gemini.',
      );
    }
    if (/memory|allocation|out of/i.test(message)) {
      throw new Error(
        'Gemma 4 Browser ran out of GPU/browser memory. Try fewer images, a lower token budget, or switch to Ollama/Gemini.',
      );
    }
    if (/fetch|network|404|resolve|download/i.test(message)) {
      throw new Error(
        `Gemma 4 Browser could not load "${normalized.modelId}". Check the model ID and network access, or switch providers.`,
      );
    }
    throw error;
  });

  sessionCache.set(cacheKey, sessionPromise);
  return sessionPromise;
}

async function blobsToRawImages(mod: TransformersModule, blobs: Blob[]): Promise<unknown[]> {
  return Promise.all(blobs.map((blob) => mod.RawImage.fromBlob(blob)));
}

function getPromptLength(inputs: Record<string, unknown>): number {
  const inputIds = inputs.input_ids as TensorLike | undefined;
  const dims = inputIds?.dims;
  const last = dims?.[dims.length - 1];
  return typeof last === 'number' ? last : 0;
}

function stripGemmaThinkingArtifacts(text: string): string {
  return text
    .replace(/<\|channel>thought[\s\S]*?<channel\|>/gi, '')
    .replace(/<\|[^>]+?\|>/g, '')
    .trim();
}

export async function generateGemmaTransformersResponse(options: GenerateOptions): Promise<string> {
  const session = await getGemmaTransformersSession(options);
  const { processor, model, module: mod } = session;
  const normalized = {
    modelId: normalizeModelId(options.modelId),
    dtype: normalizeDtype(options.dtype),
    imageTokenBudget: normalizeImageTokenBudget(options.imageTokenBudget),
  };

  try {
    emitRuntimeEvent({
      stage: 'tokenizing',
      message: 'Preparing Gemma 4 prompt',
      ...normalized,
    });
    const prompt = processor.apply_chat_template(options.messages, {
      enable_thinking: false,
      add_generation_prompt: true,
    });
    if (options.images?.length) {
      emitRuntimeEvent({
        stage: 'image-loading',
        message: `Preparing ${options.images.length} image${options.images.length === 1 ? '' : 's'} for Gemma 4`,
        ...normalized,
      });
    }
    const rawImages = options.images?.length ? await blobsToRawImages(mod, options.images) : null;
    const inputs = await processor(prompt, rawImages, null, { add_special_tokens: false });
    let streamed = '';
    const streamer = new mod.TextStreamer(processor.tokenizer as TextStreamerTokenizer, {
      skip_prompt: true,
      skip_special_tokens: true,
      callback_function: (chunk: string) => {
        streamed += chunk;
      },
    });

    emitRuntimeEvent({
      stage: 'generating',
      message: 'Generating Gemma 4 response',
      ...normalized,
    });
    const outputs = await model.generate({
      ...inputs,
      max_new_tokens: options.maxNewTokens ?? DEFAULT_GEMMA_TRANSFORMERS_ANALYSIS_TOKENS,
      do_sample: false,
      streamer,
    });

    emitRuntimeEvent({
      stage: 'decoding',
      message: 'Decoding Gemma 4 response',
      ...normalized,
    });
    const promptLength = getPromptLength(inputs);
    const generated = outputs.slice ? outputs.slice(null, [promptLength, null]) : outputs;
    const decoded = processor.batch_decode(generated, { skip_special_tokens: true });
    return stripGemmaThinkingArtifacts(streamed.trim() || decoded[0] || '');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    emitRuntimeEvent({
      stage: 'error',
      message: `Gemma 4 Browser generation failed: ${message}`,
      ...normalized,
      details: error,
    });
    if (/tensor shape is too large|OrtRun|OutputMLValue|shape is too large/i.test(message)) {
      throw new Error(
        'Gemma 4 Browser exceeded the browser tensor limit. Use 1-4 images, keep Image Token Budget at 70 or 140, or use Ollama/Gemini for this study.',
      );
    }
    throw error;
  }
}
