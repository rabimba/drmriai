import type { StudyMetadata } from '../dicom/types';

export type AnalysisDepth = 'fast' | 'standard' | 'full';

export interface SeriesSelection {
  seriesNumber: string;
  role: 'primary' | 'supplementary';
  rationale: string;
  sliceRange: [number, number];
  samplingStrategy: 'every_nth' | 'uniform' | 'all';
  samplingParam?: number;
  windowWidth: number;
  windowCenter: number;
}

export interface SelectionPlan {
  reasoning: string;
  selections: SeriesSelection[];
  totalImages: number;
  analysisDepth?: AnalysisDepth;
  // Legacy shortcuts from selections[0] — used by App.tsx viewport logic
  targetSeries: string;
  sliceRange: [number, number];
  windowCenter: number;
  windowWidth: number;
  samplingStrategy: 'every_nth' | 'uniform' | 'all';
  samplingParam?: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export interface SavedAnalysisRecord {
  id: string;
  sourceMessageId: string;
  savedAt: number;
  title: string;
  providerLabel: string;
  prompt: string;
  latestAnalysis: string;
  transcript: string;
  markdown: string;
  messages: ChatMessage[];
  study: {
    studyDescription?: string;
    modality?: string;
    bodyPartExamined?: string;
    patientAge?: string;
    patientSex?: string;
    studyDate?: string;
    institutionName?: string;
  };
}

export interface AnalysisEvidenceImage {
  fileName: string;
  label: string;
  seriesNumber: string;
  instanceNumber: number;
  zPosition: number;
  blob: Blob;
}

export interface AnalysisEvidenceBundle {
  analysisId: string;
  createdAt: number;
  prompt: string;
  plan: SelectionPlan;
  analysisDepth: AnalysisDepth;
  batchCount: number;
  surveyMode: boolean;
  images: AnalysisEvidenceImage[];
}

export type ProviderType = 'gemini' | 'ollama' | 'openai-compatible' | 'gemma-transformers';

export interface ProviderConfig {
  provider: ProviderType;
  apiKey?: string;           // Gemini only
  geminiModel?: string;      // Gemini model for hosted text + vision analysis
  ollamaTextModel?: string;  // Ollama model for Call 1 (text-only planning)
  ollamaVisionModel?: string; // Ollama model for Call 2 (multimodal analysis)
  ollamaUrl?: string;        // Ollama base URL override
  openAiCompatibleBaseUrl?: string; // OpenAI-compatible /v1 endpoint
  openAiCompatibleApiKey?: string;  // OpenAI-compatible bearer token
  openAiCompatibleTextModel?: string; // OpenAI-compatible model for Call 1 + follow-ups
  openAiCompatibleVisionModel?: string; // OpenAI-compatible model for Call 2 image analysis
  analysisDepth?: AnalysisDepth; // default image coverage depth
  gemmaTransformersModelId?: string; // Transformers.js model repo or local model path
  gemmaTransformersDtype?: string;   // Transformers.js dtype, e.g. q4f16
  gemmaTransformersMaxImages?: number; // Browser-local image budget
  gemmaTransformersImageTokenBudget?: number; // Gemma 4 image soft-token budget
}

export interface ViewportContext {
  currentInstanceNumber: number;
  currentZPosition: number;
  seriesNumber: string;
  totalSlicesInSeries: number;
}

export interface LLMService {
  getSelectionPlan(metadata: StudyMetadata, clinicalHint: string, viewportContext?: ViewportContext): Promise<SelectionPlan>;
  analyzeSlices(
    images: Blob[],
    metadata: StudyMetadata,
    clinicalHint: string,
    plan: SelectionPlan,
    sliceLabels: string[],
    surveyMode?: boolean,
    options?: { batchSize?: number; analysisDepth?: AnalysisDepth },
  ): Promise<string>;
  sendFollowUp(
    conversationHistory: ChatMessage[],
    metadata: StudyMetadata,
  ): Promise<string>;
}
