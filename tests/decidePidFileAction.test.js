import test from "node:test";
import assert from "node:assert/strict";
import { decidePidFileAction } from "../src/startup/pidManager.js";

// T-060: killZombieProcess used to key off a single global pid file, so a
// spare-port instance would read the LIVE instance's pid and SIGTERM it —
// scoping the file by port fixed WHICH file gets read, but the decision of
// whether to kill what that file names still needs to be right in all
// three states the file (and the pid it names) can actually be in.
// decidePidFileAction is that decision, pulled out of the fs/signal work
// so it can be tested without a live process.
test.describe("decidePidFileAction", () => {
  test("no pid file (or unreadable/garbled content): clean, nothing to kill", () => {
    assert.equal(decidePidFileAction(null, 12345, false), "clean");
  });

  test("pid recorded but that process is gone: clean, nothing to kill", () => {
    assert.equal(decidePidFileAction(99999, 12345, false), "clean");
  });

  test("pid recorded, alive, and not us: kill", () => {
    assert.equal(decidePidFileAction(99999, 12345, true), "kill");
  });

  test("pid recorded is our OWN pid: clean, never kill ourselves", () => {
    // Regardless of what isAlive says — process.kill(ownPid, 0) would say
    // true, but a pid file naming this process is not a second instance.
    assert.equal(decidePidFileAction(12345, 12345, true), "clean");
  });
});
