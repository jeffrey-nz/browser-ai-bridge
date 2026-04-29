import { evaluateComponent } from "./evaluator.js";
import { saveSnapshot, saveStepScreenshot } from "./io.js";
import { runLocatorProbe } from "./locatorProbe.js";
import { colors } from "#app/ui/colors.js";
import { log } from "#app/ui/log.js";

import { stepContextReset } from "./steps/contextReset.js";
import { stepInputInjection } from "./steps/inputInjection.js";
import { stepSubmission } from "./steps/submission.js";
import { stepGenerationPolling } from "./steps/generationPolling.js";
import { stepDataExtraction } from "./steps/dataExtraction.js";

const MOTION_STEPS = [
  { name: "1. Context Reset (New Chat Button)", fn: stepContextReset },
  { name: "2. Input Injection (Focus & Type)", fn: stepInputInjection },
  { name: "3. Submission (Send Button Click)", fn: stepSubmission },
  {
    name: "4. Generation Polling (Stop Button Status)",
    fn: stepGenerationPolling,
  },
  { name: "5. Data Extraction (Read Response Block)", fn: stepDataExtraction },
];

export async function runMotionTest(page, provider) {
  const allSteps = [...MOTION_STEPS, ...(provider.extraSteps || [])];

  let passed = 0;
  const total = allSteps.length;

  log(colors.dim(`\nRunning motion tests for ${provider.name}...`));

  let failedAt = null;
  const steps = [];

  for (let i = 0; i < allSteps.length; i++) {
    const step = allSteps[i];
    const ok = await evaluateComponent(step.name, () =>
      step.fn(page, provider.locators),
    );

    if (!ok) {
      if (step.optional) {
        log(
          colors.yellow(`  [SKIP] Optional step did not pass, continuing...`),
        );
        steps.push({ name: step.name, result: "SKIP" });
        await saveStepScreenshot(page, provider.name, i + 1, step.name, "SKIP");
        continue;
      }
      failedAt = step.name;
      steps.push({ name: step.name, result: "FAIL" });
      await saveStepScreenshot(page, provider.name, i + 1, step.name, "FAIL");
      log(
        colors.red(
          `  [ABORT] Step failed. Cascading failure and saving DOM snapshot.`,
        ),
      );
      await runLocatorProbe(page, provider.locators, provider.name);
      await saveSnapshot(page, provider.name);
      break;
    }

    passed++;
    steps.push({ name: step.name, result: "PASS" });
    await saveStepScreenshot(page, provider.name, i + 1, step.name, "PASS");
  }

  return { passed, total, failedAt, steps };
}
