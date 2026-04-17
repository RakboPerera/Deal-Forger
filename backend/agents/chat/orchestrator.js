import { callLLM } from '../llm.js';
import { agentLoop } from '../loop.js';
import { getChatTools } from './tools.js';
import { scoreChatConfidence } from '../confidence.js';

// ---------------------------------------------------------------------------
// System prompts
// ---------------------------------------------------------------------------

const ROUTER_SYSTEM = `You are a query router for a deal analysis chat system. Classify the user's question into exactly one category and determine which data tools will be needed.

Categories:
- deal_query: Questions about a specific deal's details, status, or financials
- model_query: Questions about valuation outputs, DCF results, multiples, or sensitivity
- scenario_comparison: Questions comparing base/upside/downside scenarios
- pipeline_search: Questions about finding deals, filtering the pipeline, or searching across deals
- assumption_query: Questions about model assumptions, rationale, or inputs
- general_question: General finance questions, explanations, or questions not requiring data lookup

Respond with ONLY a JSON object:
{
  "category": "<category>",
  "tools_needed": ["tool_name_1", "tool_name_2"],
  "deal_id": "<extracted deal_id if mentioned, or null>",
  "reasoning": "<one sentence explaining classification>"
}

Available tools: query_deal, query_model_outputs, compare_scenarios, query_comps_for_deal, find_similar_deals, summarize_assumptions`;

const WORKER_SYSTEM = `You are a senior deal analyst assistant at a private equity firm. Every question you receive must be answered from the firm's internal deal database, NEVER from general knowledge.

CRITICAL RULES:
1. You MUST call at least one tool before producing a final answer. Never answer from memory or general knowledge about public companies.
2. If a question mentions a deal by name (e.g. "Project Falcon") or by id (e.g. "DEAL-001"), resolve it with query_deal FIRST.
3. If a question mentions a deal name you don't recognize, use find_similar_deals to look it up.
4. For valuation numbers, ALWAYS use query_model_outputs or compare_scenarios. Never quote valuations from memory.
5. For comparable companies or precedent transactions, ALWAYS use query_comps_for_deal. Public companies like Datadog, Snowflake, etc. may or may not be in our database — NEVER assume.
6. For pipeline searches ("which deals…", "how many deals…"), ALWAYS use find_similar_deals.
7. For assumption details, ALWAYS use summarize_assumptions.
8. If a tool returns an error or empty result, report that honestly. Do not substitute with guessed values.
9. Cite the source table for every number you quote.
10. When you have enough data, provide a clear direct answer. Do not make unnecessary additional tool calls.

Answering without calling a tool is a failure. If the question is purely about finance theory (e.g. "What is EBITDA?") you may answer from general knowledge, but preface with "(general finance knowledge, not specific to a deal)".`;

const SYNTHESIZER_SYSTEM = `You are a financial communication specialist. Take the raw data and analysis from a deal analyst and produce a clear, concise response for the user.

FORMATTING RULES:
- Format monetary values as $X.XM or $X.XB as appropriate
- Format percentages with one decimal place (e.g., 12.3%)
- Format multiples with one decimal place followed by "x" (e.g., 8.5x)
- Use bullet points for lists of 3+ items
- Bold key numbers and metrics when relevant
- Keep responses focused and actionable
- If data was incomplete or tools returned errors, acknowledge the limitation
- Do not add analysis or opinions beyond what the data supports
- Never fabricate or estimate numbers that were not in the provided data

Respond with ONLY a JSON object:
{
  "content": "<formatted response text>",
  "dataPoints": <number of concrete data points cited in the response>,
  "assumptions": ["any assumptions you had to make to answer"]
}`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build Anthropic-format tool definitions from our chat tools.
 * Strips the handler (which is not sent to the LLM).
 */
function buildToolDefinitions(tools) {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema,
  }));
}

/**
 * Build a tool handler map from our chat tools.
 */
function buildToolHandlers(tools) {
  const handlers = {};
  for (const t of tools) {
    handlers[t.name] = t.handler;
  }
  return handlers;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Process a user message in the deal analysis chat.
 *
 * Three-tier architecture:
 *   1. Router (Haiku) - classifies the query and determines tools needed
 *   2. Worker (Sonnet with tools) - executes tool calls via agentLoop
 *   3. Synthesizer (Haiku) - formats the final response for the user
 *
 * @param {Object} db - Database instance (better-sqlite3 or compatible)
 * @param {string} userMessage - The user's question or message
 * @param {Array}  [history=[]] - Previous messages in the conversation [{role, content}]
 * @returns {Object} { content, confidence, toolCalls, tokensUsed, latencyMs }
 */
export async function processMessage(db, userMessage, history = []) {
  const startTime = Date.now();
  const tokensUsed = { inputTokens: 0, outputTokens: 0 };

  // Prepare chat tools
  const chatTools = getChatTools(db);
  const toolDefinitions = buildToolDefinitions(chatTools);
  const toolHandlers = buildToolHandlers(chatTools);

  // -------------------------------------------------------------------------
  // Step 1: Router (Haiku) - classify the query
  // -------------------------------------------------------------------------
  let routerResult;
  try {
    routerResult = await callLLM({
      tier: 'light',
      temperature: 0,
      maxTokens: 512,
      system: ROUTER_SYSTEM,
      messages: [
        // Include recent history for context (last 4 messages max)
        ...history.slice(-4).map((m) => ({ role: m.role, content: m.content })),
        { role: 'user', content: userMessage },
      ],
    });
    tokensUsed.inputTokens += routerResult.usage.inputTokens;
    tokensUsed.outputTokens += routerResult.usage.outputTokens;
  } catch (err) {
    // If router fails, proceed with all tools available
    routerResult = { content: '{"category":"general_question","tools_needed":[],"deal_id":null,"reasoning":"Router failed, proceeding with full tool set"}' };
  }

  let routerParsed;
  try {
    let raw = routerResult.content.trim();
    if (raw.startsWith('```')) {
      raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
    }
    routerParsed = JSON.parse(raw);
  } catch {
    routerParsed = {
      category: 'general_question',
      tools_needed: [],
      deal_id: null,
      reasoning: 'Failed to parse router output',
    };
  }

  // -------------------------------------------------------------------------
  // Step 2: Worker (Sonnet with tools) - gather data
  // -------------------------------------------------------------------------
  // DealForge is a deal-analysis app — almost every user question benefits from
  // DB access. Default to enabling tools unless the router is highly confident
  // the question is pure financial education with NO ties to the pipeline.
  // This avoids the failure mode where a bad router JSON parse or cautious
  // classification silently skips tool-use, leaving the model to hallucinate
  // or respond "I don't have access to that data".
  const isPureGeneralKnowledge =
    routerParsed.category === 'general_question' &&
    (!routerParsed.tools_needed || routerParsed.tools_needed.length === 0) &&
    !routerParsed.deal_id;
  const needsTools = !isPureGeneralKnowledge;

  let workerContent = '';
  let toolCallLog = [];

  if (needsTools) {
    // Conversation history is deliberately kept minimal (last 2 messages).
    // The worker would otherwise treat prior assistant text as authoritative
    // data and skip tool calls — e.g., quoting a made-up multiple because it
    // remembers the company came up in an earlier turn. Each new user message
    // must force fresh tool use.
    const workerMessages = [
      ...history.slice(-2).map((m) => ({ role: m.role, content: m.content })),
      {
        role: 'user',
        content: userMessage,
      },
    ];

    try {
      const workerResult = await agentLoop({
        messages: workerMessages,
        system: WORKER_SYSTEM,
        tools: toolDefinitions,
        toolHandlers,
        maxIterations: 6,
        tier: 'heavy',
        temperature: 0,
        maxTokens: 4096,
      });

      workerContent = workerResult.finalContent;
      toolCallLog = workerResult.toolCallLog;
      tokensUsed.inputTokens += workerResult.totalTokens.inputTokens;
      tokensUsed.outputTokens += workerResult.totalTokens.outputTokens;
    } catch (err) {
      console.error('[chat] agentLoop threw:', err.message);
      workerContent = `I encountered an error while querying the database: ${err.message}. Please try rephrasing your question.`;
    }
  } else {
    // For general questions, let Sonnet answer directly without tools
    try {
      const directResult = await callLLM({
        tier: 'heavy',
        temperature: 0.3,
        maxTokens: 2048,
        system: WORKER_SYSTEM,
        messages: [
          ...history.slice(-6).map((m) => ({ role: m.role, content: m.content })),
          { role: 'user', content: userMessage },
        ],
      });

      workerContent = directResult.content;
      tokensUsed.inputTokens += directResult.usage.inputTokens;
      tokensUsed.outputTokens += directResult.usage.outputTokens;
    } catch (err) {
      workerContent = `I was unable to process your question: ${err.message}`;
    }
  }

  // -------------------------------------------------------------------------
  // Step 3: Synthesizer (Haiku) - format the final answer
  // -------------------------------------------------------------------------
  let finalContent = workerContent;
  let dataPoints = 0;
  let assumptions = [];

  try {
    const synthesizerResult = await callLLM({
      tier: 'light',
      temperature: 0,
      maxTokens: 2048,
      system: SYNTHESIZER_SYSTEM,
      messages: [
        {
          role: 'user',
          content: `User question: ${userMessage}\n\nAnalyst response (raw data and analysis):\n${workerContent}\n\nPlease format this into a clear, professional response.`,
        },
      ],
    });

    tokensUsed.inputTokens += synthesizerResult.usage.inputTokens;
    tokensUsed.outputTokens += synthesizerResult.usage.outputTokens;

    let synthParsed;
    try {
      let raw = synthesizerResult.content.trim();
      if (raw.startsWith('```')) {
        raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
      }
      synthParsed = JSON.parse(raw);
      finalContent = synthParsed.content || workerContent;
      dataPoints = synthParsed.dataPoints || 0;
      assumptions = synthParsed.assumptions || [];
    } catch {
      // If synthesizer JSON parsing fails, use the raw synthesizer output
      finalContent = synthesizerResult.content || workerContent;
    }
  } catch {
    // If synthesizer fails entirely, fall back to worker content
    finalContent = workerContent;
  }

  // -------------------------------------------------------------------------
  // Step 4: Score confidence
  // -------------------------------------------------------------------------
  // When the synthesizer JSON parse fails we can't count dataPoints — fall back
  // to a rough estimate from successful tool calls so the badge isn't always 0.
  const effectiveDataPoints = dataPoints > 0
    ? dataPoints
    : toolCallLog.filter((t) => t.output && !t.output.error).length * 2;
  const confidenceResult = scoreChatConfidence({
    toolCalls: toolCallLog,
    dataPoints: effectiveDataPoints,
    assumptions,
  });

  const totalLatencyMs = Date.now() - startTime;

  return {
    content: finalContent,
    // Expose the numeric score to callers — the structured factors live on
    // confidenceDetail for debuggers / UIs that want the breakdown.
    confidence: confidenceResult.overall,
    confidenceDetail: confidenceResult,
    toolCalls: toolCallLog.map((tc) => ({
      tool: tc.tool,
      input: tc.input,
      latencyMs: tc.latencyMs,
      // Omit full output to keep response size manageable
      hasData: tc.output && !tc.output.error,
    })),
    tokensUsed,
    latencyMs: totalLatencyMs,
    routing: {
      category: routerParsed.category,
      reasoning: routerParsed.reasoning,
    },
  };
}
