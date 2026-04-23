import { Router } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { auditLog } from '../database.js';
import { updateSettings as updateLlmSettings, getSettings as getLlmSettings } from '../agents/llm.js';

const router = Router();

// In-memory settings store (persists for server lifetime)
let llmSettings = {
  anthropicKey: process.env.ANTHROPIC_API_KEY || '',
  openaiKey: process.env.OPENAI_API_KEY || '',
  provider: 'anthropic',
  lightModel: 'claude-haiku-4-5-20251001',
  heavyModel: 'claude-sonnet-4-5-20251001'
};

// Hydrate the LLM module from ENV on startup so server-restart with an
// ANTHROPIC_API_KEY set keeps working immediately without a PUT roundtrip.
if (llmSettings.anthropicKey) {
  updateLlmSettings({
    provider: llmSettings.provider,
    anthropicKey: llmSettings.anthropicKey,
    openaiKey: llmSettings.openaiKey,
  });
}

// GET /settings — current settings (keys masked)
router.get('/', (req, res) => {
  res.json({
    provider: llmSettings.provider,
    lightModel: llmSettings.lightModel,
    heavyModel: llmSettings.heavyModel,
    anthropicKey: llmSettings.anthropicKey ? maskKey(llmSettings.anthropicKey) : '',
    openaiKey: llmSettings.openaiKey ? maskKey(llmSettings.openaiKey) : '',
    hasAnthropicKey: !!llmSettings.anthropicKey,
    hasOpenaiKey: !!llmSettings.openaiKey
  });
});

// PUT /settings — update settings
router.put('/', (req, res) => {
  try {
    const { anthropicKey, openaiKey, provider, lightModel, heavyModel } = req.body;

    if (anthropicKey !== undefined) llmSettings.anthropicKey = anthropicKey;
    if (openaiKey !== undefined) llmSettings.openaiKey = openaiKey;
    if (provider) llmSettings.provider = provider;
    if (lightModel) llmSettings.lightModel = lightModel;
    if (heavyModel) llmSettings.heavyModel = heavyModel;

    // Update the LLM module synchronously — prior version used a dynamic
    // import with .then() which returned the response BEFORE the key landed
    // in the LLM module, so the first chat call after PUT /settings would
    // fail with "API key not set".
    try {
      updateLlmSettings({
        provider: llmSettings.provider,
        anthropicKey: llmSettings.anthropicKey,
        openaiKey: llmSettings.openaiKey,
      });
    } catch (_) {}

    auditLog(req.db, 'settings.updated', 'settings', 'llm', 'user', {
      provider: llmSettings.provider,
      hasAnthropicKey: !!llmSettings.anthropicKey,
      hasOpenaiKey: !!llmSettings.openaiKey
    });

    res.json({
      success: true,
      provider: llmSettings.provider,
      hasAnthropicKey: !!llmSettings.anthropicKey,
      hasOpenaiKey: !!llmSettings.openaiKey
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update settings', details: err.message });
  }
});

// POST /settings/validate-key — validate an API key by making a test call
router.post('/validate-key', async (req, res) => {
  const { provider, apiKey } = req.body;

  if (!apiKey) {
    return res.status(400).json({ valid: false, error: 'API key is required' });
  }

  try {
    if (provider === 'anthropic' || !provider) {
      const client = new Anthropic({ apiKey });
      const response = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 10,
        messages: [{ role: 'user', content: 'Reply with OK' }]
      });
      res.json({ valid: true, provider: 'anthropic', model: 'claude-haiku-4-5-20251001' });
    } else {
      res.status(400).json({ valid: false, error: `Provider '${provider}' not yet supported for validation` });
    }
  } catch (err) {
    const message = err.status === 401 ? 'Invalid API key' :
                    err.status === 429 ? 'Rate limited — key is valid but try again later' :
                    err.message;
    res.json({ valid: false, error: message });
  }
});

// GET /settings/export — export current LLM settings (for reference)
router.get('/export', (req, res) => {
  res.json(llmSettings);
});

function maskKey(key) {
  if (!key || key.length < 12) return '****';
  return key.slice(0, 7) + '...' + key.slice(-4);
}

export { llmSettings };
export default router;
