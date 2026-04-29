import { log } from "#app/ui/log.js";
import { startWslBridge, stopWslBridge } from "#app/wslBridge/index.js";

export async function initProvider(name, displayName, connectFn) {
  await startWslBridge();
  log(`== ${displayName} Remote Session Mode ==\n`);

  const session = await connectFn();

  return {
    providerName: name,
    startNewChat: session.startNewChat,
    setMode: session.setMode,
    sendPromptAndWait: session.sendPromptAndWait,
    close: async () => {
      await session.close?.();
      stopWslBridge();
    },
  };
}
