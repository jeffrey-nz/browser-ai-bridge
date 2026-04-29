import readline from "node:readline";

export function makeRl() {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

export function closeRl(rl) {
  if (rl) {
    rl.close();
  }
}

export async function askLine(rl, query) {
  const instance = rl || makeRl();
  return new Promise((resolve) => {
    instance.question(query, (answer) => {
      if (!rl) instance.close();
      resolve(answer);
    });
  });
}

export async function promptChoice(rl, msg, options, opts = {}) {
  const instance = rl || makeRl();
  const def = opts.defaultOption || 1;

  console.log(`\n${msg}`);
  options.forEach((opt, i) => {
    console.log(`  ${i + 1}) ${opt.label}`);
  });

  return new Promise((resolve) => {
    instance.question(`\nSelect option [${def}]: `, (answer) => {
      if (!rl) instance.close();

      const trimmed = answer.trim();
      if (trimmed === "") {
        return resolve(options[def - 1].value);
      }

      const idx = parseInt(trimmed) - 1;
      if (isNaN(idx) || idx < 0 || idx >= options.length) {
        console.log("  Invalid selection, using default.");
        return resolve(options[def - 1].value);
      }

      resolve(options[idx].value);
    });
  });
}

export async function waitForEnter(rl, message = "Press Enter to continue...") {
  const instance = rl || makeRl();
  return new Promise((resolve) => {
    instance.question(message, () => {
      if (!rl) instance.close();
      resolve();
    });
  });
}
