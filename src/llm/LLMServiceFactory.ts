import type { StudyMetadata } from '../dicom/types';
import type { AnalysisDepth, SelectionPlan, SeriesSelection, ChatMessage, ProviderConfig, LLMService, ViewportContext } from './types';
import {
  buildSelectionSystemPrompt,
  buildSelectionUserPrompt,
  buildAnalysisSystemPrompt,
  buildAnalysisUserPrompt,
  buildFollowUpSystemPrompt,
} from './PromptBuilder';
import {
  DEFAULT_GEMMA_TRANSFORMERS_ANALYSIS_TOKENS,
  DEFAULT_GEMMA_TRANSFORMERS_BATCH_ANALYSIS_TOKENS,
  DEFAULT_GEMMA_TRANSFORMERS_BATCH_SIZE,
  DEFAULT_GEMMA_TRANSFORMERS_DTYPE,
  DEFAULT_GEMMA_TRANSFORMERS_IMAGE_TOKEN_BUDGET,
  DEFAULT_GEMMA_TRANSFORMERS_MAX_IMAGES,
  DEFAULT_GEMMA_TRANSFORMERS_MODEL_ID,
  DEFAULT_GEMMA_TRANSFORMERS_PLANNING_TOKENS,
} from './gemmaTransformersConfig';
import {
  generateGemmaTransformersResponse,
  type GemmaTransformersMessage,
} from './GemmaTransformersRuntime';
import {
  DEFAULT_OLLAMA_URL,
  getOllamaUrlProblem,
  normalizeOllamaBaseUrl,
} from './ollamaConfig';
import { debugLog } from '../utils/logger';

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
    debugLog('error', 'Dr.MRI.AI', 'Selection plan JSON parse failed. Raw LLM response follows.', {
      rawResponse: raw,
      rawPreview: raw.slice(0, 4000),
    });
    throw new Error(
      'The LLM did not return valid JSON. This can happen with smaller models. ' +
      'The raw response was logged to the browser console under [Dr.MRI.AI]. ' +
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

type ChatCompletionContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

interface ChatCompletionMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ChatCompletionContentPart[];
}

interface AnalyzeOptions {
  batchSize?: number;
  analysisDepth?: AnalysisDepth;
}

function buildProviderBatchPrompt(
  metadata: StudyMetadata,
  clinicalHint: string,
  sliceLabels: string[],
  batchIndex: number,
  totalBatches: number,
  surveyMode?: boolean,
): string {
  const manifest = sliceLabels.map((label, index) => `${index + 1}. ${label}`).join('\n');
  return [
    `Batch ${batchIndex + 1}/${totalBatches}. Analyze only these ${sliceLabels.length} ${metadata.modality} images.`,
    'Educational research demo only, not clinical diagnosis.',
    `Clinical question: ${clinicalHint}`,
    `Images in this batch:\n${manifest}`,
    '',
    'Return concise batch notes:',
    '- Visible abnormal findings with exact slice labels.',
    '- Relevant normal/limited structures only when visible.',
    '- Any structures or regions that this batch cannot assess.',
    surveyMode ? '- For systematic survey, mention requested structures only if visible in this batch.' : '',
  ].filter(Boolean).join('\n');
}

function buildProviderSynthesisPrompt(
  metadata: StudyMetadata,
  clinicalHint: string,
  plan: SelectionPlan,
  sliceLabels: string[],
  batchSummaries: string[],
  surveyMode?: boolean,
  analysisDepth?: AnalysisDepth,
): string {
  const seriesSummary = plan.selections
    .map((selection) => `#${selection.seriesNumber} ${selection.role}: ${selection.rationale}`)
    .join('\n');
  const summaries = batchSummaries
    .map((summary, index) => `Batch ${index + 1}:\n${summary}`)
    .join('\n\n');
  const coverageLimit = analysisDepth === 'full'
    ? 'Full selected-series coverage was reviewed, but conclusions still depend on image quality and selected series.'
    : 'This is sampled selected-series coverage; extent assessment may be limited by omitted slices or series.';

  return [
    `Create one final ${metadata.modality} educational report from batch image-analysis notes.`,
    'Do not diagnose. State that this is not for clinical use.',
    `Study: ${metadata.studyDescription || 'unknown'}`,
    `Clinical question: ${clinicalHint}`,
    `Analysis depth: ${analysisDepth ?? 'standard'}`,
    `Selected series:\n${seriesSummary}`,
    `Reviewed slice labels:\n${sliceLabels.map((label, index) => `${index + 1}. ${label}`).join('\n')}`,
    '',
    `Batch summaries:\n${summaries}`,
    '',
    'Synthesis rules:',
    '- Cite only findings that appear in the batch summaries.',
    '- Do not invent findings from unreviewed slices or other series.',
    '- Cite exact slice labels when describing findings.',
    `- Include this coverage limitation: ${coverageLimit}`,
    surveyMode
      ? 'Format: Summary, Structure-by-structure assessment, Additional findings, Limitations.'
      : 'Format: Summary, Findings, Limitations.',
  ].filter(Boolean).join('\n');
}

async function buildImageContentParts(
  images: Blob[],
  sliceLabels: string[],
): Promise<ChatCompletionContentPart[]> {
  const imageContents = await Promise.all(
    images.map(async (blob, index) => [
      {
        type: 'text' as const,
        text: sliceLabels[index] ?? `Image ${index + 1}`,
      },
      {
        type: 'image_url' as const,
        image_url: {
          url: `data:image/jpeg;base64,${await blobToBase64(blob)}`,
        },
      },
    ]),
  );
  return imageContents.flat();
}

export interface OpenAiCompatibleModelInfo {
  id: string;
  name: string;
  object?: string;
  created?: number;
  owned_by?: string;
  capabilities: Array<'text' | 'vision'>;
}

function normalizeOpenAiCompatibleModelId(model: unknown): string | null {
  if (typeof model === 'string') return model;
  if (!model || typeof model !== 'object') return null;
  const candidate = model as { id?: unknown; name?: unknown; model?: unknown };
  if (typeof candidate.id === 'string') return candidate.id;
  if (typeof candidate.name === 'string') return candidate.name;
  if (typeof candidate.model === 'string') return candidate.model;
  return null;
}

export function normalizeOpenAiCompatibleBaseUrl(baseUrl?: string): string {
  const trimmed = (baseUrl ?? '').trim();
  if (!trimmed) return '';

  if (trimmed.startsWith('/')) {
    return trimmed
      .replace(/\/+$/, '')
      .replace(/\/chat\/completions$/i, '')
      .replace(/\/models$/i, '');
  }

  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return withScheme
    .replace(/\/+$/, '')
    .replace(/\/chat\/completions$/i, '')
    .replace(/\/models$/i, '');
}

function buildOpenAiCompatibleUrl(baseUrl: string, path: string): string {
  const normalized = normalizeOpenAiCompatibleBaseUrl(baseUrl);
  return `${normalized}/${path.replace(/^\/+/, '')}`;
}

export function inferOpenAiCompatibleModelCapabilities(modelName: string): Array<'text' | 'vision'> {
  const lower = modelName.toLowerCase();
  if (/(^|[-_:/.])(embed|embedding|rerank|whisper|tts|speech|moderation)([-_:/.]|$)/i.test(lower)) {
    return [];
  }

  const capabilities: Array<'text' | 'vision'> = ['text'];
  const visionPattern =
    /(vision|multimodal|multi-modal|llava|bakllava|pixtral|internvl|mllama|qwen[-_.]?(2|2\.5)?[-_.]?vl|qwen[-_.]?vl|gpt-4o|gpt-4\.1|gpt-5|o3|o4|claude-3|claude-sonnet-4|gemini|gemma[-_.]?4|gemma4|medgemma|llama[-_.]?3\.2[-_.]?vision|minicpm[-_.]?v)/i;
  if (visionPattern.test(lower)) {
    capabilities.push('vision');
  }
  return capabilities;
}

function extractOpenAiCompatibleModelCapabilities(
  modelName: string,
  source: Record<string, unknown>,
): Array<'text' | 'vision'> {
  const capabilities = new Set<'text' | 'vision'>(inferOpenAiCompatibleModelCapabilities(modelName));
  const capabilityFields = [
    source.capabilities,
    source.modalities,
    source.input_modalities,
    source.supported_modalities,
    source.type,
    source.model_type,
  ];
  const explicitText = capabilityFields
    .flatMap((value) => Array.isArray(value) ? value : [value])
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .toLowerCase();

  if (/\b(text|chat|llm|completion|completions)\b/.test(explicitText)) {
    capabilities.add('text');
  }
  if (/\b(image|images|vision|visual|multimodal|multi-modal|vl)\b/.test(explicitText)) {
    capabilities.add('text');
    capabilities.add('vision');
  }
  if (/\b(embed|embedding|rerank|moderation|audio|speech|tts|whisper)\b/.test(explicitText)) {
    capabilities.delete('vision');
    capabilities.delete('text');
  }

  return Array.from(capabilities);
}

function normalizeOpenAiCompatibleModel(raw: unknown): OpenAiCompatibleModelInfo | null {
  const id = normalizeOpenAiCompatibleModelId(raw);
  if (!id) return null;
  const source = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const capabilities = extractOpenAiCompatibleModelCapabilities(id, source);
  return {
    id,
    name: id,
    object: typeof source.object === 'string' ? source.object : undefined,
    created: typeof source.created === 'number' ? source.created : undefined,
    owned_by: typeof source.owned_by === 'string' ? source.owned_by : undefined,
    capabilities,
  };
}

function extractOpenAiCompatibleError(body: string): string {
  try {
    const parsed = JSON.parse(body) as {
      error?: { message?: unknown; type?: unknown; code?: unknown } | string;
      message?: unknown;
    };
    if (typeof parsed.error === 'string') return parsed.error;
    if (parsed.error && typeof parsed.error === 'object') {
      const message = typeof parsed.error.message === 'string' ? parsed.error.message : '';
      const code = typeof parsed.error.code === 'string' ? ` (${parsed.error.code})` : '';
      if (message) return `${message}${code}`;
    }
    if (typeof parsed.message === 'string') return parsed.message;
  } catch { /* plain text body */ }
  return body;
}

function formatOpenAiCompatibleHttpError(status: number, body: string, model: string, hadImages: boolean): string {
  const error = extractOpenAiCompatibleError(body);
  if (status === 401 || status === 403) {
    return 'OpenAI-compatible endpoint rejected the API key. Check the endpoint and key in Settings.';
  }
  if (status === 404) {
    return `OpenAI-compatible endpoint or model "${model}" was not found. Check the /v1 base URL and selected model.`;
  }
  if (hadImages && /image|vision|multimodal|content type|unsupported/i.test(error)) {
    return `OpenAI-compatible model "${model}" did not accept image input. Choose a vision-capable model for Call 2.`;
  }
  return `OpenAI-compatible API error (${status}) from "${model}": ${error}`;
}

function formatOpenAiCompatibleNetworkError(baseUrl: string): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : 'this app origin';
  return (
    `Cannot connect to OpenAI-compatible endpoint at ${baseUrl}. ` +
    'If this endpoint works with curl but fails in the browser, it is probably missing CORS headers. ' +
    `Allow Origin ${origin}, methods GET/POST/OPTIONS, and headers Authorization, Content-Type; ` +
    'or use a CORS-enabled proxy such as the local npm run openai-proxy helper.'
  );
}

export async function fetchOpenAiCompatibleModels(
  baseUrl: string,
  apiKey: string,
): Promise<OpenAiCompatibleModelInfo[]> {
  const normalizedBaseUrl = normalizeOpenAiCompatibleBaseUrl(baseUrl);
  const token = apiKey.trim();
  if (!normalizedBaseUrl) return [];

  let res: Response;
  try {
    res = await fetch(buildOpenAiCompatibleUrl(normalizedBaseUrl, '/models'), {
      headers: {
        Accept: 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Error(formatOpenAiCompatibleNetworkError(normalizedBaseUrl));
  }

  if (!res.ok) {
    const body = await res.text();
    throw new Error(formatOpenAiCompatibleHttpError(res.status, body, 'models', false));
  }

  const data = await res.json() as { data?: unknown; models?: unknown };
  const rawModels = Array.isArray(data.data)
    ? data.data
    : Array.isArray(data.models)
      ? data.models
      : [];

  return rawModels
    .map(normalizeOpenAiCompatibleModel)
    .filter((model): model is OpenAiCompatibleModelInfo => Boolean(model))
    .sort((a, b) => a.name.localeCompare(b.name));
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
    options?: AnalyzeOptions,
  ): Promise<string> {
    const batchSize = Math.max(1, Math.round(options?.batchSize ?? images.length));
    if (images.length > batchSize) {
      return this.analyzeSlicesInBatches(images, metadata, clinicalHint, plan, sliceLabels, surveyMode, {
        batchSize,
        analysisDepth: options?.analysisDepth,
      });
    }

    const content = [
      {
        type: 'text' as const,
        text: `${buildAnalysisUserPrompt(metadata, clinicalHint, plan, sliceLabels)}\n\nThe ordered images follow after their labels.`,
      },
      ...(await buildImageContentParts(images, sliceLabels)),
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

  private async analyzeSlicesInBatches(
    images: Blob[],
    metadata: StudyMetadata,
    clinicalHint: string,
    plan: SelectionPlan,
    sliceLabels: string[],
    surveyMode: boolean | undefined,
    options: Required<Pick<AnalyzeOptions, 'batchSize'>> & Pick<AnalyzeOptions, 'analysisDepth'>,
  ): Promise<string> {
    const imageBatches = chunkItems(images, options.batchSize);
    const labelBatches = chunkItems(sliceLabels, options.batchSize);
    const batchSummaries: string[] = [];

    for (let batchIndex = 0; batchIndex < imageBatches.length; batchIndex += 1) {
      const batchLabels = labelBatches[batchIndex];
      const content = [
        {
          type: 'text' as const,
          text: buildProviderBatchPrompt(
            metadata,
            clinicalHint,
            batchLabels,
            batchIndex,
            imageBatches.length,
            surveyMode,
          ),
        },
        ...(await buildImageContentParts(imageBatches[batchIndex], batchLabels)),
      ];
      batchSummaries.push(await this.callGemini({
        messages: [
          { role: 'system', content: buildAnalysisSystemPrompt(surveyMode) },
          { role: 'user', content },
        ],
        temperature: 0,
        maxTokens: 2048,
      }));
    }

    return this.callGemini({
      messages: [
        { role: 'system', content: 'Synthesize batch image notes into one educational report. Cite only batch-supported findings.' },
        {
          role: 'user',
          content: buildProviderSynthesisPrompt(
            metadata,
            clinicalHint,
            plan,
            sliceLabels,
            batchSummaries,
            surveyMode,
            options.analysisDepth,
          ),
        },
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

// --- OpenAI-Compatible Service ---

class OpenAiCompatibleService implements LLMService {
  private baseUrl: string;
  private apiKey: string;
  private textModel: string;
  private visionModel: string;

  constructor(baseUrl?: string, apiKey?: string, textModel?: string, visionModel?: string) {
    this.baseUrl = normalizeOpenAiCompatibleBaseUrl(baseUrl);
    this.apiKey = apiKey?.trim() ?? '';
    this.textModel = textModel?.trim() ?? '';
    this.visionModel = visionModel?.trim() || this.textModel;

    if (!this.baseUrl) {
      throw new Error('OpenAI-compatible endpoint URL is required. Enter the /v1 base URL in Settings.');
    }
    if (!this.apiKey) {
      throw new Error('OpenAI-compatible API key is required. Enter it in Settings.');
    }
    if (!this.textModel) {
      throw new Error('Choose a text model for the OpenAI-compatible provider in Settings.');
    }
  }

  async getSelectionPlan(metadata: StudyMetadata, clinicalHint: string, viewportContext?: ViewportContext): Promise<SelectionPlan> {
    const response = await this.callChat({
      model: this.textModel,
      messages: [
        { role: 'system', content: buildSelectionSystemPrompt() },
        { role: 'user', content: buildSelectionUserPrompt(metadata, clinicalHint, viewportContext) },
      ],
      temperature: 0,
      maxTokens: 1024,
      hadImages: false,
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
    options?: AnalyzeOptions,
  ): Promise<string> {
    if (!this.visionModel) {
      throw new Error('Choose a vision model for the OpenAI-compatible provider in Settings.');
    }

    const batchSize = Math.max(1, Math.round(options?.batchSize ?? images.length));
    if (images.length > batchSize) {
      return this.analyzeSlicesInBatches(images, metadata, clinicalHint, plan, sliceLabels, surveyMode, {
        batchSize,
        analysisDepth: options?.analysisDepth,
      });
    }

    const content: ChatCompletionContentPart[] = [
      {
        type: 'text',
        text: `${buildAnalysisUserPrompt(metadata, clinicalHint, plan, sliceLabels)}\n\nThe ordered images follow after their labels.`,
      },
      ...(await buildImageContentParts(images, sliceLabels)),
    ];

    return this.callChat({
      model: this.visionModel,
      messages: [
        { role: 'system', content: buildAnalysisSystemPrompt(surveyMode) },
        { role: 'user', content },
      ],
      temperature: 0,
      maxTokens: 4096,
      hadImages: images.length > 0,
    });
  }

  private async analyzeSlicesInBatches(
    images: Blob[],
    metadata: StudyMetadata,
    clinicalHint: string,
    plan: SelectionPlan,
    sliceLabels: string[],
    surveyMode: boolean | undefined,
    options: Required<Pick<AnalyzeOptions, 'batchSize'>> & Pick<AnalyzeOptions, 'analysisDepth'>,
  ): Promise<string> {
    const imageBatches = chunkItems(images, options.batchSize);
    const labelBatches = chunkItems(sliceLabels, options.batchSize);
    const batchSummaries: string[] = [];

    for (let batchIndex = 0; batchIndex < imageBatches.length; batchIndex += 1) {
      const batchLabels = labelBatches[batchIndex];
      const content: ChatCompletionContentPart[] = [
        {
          type: 'text',
          text: buildProviderBatchPrompt(
            metadata,
            clinicalHint,
            batchLabels,
            batchIndex,
            imageBatches.length,
            surveyMode,
          ),
        },
        ...(await buildImageContentParts(imageBatches[batchIndex], batchLabels)),
      ];

      batchSummaries.push(await this.callChat({
        model: this.visionModel,
        messages: [
          { role: 'system', content: buildAnalysisSystemPrompt(surveyMode) },
          { role: 'user', content },
        ],
        temperature: 0,
        maxTokens: 2048,
        hadImages: true,
      }));
    }

    return this.callChat({
      model: this.textModel,
      messages: [
        { role: 'system', content: 'Synthesize batch image notes into one educational report. Cite only batch-supported findings.' },
        {
          role: 'user',
          content: buildProviderSynthesisPrompt(
            metadata,
            clinicalHint,
            plan,
            sliceLabels,
            batchSummaries,
            surveyMode,
            options.analysisDepth,
          ),
        },
      ],
      temperature: 0,
      maxTokens: 4096,
      hadImages: false,
    });
  }

  async sendFollowUp(conversationHistory: ChatMessage[], metadata: StudyMetadata): Promise<string> {
    const messages: ChatCompletionMessage[] = conversationHistory.map((msg) => ({
      role: msg.role as 'user' | 'assistant',
      content: msg.content,
    }));

    return this.callChat({
      model: this.textModel,
      messages: [
        { role: 'system', content: buildFollowUpSystemPrompt() + '\n\nStudy context: ' + metadata.studyDescription },
        ...messages,
      ],
      temperature: 0,
      maxTokens: 4096,
      hadImages: false,
    });
  }

  private async callChat(params: {
    model: string;
    messages: ChatCompletionMessage[];
    temperature: number;
    maxTokens: number;
    hadImages: boolean;
  }): Promise<string> {
    let res: Response;
    try {
      debugLog('info', 'OpenAICompatible', 'Sending chat completions request', {
        baseUrl: this.baseUrl,
        model: params.model,
        hasImages: params.hadImages,
      });
      res = await fetch(buildOpenAiCompatibleUrl(this.baseUrl, '/chat/completions'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: params.model,
          messages: params.messages,
          max_tokens: params.maxTokens,
          temperature: params.temperature,
          stream: false,
        }),
        signal: AbortSignal.timeout(300_000),
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'TimeoutError') {
        throw new Error(`OpenAI-compatible request timed out (5min). Model: ${params.model}. Try fewer slices or a smaller model.`);
      }
      throw new Error(formatOpenAiCompatibleNetworkError(this.baseUrl));
    }

    if (!res.ok) {
      const body = await res.text();
      const message = formatOpenAiCompatibleHttpError(res.status, body, params.model, params.hadImages);
      debugLog('error', 'OpenAICompatible', message, {
        status: res.status,
        model: params.model,
        hasImages: params.hadImages,
        body,
      });
      throw new Error(message);
    }

    const data = await res.json();
    const text = extractChatCompletionText(data);
    if (!text) {
      throw new Error(`OpenAI-compatible endpoint returned no assistant text for model "${params.model}".`);
    }
    return text;
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
    this.baseUrl = normalizeOllamaBaseUrl(baseUrl);
    const problem = getOllamaUrlProblem(this.baseUrl);
    if (problem) throw new Error(problem);
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
    options?: AnalyzeOptions,
  ): Promise<string> {
    await ensureOllamaImageModel(this.baseUrl, this.visionModel);
    const batchSize = Math.max(1, Math.round(options?.batchSize ?? images.length));
    if (images.length > batchSize) {
      return this.analyzeSlicesInBatches(images, metadata, clinicalHint, plan, sliceLabels, surveyMode, {
        batchSize,
        analysisDepth: options?.analysisDepth,
      });
    }

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

  private async analyzeSlicesInBatches(
    images: Blob[],
    metadata: StudyMetadata,
    clinicalHint: string,
    plan: SelectionPlan,
    sliceLabels: string[],
    surveyMode: boolean | undefined,
    options: Required<Pick<AnalyzeOptions, 'batchSize'>> & Pick<AnalyzeOptions, 'analysisDepth'>,
  ): Promise<string> {
    const imageBatches = chunkItems(images, options.batchSize);
    const labelBatches = chunkItems(sliceLabels, options.batchSize);
    const batchSummaries: string[] = [];

    for (let batchIndex = 0; batchIndex < imageBatches.length; batchIndex += 1) {
      const batchImages = imageBatches[batchIndex];
      const batchLabels = labelBatches[batchIndex];
      const base64Images = await Promise.all(batchImages.map(blobToBase64));
      const userContent =
        `IMAGE BATCH ${batchIndex + 1}/${imageBatches.length}. The images are provided in the exact order listed.\n\n` +
        buildProviderBatchPrompt(
          metadata,
          clinicalHint,
          batchLabels,
          batchIndex,
          imageBatches.length,
          surveyMode,
        );

      batchSummaries.push(await this.callOllama({
        model: this.visionModel,
        system: buildAnalysisSystemPrompt(surveyMode),
        userContent,
        images: base64Images,
      }));
    }

    return this.callOllama({
      model: this.textModel,
      system: 'Synthesize batch image notes into one educational report. Cite only batch-supported findings.',
      userContent: buildProviderSynthesisPrompt(
        metadata,
        clinicalHint,
        plan,
        sliceLabels,
        batchSummaries,
        surveyMode,
        options.analysisDepth,
      ),
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

    const problem = getOllamaUrlProblem(this.baseUrl);
    if (problem) throw new Error(problem);

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
      const message = formatOllamaHttpError(res.status, body, this.textModel, false);
      debugLog('error', 'Ollama', message, {
        status: res.status,
        model: this.textModel,
        body,
      });
      throw new Error(message);
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
      debugLog('info', 'Ollama', 'Sending chat request', {
        model: params.model,
        hasImages: !!params.images?.length,
        imageCount: params.images?.length ?? 0,
      });
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
      throw new Error(`Cannot connect to Ollama at ${this.baseUrl}. Is it running? (ollama serve)`);
    }

    if (!res.ok) {
      const body = await res.text();
      const message = formatOllamaHttpError(res.status, body, params.model, !!params.images?.length);
      debugLog('error', 'Ollama', message, {
        status: res.status,
        model: params.model,
        hasImages: !!params.images?.length,
        body,
      });
      throw new Error(message);
    }

    const data = await res.json();
    return data.message?.content ?? '';
  }
}

// --- Gemma 4 Transformers.js Service ---

function buildGemmaSeriesLine(series: StudyMetadata['series'][number]): string {
  const parts = [
    `#${series.seriesNumber}`,
    `"${series.seriesDescription || 'no description'}"`,
    series.anatomicalPlane,
    `${series.slices.length} slices`,
    `inst ${series.instanceNumberRange[0]}-${series.instanceNumberRange[1]}`,
  ];
  if (series.estimatedWeighting) parts.push(series.estimatedWeighting);
  if (series.sliceThickness != null) parts.push(`${series.sliceThickness}mm`);
  if (series.windowCenter != null && series.windowWidth != null) {
    parts.push(`W:${Math.round(series.windowWidth)} C:${Math.round(series.windowCenter)}`);
  }
  return parts.join(' | ');
}

function buildGemmaTransformersSelectionPrompt(
  metadata: StudyMetadata,
  clinicalHint: string,
  viewportContext: ViewportContext | undefined,
  maxImages: number,
): string {
  const seriesLines = metadata.series.map(buildGemmaSeriesLine).join('\n');
  const viewportLine = viewportContext
    ? `Current viewport: series #${viewportContext.seriesNumber}, instance ${viewportContext.currentInstanceNumber}/${viewportContext.totalSlicesInSeries}.`
    : '';

  return [
    `Study: ${metadata.studyDescription || 'unknown'} | ${metadata.modality}`,
    metadata.bodyPartExamined ? `Body part hint: ${metadata.bodyPartExamined}` : '',
    viewportLine,
    '',
    `Available series:\n${seriesLines}`,
    '',
    `Clinical question: ${clinicalHint}`,
    '',
    'Rules:',
    '- Choose diagnostic series only. Never choose localizer/scout/Loc series.',
    '- For knee MRI, prefer sagittal PD fat-sat for ACL/menisci/cartilage and add coronal/sagittal T2 only if useful.',
    `- Total selected images must be <= ${maxImages}.`,
    '- Use samplingStrategy "uniform" unless selecting every slice in a tiny range.',
    '- For MR use W:800 C:400 unless a better preset is provided. For CT soft tissue use W:400 C:40.',
    '',
    'Return exactly this JSON shape:',
    `{"reasoning":"short reason","selections":[{"seriesNumber":"3","role":"primary","rationale":"short reason","sliceRange":[10,18],"samplingStrategy":"uniform","samplingParam":${Math.min(8, maxImages)},"windowCenter":400,"windowWidth":800}],"totalImages":${Math.min(8, maxImages)}}`,
  ].filter(Boolean).join('\n');
}

function buildGemmaTransformersBatchPrompt(
  metadata: StudyMetadata,
  clinicalHint: string,
  sliceLabels: string[],
  batchIndex: number,
  totalBatches: number,
  surveyMode?: boolean,
): string {
  const manifest = sliceLabels.map((label, index) => `${index + 1}. ${label}`).join('\n');
  return [
    `Batch ${batchIndex + 1}/${totalBatches}. Analyze only these ${sliceLabels.length} ${metadata.modality} images.`,
    'Educational research demo only, not clinical diagnosis.',
    `Question: ${clinicalHint}`,
    `Images:\n${manifest}`,
    '',
    'Return concise notes:',
    '- Visible abnormal findings with exact slice labels.',
    '- Relevant normal/limited structures only when visible.',
    '- Limitations for this batch.',
    surveyMode ? '- For systematic survey, mention requested structures only if visible in this batch.' : '',
  ].filter(Boolean).join('\n');
}

function buildGemmaTransformersSynthesisPrompt(
  metadata: StudyMetadata,
  clinicalHint: string,
  plan: SelectionPlan,
  sliceLabels: string[],
  batchSummaries: string[],
  surveyMode?: boolean,
): string {
  const seriesSummary = plan.selections
    .map((selection) => `#${selection.seriesNumber} ${selection.role}: ${selection.rationale}`)
    .join('\n');
  const summaries = batchSummaries
    .map((summary, index) => `Batch ${index + 1}:\n${summary}`)
    .join('\n\n');
  return [
    `Create one final ${metadata.modality} report from browser-local Gemma batch summaries.`,
    'Educational research demo only. Not for clinical diagnosis.',
    `Study: ${metadata.studyDescription || 'unknown'}`,
    `Clinical question: ${clinicalHint}`,
    `Selected series:\n${seriesSummary}`,
    `Reviewed sampled slices:\n${sliceLabels.map((label, index) => `${index + 1}. ${label}`).join('\n')}`,
    '',
    `Batch findings:\n${summaries}`,
    '',
    'Final report rules:',
    '- Do not invent findings beyond the batch summaries.',
    '- Cite exact slice labels when describing findings.',
    '- Clearly state when structures are not adequately visualized.',
    '- State that this is sampled-image analysis with limited extent assessment.',
    surveyMode
      ? 'Format: Summary, Structure-by-structure assessment, Additional findings, Limitations.'
      : 'Format: Summary, Findings, Limitations.',
  ].filter(Boolean).join('\n');
}

function chunkItems<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function isGemmaTensorLimitError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /tensor limit|tensor shape is too large|OrtRun|OutputMLValue|shape is too large/i.test(message);
}

class GemmaTransformersService implements LLMService {
  private modelId: string;
  private dtype: string;
  private maxImages: number;
  private batchSize: number;
  private imageTokenBudget: number;

  constructor(modelId?: string, dtype?: string, maxImages?: number, imageTokenBudget?: number) {
    this.modelId = modelId?.trim() || DEFAULT_GEMMA_TRANSFORMERS_MODEL_ID;
    this.dtype = dtype?.trim() || DEFAULT_GEMMA_TRANSFORMERS_DTYPE;
    this.maxImages = Math.max(1, Math.min(DEFAULT_GEMMA_TRANSFORMERS_MAX_IMAGES, Math.round(maxImages ?? DEFAULT_GEMMA_TRANSFORMERS_MAX_IMAGES)));
    this.batchSize = Math.max(1, Math.min(DEFAULT_GEMMA_TRANSFORMERS_BATCH_SIZE, this.maxImages));
    this.imageTokenBudget = Math.max(70, Math.min(280, Math.round(imageTokenBudget ?? DEFAULT_GEMMA_TRANSFORMERS_IMAGE_TOKEN_BUDGET)));
  }

  async getSelectionPlan(metadata: StudyMetadata, clinicalHint: string, viewportContext?: ViewportContext): Promise<SelectionPlan> {
    const messages: GemmaTransformersMessage[] = [
      {
        role: 'system',
        content: 'Select DICOM slices for a research demo. Return valid JSON only. No markdown. No prose outside JSON.',
      },
      {
        role: 'user',
        content: buildGemmaTransformersSelectionPrompt(metadata, clinicalHint, viewportContext, this.maxImages),
      },
    ];

    const response = await generateGemmaTransformersResponse({
      modelId: this.modelId,
      dtype: this.dtype,
      imageTokenBudget: this.imageTokenBudget,
      messages,
      maxNewTokens: DEFAULT_GEMMA_TRANSFORMERS_PLANNING_TOKENS,
    });
    debugLog('info', 'GemmaTransformers', 'Call 1 raw selection response', {
      rawResponse: response,
      rawPreview: response.slice(0, 4000),
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
    options?: AnalyzeOptions,
  ): Promise<string> {
    const limitedImages = images.slice(0, this.maxImages);
    const limitedLabels = sliceLabels.slice(0, limitedImages.length);
    const batchSize = Math.max(1, Math.min(
      limitedImages.length || this.batchSize,
      Math.round(options?.batchSize ?? this.batchSize),
    ));
    const imageBatches = chunkItems(limitedImages, batchSize);
    const labelBatches = chunkItems(limitedLabels, batchSize);

    debugLog('info', 'GemmaTransformers', 'Starting chunked browser image analysis', {
      totalImages: limitedImages.length,
      exportedImages: images.length,
      batchSize,
      batchCount: imageBatches.length,
      imageTokenBudget: this.imageTokenBudget,
    });

    const batchSummaries: string[] = [];
    for (let batchIndex = 0; batchIndex < imageBatches.length; batchIndex += 1) {
      const batchImages = imageBatches[batchIndex];
      const batchLabels = labelBatches[batchIndex];
      batchSummaries.push(await this.analyzeImageBatch(
        batchImages,
        metadata,
        clinicalHint,
        batchLabels,
        batchIndex,
        imageBatches.length,
        surveyMode,
      ));
    }

    const synthesisMessages: GemmaTransformersMessage[] = [
      {
        role: 'system',
        content:
          'Synthesize medical image batch notes into one educational report. Do not invent findings.',
      },
      {
        role: 'user',
        content: buildGemmaTransformersSynthesisPrompt(
          metadata,
          clinicalHint,
          plan,
          limitedLabels,
          batchSummaries,
          surveyMode,
        ),
      },
    ];

    return generateGemmaTransformersResponse({
      modelId: this.modelId,
      dtype: this.dtype,
      imageTokenBudget: this.imageTokenBudget,
      messages: synthesisMessages,
      maxNewTokens: DEFAULT_GEMMA_TRANSFORMERS_ANALYSIS_TOKENS,
    });
  }

  private async analyzeImageBatch(
    images: Blob[],
    metadata: StudyMetadata,
    clinicalHint: string,
    sliceLabels: string[],
    batchIndex: number,
    totalBatches: number,
    surveyMode?: boolean,
  ): Promise<string> {
    debugLog('info', 'GemmaTransformers', `Analyzing image batch ${batchIndex + 1}/${totalBatches}`, {
      imageCount: images.length,
      sliceLabels,
    });

    const messages: GemmaTransformersMessage[] = [
      {
        role: 'system',
        content:
          'Analyze a small batch of medical images for an educational research demo. ' +
          'Only describe visible findings and cite slice labels.',
      },
      {
        role: 'user',
        content: [
          ...images.map(() => ({ type: 'image' as const })),
          {
            type: 'text',
            text: buildGemmaTransformersBatchPrompt(
              metadata,
              clinicalHint,
              sliceLabels,
              batchIndex,
              totalBatches,
              surveyMode,
            ),
          },
        ],
      },
    ];

    try {
      return await generateGemmaTransformersResponse({
        modelId: this.modelId,
        dtype: this.dtype,
        imageTokenBudget: this.imageTokenBudget,
        messages,
        images,
        maxNewTokens: DEFAULT_GEMMA_TRANSFORMERS_BATCH_ANALYSIS_TOKENS,
      });
    } catch (error) {
      if (!isGemmaTensorLimitError(error) || images.length <= 1) {
        throw error;
      }

      debugLog('warn', 'GemmaTransformers', 'Batch exceeded tensor limits; retrying as single-image batches', {
        batchIndex: batchIndex + 1,
        imageCount: images.length,
      });

      const summaries: string[] = [];
      for (let imageIndex = 0; imageIndex < images.length; imageIndex += 1) {
        summaries.push(await this.analyzeImageBatch(
          [images[imageIndex]],
          metadata,
          clinicalHint,
          [sliceLabels[imageIndex]],
          imageIndex,
          images.length,
          surveyMode,
        ));
      }
      return summaries.join('\n\n');
    }
  }

  async sendFollowUp(conversationHistory: ChatMessage[], metadata: StudyMetadata): Promise<string> {
    const messages: GemmaTransformersMessage[] = [
      {
        role: 'system',
        content: buildFollowUpSystemPrompt() + '\n\nStudy context: ' + metadata.studyDescription,
      },
      ...conversationHistory.map((msg) => ({
        role: msg.role,
        content: msg.content,
      })),
    ];

    return generateGemmaTransformersResponse({
      modelId: this.modelId,
      dtype: this.dtype,
      imageTokenBudget: this.imageTokenBudget,
      messages,
      maxNewTokens: DEFAULT_GEMMA_TRANSFORMERS_ANALYSIS_TOKENS,
    });
  }
}

// --- Factory ---

const DEFAULT_TEXT_MODEL = 'alibayram/medgemma:4b';
const DEFAULT_VISION_MODEL = 'gemma4:latest';
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
  if (config.provider === 'openai-compatible') {
    return new OpenAiCompatibleService(
      config.openAiCompatibleBaseUrl,
      config.openAiCompatibleApiKey,
      config.openAiCompatibleTextModel,
      config.openAiCompatibleVisionModel,
    );
  }
  if (config.provider === 'gemma-transformers') {
    return new GemmaTransformersService(
      config.gemmaTransformersModelId,
      config.gemmaTransformersDtype,
      config.gemmaTransformersMaxImages,
      config.gemmaTransformersImageTokenBudget,
    );
  }
  const baseUrl = normalizeOllamaBaseUrl(config.ollamaUrl);
  const textModel = config.ollamaTextModel || DEFAULT_TEXT_MODEL;
  const visionModel = config.ollamaVisionModel || DEFAULT_VISION_MODEL;
  return new OllamaService(textModel, visionModel, baseUrl);
}

// --- Ollama Management API ---

export interface OllamaModelInfo {
  name: string;
  size: number;
  modified_at: string;
  capabilities?: string[];
  family?: string;
  families?: string[];
}

interface OllamaShowInfo {
  error?: string;
  capabilities?: string[];
  details?: {
    family?: string;
    families?: string[];
  };
}

const ollamaShowCache = new Map<string, Promise<OllamaShowInfo>>();

function ollamaShowCacheKey(baseUrl: string, model: string): string {
  return `${baseUrl.replace(/\/+$/, '')}::${model}`;
}

async function fetchOllamaShowInfo(baseUrl: string, model: string, timeoutMs = 5000): Promise<OllamaShowInfo> {
  baseUrl = normalizeOllamaBaseUrl(baseUrl);
  const problem = getOllamaUrlProblem(baseUrl);
  if (problem) throw new Error(problem);

  const cacheKey = ollamaShowCacheKey(baseUrl, model);
  const cached = ollamaShowCache.get(cacheKey);
  if (cached) return cached;

  const promise = (async () => {
    const res = await fetch(`${baseUrl}/api/show`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const data = await res.json().catch(() => ({}));
    return data as OllamaShowInfo;
  })().catch((error) => {
    ollamaShowCache.delete(cacheKey);
    throw error;
  });

  ollamaShowCache.set(cacheKey, promise);
  return promise;
}

function extractOllamaError(body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: unknown };
    if (typeof parsed.error === 'string') return parsed.error;
  } catch { /* plain text body */ }
  return body;
}

function formatOllamaHttpError(status: number, body: string, model: string, hadImages: boolean): string {
  const error = extractOllamaError(body);
  if (status === 404 && /model .* not found/i.test(error)) {
    return `Ollama model "${model}" is not installed. Pull it in Settings or choose an installed model.`;
  }
  if (hadImages && /missing data required for image input|does not support images|image input/i.test(error)) {
    return `Ollama model "${model}" does not support images. Choose a vision-capable model such as "gemma4:latest", or pull "llava:7b" / "gemma3:4b".`;
  }
  return `Ollama error (${status}) from "${model}": ${error}`;
}

async function ensureOllamaImageModel(baseUrl: string, model: string): Promise<void> {
  let info: OllamaShowInfo;
  try {
    info = await fetchOllamaShowInfo(baseUrl, model);
  } catch {
    return;
  }

  if (info.error) {
    throw new Error(`Ollama model "${model}" is not installed. Pull it in Settings or choose an installed vision model.`);
  }

  if (Array.isArray(info.capabilities) && !info.capabilities.includes('vision')) {
    throw new Error(
      `Ollama model "${model}" is installed but does not support images. ` +
      'Use a vision-capable model such as "gemma4:latest", or pull "llava:7b" / "gemma3:4b".',
    );
  }
}

export async function fetchOllamaModels(baseUrl = DEFAULT_OLLAMA_URL): Promise<OllamaModelInfo[]> {
  baseUrl = normalizeOllamaBaseUrl(baseUrl);
  const problem = getOllamaUrlProblem(baseUrl);
  if (problem) {
    debugLog('warn', 'Ollama', problem, { baseUrl });
    return [];
  }

  try {
    const res = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return [];
    const data = await res.json();
    const models = (data.models ?? []) as Array<{ name: string; size: number; modified_at: string }>;
    return Promise.all(models.map(async (m) => {
      const info = await fetchOllamaShowInfo(baseUrl, m.name).catch(() => null);
      return {
        name: m.name,
        size: m.size,
        modified_at: m.modified_at,
        capabilities: info?.capabilities,
        family: info?.details?.family,
        families: info?.details?.families,
      };
    }));
  } catch {
    return [];
  }
}

export async function pingOllama(baseUrl = DEFAULT_OLLAMA_URL): Promise<boolean> {
  baseUrl = normalizeOllamaBaseUrl(baseUrl);
  const problem = getOllamaUrlProblem(baseUrl);
  if (problem) {
    debugLog('warn', 'Ollama', problem, { baseUrl });
    return false;
  }

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
  baseUrl = DEFAULT_OLLAMA_URL,
): Promise<boolean> {
  baseUrl = normalizeOllamaBaseUrl(baseUrl);
  const problem = getOllamaUrlProblem(baseUrl);
  if (problem) {
    onProgress(problem, null);
    return false;
  }

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
