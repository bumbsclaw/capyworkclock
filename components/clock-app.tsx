"use client";

import {
  ChangeEvent,
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  calculateCurrentTotals,
  calculateWindowTotal,
  capSubtraction,
  canApply,
  ClockEvent,
  ClockStatus,
  compactLedger,
  DAY_MS,
  DEFAULT_TARGET_HOURS,
  EOD_SOAK_MS,
  EventType,
  formatCompact,
  formatDuration,
  formatTarget,
  getLastActionEvent,
  getStatus,
  HOUR_MS,
  isSnoozingAfterEod,
  localDateInput,
  millisecondsUntilNextMinute,
  MINUTE_MS,
  sanitizeTargetHours,
  nextEventSequence,
  startOfLocalDay,
  startOfNextLocalDay,
  timestampForDate,
  timestampForNextAction,
} from "@/lib/clock";
import {
  getStoredValue,
  isNativeRuntime,
  mutateStoredValue,
  quarantineStoredValue,
  setStoredValues,
  setStoredValue,
  subscribeStoredValues,
} from "@/lib/platform-storage";
import {
  parseLedger,
  parseBackup,
  parseSettings,
  SETTINGS_KEY,
  serializeBackup,
  serializeLedger,
  serializeSettings,
  STORAGE_KEY,
  StoredDataError,
} from "@/lib/clock-storage";

type AdjustmentMode = "add" | "subtract";

type LedgerUpdate<T> = {
  events: ClockEvent[];
  result: T;
  timestamp: number;
};

const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "a[href]",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function currentTimestamp() {
  return Date.now();
}

function eventId(at: number) {
  if (typeof window.crypto?.randomUUID === "function") {
    return `${at}-${window.crypto.randomUUID()}`;
  }

  const entropy = new Uint32Array(4);
  if (typeof window.crypto?.getRandomValues === "function") {
    window.crypto.getRandomValues(entropy);
    return `${at}-${Array.from(entropy, (part) => part.toString(36)).join("-")}`;
  }

  return `${at}-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

function trapDialogFocus(event: KeyboardEvent, dialog: HTMLElement) {
  if (event.key !== "Tab") return;
  const focusable = Array.from(
    dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter((element) => !element.hidden);
  if (focusable.length === 0) {
    event.preventDefault();
    dialog.focus();
    return;
  }

  const first = focusable[0];
  const last = focusable.at(-1)!;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function historyLabel(event: ClockEvent) {
  if (event.type === "adjustment") {
    return `${event.deltaMs > 0 ? "Added" : "Subtracted"} ${formatCompact(
      Math.abs(event.deltaMs),
    )}`;
  }
  if (event.type === "daily-total") {
    return `Compacted daily total: ${formatCompact(event.deltaMs)}`;
  }
  return {
    start: "Started the day",
    break: "Started a break",
    resume: "Resumed work",
    eod: "Ended the day",
  }[event.type];
}

const statusCopy: Record<ClockStatus, { label: string; note: string }> = {
  idle: {
    label: "Ready when you are",
    note: "A gentle day starts when you’re ready.",
  },
  working: {
    label: "Working",
    note: "You’re on the clock. Future-you is off the clock.",
  },
  break: {
    label: "On a break",
    note: "Stretch, sip, wander. The timer is resting too.",
  },
  ended: {
    label: "Day complete",
    note: "Good work, gentle human. Work can wait until tomorrow.",
  },
};

const scenes: Record<
  ClockStatus,
  { src: string; alt: string; plaque: string }
> = {
  idle: {
    src: "./state-idle.webp",
    alt: "A watercolor capybara snoozing under a knitted blanket at sunrise",
    plaque: "begin gently, when you’re ready",
  },
  working: {
    src: "./meadow-desk.webp",
    alt: "A watercolor capybara reviewing an open notebook at a cozy desk beside a wildflower meadow",
    plaque: "good work, gentle human",
  },
  break: {
    src: "./state-break-four-toes.webp",
    alt: "A watercolor capybara enjoying coconut water on a meadow break",
    plaque: "coconut breaks count",
  },
  ended: {
    src: "./state-eod.webp",
    alt: "A watercolor capybara relaxing in a warm onsen at twilight",
    plaque: "the workday ends here",
  },
};

const postOnsenScene = {
  src: "./state-idle.webp",
  alt: "A watercolor capybara snoozing under a knitted blanket after a long soak",
  plaque: "30 minutes later… tucked in & snoozing",
};

const preloadScenes: Record<ClockStatus, string[]> = {
  idle: [scenes.working.src],
  working: [scenes.break.src, scenes.ended.src],
  break: [scenes.working.src, scenes.ended.src],
  ended: [postOnsenScene.src],
};

function ControlIcon({ type }: { type: EventType }) {
  if (type === "start") {
    return (
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <path d="M5 23h22M8 19a8 8 0 0 1 16 0M16 5v4M6.5 10.5l3 3M25.5 10.5l-3 3" />
      </svg>
    );
  }
  if (type === "break") {
    return (
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <path d="M16 27V13M16 19c-5 0-8-3-8-8 5 0 8 3 8 8ZM16 16c0-5 3-8 8-8 0 5-3 8-8 8Z" />
      </svg>
    );
  }
  if (type === "resume") {
    return (
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <path d="m11 7 14 9-14 9V7Z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <path d="M5 23h22M8 19a8 8 0 0 1 16 0M16 5v4M6.5 10.5l3 3M25.5 10.5l-3 3" />
    </svg>
  );
}

export default function ClockApp() {
  const [events, setEvents] = useState<ClockEvent[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [hydrated, setHydrated] = useState(false);
  const [targetHours, setTargetHours] = useState(DEFAULT_TARGET_HOURS);
  const [targetDraft, setTargetDraft] = useState(
    String(DEFAULT_TARGET_HOURS),
  );
  const [adjustmentMode, setAdjustmentMode] =
    useState<AdjustmentMode | null>(null);
  const [adjustmentDate, setAdjustmentDate] = useState("");
  const [adjustmentHours, setAdjustmentHours] = useState(0);
  const [adjustmentMinutes, setAdjustmentMinutes] = useState(30);
  const [resetConfirmationOpen, setResetConfirmationOpen] = useState(false);
  const [dataToolsOpen, setDataToolsOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [storageError, setStorageError] = useState("");
  const [busy, setBusy] = useState(false);
  const mutationInFlight = useRef(false);
  const appContentRef = useRef<HTMLDivElement>(null);
  const adjustmentDialogRef = useRef<HTMLElement>(null);
  const resetDialogRef = useRef<HTMLElement>(null);
  const dataToolsDialogRef = useRef<HTMLElement>(null);
  const backupTextareaRef = useRef<HTMLTextAreaElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadLedger = async () => {
      const saved = await getStoredValue(STORAGE_KEY);
      try {
        const parsed = parseLedger(saved);
        if (parsed.needsRewrite) {
          await setStoredValue(STORAGE_KEY, serializeLedger(parsed.value));
        }
        return { events: parsed.value, recovered: false };
      } catch (error) {
        if (error instanceof StoredDataError) {
          await quarantineStoredValue(STORAGE_KEY, error.rawValue);
          return { events: [] as ClockEvent[], recovered: true };
        }
        throw error;
      }
    };

    const loadSettings = async () => {
      const saved = await getStoredValue(SETTINGS_KEY);
      try {
        const parsed = parseSettings(saved);
        if (parsed.needsRewrite) {
          await setStoredValue(SETTINGS_KEY, serializeSettings(parsed.value));
        }
        return { targetHours: parsed.value, recovered: false };
      } catch (error) {
        if (error instanceof StoredDataError) {
          await quarantineStoredValue(SETTINGS_KEY, error.rawValue);
          return { targetHours: DEFAULT_TARGET_HOURS, recovered: true };
        }
        throw error;
      }
    };

    const hydrate = async () => {
      const [ledgerResult, settingsResult] = await Promise.allSettled([
        loadLedger(),
        loadSettings(),
      ]);
      if (cancelled) return;

      if (ledgerResult.status === "fulfilled") {
        setEvents(ledgerResult.value.events);
      } else {
        setStorageError(
          "Clock history could not be read. No changes will be saved until storage is available.",
        );
      }
      if (settingsResult.status === "fulfilled") {
        const target = settingsResult.value.targetHours;
        setTargetHours(target);
        setTargetDraft(String(target));
      } else {
        setStorageError(
          "Some saved settings could not be read. Check browser or device storage.",
        );
      }
      if (
        (ledgerResult.status === "fulfilled" && ledgerResult.value.recovered) ||
        (settingsResult.status === "fulfilled" && settingsResult.value.recovered)
      ) {
        setNotice(
          "Invalid saved data was quarantined. Valid clock data was kept where possible.",
        );
      }
      setNow(currentTimestamp());
      setHydrated(true);
    };

    void hydrate();

    const syncFromStorage = async (key: string) => {
      if (key === STORAGE_KEY) {
        try {
          const saved = await getStoredValue(STORAGE_KEY);
          const parsed = parseLedger(saved);
          if (!cancelled) setEvents(parsed.value);
        } catch (error) {
          if (!cancelled) {
            setStorageError(
              error instanceof StoredDataError
                ? "Another window wrote invalid clock data. Your current view was preserved."
                : "Clock changes from another window could not be read.",
            );
          }
        }
        if (!cancelled) setNow(currentTimestamp());
      }
      if (key === SETTINGS_KEY) {
        try {
          const saved = await getStoredValue(SETTINGS_KEY);
          const target = parseSettings(saved).value;
          if (!cancelled) {
            setTargetHours(target);
            setTargetDraft(String(target));
          }
        } catch (error) {
          if (!cancelled) {
            setStorageError(
              error instanceof StoredDataError
                ? "Another window wrote invalid settings. Your current target was preserved."
                : "Settings from another window could not be read.",
            );
          }
        }
      }
    };
    const unsubscribe = subscribeStoredValues((key) => {
      void syncFromStorage(key);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const status = getStatus(events);
  const lastAction = getLastActionEvent(events);
  const snoozingAfterEod = isSnoozingAfterEod(events, now);
  const dayKey = localDateInput(now);
  const { todayMs, weekMs } = useMemo(
    () => calculateCurrentTotals(events, now),
    [events, now],
  );

  useEffect(() => {
    for (const src of preloadScenes[status]) {
      const image = new Image();
      image.src = src;
    }
  }, [status]);

  useEffect(() => {
    if (status !== "working") return;
    const delay =
      Math.min(
        millisecondsUntilNextMinute(todayMs),
        millisecondsUntilNextMinute(weekMs),
      ) + 25;
    const timeout = window.setTimeout(
      () => setNow(currentTimestamp()),
      delay,
    );
    return () => window.clearTimeout(timeout);
  }, [status, todayMs, weekMs]);

  useEffect(() => {
    const refresh = () => setNow(currentTimestamp());
    const refreshWhenVisible = () => {
      if (!document.hidden) refresh();
    };
    window.addEventListener("focus", refresh);
    window.addEventListener("pageshow", refresh);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("pageshow", refresh);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, []);

  useEffect(() => {
    const current = currentTimestamp();
    const deadlines = [startOfNextLocalDay(current)];
    if (
      status === "ended" &&
      lastAction?.type === "eod" &&
      !snoozingAfterEod
    ) {
      deadlines.push(lastAction.at + EOD_SOAK_MS);
    }
    const nextDeadline = Math.min(...deadlines);
    const delay = Math.min(2_147_483_647, Math.max(0, nextDeadline - current + 25));
    const timeout = window.setTimeout(
      () => setNow(currentTimestamp()),
      delay,
    );
    return () => window.clearTimeout(timeout);
  }, [dayKey, lastAction?.at, lastAction?.type, snoozingAfterEod, status]);

  useEffect(() => {
    if (!adjustmentMode && !resetConfirmationOpen && !dataToolsOpen) return;
    const dialog = adjustmentMode
      ? adjustmentDialogRef.current
      : resetConfirmationOpen
        ? resetDialogRef.current
        : dataToolsDialogRef.current;
    if (!dialog) return;

    const appContent = appContentRef.current;
    appContent?.setAttribute("inert", "");
    const closeDialog = () => {
      if (mutationInFlight.current) return;
      setAdjustmentMode(null);
      setResetConfirmationOpen(false);
      setDataToolsOpen(false);
    };
    const handleKeyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeDialog();
      } else {
        trapDialogFocus(event, dialog);
      }
    };
    const focusFrame = window.requestAnimationFrame(() => {
      const initial = dialog.querySelector<HTMLElement>(
        "[autofocus], button:not([disabled]), input:not([disabled])",
      );
      (initial ?? dialog).focus();
    });
    let nativeBackHandle: { remove: () => Promise<void> } | null = null;
    let disposed = false;
    if (isNativeRuntime()) {
      void import("@capacitor/app").then(async ({ App }) => {
        const handle = await App.addListener("backButton", closeDialog);
        if (disposed) await handle.remove();
        else nativeBackHandle = handle;
      });
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyboard);
    return () => {
      disposed = true;
      window.cancelAnimationFrame(focusFrame);
      appContent?.removeAttribute("inert");
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyboard);
      void nativeBackHandle?.remove();
      window.requestAnimationFrame(() => returnFocusRef.current?.focus());
    };
  }, [adjustmentMode, dataToolsOpen, resetConfirmationOpen]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(""), 5000);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const scene = snoozingAfterEod ? postOnsenScene : scenes[status];

  const reportPersistenceFailure = async (error: unknown) => {
    if (error instanceof StoredDataError) {
      try {
        await quarantineStoredValue(STORAGE_KEY, error.rawValue);
        setStorageError(
          "Invalid clock data was quarantined. Review the current totals, then retry your change.",
        );
      } catch {
        setStorageError(
          "Saved clock data is invalid and could not be quarantined. No change was made.",
        );
      }
      return;
    }
    setStorageError(
      "This change was not saved. Check browser or device storage and try again.",
    );
  };

  const mutateLedger = async <T,>(
    updater: (currentEvents: ClockEvent[]) => LedgerUpdate<T>,
  ): Promise<LedgerUpdate<T> | null> => {
    if (mutationInFlight.current) return null;
    mutationInFlight.current = true;
    setBusy(true);
    setStorageError("");
    try {
      const committed = await mutateStoredValue(STORAGE_KEY, (rawValue) => {
        const currentEvents = parseLedger(rawValue).value;
        const update = updater(currentEvents);
        const compacted = compactLedger(update.events, update.timestamp);
        return {
          value: serializeLedger(compacted),
          result: { ...update, events: compacted },
        };
      });
      setEvents(committed.events);
      setNow(committed.timestamp);
      return committed;
    } catch (error) {
      await reportPersistenceFailure(error);
      return null;
    } finally {
      mutationInFlight.current = false;
      setBusy(false);
    }
  };

  const addEvent = async (type: EventType) => {
    const wallClockAt = currentTimestamp();
    const committed = await mutateLedger((base) => {
      if (!canApply(type, getStatus(base))) {
        return {
          events: base,
          result: { applied: false, clockSkew: false },
          timestamp: wallClockAt,
        };
      }
      const { at, clockSkew } = timestampForNextAction(base, wallClockAt);
      return {
        events: [
          ...base,
          {
            id: eventId(wallClockAt),
            type,
            at,
            sequence: nextEventSequence(base),
          },
        ],
        result: { applied: true, clockSkew },
        timestamp: wallClockAt,
      };
    });
    if (!committed) return;
    if (!committed.result.applied) {
      setNotice(
        "The clock changed in another window, so that action was not applied.",
      );
    } else if (committed.result.clockSkew) {
      setNotice(
        "Device time moved backwards. The action order was preserved; check today’s total and correct it if needed.",
      );
    }
  };

  const commitTarget = async () => {
    const parsed = Number(targetDraft);
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > 168) {
      setTargetDraft(String(targetHours));
      setStorageError("Weekly target must be between 1 and 168 hours.");
      return;
    }
    const next = sanitizeTargetHours(parsed);
    if (next === targetHours) {
      setTargetDraft(String(next));
      return;
    }
    if (mutationInFlight.current) return;
    mutationInFlight.current = true;
    setBusy(true);
    setStorageError("");
    try {
      await setStoredValue(SETTINGS_KEY, serializeSettings(next));
      setTargetHours(next);
      setTargetDraft(String(next));
    } catch (error) {
      setTargetDraft(String(targetHours));
      await reportPersistenceFailure(error);
    } finally {
      mutationInFlight.current = false;
      setBusy(false);
    }
  };

  const openAdjustment = (mode: AdjustmentMode) => {
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    setAdjustmentMode(mode);
    setAdjustmentDate(localDateInput(currentTimestamp()));
    setAdjustmentHours(0);
    setAdjustmentMinutes(30);
  };

  const openResetConfirmation = () => {
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    setResetConfirmationOpen(true);
  };

  const openDataTools = () => {
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    setDataToolsOpen(true);
  };

  const resetAllTime = async () => {
    if (mutationInFlight.current) return;
    mutationInFlight.current = true;
    setBusy(true);
    setStorageError("");
    try {
      await mutateStoredValue(STORAGE_KEY, () => ({
        value: null,
        result: undefined,
      }));
      setEvents([]);
      setNow(currentTimestamp());
      setResetConfirmationOpen(false);
      setNotice("All recorded time has been reset.");
    } catch (error) {
      await reportPersistenceFailure(error);
    } finally {
      mutationInFlight.current = false;
      setBusy(false);
    }
  };

  const undoLatestChange = async () => {
    const committed = await mutateLedger((base) => {
      const latest = [...base]
        .reverse()
        .find(
          (event) =>
            event.type !== "daily-total" &&
            !event.id.startsWith("compaction-"),
        );
      return {
        events: latest ? base.filter((event) => event.id !== latest.id) : base,
        result: latest ? historyLabel(latest) : null,
        timestamp: currentTimestamp(),
      };
    });
    if (!committed) return;
    setNotice(
      committed.result
        ? `Undid: ${committed.result}.`
        : "There is no recent unaggregated change to undo.",
    );
  };

  const copyBackup = async () => {
    const backup = serializeBackup(events, targetHours);
    try {
      await navigator.clipboard.writeText(backup);
      setNotice("Backup copied to the clipboard.");
    } catch {
      backupTextareaRef.current?.focus();
      backupTextareaRef.current?.select();
      setNotice("Select and copy the highlighted backup text.");
    }
  };

  const downloadBackup = () => {
    const blob = new Blob([serializeBackup(events, targetHours)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `capy-work-clock-${localDateInput(currentTimestamp())}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const importBackup = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || mutationInFlight.current) return;
    if (file.size > 5 * 1024 * 1024) {
      setStorageError("That backup is larger than the supported 5 MB limit.");
      return;
    }

    mutationInFlight.current = true;
    setBusy(true);
    setStorageError("");
    try {
      const parsed = parseBackup(await file.text());
      const timestamp = currentTimestamp();
      const importedEvents = compactLedger(parsed.events, timestamp);
      await setStoredValues({
        [STORAGE_KEY]: serializeLedger(importedEvents),
        [SETTINGS_KEY]: serializeSettings(parsed.targetHours),
      });
      setEvents(importedEvents);
      setTargetHours(parsed.targetHours);
      setTargetDraft(String(parsed.targetHours));
      setNow(timestamp);
      setDataToolsOpen(false);
      setNotice("Backup imported successfully.");
    } catch (error) {
      setStorageError(
        error instanceof StoredDataError
          ? error.message
          : "The backup could not be imported. No existing data was changed.",
      );
    } finally {
      mutationInFlight.current = false;
      setBusy(false);
    }
  };

  const saveAdjustment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!adjustmentMode) return;
    const savedAt = currentTimestamp();
    const effectiveAt = timestampForDate(adjustmentDate, savedAt);
    const requestedMs =
      Math.max(0, adjustmentHours) * HOUR_MS +
      Math.max(0, adjustmentMinutes) * MINUTE_MS;
    const cappedRequestMs = Math.min(DAY_MS, requestedMs);
    if (effectiveAt === null || cappedRequestMs < MINUTE_MS) return;

    const mode = adjustmentMode;
    const committed = await mutateLedger((base) => {
      const availableMs = calculateWindowTotal(
        base,
        startOfLocalDay(effectiveAt),
        startOfNextLocalDay(effectiveAt),
        savedAt,
      );
      const amountMs =
        mode === "subtract"
          ? capSubtraction(cappedRequestMs, availableMs)
          : cappedRequestMs;
      if (amountMs < MINUTE_MS) {
        return {
          events: base,
          result: { applied: false, amountMs },
          timestamp: savedAt,
        };
      }
      const deltaMs = mode === "add" ? amountMs : -amountMs;
      return {
        events: [
          ...base,
          {
            id: eventId(savedAt),
            type: "adjustment",
            at: effectiveAt,
            sequence: nextEventSequence(base),
            deltaMs,
          },
        ],
        result: { applied: true, amountMs },
        timestamp: savedAt,
      };
    });
    if (!committed) return;
    if (!committed.result.applied) {
      setNotice("There isn’t a full minute recorded on that day to subtract.");
      setAdjustmentMode(null);
      return;
    }

    const verb = mode === "add" ? "Added" : "Subtracted";
    const dateLabel = new Date(effectiveAt).toLocaleDateString(undefined, {
      weekday: "short",
      day: "numeric",
      month: "short",
    });
    setNotice(
      `${verb} ${formatCompact(committed.result.amountMs)} on ${dateLabel}.`,
    );
    setAdjustmentMode(null);
  };

  const handleTargetKeyDown = (
    event: ReactKeyboardEvent<HTMLInputElement>,
  ) => {
    if (event.key === "Enter") event.currentTarget.blur();
    if (event.key === "Escape") {
      setTargetDraft(String(targetHours));
      event.currentTarget.blur();
    }
  };

  const controls: Array<{
    type: EventType;
    label: string;
    enabled: boolean;
  }> = [
    {
      type: "start",
      label: "Start the day",
      enabled: status === "idle" || status === "ended",
    },
    { type: "break", label: "Break", enabled: status === "working" },
    { type: "resume", label: "Resume", enabled: status === "break" },
    {
      type: "eod",
      label: "EOD",
      enabled: status === "working" || status === "break",
    },
  ];

  const targetMs = targetHours * HOUR_MS;
  const progress = Math.min(100, (weekMs / targetMs) * 100);
  const boundaryDelta = Math.abs(targetMs - weekMs);
  const targetLabel = formatTarget(targetHours);
  const boundaryNote =
    weekMs > targetMs
      ? `${formatCompact(boundaryDelta)} beyond your boundary`
      : `${formatCompact(boundaryDelta)} left to ${targetLabel}`;
  const requestedAdjustmentAmount = Math.min(
    DAY_MS,
    adjustmentHours * HOUR_MS + adjustmentMinutes * MINUTE_MS,
  );
  const adjustmentTimestamp = adjustmentDate
    ? timestampForDate(adjustmentDate, now)
    : null;
  const subtractableMs =
    adjustmentMode !== "subtract" || adjustmentTimestamp === null
      ? 0
      : calculateWindowTotal(
          events,
          startOfLocalDay(adjustmentTimestamp),
          startOfNextLocalDay(adjustmentTimestamp),
          now,
        );
  const adjustmentAmount =
    adjustmentMode === "subtract"
      ? capSubtraction(requestedAdjustmentAmount, subtractableMs)
      : requestedAdjustmentAmount;
  const adjustmentWasCapped =
    adjustmentMode === "subtract" &&
    requestedAdjustmentAmount > subtractableMs;
  const hasUndoableEvent = events.some(
    (event) =>
      event.type !== "daily-total" && !event.id.startsWith("compaction-"),
  );

  return (
    <main className="app-shell" aria-busy={busy}>
      <div className="app-content" ref={appContentRef}>
      <header className="site-header">
        <h1
          className="brand"
          aria-label="Capybara Healthy Work Boundaries Clock"
        >
          <span className="brand-mark" aria-hidden="true">
            {/* Purpose-sized local WebP; no runtime image transform is needed. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="./boundary-clock-icon.webp"
              alt=""
              width="96"
              height="96"
              decoding="async"
            />
          </span>
          <span>Capybara Healthy Work Boundaries Clock</span>
        </h1>
        <p className="boundary-mantra">
          <span aria-hidden="true">❧</span>
          You’ve done enough for today when the clock says so.
        </p>
      </header>

      <section className="hero" aria-label="Work timer">
        <article className={`timer-card state-${status}`}>
          <div className="botanical-corner corner-left" aria-hidden="true">
            ❧
          </div>
          <div className="botanical-corner corner-right" aria-hidden="true">
            ❧
          </div>
          <div className="status-pill" aria-live="polite">
            <span className="status-dot" />
            {statusCopy[status].label}
          </div>
          <p className="eyebrow">
            <span>❧</span> Today <span>❧</span>
          </p>
          <p
            className="today-time"
            aria-label={`Today: ${formatDuration(todayMs)}`}
          >
            {hydrated ? formatDuration(todayMs) : "00:00"}
          </p>
          <p className="state-note">{statusCopy[status].note}</p>
          <div className="stem-divider" aria-hidden="true">
            <span>❧</span>
          </div>
          <div className="controls" aria-label="Clock controls">
            {controls.map((control) => (
              <button
                key={control.type}
                className={`control control-${control.type}`}
                type="button"
                disabled={!hydrated || busy || !control.enabled}
                onClick={() => void addEvent(control.type)}
                aria-label={control.label}
              >
                <ControlIcon type={control.type} />
                <span>{control.label}</span>
              </button>
            ))}
          </div>
        </article>

        <aside className={`meadow-scene scene-${status}`}>
          {/* Full-bleed local WebPs are precompressed and switch instantly by state. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            key={scene.src}
            className="scene-image"
            src={scene.src}
            alt={scene.alt}
            width="1400"
            height="876"
            decoding="async"
            fetchPriority="high"
          />
          <p className="desk-plaque">{scene.plaque}</p>
        </aside>
      </section>

      <section className="summaries" aria-label="Time summary">
        <article className="week-card">
          <div className="week-main">
            <div className="calendar-sketch" aria-hidden="true">
              <span>❧</span>
            </div>
            <div>
              <p className="summary-label">This week</p>
              <p
                className="week-time"
                aria-label={`This week: ${formatDuration(weekMs)}`}
              >
                {hydrated ? formatDuration(weekMs) : "00:00"}
              </p>
              <p className="summary-caption">Total time worked since Monday</p>
            </div>
          </div>
          <div className="correction-row" aria-label="Manual time corrections">
            <span className="correction-label">Forgot a tap?</span>
            <button
              type="button"
              disabled={!hydrated || busy}
              onClick={() => openAdjustment("add")}
            >
              <span aria-hidden="true">＋</span> Add time
            </button>
            <button
              type="button"
              disabled={!hydrated || busy}
              onClick={() => openAdjustment("subtract")}
            >
              <span aria-hidden="true">−</span> Subtract time
            </button>
          </div>
          <div className="reset-row">
            <span>Your records stay under your control.</span>
            <button
              className="data-tools-button"
              type="button"
              disabled={!hydrated || busy}
              onClick={openDataTools}
            >
              History &amp; backup
            </button>
            <button
              className="reset-button"
              type="button"
              disabled={!hydrated || busy}
              onClick={openResetConfirmation}
            >
              <span aria-hidden="true">↺</span> Reset
            </button>
          </div>
          <p className="adjustment-notice" role="status" aria-live="polite">
            {notice || " "}
          </p>
          {storageError && (
            <p className="storage-error" role="alert">
              {storageError}
            </p>
          )}
        </article>

        <article className="progress-card">
          <div className="progress-heading">
            <div>
              <p className="summary-label">Weekly progress</p>
              <p className="progress-total">
                {formatCompact(weekMs)} of {targetLabel}
              </p>
            </div>
            <label className="target-field">
              <span>Weekly target</span>
              <span className="target-input-wrap">
                <input
                  aria-label="Weekly target in hours"
                  type="number"
                  min="1"
                  max="168"
                  step="0.5"
                  value={targetDraft}
                  disabled={!hydrated || busy}
                  onChange={(event) => setTargetDraft(event.target.value)}
                  onBlur={() => void commitTarget()}
                  onKeyDown={handleTargetKeyDown}
                />
                <i>h</i>
              </span>
            </label>
          </div>
          <div
            className="progress-track"
            role="progressbar"
            aria-label={`${Math.round(progress)}% of weekly boundary`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress)}
            aria-valuetext={`${formatCompact(weekMs)} of ${targetLabel}`}
          >
            <span style={{ width: `${progress}%` }} />
            <i aria-hidden="true" />
          </div>
          <div className="progress-foot">
            <span>0h</span>
            <strong className={weekMs > targetMs ? "over-boundary" : ""}>
              {boundaryNote}
            </strong>
            <span>{targetLabel}</span>
          </div>
        </article>
      </section>

      <footer className="garden-footer" aria-hidden="true">
        <span>· ❀ · ❧ · ✿ · ❀ · ❧ · ✿ · ❀ · ❧ ·</span>
      </footer>
      </div>

      {adjustmentMode && (
        <div
          className="modal-backdrop"
          onPointerDown={(event) => {
            if (
              event.target === event.currentTarget &&
              !mutationInFlight.current
            ) {
              setAdjustmentMode(null);
            }
          }}
        >
          <section
            className="adjustment-modal"
            ref={adjustmentDialogRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-labelledby="adjustment-title"
            aria-describedby="adjustment-help"
          >
            <button
              className="modal-close"
              type="button"
              aria-label="Close time adjustment"
              disabled={busy}
              onClick={() => setAdjustmentMode(null)}
            >
              ×
            </button>
            <p className="modal-kicker">A tiny timeline tidy-up</p>
            <h2 id="adjustment-title">
              {adjustmentMode === "add" ? "Add worked time" : "Subtract time"}
            </h2>
            <p id="adjustment-help" className="modal-help">
              Choose the day and duration. This changes your totals without
              changing whether the clock is currently running.
            </p>
            <form onSubmit={saveAdjustment}>
              <label className="form-field date-field">
                <span>Date</span>
                <input
                  type="date"
                  required
                  max={dayKey}
                  value={adjustmentDate}
                  onChange={(event) => setAdjustmentDate(event.target.value)}
                />
              </label>
              <fieldset className="duration-fieldset">
                <legend>Duration</legend>
                <label className="form-field">
                  <span>Hours</span>
                  <input
                    autoFocus
                    type="number"
                    inputMode="numeric"
                    min="0"
                    max="24"
                    value={adjustmentHours}
                    onChange={(event) => {
                      const nextHours = Math.min(
                        24,
                        Math.max(0, event.target.valueAsNumber || 0),
                      );
                      setAdjustmentHours(nextHours);
                      if (nextHours === 24) setAdjustmentMinutes(0);
                    }}
                  />
                </label>
                <label className="form-field">
                  <span>Minutes</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min="0"
                    max="59"
                    disabled={adjustmentHours >= 24}
                    value={adjustmentMinutes}
                    onChange={(event) =>
                      setAdjustmentMinutes(
                        Math.min(59, Math.max(0, event.target.valueAsNumber || 0)),
                      )
                    }
                  />
                </label>
              </fieldset>
              <p className="adjustment-preview" aria-live="polite">
                {adjustmentMode === "add" ? "+" : "−"}
                {formatCompact(adjustmentAmount)}
                {adjustmentWasCapped && (
                  <small> Capped at the time recorded on this day.</small>
                )}
              </p>
              <div className="modal-actions">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setAdjustmentMode(null)}
                >
                  Cancel
                </button>
                <button
                  className={`save-adjustment ${adjustmentMode}`}
                  type="submit"
                  disabled={
                    busy || adjustmentAmount < MINUTE_MS || !adjustmentDate
                  }
                >
                  {adjustmentMode === "add" ? "Add time" : "Subtract time"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {resetConfirmationOpen && (
        <div
          className="modal-backdrop"
          onPointerDown={(event) => {
            if (
              event.target === event.currentTarget &&
              !mutationInFlight.current
            ) {
              setResetConfirmationOpen(false);
            }
          }}
        >
          <section
            className="adjustment-modal reset-modal"
            ref={resetDialogRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-labelledby="reset-title"
            aria-describedby="reset-help"
          >
            <button
              className="modal-close"
              type="button"
              aria-label="Close reset confirmation"
              disabled={busy}
              onClick={() => setResetConfirmationOpen(false)}
            >
              ×
            </button>
            <p className="modal-kicker">A clean slate</p>
            <h2 id="reset-title">Reset all recorded time?</h2>
            <p id="reset-help" className="modal-help">
              This deletes every clock event and correction on this device,
              sets Today and This week to 00:00, and stops any running timer.
              Your weekly target will stay the same.
            </p>
            <div className="modal-actions">
              <button
                autoFocus
                type="button"
                disabled={busy}
                onClick={() => setResetConfirmationOpen(false)}
              >
                Keep my time
              </button>
              <button
                className="confirm-reset"
                type="button"
                disabled={busy}
                onClick={() => void resetAllTime()}
              >
                Reset to zero
              </button>
            </div>
          </section>
        </div>
      )}

      {dataToolsOpen && (
        <div
          className="modal-backdrop"
          onPointerDown={(event) => {
            if (
              event.target === event.currentTarget &&
              !mutationInFlight.current
            ) {
              setDataToolsOpen(false);
            }
          }}
        >
          <section
            className="adjustment-modal data-tools-modal"
            ref={dataToolsDialogRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-labelledby="data-tools-title"
            aria-describedby="data-tools-help"
          >
            <button
              className="modal-close"
              type="button"
              aria-label="Close history and backup"
              disabled={busy}
              onClick={() => setDataToolsOpen(false)}
            >
              ×
            </button>
            <p className="modal-kicker">Your local records</p>
            <h2 id="data-tools-title">History &amp; backup</h2>
            <p id="data-tools-help" className="modal-help">
              Review recent changes, undo the latest one, or move an explicit
              JSON backup between your own devices.
            </p>

            <h3>Recent changes</h3>
            {events.length === 0 ? (
              <p className="empty-history">No clock changes recorded yet.</p>
            ) : (
              <ol className="history-list">
                {[...events].reverse().slice(0, 8).map((clockEvent) => (
                  <li key={clockEvent.id}>
                    <strong>{historyLabel(clockEvent)}</strong>
                    <time dateTime={new Date(clockEvent.at).toISOString()}>
                      {new Date(clockEvent.at).toLocaleString(undefined, {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </time>
                  </li>
                ))}
              </ol>
            )}
            <button
              className="undo-button"
              type="button"
              disabled={busy || !hasUndoableEvent}
              onClick={() => void undoLatestChange()}
            >
              Undo latest change
            </button>

            <h3>Portable backup</h3>
            <textarea
              ref={backupTextareaRef}
              className="backup-text"
              aria-label="Backup JSON"
              readOnly
              value={serializeBackup(events, targetHours)}
            />
            <div className="data-actions">
              <button type="button" disabled={busy} onClick={() => void copyBackup()}>
                Copy backup
              </button>
              {!isNativeRuntime() && (
                <button type="button" disabled={busy} onClick={downloadBackup}>
                  Download JSON
                </button>
              )}
              <label className={busy ? "import-button disabled" : "import-button"}>
                Import JSON
                <input
                  type="file"
                  accept="application/json,.json"
                  disabled={busy}
                  onChange={(event) => void importBackup(event)}
                />
              </label>
            </div>
            {storageError && (
              <p className="storage-error modal-storage-error" role="alert">
                {storageError}
              </p>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
