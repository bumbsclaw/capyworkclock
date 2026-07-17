import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pageSource = await readFile(
  new URL("../components/clock-app.tsx", import.meta.url),
  "utf8",
);
const stylesheet = await readFile(
  new URL("../app/globals.css", import.meta.url),
  "utf8",
);

test("the clock has no recurring interval or infinite visual animation", () => {
  assert.doesNotMatch(pageSource, /setInterval\s*\(/);
  assert.doesNotMatch(stylesheet, /animation\s*:[^;]*\binfinite\b/i);
  assert.match(pageSource, /millisecondsUntilNextMinute\(todayMs\)/);
  assert.match(pageSource, /millisecondsUntilNextMinute\(weekMs\)/);
});

test("the current day and week share one summary calculation", () => {
  assert.match(pageSource, /calculateCurrentTotals\(events, now\)/);
});

test("reset requires confirmation and clears only the time ledger", () => {
  assert.match(pageSource, /Reset all recorded time\?/);
  assert.match(pageSource, /mutateStoredValue\(STORAGE_KEY/);
  assert.match(pageSource, /value:\s*null/);
});

test("web and Android render the same clock component", async () => {
  const webEntry = await readFile(
    new URL("../app/page.tsx", import.meta.url),
    "utf8",
  );
  const androidEntry = await readFile(
    new URL("../mobile/main.tsx", import.meta.url),
    "utf8",
  );

  assert.match(webEntry, /@\/components\/clock-app/);
  assert.match(androidEntry, /@\/components\/clock-app/);
});
