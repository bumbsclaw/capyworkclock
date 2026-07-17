const DATABASE_NAME = "capybara-boundary-clock";
const DATABASE_VERSION = 1;
const OBJECT_STORE = "values";
const CHANNEL_NAME = "capybara-boundary-clock.storage.v2";

export type StoredValueMutation<T> = {
  value: string | null;
  result: T;
};

type StoredValueUpdater<T> = (
  currentValue: string | null,
) => StoredValueMutation<T>;

let databasePromise: Promise<IDBDatabase> | null = null;

class StoredValueUpdaterError extends Error {
  readonly updaterCause: unknown;

  constructor(updaterCause: unknown) {
    super("The storage updater rejected the current value.");
    this.updaterCause = updaterCause;
  }
}

export class StorageUnavailableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "StorageUnavailableError";
  }
}

export function isNativeRuntime() {
  return false;
}

export async function getStoredValue(key: string): Promise<string | null> {
  if (typeof indexedDB === "undefined") {
    return window.localStorage.getItem(key);
  }

  try {
    return await getIndexedValueWithMigration(key);
  } catch (error) {
    const legacyValue = window.localStorage.getItem(key);
    if (legacyValue !== null) return legacyValue;
    throw new StorageUnavailableError("IndexedDB could not be read.", {
      cause: error,
    });
  }
}

export async function mutateStoredValue<T>(
  key: string,
  updater: StoredValueUpdater<T>,
): Promise<T> {
  if (typeof indexedDB === "undefined") {
    throw new StorageUnavailableError(
      "This browser does not provide transactional IndexedDB storage.",
    );
  }

  try {
    const result = await mutateIndexedValue(key, updater);
    window.localStorage.removeItem(key);
    broadcastStorageChange(key);
    return result;
  } catch (error) {
    if (error instanceof StoredValueUpdaterError) throw error.updaterCause;
    if (error instanceof StorageUnavailableError) throw error;
    throw new StorageUnavailableError("IndexedDB could not save the change.", {
      cause: error,
    });
  }
}

export async function setStoredValue(
  key: string,
  value: string,
): Promise<void> {
  await mutateStoredValue(key, () => ({ value, result: undefined }));
}

export async function removeStoredValue(key: string): Promise<void> {
  await mutateStoredValue(key, () => ({ value: null, result: undefined }));
}

export async function setStoredValues(
  values: Readonly<Record<string, string | null>>,
): Promise<void> {
  const entries = Object.entries(values);
  if (typeof indexedDB === "undefined") {
    throw new StorageUnavailableError(
      "This browser does not provide transactional IndexedDB storage.",
    );
  }

  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(OBJECT_STORE, "readwrite");
    const store = transaction.objectStore(OBJECT_STORE);
    for (const [key, value] of entries) {
      if (value === null) store.delete(key);
      else store.put(value, key);
    }
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
  for (const [key] of entries) {
    window.localStorage.removeItem(key);
    broadcastStorageChange(key);
  }
}

export async function quarantineStoredValue(
  key: string,
  rawValue: string,
): Promise<string> {
  const quarantineKey = `${key}.recovered.${Date.now()}`;
  if (typeof indexedDB === "undefined") {
    throw new StorageUnavailableError(
      "This browser does not provide transactional IndexedDB storage.",
    );
  }

  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(OBJECT_STORE, "readwrite");
    const store = transaction.objectStore(OBJECT_STORE);
    store.put(rawValue, quarantineKey);
    store.delete(key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
  window.localStorage.removeItem(key);
  broadcastStorageChange(key);
  return quarantineKey;
}

export function subscribeStoredValues(
  listener: (key: string) => void,
): () => void {
  const channel =
    typeof BroadcastChannel === "function"
      ? new BroadcastChannel(CHANNEL_NAME)
      : null;
  const onMessage = (event: MessageEvent<unknown>) => {
    if (
      event.data &&
      typeof event.data === "object" &&
      "key" in event.data &&
      typeof event.data.key === "string"
    ) {
      listener(event.data.key);
    }
  };
  channel?.addEventListener("message", onMessage);

  const onLegacyStorage = (event: StorageEvent) => {
    if (event.key) listener(event.key);
  };
  window.addEventListener("storage", onLegacyStorage);

  return () => {
    channel?.removeEventListener("message", onMessage);
    channel?.close();
    window.removeEventListener("storage", onLegacyStorage);
  };
}

function openDatabase() {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(OBJECT_STORE)) {
        request.result.createObjectStore(OBJECT_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () =>
      reject(new StorageUnavailableError("IndexedDB migration was blocked."));
  }).catch((error) => {
    databasePromise = null;
    throw error;
  });
  return databasePromise;
}

async function getIndexedValueWithMigration(key: string) {
  const database = await openDatabase();
  const legacyValue = window.localStorage.getItem(key);
  return new Promise<string | null>((resolve, reject) => {
    const transaction = database.transaction(OBJECT_STORE, "readwrite");
    const store = transaction.objectStore(OBJECT_STORE);
    const request = store.get(key);
    let value: string | null = null;
    request.onsuccess = () => {
      if (typeof request.result === "string") {
        value = request.result;
      } else if (legacyValue !== null) {
        value = legacyValue;
        store.put(legacyValue, key);
      }
    };
    transaction.oncomplete = () => {
      if (legacyValue !== null) window.localStorage.removeItem(key);
      resolve(value);
    };
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

async function mutateIndexedValue<T>(
  key: string,
  updater: StoredValueUpdater<T>,
) {
  const database = await openDatabase();
  const legacyValue = window.localStorage.getItem(key);
  return new Promise<T>((resolve, reject) => {
    const transaction = database.transaction(OBJECT_STORE, "readwrite");
    const store = transaction.objectStore(OBJECT_STORE);
    const request = store.get(key);
    let result!: T;
    let updaterError: StoredValueUpdaterError | null = null;
    request.onsuccess = () => {
      try {
        const currentValue =
          typeof request.result === "string" ? request.result : legacyValue;
        const mutation = updater(currentValue);
        result = mutation.result;
        if (mutation.value === null) store.delete(key);
        else store.put(mutation.value, key);
      } catch (error) {
        updaterError = new StoredValueUpdaterError(error);
        transaction.abort();
      }
    };
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(updaterError ?? transaction.error);
  });
}

function broadcastStorageChange(key: string) {
  if (typeof BroadcastChannel !== "function") return;
  const channel = new BroadcastChannel(CHANNEL_NAME);
  channel.postMessage({ key });
  channel.close();
}
