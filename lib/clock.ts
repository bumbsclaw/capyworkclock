export type EventType = "start" | "break" | "resume" | "eod";
type SequencedEvent = { id: string; at: number; sequence: number };
export type ActionEvent = SequencedEvent & { type: EventType };
export type AdjustmentEvent = {
  id: string;
  type: "adjustment";
  at: number;
  sequence: number;
  deltaMs: number;
};
export type DailyTotalEvent = {
  id: string;
  type: "daily-total";
  at: number;
  sequence: number;
  deltaMs: number;
};
export type ClockEvent = ActionEvent | AdjustmentEvent | DailyTotalEvent;
export type ClockStatus = "idle" | "working" | "break" | "ended";

export const HOUR_MS = 60 * 60 * 1000;
export const MINUTE_MS = 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;
export const EOD_SOAK_MS = 30 * MINUTE_MS;
export const DEFAULT_TARGET_HOURS = 40;
export const MAX_LEDGER_EVENTS = 5000;
const MAX_ROLLUP_DAYS = 20_000;
const MAX_DATE_TIMESTAMP = 8_640_000_000_000_000;

export function compareEvents(a: ClockEvent, b: ClockEvent) {
  return a.sequence - b.sequence || a.at - b.at || a.id.localeCompare(b.id);
}

export function orderEvents(events: ClockEvent[]) {
  return [...events].sort(compareEvents);
}

export function nextEventSequence(events: ClockEvent[]) {
  return events.reduce(
    (maximum, event) => Math.max(maximum, event.sequence),
    0,
  ) + 1;
}

export function timestampForNextAction(events: ClockEvent[], wallClockAt: number) {
  const previousAction = getLastActionEvent(events);
  return {
    at: Math.max(wallClockAt, previousAction?.at ?? wallClockAt),
    clockSkew: Boolean(previousAction && wallClockAt < previousAction.at),
  };
}

/**
 * Replaces older raw events with exact local-day totals. If a ledger is too
 * concentrated to compact safely (for example, thousands of actions today),
 * it remains oversized instead of silently deleting recorded time.
 */
export function compactLedger(
  inputEvents: ClockEvent[],
  now: number,
  maxEvents = MAX_LEDGER_EVENTS,
) {
  const orderedEvents = orderEvents(inputEvents);
  if (maxEvents <= 0 || orderedEvents.length <= maxEvents) {
    return orderedEvents;
  }

  const cutoff = startOfLocalDay(now);
  const oldEvents = orderedEvents.filter((event) => event.at < cutoff);
  if (oldEvents.length === 0) return orderedEvents;

  const earliestDay = startOfLocalDay(
    oldEvents.reduce((minimum, event) => Math.min(minimum, event.at), cutoff),
  );
  const estimatedDays = Math.ceil(
    Math.abs(cutoff - earliestDay) / DAY_MS,
  );
  if (estimatedDays > MAX_ROLLUP_DAYS) return orderedEvents;

  const rollups: DailyTotalEvent[] = [];
  let dayStart = earliestDay;
  let rollupIndex = 0;
  while (dayStart < cutoff) {
    const dayEnd = startOfNextLocalDay(dayStart);
    const deltaMs = calculateWindowTotal(
      orderedEvents,
      dayStart,
      dayEnd,
      cutoff,
    );
    if (deltaMs > 0) {
      rollups.push({
        id: `daily-total-${localDateInput(dayStart)}`,
        type: "daily-total",
        at: dayStart + Math.floor((dayEnd - dayStart) / 2),
        sequence: ++rollupIndex,
        deltaMs,
      });
    }
    dayStart = dayEnd;
  }

  const actionsBeforeCutoff = orderedEvents.filter(
    (event): event is ActionEvent =>
      event.type !== "adjustment" &&
      event.type !== "daily-total" &&
      event.at < cutoff,
  );
  const lastAction = actionsBeforeCutoff.at(-1) ?? null;
  const anchor: ActionEvent[] = [];
  if (lastAction?.type === "start" || lastAction?.type === "resume") {
    anchor.push({
      id: `compaction-start-${cutoff}`,
      type: "start",
      at: cutoff,
      sequence: 0,
    });
  } else if (lastAction?.type === "break" || lastAction?.type === "eod") {
    anchor.push({ ...lastAction, id: `compaction-${lastAction.type}-${cutoff}` });
  }

  const recent = orderedEvents.filter((event) => event.at >= cutoff);
  return [...rollups, ...anchor, ...recent].map((event, index) => ({
    ...event,
    sequence: index + 1,
  }));
}

export function sanitizeEvents(value: unknown): ClockEvent[] {
  if (!Array.isArray(value)) return [];

  const sanitized: Array<ClockEvent & { sourceIndex: number }> = [];
  const identifiers = new Set<string>();
  for (const [sourceIndex, event] of value.entries()) {
    if (!event || typeof event !== "object") continue;
    const candidate = event as Record<string, unknown>;
    if (
      typeof candidate.id !== "string" ||
      candidate.id.length === 0 ||
      typeof candidate.at !== "number" ||
      !Number.isSafeInteger(candidate.at) ||
      Math.abs(candidate.at) > MAX_DATE_TIMESTAMP
    ) {
      continue;
    }
    if (identifiers.has(candidate.id)) continue;

    const sequence =
      typeof candidate.sequence === "number" &&
      Number.isSafeInteger(candidate.sequence) &&
      candidate.sequence > 0
        ? candidate.sequence
        : 0;

    if (candidate.type === "adjustment") {
      if (
        typeof candidate.deltaMs === "number" &&
        Number.isFinite(candidate.deltaMs) &&
        candidate.deltaMs !== 0 &&
        Math.abs(candidate.deltaMs) <= DAY_MS
      ) {
        sanitized.push({
          id: candidate.id,
          type: "adjustment",
          at: candidate.at,
          sequence,
          deltaMs: candidate.deltaMs,
          sourceIndex,
        });
        identifiers.add(candidate.id);
      }
      continue;
    }

    if (
      candidate.type === "daily-total" &&
      typeof candidate.deltaMs === "number" &&
      Number.isSafeInteger(candidate.deltaMs) &&
      candidate.deltaMs > 0
    ) {
      sanitized.push({
        id: candidate.id,
        type: "daily-total",
        at: candidate.at,
        sequence,
        deltaMs: candidate.deltaMs,
        sourceIndex,
      });
      identifiers.add(candidate.id);
      continue;
    }

    if (["start", "break", "resume", "eod"].includes(String(candidate.type))) {
      sanitized.push({
        id: candidate.id,
        type: candidate.type as EventType,
        at: candidate.at,
        sequence,
        sourceIndex,
      });
      identifiers.add(candidate.id);
    }
  }

  const hasStoredSequence = sanitized.some((event) => event.sequence > 0);
  sanitized.sort((a, b) =>
    hasStoredSequence
      ? (a.sequence || Number.MAX_SAFE_INTEGER) -
          (b.sequence || Number.MAX_SAFE_INTEGER) ||
        a.sourceIndex - b.sourceIndex
      : a.at - b.at || a.sourceIndex - b.sourceIndex,
  );
  return sanitized.map((event, index): ClockEvent => {
    if (event.type === "adjustment" || event.type === "daily-total") {
      return {
        id: event.id,
        type: event.type,
        at: event.at,
        sequence: index + 1,
        deltaMs: event.deltaMs,
      };
    }
    return {
      id: event.id,
      type: event.type,
      at: event.at,
      sequence: index + 1,
    };
  });
}

export function sanitizeTargetHours(value: unknown) {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_TARGET_HOURS;
  return Math.min(168, Math.max(1, Math.round(numeric * 2) / 2));
}

export function capSubtraction(requestedMs: number, availableMs: number) {
  return Math.min(
    Math.max(0, requestedMs),
    Math.max(0, availableMs),
  );
}

export function getLastActionEvent(events: ClockEvent[]) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.type !== "adjustment" && event.type !== "daily-total") {
      return event;
    }
  }
  return null;
}

export function getStatus(events: ClockEvent[]): ClockStatus {
  const event = getLastActionEvent(events);
  if (!event) return "idle";
  if (event.type === "start" || event.type === "resume") return "working";
  if (event.type === "break") return "break";
  return "ended";
}

export function canApply(type: EventType, status: ClockStatus) {
  if (type === "start") return status === "idle" || status === "ended";
  if (type === "break") return status === "working";
  if (type === "resume") return status === "break";
  return status === "working" || status === "break";
}

export function workIntervals(events: ClockEvent[], now: number) {
  const intervals: Array<[number, number]> = [];
  let openedAt: number | null = null;

  for (const event of events) {
    if (event.type === "adjustment" || event.type === "daily-total") continue;
    if (event.type === "start" || event.type === "resume") {
      if (openedAt === null) openedAt = event.at;
      continue;
    }

    if (openedAt !== null) {
      intervals.push([openedAt, Math.max(openedAt, event.at)]);
      openedAt = null;
    }
  }

  if (openedAt !== null) intervals.push([openedAt, Math.max(openedAt, now)]);
  return intervals;
}

export function totalWithin(
  intervals: Array<[number, number]>,
  windowStart: number,
  windowEndExclusive: number,
) {
  return intervals.reduce((total, [start, end]) => {
    const overlap = Math.max(
      0,
      Math.min(end, windowEndExclusive) - Math.max(start, windowStart),
    );
    return total + overlap;
  }, 0);
}

export function adjustmentsWithin(
  events: ClockEvent[],
  windowStart: number,
  windowEndExclusive: number,
) {
  return events.reduce((total, event) => {
    if (
      (event.type !== "adjustment" && event.type !== "daily-total") ||
      event.at < windowStart ||
      event.at >= windowEndExclusive
    ) {
      return total;
    }
    return total + event.deltaMs;
  }, 0);
}

export function startOfLocalDay(timestamp: number) {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

export function startOfNextLocalDay(timestamp: number) {
  const date = new Date(startOfLocalDay(timestamp));
  date.setDate(date.getDate() + 1);
  return date.getTime();
}

export function startOfLocalWeek(timestamp: number) {
  const date = new Date(timestamp);
  const mondayOffset = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - mondayOffset);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

export function startOfNextLocalWeek(timestamp: number) {
  const date = new Date(startOfLocalWeek(timestamp));
  date.setDate(date.getDate() + 7);
  return date.getTime();
}

export function calculateWindowTotal(
  events: ClockEvent[],
  windowStart: number,
  windowEndExclusive: number,
  now: number,
) {
  if (windowEndExclusive <= windowStart) return 0;

  const intervalEnd = Math.min(windowEndExclusive, now);
  const adjustmentEnd = Math.min(windowEndExclusive, now + 1);
  const intervalTotal =
    intervalEnd > windowStart
      ? totalWithin(workIntervals(events, now), windowStart, intervalEnd)
      : 0;
  const adjustmentTotal =
    adjustmentEnd > windowStart
      ? adjustmentsWithin(events, windowStart, adjustmentEnd)
      : 0;
  return Math.max(0, intervalTotal + adjustmentTotal);
}

export function calculateCurrentTotals(events: ClockEvent[], now: number) {
  const todayStart = startOfLocalDay(now);
  const weekStart = startOfLocalWeek(now);
  let todayTotal = 0;
  let weekTotal = 0;

  for (const [start, end] of workIntervals(events, now)) {
    const cappedEnd = Math.min(end, now);
    todayTotal += Math.max(0, cappedEnd - Math.max(start, todayStart));
    weekTotal += Math.max(0, cappedEnd - Math.max(start, weekStart));
  }

  for (const event of events) {
    if (
      (event.type !== "adjustment" && event.type !== "daily-total") ||
      event.at > now
    ) {
      continue;
    }
    if (event.at >= todayStart) todayTotal += event.deltaMs;
    if (event.at >= weekStart) weekTotal += event.deltaMs;
  }

  return {
    todayMs: Math.max(0, todayTotal),
    weekMs: Math.max(0, weekTotal),
  };
}

export function millisecondsUntilNextMinute(elapsedMs: number) {
  const normalized = Math.max(0, Math.floor(elapsedMs));
  const remainder = normalized % MINUTE_MS;
  return remainder === 0 ? MINUTE_MS : MINUTE_MS - remainder;
}

export function localDateInput(timestamp: number) {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function timestampForDate(value: string, now: number) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day, 12, 0, 0, 0);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day ||
    localDateInput(date.getTime()) !== value ||
    value > localDateInput(now)
  ) {
    return null;
  }
  return value === localDateInput(now) ? now : date.getTime();
}

export function isSnoozingAfterEod(events: ClockEvent[], now: number) {
  const event = getLastActionEvent(events);
  return event?.type === "eod" && now >= event.at + EOD_SOAK_MS;
}

export function formatDuration(milliseconds: number) {
  const totalMinutes = Math.max(0, Math.floor(milliseconds / MINUTE_MS));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return [hours, minutes]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
}

export function formatCompact(milliseconds: number) {
  const totalMinutes = Math.max(0, Math.floor(milliseconds / MINUTE_MS));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${String(minutes).padStart(2, "0")}m`;
}

export function formatTarget(hours: number) {
  return Number.isInteger(hours) ? `${hours}h` : `${hours.toFixed(1)}h`;
}
