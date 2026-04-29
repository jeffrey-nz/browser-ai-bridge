import { extractStructuredData } from "#utils/responseParser.js";
import { logger } from "#utils/logger.js";

export class AgentOrchestrator {
  constructor(session, toolRegistry) {
    this.session = session;
    this.toolRegistry = toolRegistry;
  }

  async runTask(initialPrompt, maxTurns = 15) {
    let currentPrompt = initialPrompt;
    let turn = 1;
    const history = [];

    logger.info(`🤖 Starting Autonomous Task (Max Turns: ${maxTurns})`);

    while (turn <= maxTurns) {
      logger.info(`[Agent] Turn ${turn}/${maxTurns} executing...`);

      const response = await this.session.engine.sendPromptAndWait(
        currentPrompt,
        `Turn ${turn}`,
      );

      if (!response.ok) {
        logger.error(`[Agent] AI Provider failed: ${response.reason}`);
        return { status: "failed", reason: response.reason, history };
      }

      history.push({ role: "ai", content: response.text });

      const data = extractStructuredData(response.text);
      const toolCalls = Array.isArray(data) ? data : data ? [data] : [];

      if (toolCalls.length === 0) {
        logger.info("[Agent] No tools detected in response. Yielding to user.");
        return { status: "yield", result: response.text, history };
      }

      const completeCall = toolCalls.find(
        (c) =>
          c.action === "workflow_complete" || c.tool === "workflow_complete",
      );
      if (completeCall) {
        logger.info("✅ [Agent] Task marked complete by AI.");
        return { status: "complete", result: completeCall, history };
      }

      logger.info(`[Agent] Executing ${toolCalls.length} tool(s)...`);
      const results = await this.toolRegistry.executeAll(toolCalls);

      currentPrompt = this.formatResults(results);
      history.push({ role: "system", content: currentPrompt });

      turn++;
    }

    logger.warn("⚠️ [Agent] Maximum turns reached.");
    return { status: "max_turns_reached", history };
  }

  formatResults(results) {
    let output = "## 🛠 TOOL RESULTS\n\n";
    for (const res of results) {
      const tag = `${res.tool}_result`;
      output += `<${tag}>\n${res.output}\n</${tag}>\n\n`;
    }
    output += "Please analyze the results and provide your next action.";
    return output;
  }
}
