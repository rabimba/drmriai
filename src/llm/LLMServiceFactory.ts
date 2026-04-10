import type { StudyMetadata } from '../dicom/types';
import type { SelectionPlan, SeriesSelection, ChatMessage, ProviderConfig, LLMService, ViewportContext } from './types';
import {
  buildSelectionSystemPrompt,
  buildSelectionUserPrompt,
  buildAnalysisSystemPrompt,
  buildAnalysisUserPrompt,
  buildFollowUpSystemPrompt,
} from './PromptBuilder';
import {
  DEFAULT_GEMMA_WEB_MAX_IMAGES,
  DEFAULT_GEMMA_WEB_MAX_TOKENS,
  DEFAULT_GEMMA_WEB_TEXT_MODEL_PATH,
  DEFAULT_GEMMA_WEB_VISION_MODEL_PATH,
  DEFAULT_GEMMA_WEB_WASM_ROOT,
} from './gemmaWebConfig';
import {
  getGemmaWebSession,
  normalizeGemmaWebModelPath,
  preparePromptImages,
} from './GemmaWebRuntime';

// --- Shared Helpers ---

function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  const braceStart = text.indexOf('{');
  const braceEnd = text.lastIndexOf('}');
  if (braceStart !== -1 && braceEnd > braceStart) {
    return text.slice(braceStart, braceEnd + 1);
  }
  return text.trim();
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function parseSamplingStrategy(value: unknown): SeriesSelection['samplingStrategy'] {
  return value === 'every_nth' || value === 'all' ? value : 'uniform';
}

function parseSeriesSelection(raw: Record<string, unknown>): SeriesSelection {
  return {
    seriesNumber: String(raw.seriesNumber),
    role: (raw.role as string) === 'supplementary' ? 'supplementary' : 'primary',
    rationale: String(raw.rationale ?? ''),
    sliceRange: [Number((raw.sliceRange as number[])[0]), Number((raw.sliceRange as number[])[1])],
    samplingStrategy: parseSamplingStrategy(raw.samplingStrategy),
    samplingParam: raw.samplingParam != null ? Number(raw.samplingParam) : undefined,
    windowWidth: Number(raw.windowWidth),
    windowCenter: Number(raw.windowCenter),
  };
}

function populateLegacyFields(selections: SeriesSelection[], reasoning: string, totalImages: number): SelectionPlan {
  const primary = selections[0];
  return {
    reasoning,
    selections,
    totalImages,
    targetSeries: primary.seriesNumber,
    sliceRange: primary.sliceRange,
    windowCenter: primary.windowCenter,
    windowWidth: primary.windowWidth,
    samplingStrategy: primary.samplingStrategy,
    samplingParam: primary.samplingParam,
  };
}

function parseSelectionPlan(raw: string): SelectionPlan {
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(extractJson(raw));
  } catch {
    throw new Error(
      'The LLM did not return valid JSON. This can happen with smaller models. ' +
      'Try a more specific clinical prompt (e.g., "Evaluate for lung nodules") or switch to Gemini 2.5 Flash.',
    );
  }

  // New multi-series format: { reasoning, selections: [...], totalImages }
  if (Array.isArray(json.selections) && json.selections.length > 0) {
    const selections = (json.selections as Record<string, unknown>[]).map(parseSeriesSelection);
    const reasoning = String(json.reasoning ?? '');
    const totalImages = json.totalImages != null ? Number(json.totalImages) : 0;
    return populateLegacyFields(selections, reasoning, totalImages);
  }

  // Legacy single-series format: { targetSeries, sliceRange, ... }
  if (!json.targetSeries || !json.sliceRange) {
    throw new Error(
      'The LLM response is missing required fields (targetSeries, sliceRange). ' +
      'Try a more specific clinical prompt or a larger model.',
    );
  }

  const selection: SeriesSelection = {
    seriesNumber: String(json.targetSeries),
    role: 'primary',
    rationale: String(json.reasoning ?? ''),
    sliceRange: [Number((json.sliceRange as number[])[0]), Number((json.sliceRange as number[])[1])],
    samplingStrategy: parseSamplingStrategy(json.samplingStrategy),
    samplingParam: json.samplingParam != null ? Number(json.samplingParam) : undefined,
    windowCenter: Number(json.windowCenter),
    windowWidth: Number(json.windowWidth),
  };

  return populateLegacyFields([selection], selection.rationale, 0);
}

function extractChatCompletionText(data: { choices?: Array<{ message?: { content?: unknown } }> }): string {
  const content = data.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';

  return content
    .map((part) => {
      if (typeof part === 'string') return part;
      if (part && typeof part === 'object' && 'text' in part) {
        return String((part as { text?: unknown }).text ?? '');
      }
      return '';
    })
    .join('\n')
    .trim();
}

// --- Gemini Service ---

class GeminiService implements LLMService {
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model: string) {
    this.apiKey = apiKey;
    this.model = model;
  }

  async getSelectionPlan(metadata: StudyMetadata, clinicalHint: string, viewportContext?: ViewportContext): Promise<SelectionPlan> {
    const response = await this.callGemini({
      messages: [
        { role: 'system', content: buildSelectionSystemPrompt() },
        { role: 'user', content: buildSelectionUserPrompt(metadata, clinicalHint, viewportContext) },
      ],
      temperature: 0,
      maxTokens: 1024,
    });
    return parseSelectionPlan(response);
  }

  async analyzeSlices(
    images: Blob[],
    metadata: StudyMetadata,
    clinicalHint: string,
    plan: SelectionPlan,
    sliceLabels: string[],
    surveyMode?: boolean,
  ): Promise<string> {
    const imageContents = await Promise.all(
      images.map(async (blob, i) => [
        {
          type: 'text' as const,
          text: sliceLabels[i] ?? `Image ${i + 1}`,
        },
        {
          type: 'image_url' as const,
          image_url: {
            url: `data:image/jpeg;base64,${await blobToBase64(blob)}`,
          },
        },
      ]),
    );

    const content = [
      {
        type: 'text' as const,
        text: `${buildAnalysisUserPrompt(metadata, clinicalHint, plan, sliceLabels)}\n\nThe ordered images follow after their labels.`,
      },
      ...imageContents.flat(),
    ];

    return this.callGemini({
      messages: [
        { role: 'system', content: buildAnalysisSystemPrompt(surveyMode) },
        { role: 'user', content },
      ],
      temperature: 0,
      maxTokens: 4096,
    });
  }

  async sendFollowUp(conversationHistory: ChatMessage[], metadata: StudyMetadata): Promise<string> {
    const messages = conversationHistory.map((msg) => ({
      role: msg.role as 'user' | 'assistant',
      content: msg.content,
    }));

    return this.callGemini({
      messages: [
        { role: 'system', content: buildFollowUpSystemPrompt() + '\n\nStudy context: ' + metadata.studyDescription },
        ...messages,
      ],
      temperature: 0,
      maxTokens: 4096,
    });
  }

  private async callGemini(params: {
    messages: Array<{ role: string; content: unknown }>;
    temperature: number;
    maxTokens: number;
  }): Promise<string> {
    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: params.maxTokens,
        temperature: params.temperature,
        messages: params.messages,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      if (res.status === 401 || res.status === 403) {
        throw new Error('Invalid Gemini API key. Check your Google AI Studio key.');
      }
      throw new Error(`Gemini API error (${res.status}): ${body}`);
    }

    const data = await res.json();
    return extractChatCompletionText(data);
  }
}

// --- Ollama Service ---

class OllamaService implements LLMService {
  private baseUrl: string;
  private textModel: string;
  private visionModel: string;

  constructor(textModel: string, visionModel: string, baseUrl: string) {
    this.textModel = textModel;
    this.visionModel = visionModel;
    this.baseUrl = baseUrl;
  }

  async getSelectionPlan(metadata: StudyMetadata, clinicalHint: string, viewportContext?: ViewportContext): Promise<SelectionPlan> {
    const response = await this.callOllama({
      model: this.textModel,
      system: buildSelectionSystemPrompt(),
      userContent: buildSelectionUserPrompt(metadata, clinicalHint, viewportContext),
    });
    return parseSelectionPlan(response);
  }

  async analyzeSlices(
    images: Blob[],
    metadata: StudyMetadata,
    clinicalHint: string,
    plan: SelectionPlan,
    sliceLabels: string[],
    surveyMode?: boolean,
  ): Promise<string> {
    const base64Images = await Promise.all(images.map(blobToBase64));
    const manifest = sliceLabels.map((l, i) => `  ${i + 1}. ${l}`).join('\n');
    const userContent =
      `IMAGE MANIFEST (${sliceLabels.length} images, in sequential order):\n${manifest}\n\nThe images are provided in the exact order listed above.\n\n` +
      buildAnalysisUserPrompt(metadata, clinicalHint, plan, sliceLabels);

    return this.callOllama({
      model: this.visionModel,
      system: buildAnalysisSystemPrompt(surveyMode),
      userContent,
      images: base64Images,
    });
  }

  async sendFollowUp(conversationHistory: ChatMessage[], metadata: StudyMetadata): Promise<string> {
    const messages = [
      { role: 'system' as const, content: buildFollowUpSystemPrompt() + '\n\nStudy context: ' + metadata.studyDescription },
      ...conversationHistory.map((msg) => ({
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
      })),
    ];

    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.textModel,
        messages,
        stream: false,
        options: { temperature: 0 },
      }),
      signal: AbortSignal.timeout(300_000),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Ollama error (${res.status}): ${body}`);
    }

    const data = await res.json();
    return data.message?.content ?? '';
  }

  private async callOllama(params: {
    model: string;
    system: string;
    userContent: string;
    images?: string[];
  }): Promise<string> {
    const messages = [
      { role: 'system', content: params.system },
      {
        role: 'user',
        content: params.userContent,
        ...(params.images?.length ? { images: params.images } : {}),
      },
    ];

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: params.model,
          messages,
          stream: false,
          options: { temperature: 0 },
        }),
        signal: AbortSignal.timeout(300_000),
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'TimeoutError') {
        throw new Error(`Ollama request timed out (5min). Model: ${params.model}. Try fewer slices or a smaller model.`);
      }
      throw new Error('Cannot connect to Ollama. Is it running? (ollama serve)');
    }

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Ollama error (${res.status}): ${body}`);
    }

    const data = await res.json();
    return data.message?.content ?? '';
  }
}

// --- Gemma Web Service ---

class GemmaWebService implements LLMService {
  private textModelPath?: string;
  private visionModelPath?: string;
  private wasmRoot: string;

  constructor(textModelPath: string | undefined, visionModelPath: string | undefined, wasmRoot: string) {
    this.textModelPath = normalizeGemmaWebModelPath(textModelPath);
    this.visionModelPath = normalizeGemmaWebModelPath(visionModelPath);
    this.wasmRoot = wasmRoot.trim() || DEFAULT_GEMMA_WEB_WASM_ROOT;
  }

  private getTextModelPath(): string {
    return this.textModelPath || this.visionModelPath || DEFAULT_GEMMA_WEB_TEXT_MODEL_PATH;
  }

  private getVisionModelPath(): string {
    return this.visionModelPath || this.textModelPath || DEFAULT_GEMMA_WEB_VISION_MODEL_PATH;
  }

  async getSelectionPlan(metadata: StudyMetadata, clinicalHint: string, viewportContext?: ViewportContext): Promise<SelectionPlan> {
    const session = await getGemmaWebSession({
      modelPath: this.getTextModelPath(),
      wasmRoot: this.wasmRoot,
      maxTokens: DEFAULT_GEMMA_WEB_MAX_TOKENS,
      maxNumImages: DEFAULT_GEMMA_WEB_MAX_IMAGES,
    });

    const prompt = [
      buildSelectionSystemPrompt(),
      '',
      buildSelectionUserPrompt(metadata, clinicalHint, viewportContext),
      '',
      'Return JSON only.',
    ].join('\n');

    const response = await session.generateResponse(prompt);
    return parseSelectionPlan(response);
  }

  async analyzeSlices(
    images: Blob[],
    metadata: StudyMetadata,
    clinicalHint: string,
    plan: SelectionPlan,
    sliceLabels: string[],
    surveyMode?: boolean,
  ): Promise<string> {
    const session = await getGemmaWebSession({
      modelPath: this.getVisionModelPath(),
      wasmRoot: this.wasmRoot,
      maxTokens: DEFAULT_GEMMA_WEB_MAX_TOKENS,
      maxNumImages: DEFAULT_GEMMA_WEB_MAX_IMAGES,
    });

    const preparedImages = await preparePromptImages(images);

    try {
      const promptParts: Array<string | HTMLImageElement> = [
        '<start_of_turn>user\n',
        buildAnalysisSystemPrompt(surveyMode),
        '\n\n',
        buildAnalysisUserPrompt(metadata, clinicalHint, plan, sliceLabels),
        '\n\nThe ordered images follow below.\n\n',
      ];

      preparedImages.forEach((prepared, index) => {
        promptParts.push(`Image ${index + 1}: ${sliceLabels[index] ?? `Image ${index + 1}`}\n`);
        promptParts.push(prepared.element);
        promptParts.push('\n\n');
      });

      promptParts.push('<end_of_turn>\n<start_of_turn>model\n');
      const response = await session.generateResponse(promptParts);
      return response;
    } finally {
      preparedImages.forEach((prepared) => prepared.cleanup());
    }
  }

  async sendFollowUp(conversationHistory: ChatMessage[], metadata: StudyMetadata): Promise<string> {
    const session = await getGemmaWebSession({
      modelPath: this.getTextModelPath(),
      wasmRoot: this.wasmRoot,
      maxTokens: DEFAULT_GEMMA_WEB_MAX_TOKENS,
      maxNumImages: DEFAULT_GEMMA_WEB_MAX_IMAGES,
    });

    const transcript = conversationHistory
      .map((msg) => `${msg.role === 'assistant' ? 'Assistant' : 'User'}: ${msg.content}`)
      .join('\n\n');

    const prompt = [
      buildFollowUpSystemPrompt(),
      '',
      `Study context: ${metadata.studyDescription} (${metadata.modality})`,
      '',
      'Conversation so far:',
      transcript,
      '',
      'Answer the latest user question directly. Do not claim to be re-reading images.',
    ].join('\n');

    return session.generateResponse(prompt);
  }
}

// --- Factory ---

const DEFAULT_TEXT_MODEL = 'alibayram/medgemma:4b';
const DEFAULT_VISION_MODEL = 'gemma3:4b';
export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';

export function createLLMService(config: ProviderConfig): LLMService {
  if (config.provider === 'gemini') {
    const isLocalhost =
      typeof window !== 'undefined' &&
      ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
    const key = config.apiKey || (isLocalhost ? import.meta.env.VITE_GEMINI_API_KEY : undefined);
    if (!key) throw new Error('Gemini API key is required. Enter it in Settings.');
    return new GeminiService(key, config.geminiModel || DEFAULT_GEMINI_MODEL);
  }
  if (config.provider === 'gemma-web') {
    return new GemmaWebService(
      config.gemmaWebTextModelPath || DEFAULT_GEMMA_WEB_TEXT_MODEL_PATH,
      config.gemmaWebVisionModelPath || DEFAULT_GEMMA_WEB_VISION_MODEL_PATH,
      config.gemmaWebWasmRoot || DEFAULT_GEMMA_WEB_WASM_ROOT,
    );
  }
  const baseUrl = config.ollamaUrl || 'http://localhost:11434';
  const textModel = config.ollamaTextModel || DEFAULT_TEXT_MODEL;
  const visionModel = config.ollamaVisionModel || DEFAULT_VISION_MODEL;
  return new OllamaService(textModel, visionModel, baseUrl);
}

// --- Ollama Management API ---

export interface OllamaModelInfo {
  name: string;
  size: number;
  modified_at: string;
}

export async function fetchOllamaModels(baseUrl = 'http://localhost:11434'): Promise<OllamaModelInfo[]> {
  try {
    const res = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.models ?? []).map((m: { name: string; size: number; modified_at: string }) => ({
      name: m.name,
      size: m.size,
      modified_at: m.modified_at,
    }));
  } catch {
    return [];
  }
}

export async function pingOllama(baseUrl = 'http://localhost:11434'): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function pullOllamaModel(
  modelName: string,
  onProgress: (status: string, percent: number | null) => void,
  baseUrl = 'http://localhost:11434',
): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: modelName, stream: true }),
    });

    if (!res.ok || !res.body) {
      onProgress('Failed to start download', null);
      return false;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const data = JSON.parse(line);
          if (data.error) {
            onProgress(`Error: ${data.error}`, null);
            return false;
          }
          const percent = data.total ? Math.round((data.completed / data.total) * 100) : null;
          onProgress(data.status ?? 'Downloading...', percent);
        } catch { /* skip malformed lines */ }
      }
    }

    onProgress('Complete', 100);
    return true;
  } catch {
    onProgress('Connection failed', null);
    return false;
  }
}
