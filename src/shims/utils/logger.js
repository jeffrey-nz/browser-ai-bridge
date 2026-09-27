import pino from "pino";
import process from "node:process";

//[[ A LOG FORMATTER MUST NOT BE ABLE TO KILL THE BRIDGE.
//
//   pino-pretty runs in a worker thread, through thread-stream. When that worker
//   exits, the stream emits 'error'; with no listener on it Node treats that as an
//   unhandled 'error' event and takes the process down.
//
//   2026-09-27, mid-generation: the bridge died with "Error: the worker has
//   exited" one line after logging a successful, valid response. Nothing was wrong
//   with the browser, the providers or the network — the log writer went away and
//   the service went with it. The client saw ECONNREFUSED on all four lanes at
//   once and a 24-chapter book stalled until someone noticed.
//
//   Building the transport explicitly lets us listen on it. A logging failure now
//   costs pretty-printing and nothing else: pino keeps writing to the raw
//   destination, and the process stays up. This is the right trade in both
//   directions — logs are how we diagnose the bridge, but a bridge that exits
//   cannot be diagnosed at all. ]]
const level = process.env.LOG_LEVEL || "info";

function prettyStream() {
  try {
    const stream = pino.transport({
      target: "pino-pretty",
      options: {
        colorize: true,
        translateTime: "SYS:standard",
        ignore: "pid,hostname",
      },
    });
    // The listener is the whole point: without it the 'error' is unhandled.
    stream.on("error", (err) => {
      process.stderr.write(
        `[logger] pretty transport failed, falling back to plain output: ${err?.message || err}\n`,
      );
    });
    return stream;
  } catch (err) {
    process.stderr.write(
      `[logger] could not start the pretty transport, using plain output: ${err?.message || err}\n`,
    );
    return undefined;
  }
}

const stream = prettyStream();

export const logger = stream ? pino({ level }, stream) : pino({ level });
