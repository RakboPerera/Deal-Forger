import Anthropic from '@anthropic-ai/sdk';

// ---------------------------------------------------------------------------
// Model tiers
// ---------------------------------------------------------------------------
const MODELS = {
  anthropic: {
    // Use the latest aliases (no datestamps) so the IDs don't rot when
    // Anthropic publishes a new snapshot. Verified live against the API.
    light: 'claude-haiku-4-5',
    heavy: 'claude-sonnet-4-5',
  },
  // Placeholder — add mappings here when the OpenAI provider is implemented.
  // openai: { light: 'gpt-4o-mini', heavy: 'gpt-4o' },
};

// ---------------------------------------------------------------------------
// Runtime settings (in-memory, hot-swappable via API)
// ---------------------------------------------------------------------------
let settings = {
  provider: 'anthropic',
  anthropicKey: process.env.ANTHROPIC_API_KEY || '',
  openaiKey: process.env.OPENAI_API_KEY || '',
};

export function updateSettings(newSettings) {
  settings = { ...settings, ...newSettings };
}

export function getSettings() {
  // Return a shallow copy so callers cannot mutate internal state.
  return { ...settings };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const TRANSIENT_STATUS_CODES = new Set([429, 500, 503]);
const DEFAULT_TIMEOUT_MS = 90_000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Wrap a promise with an absolute timeout. */
function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`LLM call timed out after ${ms}ms`)), ms);
    promise.then(
      (val) => { clearTimeout(timer); resolve(val); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

/** Determine whether an error is transient and eligible for retry. */
function isTransient(err) {
  if (err && typeof err.status === 'number' && TRANSIENT_STATUS_CODES.has(err.status)) return true;
  if (err && typeof err.statusCode === 'number' && TRANSIENT_STATUS_CODES.has(err.statusCode)) return true;
  // Anthropic SDK may expose an `error` object with a status.
  if (err?.error?.type === 'overloaded_error') return true;
  return false;
}

// ---------------------------------------------------------------------------
// Core LLM call — Anthropic implementation
// ---------------------------------------------------------------------------
async function callAnthropic({ model, messages, system, tools, temperature, maxTokens }) {
  const client = new Anthropic({ apiKey: settings.anthropicKey });

  const params = {
    model,
    max_tokens: maxTokens,
    temperature,
    messages,
  };

  if (system) {
    params.system = system;
  }

  if (tools && tools.length > 0) {
    params.tools = tools;
  }

  const response = await client.messages.create(params);

  // Parse content blocks into a normalised shape.
  let textContent = '';
  const toolCalls = [];

  for (const block of response.content) {
    if (block.type === 'text') {
      textContent += block.text;
    } else if (block.type === 'tool_use') {
      toolCalls.push({
        id: block.id,
        name: block.name,
        input: block.input,
      });
    }
  }

  return {
    content: textContent,
    toolCalls,
    stopReason: response.stop_reason,
    usage: {
      inputTokens: response.usage?.input_tokens ?? 0,
      outputTokens: response.usage?.output_tokens ?? 0,
    },
  };
}

// ---------------------------------------------------------------------------
// Public: callLLM
// ---------------------------------------------------------------------------
/**
 * Call the configured LLM provider.
 *
 * @param {object}  opts
 * @param {'light'|'heavy'} opts.tier      - Model tier (default: 'light').
 * @param {Array}   opts.messages          - Conversation messages.
 * @param {string}  [opts.system]          - System prompt.
 * @param {Array}   [opts.tools]           - Tool definitions (Anthropic format).
 * @param {number}  [opts.temperature=0]   - Sampling temperature.
 * @param {number}  [opts.maxTokens=4096]  - Max output tokens.
 *
 * @returns {{ content: string, toolCalls: Array, usage: { inputTokens: number, outputTokens: number }, latencyMs: number }}
 */
export async function callLLM({
  tier = 'light',
  messages,
  system,
  tools,
  temperature = 0,
  maxTokens = 4096,
} = {}) {
  const provider = settings.provider;
  const modelMap = MODELS[provider];

  if (!modelMap) {
    throw new Error(`Unsupported LLM provider: ${provider}`);
  }

  const model = modelMap[tier];
  if (!model) {
    throw new Error(`Unknown tier "${tier}" for provider "${provider}"`);
  }

  // Dispatch to the correct provider implementation.
  let dispatchFn;
  if (provider === 'anthropic') {
    dispatchFn = () => callAnthropic({ model, messages, system, tools, temperature, maxTokens });
  } else {
    // Future providers go here.
    throw new Error(`Provider "${provider}" is not yet implemented`);
  }

  // Retry logic — one automatic retry on transient errors.
  const MAX_ATTEMPTS = 2;
  let lastError;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const start = Date.now();
    try {
      const result = await withTimeout(dispatchFn(), DEFAULT_TIMEOUT_MS);
      result.latencyMs = Date.now() - start;
      return result;
    } catch (err) {
      lastError = err;
      if (attempt < MAX_ATTEMPTS && isTransient(err)) {
        // Brief back-off before retry.
        await sleep(1000 * attempt);
        continue;
      }
      throw err;
    }
  }

  // Should never reach here, but just in case:
  throw lastError;
}

// ---------------------------------------------------------------------------
// Convenience wrappers
// ---------------------------------------------------------------------------

/**
 * Classify a document by type (e.g. financial statement, pitch deck, CIM).
 * Uses the *light* tier for speed.
 */
export async function classifyDocument(text, tables) {
  const system = `You are a financial document classifier. Given the text (and optionally extracted tables) of a document, determine its type. Respond with ONLY a JSON object: { "documentType": "<type>", "confidence": <0-1>, "reasoning": "<brief>" }. Valid types: annual_report, quarterly_report, pitch_deck, cim, investor_presentation, financial_model, term_sheet, loi, due_diligence, other.`;

  const userContent = tables && tables.length > 0
    ? `Document text:\n${text}\n\nExtracted tables:\n${JSON.stringify(tables)}`
    : `Document text:\n${text}`;

  const result = await callLLM({
    tier: 'light',
    temperature: 0,
    maxTokens: 512,
    system,
    messages: [{ role: 'user', content: userContent }],
  });

  try {
    return JSON.parse(result.content);
  } catch {
    return { documentType: 'other', confidence: 0, reasoning: result.content, raw: result };
  }
}

/**
 * Extract financial data points from document text / tables.
 * Uses the *heavy* tier for accuracy.
 */
export async function extractFinancials(text, tables, fields) {
  const fieldList = fields.map((f) => `- ${f}`).join('\n');

  const system = `You are a financial data extraction specialist. Extract the requested fields from the provided document content. Return ONLY a JSON object where each key is the requested field name and the value is the extracted value (number, string, or null if not found). Include a "_meta" key with { "fieldsFound": <count>, "fieldsTotal": <count>, "notes": "<any caveats>" }.`;

  const userContent = [
    'Extract the following fields:',
    fieldList,
    '',
    'Document text:',
    text,
    tables && tables.length > 0 ? `\nExtracted tables:\n${JSON.stringify(tables)}` : '',
  ].join('\n');

  const result = await callLLM({
    tier: 'heavy',
    temperature: 0,
    maxTokens: 4096,
    system,
    messages: [{ role: 'user', content: userContent }],
  });

  try {
    return JSON.parse(result.content);
  } catch {
    return { _meta: { fieldsFound: 0, fieldsTotal: fields.length, notes: 'Parse error' }, raw: result };
  }
}

/**
 * Classify a company's sector / industry given a profile and description.
 * Uses the *heavy* tier for nuanced reasoning.
 */
export async function classifySector(profile, businessDescription) {
  const system = `You are an industry classification expert using GICS (Global Industry Classification Standard). Given a company profile and business description, determine the appropriate Sector, Industry Group, Industry, and Sub-Industry. Respond with ONLY a JSON object: { "sector": "...", "industryGroup": "...", "industry": "...", "subIndustry": "...", "confidence": <0-1>, "reasoning": "<brief>" }.`;

  const userContent = [
    'Company profile:',
    JSON.stringify(profile, null, 2),
    '',
    'Business description:',
    businessDescription,
  ].join('\n');

  const result = await callLLM({
    tier: 'heavy',
    temperature: 0,
    maxTokens: 1024,
    system,
    messages: [{ role: 'user', content: userContent }],
  });

  try {
    return JSON.parse(result.content);
  } catch {
    return { sector: 'unknown', confidence: 0, reasoning: result.content, raw: result };
  }
}
