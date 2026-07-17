import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateCurrentTotals,
  calculateWindowTotal,
  canApply,
  capSubtraction,
  compactLedger,
  DAY_MS,
  DEFAULT_TARGET_HOURS,
  EOD_SOAK_MS,
  formatDuration,
  getStatus,
  HOUR_MS,
  isSnoozingAfterEod,
  millisecondsUntilNextMinute,
  MINUTE_MS,
  sanitizeEvents,
  sanitizeTargetHours,
  startOfLocalDay,
  startOfLocalWeek,
  startOfNextLocalDay,
  startOfNextLocalWeek,
  timestampForDate,
  timestampForNextAction,
  type ClockEvent,
} from "../lib/clock.ts";

const action = (
  type: "start" | "break" | "resume" | "eod",
  at: number,
  sequence = at,
): ClockEvent => ({ id: `${type}-${at}-${sequence}`, type, at, sequence });

const adjustment = (at: number, deltaMs: number): ClockEvent => ({
  id: `adjustment-${at}-${deltaMs}`,
  type: "adjustment",
  at,
  sequence: at,
  deltaMs,
});

test("a day with a one-hour break totals seven hours", () => {
  const day = new Date(2026, 6, 14).getTime();
  const events = [
    action("start", day + 9 * HOUR_MS),
    action("break", day + 12 * HOUR_MS),
    action("resume", day + 13 * HOUR_MS),
    action("eod", day + 17 * HOUR_MS),
  ];
  const now = day + 20 * HOUR_MS;

  assert.equal(
    calculateWindowTotal(
      events,
      startOfLocalDay(now),
      startOfNextLocalDay(now),
      now,
    ),
    7 * HOUR_MS,
  );
});

test("an open timer derives elapsed time from timestamps after a long sleep", () => {
  const day = new Date(2026, 6, 14).getTime();
  const events = [action("start", day + 9 * HOUR_MS)];
  const wokeAt = day + 17 * HOUR_MS + 23 * MINUTE_MS;

  assert.equal(
    calculateWindowTotal(
      events,
      startOfLocalDay(wokeAt),
      startOfNextLocalDay(wokeAt),
      wokeAt,
    ),
    8 * HOUR_MS + 23 * MINUTE_MS,
  );
});

test("current day and week totals share the same reconstructed ledger", () => {
  const monday = new Date(2026, 6, 13).getTime();
  const tuesday = new Date(2026, 6, 14).getTime();
  const now = tuesday + 12 * HOUR_MS;
  const events = [
    action("start", monday + 9 * HOUR_MS),
    action("eod", monday + 17 * HOUR_MS),
    action("start", tuesday + 9 * HOUR_MS),
    adjustment(tuesday + 10 * HOUR_MS, 15 * MINUTE_MS),
  ];

  assert.deepEqual(calculateCurrentTotals(events, now), {
    todayMs: 3 * HOUR_MS + 15 * MINUTE_MS,
    weekMs: 11 * HOUR_MS + 15 * MINUTE_MS,
  });
});

test("working display refreshes only at the next cumulative minute", () => {
  assert.equal(millisecondsUntilNextMinute(0), MINUTE_MS);
  assert.equal(millisecondsUntilNextMinute(26_000), 34_000);
  assert.equal(millisecondsUntilNextMinute(59_999), 1);
  assert.equal(millisecondsUntilNextMinute(MINUTE_MS), MINUTE_MS);
});

test("duration displays use whole minutes without misleading seconds", () => {
  assert.equal(formatDuration(0), "00:00");
  assert.equal(formatDuration(MINUTE_MS - 1), "00:00");
  assert.equal(
    formatDuration(HOUR_MS + 9 * MINUTE_MS + MINUTE_MS - 1),
    "01:09",
  );
  assert.equal(formatDuration(50 * HOUR_MS), "50:00");
});

test("break time stays frozen while wall-clock time advances", () => {
  const day = new Date(2026, 6, 14).getTime();
  const events = [
    action("start", day + 9 * HOUR_MS),
    action("break", day + 10 * HOUR_MS),
  ];
  const now = day + 18 * HOUR_MS;

  assert.equal(getStatus(events), "break");
  assert.equal(
    calculateWindowTotal(
      events,
      startOfLocalDay(now),
      startOfNextLocalDay(now),
      now,
    ),
    HOUR_MS,
  );
});

test("work spanning midnight is clipped to today's local calendar window", () => {
  const yesterday = new Date(2026, 6, 13).getTime();
  const now = new Date(2026, 6, 14, 1).getTime();
  const events = [action("start", yesterday + 23 * HOUR_MS)];

  assert.equal(
    calculateWindowTotal(
      events,
      startOfLocalDay(now),
      startOfNextLocalDay(now),
      now,
    ),
    HOUR_MS,
  );
});

test("the Monday boundary excludes Sunday work from the new week", () => {
  const sunday = new Date(2026, 6, 12).getTime();
  const mondayAtOne = new Date(2026, 6, 13, 1).getTime();
  const events = [action("start", sunday + 23 * HOUR_MS)];

  assert.equal(
    calculateWindowTotal(
      events,
      startOfLocalWeek(mondayAtOne),
      startOfNextLocalWeek(mondayAtOne),
      mondayAtOne,
    ),
    HOUR_MS,
  );
});

test("manual corrections affect totals but never the running state", () => {
  const day = new Date(2026, 6, 14).getTime();
  const now = day + 12 * HOUR_MS;
  const events = [
    action("start", day + 9 * HOUR_MS),
    adjustment(day + 10 * HOUR_MS, 30 * MINUTE_MS),
    adjustment(day + 11 * HOUR_MS, -15 * MINUTE_MS),
  ];

  assert.equal(getStatus(events), "working");
  assert.equal(canApply("break", getStatus(events)), true);
  assert.equal(
    calculateWindowTotal(
      events,
      startOfLocalDay(now),
      startOfNextLocalDay(now),
      now,
    ),
    3 * HOUR_MS + 15 * MINUTE_MS,
  );
});

test("subtraction is capped so it cannot create a hidden negative balance", () => {
  const day = new Date(2026, 6, 14).getTime();
  const capped = capSubtraction(2 * HOUR_MS, HOUR_MS);
  const now = day + 13 * HOUR_MS;
  const events = [
    action("start", day + 9 * HOUR_MS),
    action("eod", day + 10 * HOUR_MS),
    adjustment(day + 11 * HOUR_MS, -capped),
    action("start", day + 12 * HOUR_MS),
  ];

  assert.equal(capped, HOUR_MS);
  assert.equal(
    calculateWindowTotal(
      events,
      startOfLocalDay(now),
      startOfNextLocalDay(now),
      now,
    ),
    HOUR_MS,
  );
});

test("EOD changes from onsen to bed at exactly 30 minutes", () => {
  const eodAt = new Date(2026, 6, 14, 18).getTime();
  const events = [action("eod", eodAt)];

  assert.equal(EOD_SOAK_MS, 30 * MINUTE_MS);
  assert.equal(isSnoozingAfterEod(events, eodAt + EOD_SOAK_MS - 1), false);
  assert.equal(isSnoozingAfterEod(events, eodAt + EOD_SOAK_MS), true);
  assert.equal(
    isSnoozingAfterEod(
      [...events, adjustment(eodAt + EOD_SOAK_MS + 1, MINUTE_MS)],
      eodAt + EOD_SOAK_MS + 1,
    ),
    true,
  );
});

test("ledger compaction preserves totals and the open timer state", () => {
  const day = new Date(2026, 6, 14).getTime();
  const now = day + DAY_MS + HOUR_MS;
  const events = [
    action("start", day + 9 * HOUR_MS, 1),
    adjustment(day + 10 * HOUR_MS, MINUTE_MS),
    adjustment(day + 11 * HOUR_MS, MINUTE_MS),
    adjustment(day + 12 * HOUR_MS, MINUTE_MS),
  ];
  events[1].sequence = 2;
  events[2].sequence = 3;
  events[3].sequence = 4;
  const compacted = compactLedger(events, now, 3);

  assert.ok(compacted.length <= 3);
  assert.equal(getStatus(compacted), "working");
  assert.equal(
    calculateWindowTotal(
      compacted,
      startOfLocalDay(day),
      startOfNextLocalDay(day),
      now,
    ),
    calculateWindowTotal(
      events,
      startOfLocalDay(day),
      startOfNextLocalDay(day),
      now,
    ),
  );
});

test("a backward wall-clock change preserves action order", () => {
  const start = action("start", 100_000, 1);
  const timestamp = timestampForNextAction([start], 90_000);
  const events = [
    start,
    action("break", timestamp.at, 2),
  ];

  assert.equal(timestamp.clockSkew, true);
  assert.equal(timestamp.at, start.at);
  assert.equal(getStatus(events), "break");
});

test("stored data validation rejects malformed dates and oversized corrections", () => {
  const now = new Date(2026, 6, 14, 9).getTime();
  assert.equal(timestampForDate("2026-02-30", now), null);
  assert.equal(timestampForDate("2026-07-15", now), null);
  assert.equal(
    sanitizeEvents([
      adjustment(now, DAY_MS + 1),
      action("start", now),
      action("break", Number.MAX_SAFE_INTEGER),
    ]).length,
    1,
  );
});

test("fresh installs default to a 40-hour configurable boundary", () => {
  assert.equal(DEFAULT_TARGET_HOURS, 40);
  assert.equal(sanitizeTargetHours(undefined), 40);
  assert.equal(sanitizeTargetHours(37.26), 37.5);
  assert.equal(sanitizeTargetHours(999), 168);
});
