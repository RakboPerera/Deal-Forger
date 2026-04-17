import { Router } from 'express';
import { auditLog } from '../database.js';
import { processMessage } from '../agents/chat/orchestrator.js';
import { getSettings } from '../agents/llm.js';

const router = Router();

router.get('/conversations', (req, res) => {
  try {
    res.json(req.db.all('SELECT * FROM chat_conversations ORDER BY updated_at DESC'));
  } catch (err) {
    res.status(500).json({ error: 'Failed', details: err.message });
  }
});

router.get('/conversations/:id', (req, res) => {
  try {
    const conv = req.db.get('SELECT * FROM chat_conversations WHERE id = ?', req.params.id);
    if (!conv) return res.status(404).json({ error: 'Conversation not found' });
    conv.messages = req.db.all(
      'SELECT * FROM chat_messages WHERE conversation_id = ? ORDER BY created_at ASC',
      req.params.id
    );
    res.json(conv);
  } catch (err) {
    res.status(500).json({ error: 'Failed', details: err.message });
  }
});

router.post('/conversations', (req, res) => {
  try {
    const { title } = req.body;
    req.db.run('INSERT INTO chat_conversations (title) VALUES (?)', title || 'New conversation');
    const created = req.db.get('SELECT * FROM chat_conversations ORDER BY id DESC LIMIT 1');
    res.status(201).json(created);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create', details: err.message });
  }
});

// Deterministic fallback — used when no API key is configured, so the UI still
// returns something useful off the seeded data. Covers a handful of common
// questions via direct SQL so the demo never hard-fails.
function deterministicFallback(db, content) {
  const q = content.toLowerCase();

  if (q.includes('due diligence') || q.includes('in dd')) {
    const rows = db.all("SELECT deal_id, deal_name, target_company, sector FROM deal_pipeline WHERE stage = 'due_diligence'");
    const lines = rows.map(r => `• ${r.deal_name} (${r.deal_id}) — ${r.target_company || '-'} in ${r.sector || '-'}`);
    return { content: `Deals currently in Due Diligence (${rows.length}):\n${lines.join('\n') || '(none)'}`, confidence: 0.9 };
  }
  if (q.includes('largest') || q.includes('biggest')) {
    const rows = db.all('SELECT deal_name, deal_size_estimate FROM deal_pipeline WHERE deal_size_estimate IS NOT NULL ORDER BY deal_size_estimate DESC LIMIT 5');
    const lines = rows.map(r => `• ${r.deal_name} — $${r.deal_size_estimate}M`);
    return { content: `Top deals by estimated size:\n${lines.join('\n')}`, confidence: 0.9 };
  }
  if (q.includes('ebitda') && q.includes('sector')) {
    const rows = db.all('SELECT sector, AVG(ev_ebitda) AS avg_mult, COUNT(*) AS n FROM comparable_companies WHERE sector IS NOT NULL GROUP BY sector ORDER BY avg_mult DESC');
    const lines = rows.map(r => `• ${r.sector}: ${r.avg_mult?.toFixed(1)}x (n=${r.n})`);
    return { content: `Average EV/EBITDA multiples by sector:\n${lines.join('\n')}`, confidence: 0.85 };
  }
  if (q.includes('average') && q.includes('technology')) {
    const row = db.get("SELECT AVG(deal_size_estimate) AS avg FROM deal_pipeline WHERE sector LIKE '%Tech%' OR sector LIKE '%Software%'");
    return { content: `Average Technology deal size: $${row.avg?.toFixed(0) || '-'}M`, confidence: 0.8 };
  }

  // Generic: summarize the pipeline
  const counts = db.all('SELECT stage, COUNT(*) AS n FROM deal_pipeline GROUP BY stage');
  const lines = counts.map(r => `• ${r.stage}: ${r.n}`);
  return {
    content:
      `I don't have an API key configured, so I'm answering from the database directly. ` +
      `Current pipeline by stage:\n${lines.join('\n')}\n\n` +
      `Set your Anthropic key in Settings for richer answers.`,
    confidence: 0.5,
  };
}

router.post('/conversations/:id/messages', async (req, res) => {
  try {
    const conv = req.db.get('SELECT * FROM chat_conversations WHERE id = ?', req.params.id);
    if (!conv) return res.status(404).json({ error: 'Conversation not found' });

    const { content } = req.body;
    if (!content) return res.status(400).json({ error: 'content required' });

    // Save user message
    req.db.run(
      'INSERT INTO chat_messages (conversation_id, role, content) VALUES (?, ?, ?)',
      req.params.id, 'user', content
    );

    // Load recent history for context
    const history = req.db.all(
      `SELECT role, content FROM chat_messages
       WHERE conversation_id = ?
       ORDER BY created_at ASC`,
      req.params.id
    );

    const settings = getSettings();
    const hasKey = !!settings.anthropicKey;

    let assistantContent;
    let confidence = 0.5;
    let toolCallsJson = null;
    let tokensUsed = 0;
    let latencyMs = 0;

    if (hasKey) {
      try {
        const result = await processMessage(req.db, content, history.slice(0, -1));
        assistantContent = result.content;
        confidence = result.confidence;
        toolCallsJson = JSON.stringify(result.toolCalls || []);
        tokensUsed = (result.tokensUsed?.inputTokens || 0) + (result.tokensUsed?.outputTokens || 0);
        latencyMs = result.latencyMs || 0;
      } catch (err) {
        console.error('Chat orchestrator failed:', err);
        const fb = deterministicFallback(req.db, content);
        assistantContent = `⚠️ AI call failed (${err.message}). Falling back to direct DB query:\n\n${fb.content}`;
        confidence = fb.confidence;
      }
    } else {
      const fb = deterministicFallback(req.db, content);
      assistantContent = fb.content;
      confidence = fb.confidence;
    }

    // Coerce to sql.js-safe primitives — bind() rejects any object/undefined
    const safeStr = (v) => {
      if (v == null) return '';
      if (typeof v === 'string') return v;
      if (typeof v === 'number' || typeof v === 'boolean') return String(v);
      try { return JSON.stringify(v); } catch { return String(v); }
    };
    const safeNum = (v) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    };

    req.db.run(
      `INSERT INTO chat_messages (conversation_id, role, content, confidence, tool_calls, tokens_used, latency_ms)
       VALUES (?, 'assistant', ?, ?, ?, ?, ?)`,
      Number(req.params.id),
      safeStr(assistantContent) || '(empty response)',
      safeNum(confidence),
      safeStr(toolCallsJson || '[]'),
      safeNum(tokensUsed),
      safeNum(latencyMs),
    );

    req.db.run(
      "UPDATE chat_conversations SET updated_at = datetime('now') WHERE id = ?",
      req.params.id
    );

    const messages = req.db.all(
      'SELECT * FROM chat_messages WHERE conversation_id = ? ORDER BY created_at ASC',
      req.params.id
    );

    auditLog(req.db, 'chat.message', 'chat_conversations', req.params.id, 'user', {
      tokensUsed, latencyMs, confidence,
    });

    res.json({ messages });
  } catch (err) {
    console.error('POST /chat/messages failed:', err);
    res.status(500).json({ error: 'Failed to send message', details: err.message || String(err) });
  }
});

router.delete('/conversations/:id', (req, res) => {
  try {
    const conv = req.db.get('SELECT * FROM chat_conversations WHERE id = ?', req.params.id);
    if (!conv) return res.status(404).json({ error: 'Not found' });
    req.db.run('DELETE FROM chat_messages WHERE conversation_id = ?', req.params.id);
    req.db.run('DELETE FROM chat_conversations WHERE id = ?', req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete', details: err.message });
  }
});

export default router;
