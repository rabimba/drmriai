export const DEFAULT_GEMMA_WEB_WASM_ROOT =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-genai@latest/wasm';

export const DEFAULT_GEMMA_WEB_MODEL_PATH =
  'https://huggingface.co/vba01/gemma-3n-E2B-it-int4/resolve/main/gemma-3n-E2B-it-int4.task';

export const DEFAULT_GEMMA_WEB_TEXT_MODEL_PATH = DEFAULT_GEMMA_WEB_MODEL_PATH;
export const DEFAULT_GEMMA_WEB_VISION_MODEL_PATH = DEFAULT_GEMMA_WEB_MODEL_PATH;
export const DEFAULT_GEMMA_WEB_MAX_TOKENS = 4096;
export const DEFAULT_GEMMA_WEB_MAX_IMAGES = 20;

export const LEGACY_GEMMA_WEB_MODEL_PATHS = [
  'https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/resolve/main/gemma-4-E2B-it-web.task',
  'https://huggingface.co/google/gemma-3n-E4B-it-litert-lm/resolve/main/gemma-3n-E4B-it-int4-Web.litertlm',
  'https://huggingface.co/notabilia/gemma-3n-E4B-it-litert-lm/resolve/main/gemma-3n-E4B-it-int4-Web.litertlm',
];

export function hasWebGpuSupport(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator;
}
