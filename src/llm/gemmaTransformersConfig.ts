export const DEFAULT_GEMMA_TRANSFORMERS_MODEL_ID = 'onnx-community/gemma-4-E2B-it-ONNX';
export const DEFAULT_GEMMA_TRANSFORMERS_DTYPE = 'q4f16';
export const DEFAULT_GEMMA_TRANSFORMERS_MAX_IMAGES = 16;
export const DEFAULT_GEMMA_TRANSFORMERS_BATCH_SIZE = 4;
export const DEFAULT_GEMMA_TRANSFORMERS_IMAGE_TOKEN_BUDGET = 140;
export const DEFAULT_GEMMA_TRANSFORMERS_EXPORT_LONG_EDGE = 768;
export const DEFAULT_GEMMA_TRANSFORMERS_PLANNING_TOKENS = 512;
export const DEFAULT_GEMMA_TRANSFORMERS_BATCH_ANALYSIS_TOKENS = 384;
export const DEFAULT_GEMMA_TRANSFORMERS_ANALYSIS_TOKENS = 1024;

export const GEMMA_TRANSFORMERS_IMAGE_TOKEN_BUDGETS = [70, 140, 280] as const;
export const GEMMA_TRANSFORMERS_DTYPES = ['q4f16', 'q4', 'q8', 'fp16', 'fp32'] as const;

export type GemmaTransformersDtype = typeof GEMMA_TRANSFORMERS_DTYPES[number];
export type GemmaTransformersImageTokenBudget = typeof GEMMA_TRANSFORMERS_IMAGE_TOKEN_BUDGETS[number];

export function hasTransformersWebGpuSupport(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator;
}
