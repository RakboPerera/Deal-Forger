import { callLLM } from './llm.js';

/**
 * Generic agentic tool-use loop.
 *
 * Calls the LLM with the provided tools, executes any tool calls via the
 * supplied handlers, appends the results, and loops until the model returns
 * a plain text response (no tool_use) or `maxIterations` is reached.
 *
 * @param {object}  opts
 * @param {Array}   opts.messages        - Initial conversation messages.
 * @param {string}  [opts.system]        - System prompt.
 * @param {Array}   opts.tools           - Tool definitions (Anthropic format).
 * @param {Object}  opts.toolHandlers    - Map of tool_name -> async (input) => result.
 * @param {number}  [opts.maxIterations=10] - Safety cap on loop iterations.
 * @param {'light'|'heavy'} [opts.tier='heavy'] - Model tier to use.
 * @param {number}  [opts.temperature=0] - Sampling temperature.
 * @param {number}  [opts.maxTokens=4096]- Max tokens per LLM call.
 *
 * @returns {{
 *   finalContent: string,
 *   toolCallLog: Array<{ tool: string, input: any, output: any, latencyMs: number }>,
 *   totalTokens: { inputTokens: number, outputTokens: number },
 *   totalLatencyMs: number,
 *   iterations: number,
 *   stopReason: string
 * }}
 */
export async function agentLoop({
  messages,
  system,
  tools,
  toolHandlers,
  maxIterations = 10,
  tier = 'heavy',
  temperature = 0,
  maxTokens = 4096,
} = {}) {
  // Clone messages so we don't mutate the caller's array.
  const conversation = messages.map((m) => ({ ...m }));

  const toolCallLog = [];
  const totalTokens = { inputTokens: 0, outputTokens: 0 };
  let totalLatencyMs = 0;
  let iterations = 0;
  let stopReason = 'end_turn';

  for (let i = 0; i < maxIterations; i++) {
    iterations++;

    // ---- LLM call --------------------------------------------------------
    const llmResult = await callLLM({
      tier,
      messages: conversation,
      system,
      tools,
      temperature,
      maxTokens,
    });

    totalTokens.inputTokens += llmResult.usage.inputTokens;
    totalTokens.outputTokens += llmResult.usage.outputTokens;
    totalLatencyMs += llmResult.latencyMs;
    stopReason = llmResult.stopReason || 'end_turn';

    // ---- No tool calls → done --------------------------------------------
    if (!llmResult.toolCalls || llmResult.toolCalls.length === 0) {
      return {
        finalContent: llmResult.content,
        toolCallLog,
        totalTokens,
        totalLatencyMs,
        iterations,
        stopReason,
      };
    }

    // ---- Build assistant message with all content blocks ------------------
    const assistantContentBlocks = [];

    if (llmResult.content) {
      assistantContentBlocks.push({ type: 'text', text: llmResult.content });
    }

    for (const tc of llmResult.toolCalls) {
      assistantContentBlocks.push({
        type: 'tool_use',
        id: tc.id,
        name: tc.name,
        input: tc.input,
      });
    }

    conversation.push({ role: 'assistant', content: assistantContentBlocks });

    // ---- Execute tool calls -----------------------------------------------
    const toolResultBlocks = [];

    for (const tc of llmResult.toolCalls) {
      const handler = toolHandlers[tc.name];

      if (!handler) {
        const errorResult = { error: `Unknown tool: ${tc.name}` };
        toolCallLog.push({
          tool: tc.name,
          input: tc.input,
          output: errorResult,
          latencyMs: 0,
        });
        toolResultBlocks.push({
          type: 'tool_result',
          tool_use_id: tc.id,
          content: JSON.stringify(errorResult),
          is_error: true,
        });
        continue;
      }

      const toolStart = Date.now();
      let output;
      let isError = false;

      try {
        output = await handler(tc.input);
      } catch (err) {
        output = { error: err.message || String(err) };
        isError = true;
      }

      const toolLatency = Date.now() - toolStart;
      totalLatencyMs += toolLatency;

      toolCallLog.push({
        tool: tc.name,
        input: tc.input,
        output,
        latencyMs: toolLatency,
      });

      // Anthropic expects tool_result content as a string.
      const serialised = typeof output === 'string' ? output : JSON.stringify(output);

      toolResultBlocks.push({
        type: 'tool_result',
        tool_use_id: tc.id,
        content: serialised,
        ...(isError ? { is_error: true } : {}),
      });
    }

    // Append all tool results as a single user message.
    conversation.push({ role: 'user', content: toolResultBlocks });
  }

  // Reached maxIterations — return whatever we have.
  // Make one final call without tools to get a summary.
  const finalResult = await callLLM({
    tier,
    messages: [
      ...conversation,
      {
        role: 'user',
        content: 'You have reached the maximum number of tool-use iterations. Please provide your best answer with the information gathered so far.',
      },
    ],
    system,
    temperature,
    maxTokens,
    // No tools — force a text response.
  });

  totalTokens.inputTokens += finalResult.usage.inputTokens;
  totalTokens.outputTokens += finalResult.usage.outputTokens;
  totalLatencyMs += finalResult.latencyMs;

  return {
    finalContent: finalResult.content,
    toolCallLog,
    totalTokens,
    totalLatencyMs,
    iterations,
    stopReason: 'max_iterations',
  };
}
