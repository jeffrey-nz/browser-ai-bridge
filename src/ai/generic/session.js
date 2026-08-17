import { BaseProvider } from "#ai/shared/BaseProvider.js";
import { makeInteraction } from "./interaction.js";
import { GENERIC_SPECS } from "./specs.js";

/**
 * Build a provider class from a spec. See specs.js for why these are not five
 * hand-written directories.
 *
 * `setMode` is deliberately absent: none of these sites has a mode menu this
 * bridge knows how to drive, and a setMode that silently did nothing would be
 * worse than not having one — the executor only calls it when the engine
 * declares it, so a missing method is honest and a no-op method is a lie.
 */
export function createGenericProvider(spec) {
  return class GenericProvider extends BaseProvider {
    constructor() {
      super(spec.name, spec.urlMatch, spec.url);
      this.spec = spec;
      this.io = makeInteraction(spec);
    }

    async startNewChat() {
      return await this.io.startNewChat(this.page);
    }

    async sendPromptAndWait(text, label) {
      return await this.io.sendPromptAndWait(this.page, text, label);
    }

    async sendPromptWithFile(text, label, sessionId, filePath) {
      return await this.io.sendPromptWithFile(this.page, filePath, text, label);
    }

    async sendPromptOnly(text) {
      await this.io.injectText(this.page, text);
      await this.io.clickSend(this.page);
    }
  };
}

/** id → provider class, for every spec. */
export const GENERIC_PROVIDERS = Object.fromEntries(
  Object.entries(GENERIC_SPECS).map(([id, spec]) => [
    id,
    createGenericProvider(spec),
  ]),
);
