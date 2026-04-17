import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  getConversations, getConversation, createConversation,
  sendMessage, deleteConversation, getSettings
} from '../api';
import {
  MessageSquare, Plus, Send, Trash2, ChevronDown, ChevronRight,
  Bot, User, Loader, AlertTriangle, Key
} from 'lucide-react';

/* ── Helpers ────────────────────────────────────────────── */

function parseToolCalls(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try { const parsed = JSON.parse(raw); return Array.isArray(parsed) ? parsed : []; }
    catch { return []; }
  }
  return [];
}

/* ── Styles ─────────────────────────────────────────────── */
const s = {
  wrapper: {
    display: 'flex', height: '100%',
  },
  /* Sidebar */
  sidebar: {
    width: 260, minWidth: 260, display: 'flex', flexDirection: 'column',
    borderRight: '1px solid var(--border, #e2e8f0)',
    background: 'var(--bg, #fff)', height: '100%',
  },
  sidebarHeader: {
    padding: 12, borderBottom: '1px solid var(--border, #e2e8f0)',
  },
  newConvBtn: {
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
    width: '100%', padding: '8px 12px', borderRadius: 8, border: 'none',
    background: 'var(--primary, #2563eb)', color: '#fff',
    fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer',
  },
  convList: { flex: 1, overflowY: 'auto' },
  convItem: (active) => ({
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '10px 12px', cursor: 'pointer',
    background: active ? 'var(--primary-light, #eff6ff)' : 'transparent',
    borderBottom: '1px solid var(--border, #e2e8f0)',
  }),
  convLabel: {
    display: 'flex', alignItems: 'center', gap: 8,
    flex: 1, minWidth: 0,
  },
  convTitle: {
    fontSize: '0.85rem', overflow: 'hidden', textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  deleteBtn: {
    background: 'none', border: 'none', cursor: 'pointer',
    color: 'var(--text-muted, #64748b)', padding: 4, borderRadius: 4,
    display: 'flex', alignItems: 'center', flexShrink: 0,
  },
  emptyConvs: {
    textAlign: 'center', padding: 24,
    color: 'var(--text-muted, #64748b)', fontSize: '0.85rem',
  },
  /* Main area */
  main: {
    display: 'flex', flexDirection: 'column', flex: 1,
    minWidth: 0, height: '100%',
  },
  messagesArea: {
    flex: 1, overflowY: 'auto', padding: 24,
    display: 'flex', flexDirection: 'column', gap: 16,
  },
  /* Bubbles */
  bubbleRow: (isUser) => ({
    display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start',
  }),
  bubble: (isUser) => ({
    maxWidth: '70%', padding: '12px 16px', borderRadius: 12,
    background: isUser ? 'var(--primary, #2563eb)' : 'var(--bg-secondary, #f1f5f9)',
    color: isUser ? '#fff' : 'var(--text, #1e293b)',
    fontSize: '0.9rem', lineHeight: 1.5,
  }),
  bubbleHeader: {
    display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4,
    fontSize: '0.75rem', fontWeight: 600, opacity: 0.85,
  },
  confidenceBadge: (conf) => ({
    display: 'inline-block', padding: '1px 6px', borderRadius: 4,
    fontSize: '0.65rem', fontWeight: 600, marginLeft: 4,
    background: conf > 0.8 ? '#d1fae5' : conf > 0.5 ? '#fef3c7' : '#fee2e2',
    color: conf > 0.8 ? '#065f46' : conf > 0.5 ? '#92400e' : '#991b1b',
  }),
  messageContent: { whiteSpace: 'pre-wrap', wordBreak: 'break-word' },
  /* Tool calls */
  toolToggle: {
    display: 'inline-flex', alignItems: 'center', gap: 4,
    marginTop: 8, padding: '3px 8px', borderRadius: 4, border: 'none',
    background: 'rgba(0,0,0,0.06)', fontSize: '0.75rem',
    cursor: 'pointer', color: 'inherit',
  },
  toolBox: {
    marginTop: 8, padding: 8, borderRadius: 6,
    background: 'rgba(0,0,0,0.04)', fontSize: '0.78rem',
  },
  toolName: {
    fontWeight: 600, color: 'var(--primary, #2563eb)', marginBottom: 2,
  },
  toolPre: {
    fontFamily: 'monospace', fontSize: '0.72rem', whiteSpace: 'pre-wrap',
    wordBreak: 'break-word', margin: 0, padding: 0,
  },
  /* Loading */
  loadingBubble: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '12px 16px', borderRadius: 12,
    background: 'var(--bg-secondary, #f1f5f9)',
    maxWidth: '70%', fontSize: '0.85rem',
    color: 'var(--text-muted, #64748b)',
  },
  /* Input bar */
  inputBar: {
    display: 'flex', alignItems: 'flex-end', gap: 8,
    padding: '12px 24px', borderTop: '1px solid var(--border, #e2e8f0)',
    background: 'var(--bg, #fff)',
  },
  textarea: {
    flex: 1, resize: 'none', minHeight: 40, maxHeight: 120,
    padding: '10px 12px', borderRadius: 8,
    border: '1px solid var(--border, #e2e8f0)',
    fontSize: '0.9rem', fontFamily: 'inherit',
    outline: 'none',
  },
  sendBtn: (disabled) => ({
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    width: 40, height: 40, borderRadius: 8, border: 'none',
    background: disabled ? 'var(--bg-secondary, #e2e8f0)' : 'var(--primary, #2563eb)',
    color: disabled ? 'var(--text-muted, #94a3b8)' : '#fff',
    cursor: disabled ? 'not-allowed' : 'pointer',
    flexShrink: 0,
  }),
  /* Suggestions */
  suggestionsRow: {
    display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4,
  },
  suggestionBtn: {
    padding: '5px 12px', borderRadius: 6, border: 'none',
    background: 'var(--bg-secondary, #f1f5f9)',
    color: 'var(--text, #1e293b)', fontSize: '0.8rem',
    cursor: 'pointer',
  },
  /* Empty state */
  emptyState: {
    flex: 1, display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center',
    color: 'var(--text-muted, #64748b)', padding: 40,
  },
  emptyTitle: {
    fontSize: '1.25rem', fontWeight: 700, marginTop: 16, marginBottom: 8,
    color: 'var(--text, #1e293b)',
  },
  emptyDesc: { fontSize: '0.9rem', marginBottom: 24 },
  starterGrid: {
    display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center',
    maxWidth: 520,
  },
  starterBtn: {
    padding: '8px 14px', borderRadius: 8,
    border: '1px solid var(--border, #e2e8f0)',
    background: 'var(--bg, #fff)', color: 'var(--text, #1e293b)',
    fontSize: '0.8rem', cursor: 'pointer',
  },
  spinner: {
    display: 'flex', justifyContent: 'center', alignItems: 'center',
    padding: 40,
  },
};

/* ── ToolCallSection ────────────────────────────────────── */
function ToolCallSection({ toolCalls }) {
  const [expanded, setExpanded] = useState(false);
  const parsed = parseToolCalls(toolCalls);
  if (parsed.length === 0) return null;

  return (
    <div>
      <button style={s.toolToggle} onClick={() => setExpanded(!expanded)}>
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        Show work ({parsed.length} tool call{parsed.length > 1 ? 's' : ''})
      </button>
      {expanded && (
        <div style={s.toolBox}>
          {parsed.map((tc, i) => (
            <div key={i} style={{ marginBottom: i < parsed.length - 1 ? 8 : 0 }}>
              <div style={s.toolName}>{tc.tool || tc.name || 'Tool'}</div>
              <pre style={s.toolPre}>
                {typeof tc.input === 'string' ? tc.input : JSON.stringify(tc.input, null, 2)}
              </pre>
              {tc.output && (
                <pre style={{ ...s.toolPre, opacity: 0.7, marginTop: 4 }}>
                  {typeof tc.output === 'string' ? tc.output : JSON.stringify(tc.output, null, 2)}
                </pre>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── MessageBubble ──────────────────────────────────────── */
function MessageBubble({ message }) {
  const isUser = message.role === 'user';
  return (
    <div style={s.bubbleRow(isUser)}>
      <div style={s.bubble(isUser)}>
        <div style={s.bubbleHeader}>
          {isUser ? <User size={14} /> : <Bot size={14} />}
          <span>{isUser ? 'You' : 'DealForge AI'}</span>
          {!isUser && message.confidence != null && (
            <span style={s.confidenceBadge(message.confidence)}>
              {Math.round(message.confidence * 100)}% confident
            </span>
          )}
        </div>
        <div style={s.messageContent}>{message.content || ''}</div>
        {!isUser && <ToolCallSection toolCalls={message.tool_calls} />}
      </div>
    </div>
  );
}

/* ── Main Component ─────────────────────────────────────── */
export default function Chat() {
  const [conversations, setConversations] = useState([]);
  const [activeConvId, setActiveConvId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [loadingConvs, setLoadingConvs] = useState(true);
  const [suggestions, setSuggestions] = useState([]);
  const [hasApiKey, setHasApiKey] = useState(null); // null = unknown, false = missing, true = set
  const messagesEndRef = useRef(null);

  useEffect(() => {
    getSettings()
      .then(s => setHasApiKey(!!s.hasAnthropicKey))
      .catch(() => setHasApiKey(false));
  }, []);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => { scrollToBottom(); }, [messages]);

  const fetchConversations = async () => {
    try {
      const data = await getConversations();
      setConversations(Array.isArray(data) ? data : data.conversations || []);
    } catch (err) {
      console.error('Failed to fetch conversations:', err);
    } finally {
      setLoadingConvs(false);
    }
  };

  useEffect(() => { fetchConversations(); }, []);

  const loadConversation = async (convId) => {
    setActiveConvId(convId);
    setSuggestions([]);
    try {
      const data = await getConversation(convId);
      // data may be { messages: [...] } or { conversation: {...}, messages: [...] }
      const msgs = Array.isArray(data.messages) ? data.messages : [];
      // Parse tool_calls JSON strings in each message
      setMessages(msgs.map(m => ({
        ...m,
        tool_calls: parseToolCalls(m.tool_calls),
      })));
    } catch (err) {
      console.error('Failed to load conversation:', err);
      setMessages([]);
    }
  };

  const handleNewConversation = async () => {
    try {
      const conv = await createConversation('New Conversation');
      // API returns {id, title, ...}
      setConversations(prev => [conv, ...prev]);
      setActiveConvId(conv.id);
      setMessages([]);
      setSuggestions([]);
    } catch (err) {
      console.error('Failed to create conversation:', err);
    }
  };

  const handleDeleteConversation = async (e, convId) => {
    e.stopPropagation();
    try {
      await deleteConversation(convId);
      setConversations(prev => prev.filter(c => c.id !== convId));
      if (activeConvId === convId) {
        setActiveConvId(null);
        setMessages([]);
      }
    } catch (err) {
      console.error('Failed to delete conversation:', err);
    }
  };

  const handleSend = async () => {
    if (!input.trim() || sending) return;

    let convId = activeConvId;
    if (!convId) {
      try {
        const conv = await createConversation(input.trim().slice(0, 50));
        setConversations(prev => [conv, ...prev]);
        convId = conv.id;
        setActiveConvId(convId);
      } catch (err) {
        console.error('Failed to create conversation:', err);
        return;
      }
    }

    const userMsg = { role: 'user', content: input.trim() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setSending(true);
    setSuggestions([]);

    try {
      const response = await sendMessage(convId, userMsg.content);
      // response may be { messages: [...] } or { content, confidence, tool_calls, ... }
      let assistantMsg;
      if (response.messages && Array.isArray(response.messages)) {
        // Find the last assistant message from the returned list
        const assistantMsgs = response.messages.filter(m => m.role === 'assistant');
        const last = assistantMsgs.length > 0 ? assistantMsgs[assistantMsgs.length - 1] : null;
        if (last) {
          assistantMsg = {
            role: 'assistant',
            content: last.content || '',
            confidence: last.confidence,
            tool_calls: parseToolCalls(last.tool_calls),
          };
        } else {
          assistantMsg = {
            role: 'assistant',
            content: response.messages.map(m => m.content).filter(Boolean).join('\n') || '',
          };
        }
        // Also extract suggestions if present
        if (response.suggestions) setSuggestions(response.suggestions);
      } else {
        assistantMsg = {
          role: 'assistant',
          content: response.content || response.message || '',
          confidence: response.confidence,
          tool_calls: parseToolCalls(response.tool_calls),
        };
        if (response.suggestions) setSuggestions(response.suggestions);
      }
      setMessages(prev => [...prev, assistantMsg]);
    } catch (err) {
      console.error('Failed to send message:', err);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: 'Sorry, I encountered an error processing your request. Please try again.',
      }]);
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const starterPrompts = [
    'What deals are in Due Diligence?',
    'Show me the largest deals by pipeline value',
    'Compare EBITDA multiples across sectors',
    'What is the average deal size in Technology?',
  ];

  return (
    <div style={s.wrapper}>
      {/* Sidebar */}
      <div style={s.sidebar}>
        <div style={s.sidebarHeader}>
          <button style={s.newConvBtn} onClick={handleNewConversation}>
            <Plus size={16} /> New Conversation
          </button>
        </div>
        <div style={s.convList}>
          {loadingConvs ? (
            <div style={s.spinner}>
              <Loader size={20} style={{ animation: 'spin 1s linear infinite', color: 'var(--primary, #2563eb)' }} />
            </div>
          ) : conversations.length === 0 ? (
            <div style={s.emptyConvs}>No conversations yet</div>
          ) : (
            conversations.map(conv => (
              <div
                key={conv.id}
                style={s.convItem(activeConvId === conv.id)}
                onClick={() => loadConversation(conv.id)}
              >
                <div style={s.convLabel}>
                  <MessageSquare size={14} style={{ flexShrink: 0, opacity: 0.5 }} />
                  <span style={s.convTitle}>{conv.title || 'Untitled'}</span>
                </div>
                <button
                  style={s.deleteBtn}
                  onClick={(e) => handleDeleteConversation(e, conv.id)}
                  title="Delete conversation"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Main Chat Area */}
      <div style={s.main}>
        {hasApiKey === false && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '10px 16px', background: '#fef3c7',
            borderBottom: '1px solid #fbbf24', color: '#92400e',
            fontSize: '0.82rem',
          }}>
            <AlertTriangle size={16} style={{ flexShrink: 0 }} />
            <span style={{ flex: 1 }}>
              No Anthropic API key configured — responses use a deterministic SQL fallback.
              For full AI chat with tool use, add your key in{' '}
              <Link to="/settings" style={{ color: '#92400e', fontWeight: 600, textDecoration: 'underline' }}>
                <Key size={11} style={{ display: 'inline', verticalAlign: 'middle' }} /> Settings
              </Link>.
            </span>
          </div>
        )}
        {activeConvId || messages.length > 0 ? (
          <>
            <div style={s.messagesArea}>
              {messages.map((msg, i) => (
                <MessageBubble key={i} message={msg} />
              ))}
              {sending && (
                <div style={s.bubbleRow(false)}>
                  <div style={s.loadingBubble}>
                    <Loader size={16} style={{ animation: 'spin 1s linear infinite' }} />
                    <span>Thinking...</span>
                  </div>
                </div>
              )}
              {suggestions.length > 0 && (
                <div style={s.suggestionsRow}>
                  {suggestions.map((sg, i) => (
                    <button
                      key={i}
                      style={s.suggestionBtn}
                      onClick={() => setInput(sg)}
                    >
                      {sg}
                    </button>
                  ))}
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
            <div style={s.inputBar}>
              <textarea
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask about your deals, valuations, or comparables..."
                rows={1}
                style={s.textarea}
              />
              <button
                data-send-btn
                style={s.sendBtn(!input.trim() || sending)}
                onClick={handleSend}
                disabled={!input.trim() || sending}
              >
                <Send size={16} />
              </button>
            </div>
          </>
        ) : (
          <div style={s.emptyState}>
            <MessageSquare size={48} style={{ opacity: 0.3 }} />
            <div style={s.emptyTitle}>DealForge AI Assistant</div>
            <div style={s.emptyDesc}>
              Ask questions about your deal pipeline, valuations, and comparables.
            </div>
            <div style={s.starterGrid}>
              {starterPrompts.map((q, i) => (
                <button
                  key={i}
                  style={s.starterBtn}
                  onClick={async () => {
                    setInput(q);
                    // Auto-send so first-time users don't have to also press Enter
                    setTimeout(() => {
                      const btn = document.querySelector('[data-send-btn]');
                      if (btn) btn.click();
                    }, 50);
                  }}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
