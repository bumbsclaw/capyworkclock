import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { HOUR_MS } from "@/lib/clock";
import { serializeLedger, STORAGE_KEY, SETTINGS_KEY } from "@/lib/clock-storage";

const storage = vi.hoisted(() => ({
  values: new Map<string, string>(),
  failWrites: false,
  mutationCount: 0,
  listeners: new Set<(key: string) => void>(),
}));

vi.mock("@/lib/platform-storage", () => ({
  getStoredValue: async (key: string) => storage.values.get(key) ?? null,
  isNativeRuntime: () => false,
  mutateStoredValue: async <T,>(
    key: string,
    updater: (value: string | null) => { value: string | null; result: T },
  ) => {
    if (storage.failWrites) throw new Error("storage unavailable");
    storage.mutationCount += 1;
    const mutation = updater(storage.values.get(key) ?? null);
    if (mutation.value === null) storage.values.delete(key);
    else storage.values.set(key, mutation.value);
    return mutation.result;
  },
  quarantineStoredValue: async (key: string, rawValue: string) => {
    const quarantineKey = `${key}.recovered.test`;
    storage.values.set(quarantineKey, rawValue);
    storage.values.delete(key);
    return quarantineKey;
  },
  setStoredValue: async (key: string, value: string) => {
    if (storage.failWrites) throw new Error("storage unavailable");
    storage.values.set(key, value);
  },
  setStoredValues: async (values: Record<string, string | null>) => {
    if (storage.failWrites) throw new Error("storage unavailable");
    for (const [key, value] of Object.entries(values)) {
      if (value === null) storage.values.delete(key);
      else storage.values.set(key, value);
    }
  },
  subscribeStoredValues: (listener: (key: string) => void) => {
    storage.listeners.add(listener);
    return () => storage.listeners.delete(listener);
  },
}));

import ClockApp from "@/components/clock-app";

const NOW = new Date(2026, 6, 16, 12).getTime();

beforeEach(() => {
  storage.values.clear();
  storage.failWrites = false;
  storage.mutationCount = 0;
  storage.listeners.clear();
  vi.spyOn(Date, "now").mockReturnValue(NOW);
});

async function renderHydratedClock() {
  render(<ClockApp />);
  const start = screen.getByRole("button", { name: "Start the day" });
  await waitFor(() =>
    expect(screen.getByLabelText("Weekly target in hours")).toBeEnabled(),
  );
  return start;
}

describe("ClockApp persistence", () => {
  test("commits a clock action before showing the new state", async () => {
    const user = userEvent.setup();
    const start = await renderHydratedClock();
    storage.mutationCount = 0;

    await user.click(start);

    expect(screen.getByText("Working")).toBeInTheDocument();
    expect(storage.mutationCount).toBe(1);
    const stored = JSON.parse(storage.values.get(STORAGE_KEY) ?? "null");
    expect(stored.events).toMatchObject([
      { type: "start", sequence: 1, at: NOW },
    ]);
  });

  test("keeps the visible state unchanged and reports a failed write", async () => {
    const user = userEvent.setup();
    const start = await renderHydratedClock();
    storage.failWrites = true;

    await user.click(start);

    expect(screen.getByText("Ready when you are")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("not saved");
  });

  test("recovers a valid ledger independently from corrupt settings", async () => {
    storage.values.set(
      STORAGE_KEY,
      serializeLedger([
        {
          id: "start",
          type: "start",
          at: NOW - HOUR_MS,
          sequence: 1,
        },
      ]),
    );
    storage.values.set(SETTINGS_KEY, "{broken");

    await renderHydratedClock();

    expect(screen.getByText("Working")).toBeInTheDocument();
    expect(screen.getByLabelText("Today: 01:00")).toBeInTheDocument();
    expect(screen.getByLabelText("Weekly target in hours")).toHaveValue(40);
    expect(screen.getByRole("status")).toHaveTextContent("quarantined");
  });

  test("prevents rapid duplicate actions", async () => {
    const start = await renderHydratedClock();
    storage.mutationCount = 0;

    fireEvent.click(start);
    fireEvent.click(start);
    await waitFor(() => expect(screen.getByText("Working")).toBeInTheDocument());

    expect(storage.mutationCount).toBe(1);
  });
});

describe("ClockApp accessibility and editing", () => {
  test("exposes weekly progress with role and numeric value", async () => {
    await renderHydratedClock();
    expect(
      screen.getByRole("progressbar", { name: /weekly boundary/i }),
    ).toHaveAttribute("aria-valuenow", "0");
  });

  test("contains modal focus and returns it to the invoking control", async () => {
    const user = userEvent.setup();
    await renderHydratedClock();
    const trigger = screen.getByRole("button", { name: /add time/i });
    await user.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Add worked time" });

    await waitFor(() =>
      expect(dialog).toContainElement(document.activeElement as HTMLElement),
    );
    const close = within(dialog).getByRole("button", {
      name: "Close time adjustment",
    });
    close.focus();
    await user.tab({ shift: true });
    expect(dialog).toContainElement(document.activeElement as HTMLElement);

    await user.keyboard("{Escape}");
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  test("allows clearing and replacing the weekly target", async () => {
    const user = userEvent.setup();
    await renderHydratedClock();
    const target = screen.getByLabelText("Weekly target in hours");

    await user.clear(target);
    await user.type(target, "37.5");
    await user.tab();

    await waitFor(() => expect(target).toHaveValue(37.5));
    expect(JSON.parse(storage.values.get(SETTINGS_KEY) ?? "null")).toMatchObject({
      targetHours: 37.5,
    });
  });

  test("shows recent history and can undo the latest event", async () => {
    const user = userEvent.setup();
    const start = await renderHydratedClock();
    await user.click(start);
    await user.click(screen.getByRole("button", { name: "History & backup" }));

    const dialog = screen.getByRole("dialog", { name: "History & backup" });
    expect(within(dialog).getByText("Started the day")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Undo latest change" }));

    await waitFor(() =>
      expect(screen.getByText("Ready when you are")).toBeInTheDocument(),
    );
    expect(within(dialog).getByText("No clock changes recorded yet.")).toBeInTheDocument();
  });
});
