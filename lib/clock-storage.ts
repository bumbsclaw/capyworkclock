import {
  DEFAULT_TARGET_HOURS,
  sanitizeEvents,
  sanitizeTargetHours,
} from "./clock.ts";
import type { ClockEvent } from "./clock.ts";

export const STORAGE_KEY = "capybara-boundary-clock.events.v1";
export const SETTINGS_KEY = "capybara-boundary-clock.settings.v1";
export const LEDGER_SCHEMA_VERSION = 2;
export const SETTINGS_SCHEMA_VERSION = 2;
export const BACKUP_FORMAT = "capybara-work-clock-backup";
export const BACKUP_VERSION = 1;

type LedgerEnvelope = {
  version: typeof LEDGER_SCHEMA_VERSION;
  events: ClockEvent[];
};

type SettingsEnvelope = {
  version: typeof SETTINGS_SCHEMA_VERSION;
  targetHours: number;
};

export type ClockBackup = {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  exportedAt: string;
  ledger: LedgerEnvelope;
  settings: SettingsEnvelope;
};

export type ParsedValue<T> = {
  value: T;
  needsRewrite: boolean;
};

export class StoredDataError extends Error {
  readonly rawValue: string;

  constructor(
    message: string,
    rawValue: string,
  ) {
    super(message);
    this.name = "StoredDataError";
    this.rawValue = rawValue;
  }
}

export function parseLedger(rawValue: string | null): ParsedValue<ClockEvent[]> {
  if (rawValue === null) return { value: [], needsRewrite: false };

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawValue);
  } catch {
    throw new StoredDataError("The saved clock history is not valid JSON.", rawValue);
  }

  const source = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && parsed.version === LEDGER_SCHEMA_VERSION
      ? parsed.events
      : undefined;
  if (!Array.isArray(source)) {
    throw new StoredDataError("The saved clock history has an unknown format.", rawValue);
  }

  const events = sanitizeEvents(source);
  const needsRewrite =
    Array.isArray(parsed) ||
    events.length !== source.length ||
    JSON.stringify(events) !== JSON.stringify(source);
  return { value: events, needsRewrite };
}

export function serializeLedger(events: ClockEvent[]) {
  return JSON.stringify({
    version: LEDGER_SCHEMA_VERSION,
    events,
  } satisfies LedgerEnvelope);
}

export function parseSettings(rawValue: string | null): ParsedValue<number> {
  if (rawValue === null) {
    return { value: DEFAULT_TARGET_HOURS, needsRewrite: false };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawValue);
  } catch {
    throw new StoredDataError("The saved weekly target is not valid JSON.", rawValue);
  }
  if (!isRecord(parsed) || !("targetHours" in parsed)) {
    throw new StoredDataError("The saved weekly target has an unknown format.", rawValue);
  }

  const targetHours = sanitizeTargetHours(parsed.targetHours);
  return {
    value: targetHours,
    needsRewrite:
      parsed.version !== SETTINGS_SCHEMA_VERSION ||
      parsed.targetHours !== targetHours,
  };
}

export function serializeSettings(targetHours: number) {
  return JSON.stringify({
    version: SETTINGS_SCHEMA_VERSION,
    targetHours: sanitizeTargetHours(targetHours),
  } satisfies SettingsEnvelope);
}

export function serializeBackup(
  events: ClockEvent[],
  targetHours: number,
  exportedAt = new Date().toISOString(),
) {
  const backup: ClockBackup = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt,
    ledger: JSON.parse(serializeLedger(events)) as LedgerEnvelope,
    settings: JSON.parse(serializeSettings(targetHours)) as SettingsEnvelope,
  };
  return JSON.stringify(backup, null, 2);
}

export function parseBackup(rawValue: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawValue);
  } catch {
    throw new StoredDataError("The backup file is not valid JSON.", rawValue);
  }
  if (
    !isRecord(parsed) ||
    parsed.format !== BACKUP_FORMAT ||
    parsed.version !== BACKUP_VERSION ||
    typeof parsed.exportedAt !== "string" ||
    !Number.isFinite(Date.parse(parsed.exportedAt))
  ) {
    throw new StoredDataError("This is not a supported Capy Work Clock backup.", rawValue);
  }

  const ledger = parseLedger(JSON.stringify(parsed.ledger));
  const settings = parseSettings(JSON.stringify(parsed.settings));
  if (ledger.needsRewrite || settings.needsRewrite) {
    throw new StoredDataError(
      "The backup contains invalid or incomplete clock data.",
      rawValue,
    );
  }
  return { events: ledger.value, targetHours: settings.value };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
