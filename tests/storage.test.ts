import assert from "node:assert/strict";
import test from "node:test";
import "fake-indexeddb/auto";

class MemoryStorage implements Storage {
  #values = new Map<string, string>();

  get length() {
    return this.#values.size;
  }

  clear() {
    this.#values.clear();
  }

  getItem(key: string) {
    return this.#values.get(key) ?? null;
  }

  key(index: number) {
    return [...this.#values.keys()][index] ?? null;
  }

  removeItem(key: string) {
    this.#values.delete(key);
  }

  setItem(key: string, value: string) {
    this.#values.set(key, String(value));
  }
}

const localStorage = new MemoryStorage();
const eventTarget = new EventTarget();
Object.assign(globalThis, {
  window: {
    localStorage,
    addEventListener: eventTarget.addEventListener.bind(eventTarget),
    removeEventListener: eventTarget.removeEventListener.bind(eventTarget),
  },
});

const {
  getStoredValue,
  mutateStoredValue,
  quarantineStoredValue,
  setStoredValues,
} = await import("../lib/browser-storage.ts");
const {
  parseLedger,
  parseBackup,
  parseSettings,
  serializeBackup,
  serializeLedger,
  StoredDataError,
} = await import("../lib/clock-storage.ts");

test("legacy ledgers migrate to sequenced schema without losing events", () => {
  const parsed = parseLedger(
    JSON.stringify([
      { id: "start", type: "start", at: 100 },
      { id: "break", type: "break", at: 200 },
    ]),
  );

  assert.equal(parsed.needsRewrite, true);
  assert.deepEqual(
    parsed.value.map((event) => event.sequence),
    [1, 2],
  );
  assert.equal(parseLedger(serializeLedger(parsed.value)).needsRewrite, false);
});

test("invalid settings do not prevent a valid ledger from being recovered", () => {
  const ledger = parseLedger(
    JSON.stringify([{ id: "start", type: "start", at: 100 }]),
  );
  assert.equal(ledger.value.length, 1);
  assert.throws(() => parseSettings("{broken"), StoredDataError);
});

test("IndexedDB mutations serialize concurrent writers without lost updates", async () => {
  const key = `concurrency-${Date.now()}`;
  await Promise.all(
    Array.from({ length: 40 }, () =>
      mutateStoredValue(key, (rawValue) => {
        const value = Number(rawValue ?? 0) + 1;
        return { value: String(value), result: value };
      }),
    ),
  );

  assert.equal(await getStoredValue(key), "40");
});

test("legacy localStorage values migrate into IndexedDB", async () => {
  const key = `legacy-${Date.now()}`;
  localStorage.setItem(key, "kept");

  assert.equal(await getStoredValue(key), "kept");
  assert.equal(localStorage.getItem(key), null);
  assert.equal(await getStoredValue(key), "kept");
});

test("corrupt values are quarantined instead of overwritten", async () => {
  const key = `corrupt-${Date.now()}`;
  await mutateStoredValue(key, () => ({ value: "{broken", result: undefined }));
  const quarantineKey = await quarantineStoredValue(key, "{broken");

  assert.equal(await getStoredValue(key), null);
  assert.equal(await getStoredValue(quarantineKey), "{broken");
});

test("portable backups round-trip ledger and settings with format validation", () => {
  const events = parseLedger(
    JSON.stringify([{ id: "start", type: "start", at: 100 }]),
  ).value;
  const backup = serializeBackup(events, 37.5, "2026-07-16T00:00:00.000Z");

  assert.deepEqual(parseBackup(backup), { events, targetHours: 37.5 });
  assert.throws(
    () => parseBackup(JSON.stringify({ format: "something-else" })),
    StoredDataError,
  );
  const malformed = JSON.parse(backup);
  malformed.ledger.events.push({ id: "broken", type: "start", at: "tomorrow" });
  assert.throws(() => parseBackup(JSON.stringify(malformed)), StoredDataError);

  const clamped = JSON.parse(backup);
  clamped.settings.targetHours = 999;
  assert.throws(() => parseBackup(JSON.stringify(clamped)), StoredDataError);
});

test("multi-key restores commit all backup values together", async () => {
  const first = `restore-ledger-${Date.now()}`;
  const second = `restore-settings-${Date.now()}`;
  await setStoredValues({ [first]: "ledger", [second]: "settings" });

  assert.equal(await getStoredValue(first), "ledger");
  assert.equal(await getStoredValue(second), "settings");
});
