const MEDIAPIPE_GENAI_MODULE_URL =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-genai@0.10.27/+esm';

import {
  DEFAULT_GEMMA_WEB_MAX_IMAGES,
  DEFAULT_GEMMA_WEB_MAX_TOKENS,
  DEFAULT_GEMMA_WEB_WASM_ROOT,
  hasWebGpuSupport,
} from './gemmaWebConfig';

export {
  DEFAULT_GEMMA_WEB_MAX_IMAGES,
  DEFAULT_GEMMA_WEB_MAX_TOKENS,
  DEFAULT_GEMMA_WEB_WASM_ROOT,
  hasWebGpuSupport,
} from './gemmaWebConfig';

type PromptPart = string | HTMLImageElement;
type WebGpuCompatAdapter = Record<string, unknown> & {
  info?: unknown;
  requestAdapterInfo?: unknown;
  requestDevice?: (...requestArgs: unknown[]) => Promise<Record<string, unknown>>;
};
type WebGpuCompat = {
  requestAdapter?: (...args: unknown[]) => Promise<WebGpuCompatAdapter | null>;
};

interface GenAiFilesetResolver {
  forGenAiTasks(wasmRoot: string): Promise<unknown>;
}

interface GemmaWebSession {
  generateResponse(
    prompt: string | PromptPart[],
    callback?: (partialResult: string, done: boolean) => void,
  ): Promise<string>;
}

interface GenAiModule {
  FilesetResolver: GenAiFilesetResolver;
  LlmInference: {
    createFromOptions(genai: unknown, options: Record<string, unknown>): Promise<GemmaWebSession>;
  };
}

interface SessionOptions {
  modelPath: string;
  wasmRoot: string;
  maxTokens: number;
  maxNumImages?: number;
}

interface PreparedImage {
  element: HTMLImageElement;
  cleanup: () => void;
}

let modulePromise: Promise<GenAiModule> | null = null;
const sessionCache = new Map<string, Promise<GemmaWebSession>>();
let webGpuCompatPatched = false;

function ensureWebGpuAdapterInfoCompatibility() {
  if (webGpuCompatPatched || typeof navigator === 'undefined' || !('gpu' in navigator)) {
    return;
  }

  const gpu = (navigator as unknown as { gpu?: WebGpuCompat }).gpu;

  if (!gpu?.requestAdapter) return;

  const originalRequestAdapter = gpu.requestAdapter.bind(gpu);
  gpu.requestAdapter = async (...args: unknown[]) => {
    const adapter = await originalRequestAdapter(...args);
    if (!adapter) return adapter;

    if (typeof adapter.requestAdapterInfo !== 'function') {
      Object.defineProperty(adapter, 'requestAdapterInfo', {
        configurable: true,
        value: async () => adapter.info ?? {},
      });
    }

    const requestDevice = adapter.requestDevice;

    if (typeof requestDevice === 'function') {
      const originalRequestDevice = requestDevice.bind(adapter);
      (adapter as { requestDevice: (...requestArgs: unknown[]) => Promise<Record<string, unknown>> }).requestDevice =
        async (...requestArgs: unknown[]) => {
          const device = await originalRequestDevice(...requestArgs);
          if (device) {
            try {
              Object.defineProperty(device, 'adapterInfo', {
                configurable: true,
                writable: true,
                value: adapter.info ?? {},
              });
            } catch {
              // Some engines may reject redefining platform properties. In that case
              // we fall back to the native behavior and surface a clearer error later.
            }
          }
          return device;
        };
    }

    return adapter;
  };

  webGpuCompatPatched = true;
}

function loadGenAiModule(): Promise<GenAiModule> {
  if (!modulePromise) {
    modulePromise = import(/* @vite-ignore */ MEDIAPIPE_GENAI_MODULE_URL) as Promise<GenAiModule>;
  }
  return modulePromise;
}

function getCacheKey(options: SessionOptions): string {
  return JSON.stringify({
    modelPath: options.modelPath,
    wasmRoot: options.wasmRoot,
    maxTokens: options.maxTokens,
    maxNumImages: options.maxNumImages ?? 0,
  });
}

function normalizeModelPath(modelPath: string): string {
  const trimmed = modelPath.trim();
  if (!trimmed) return '';

  if (/^(https?:|blob:|data:)/i.test(trimmed)) {
    return trimmed;
  }

  if (trimmed.startsWith('/')) {
    return trimmed;
  }

  return `/${trimmed.replace(/^\.?\//, '')}`;
}

export function normalizeGemmaWebModelPath(modelPath?: string): string {
  return normalizeModelPath(modelPath ?? '');
}

export function getGemmaWebTextModelLabel(modelPath?: string): string {
  const normalized = normalizeGemmaWebModelPath(modelPath);
  if (!normalized) return 'gemma-web';
  const lastSegment = normalized.split('/').pop();
  return lastSegment || normalized;
}

export function getGemmaWebVisionModelLabel(modelPath?: string): string {
  const normalized = normalizeGemmaWebModelPath(modelPath);
  if (!normalized) return 'gemma-web';
  const lastSegment = normalized.split('/').pop();
  return lastSegment || normalized;
}

export async function getGemmaWebSession(options: SessionOptions): Promise<GemmaWebSession> {
  const modelPath = normalizeModelPath(options.modelPath);
  if (!modelPath) {
    throw new Error('Gemma Web model path is required.');
  }

  if (!hasWebGpuSupport()) {
    throw new Error('Gemma Web requires a browser with WebGPU support.');
  }

  ensureWebGpuAdapterInfoCompatibility();

  const normalizedOptions: SessionOptions = {
    ...options,
    modelPath,
    wasmRoot: options.wasmRoot.trim() || DEFAULT_GEMMA_WEB_WASM_ROOT,
  };

  const cacheKey = getCacheKey(normalizedOptions);
  const cached = sessionCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const sessionPromise = (async () => {
    const mod = await loadGenAiModule();
    const genai = await mod.FilesetResolver.forGenAiTasks(normalizedOptions.wasmRoot);

    const runtimeOptions: Record<string, unknown> = {
      baseOptions: {
        modelAssetPath: normalizedOptions.modelPath,
      },
      maxTokens: normalizedOptions.maxTokens,
      topK: 1,
      temperature: 0,
      randomSeed: 0,
    };

    if (normalizedOptions.maxNumImages != null) {
      runtimeOptions.maxNumImages = normalizedOptions.maxNumImages;
    }

    return mod.LlmInference.createFromOptions(genai, runtimeOptions);
  })().catch((error) => {
    sessionCache.delete(cacheKey);

    const message = error instanceof Error ? error.message : String(error);
    if (/requestAdapterInfo/i.test(message)) {
      throw new Error(
        'This browser exposes WebGPU but not the older requestAdapterInfo() API that the current Gemma Web runtime expects. ' +
        'Try the latest Chrome or Edge build, or reload after updating the browser.',
      );
    }
    if (/adapterInfo/i.test(message)) {
      throw new Error(
        'Gemma Web hit a WebGPU compatibility issue in the browser runtime while initializing the model. ' +
        'Reload the page after updating Chrome or Edge; if it persists, this browser/runtime combination is not currently usable for Gemma Web.',
      );
    }
    if (/failed to fetch|network/i.test(message)) {
      throw new Error(
        `Failed to load Gemma Web assets from "${normalizedOptions.modelPath}". ` +
        'Check that the model path is correct and that the host allows browser access.',
      );
    }

    throw error;
  });

  sessionCache.set(cacheKey, sessionPromise);
  return sessionPromise;
}

export async function warmGemmaWebModel(modelPath: string, wasmRoot = DEFAULT_GEMMA_WEB_WASM_ROOT): Promise<void> {
  await getGemmaWebSession({
    modelPath,
    wasmRoot,
    maxTokens: DEFAULT_GEMMA_WEB_MAX_TOKENS,
    maxNumImages: DEFAULT_GEMMA_WEB_MAX_IMAGES,
  });
}

export async function preparePromptImages(images: Blob[]): Promise<PreparedImage[]> {
  return Promise.all(images.map(preparePromptImage));
}

async function preparePromptImage(blob: Blob): Promise<PreparedImage> {
  const objectUrl = URL.createObjectURL(blob);
  const image = new Image();
  image.decoding = 'async';

  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('Failed to decode exported JPEG for Gemma Web analysis.'));
    image.src = objectUrl;
  });

  return {
    element: image,
    cleanup: () => URL.revokeObjectURL(objectUrl),
  };
}
