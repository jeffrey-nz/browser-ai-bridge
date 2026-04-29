import { logger } from "#utils/logger.js";

export class ToolRegistry {
  constructor() {
    this.handlers = new Map();
  }

  register(toolName, handlerFn) {
    this.handlers.set(toolName, handlerFn);
  }

  async executeAll(toolCalls) {
    const results = [];
    for (const call of toolCalls) {
      const toolName = call.tool || call.action;
      const args = call.args || call.parameters || {};

      let output = "";
      try {
        const handler = this.handlers.get(toolName);
        if (handler) {
          output = await handler(args);
        } else {
          output = `Error: Tool '${toolName}' is not recognized or implemented.`;
        }
      } catch (err) {
        logger.error(err, `[ToolRegistry] Error executing ${toolName}`);
        output = `Execution Error: ${err.message}`;
      }

      results.push({ tool: toolName, output });
    }
    return results;
  }
}

export const defaultRegistry = new ToolRegistry();

defaultRegistry.register("read_file", async (args) => {
  return `(Mock) Output: Content of ${args.path || "unknown file"} goes here.`;
});
