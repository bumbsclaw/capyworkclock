# Capybara Healthy Work Boundaries Clock

A cozy, capybara-themed work timer for protecting remote-work boundaries,
available as a website, an installable Android app, and a strictly confined
Linux snap.

The app has four clock actions—**Start the day**, **Break**, **Resume**, and
**EOD**—plus manual time corrections and a configurable weekly target. All
data stays on the current device; no account, remote database, analytics, or
application backend is required.

## Features

- Live totals for today and the current Monday–Sunday week
- Distinct capybara scenes for resting, working, taking a coconut break, and
  soaking after EOD
- Automatic EOD transition from the onsen to bed after 30 minutes
- Configurable weekly boundary (40 hours by default on a fresh browser)
- Manual add/subtract corrections, with subtraction capped to prevent hidden
  negative time balances
- Minute-only timer displays, with timestamp-derived arithmetic retained in
  full precision behind the scenes
- Confirmed reset for clearing all recorded time without changing the weekly
  target
- Recent history with a one-step undo for any event that has not yet been
  compacted
- Explicit JSON backup, download/copy, and validated import for moving data
  between the user’s own devices
- Transactional browser persistence in IndexedDB, including automatic
  migration from the previous `localStorage` format
- Serialized cross-tab and native writes, with mutations committed to storage
  before the UI reports success
- Exact daily rollups for old history, so the ledger stays practical without
  discarding recorded totals
- Stable event sequencing when the device clock moves backwards
- Responsive layout for phones, tablets, and desktop browsers
- An offline Android bundle with branded legacy, adaptive, themed launcher,
  and platform splash resources
- Durable native Preferences storage on Android with OS backup and
  device-transfer exclusions
- Accessible dialogs with focus containment, Escape/native-back handling,
  semantic progress reporting, and touch-sized controls
- Deterministic tests for concurrency, persistence failures, corruption
  recovery, sleep, midnight, weekly rollover, corrections, compaction, and
  clock rollback
- A performance regression check that rejects recurring intervals and infinite
  CSS animation
- Production security headers and continuous web/Android verification in CI

## Why the timer remains correct after device sleep

The displayed timer does **not** depend on counting one-second interval ticks.
Every action is stored as a timestamped event. The app reconstructs work
intervals from that ledger and compares them with the current wall-clock time.

Browsers normally pause JavaScript timers when a phone sleeps or a tab is in
the background. When the page wakes, becomes visible, regains focus, or resumes
from the back-forward cache, the app recalculates from the stored timestamps.
While actively working, the display schedules one refresh at the next
cumulative-minute boundary rather than running a one-second interval. Actions,
focus, visibility changes, and wake events still refresh immediately. The
refresh schedule only controls the display; it is not the source of truth.

## Requirements

- [Node.js](https://nodejs.org/) **22.13 or newer**
- npm (included with Node.js)
- A modern browser with IndexedDB support

Building the Android app additionally requires Android Studio 2025.2.1 or
newer and an Android SDK. Android Studio installs a suitable JDK for you. See
[Android development and release](docs/ANDROID.md) for a beginner-friendly
setup and publishing guide.

Linux or WSL2 is recommended if you want to run the complete production build
and test scripts. Local development itself also works on macOS and should work
from a current Windows PowerShell environment.

## Quick start

Open a terminal in the project directory and run:

```bash
npm ci
npm run dev
```

Vite will print the local URL, normally:

```text
http://localhost:5173
```

Open that address in your browser. To stop the development server, press
`Ctrl+C` in the terminal.

To use a different port:

```bash
npm run dev -- --port 5174
```

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the local development server with hot reload |
| `npm run build:android` | Build the offline web bundle embedded in Android |
| `npm run build:desktop` | Build the offline browser-only bundle used by the snap |
| `npm run android:sync` | Build that bundle and copy it into the native project |
| `npm run android:open` | Sync, then open the project in Android Studio |
| `npm run android:run` | Sync and run on a connected device or emulator |
| `npm run android:apk` | Create a debug APK with the Gradle wrapper |
| `npm run android:check` | Run native unit tests, both lint variants, R8/resource shrinking, and build debug/instrumentation APKs plus a release AAB |
| `npm run android:check:device` | Run native instrumentation tests on a connected device or emulator |
| `npm run android:assets` | Regenerate legacy, adaptive, and themed launcher resources |
| `npm run test:clock` | Run the deterministic timer-arithmetic tests |
| `npm run test:unit` | Run clock, storage, and performance contract tests |
| `npm run test:ui` | Run component persistence, editing, and accessibility tests |
| `npm run test:e2e` | Run Chromium desktop/mobile concurrency, persistence, accessibility, and security tests |
| `npm run test:desktop-bundle` | Verify the snap bundle is offline and contains no Capacitor code |
| `npm run typecheck` | Type-check the complete TypeScript project |
| `npm run lint` | Run ESLint |
| `npm run build` | Build and validate the production artifact |
| `npm test` | Run full type checking, unit/UI tests, production validation, and Android bundle contracts |
| `npm run start` | Serve an existing production build |

`npm run build`, `npm test`, `npm run lint`, `npm run install:ci`, and the
Gradle-based Android commands use Bash helper scripts. The web build helper
also expects GNU `timeout`.

## Android quick start

Install Android Studio and its SDK, then run:

```bash
npm ci
npm run android:open
```

The command builds the same React clock used by the website, copies an offline
bundle into the native project, and opens `android/` in Android Studio. Select
a physical device or an API 24+ emulator and click Run. After changing shared
UI or timer code, run `npm run android:sync` before running the native project
again.

For a command-line debug APK:

```bash
npm run android:apk
```

The output is `android/app/build/outputs/apk/debug/app-debug.apk`. This debug
APK is for local testing, not Play Store publication. The signing, versioning,
package-ID, and Play Store steps are covered in
[docs/ANDROID.md](docs/ANDROID.md).

## Linux snap

The snap is named `capy-work-clock`. It embeds a purpose-built static desktop
bundle and a small GTK/WebKit launcher; it does not embed Node.js, Electron,
Capacitor, Gradle, the Android project, or the Cloudflare deployment runtime.
GTK and WebKit are supplied by Canonical's shared GNOME content snap instead of
being duplicated in this package. The application is strictly confined and
Wayland-only. Its only system interfaces are `desktop`, for the user-mediated
file portal, and `wayland`, for its window. Canonical's GNOME and Mesa content
snaps provide read-only runtime files. It does not request X11, legacy desktop,
GSettings, OpenGL-device, network, home, removable-media, audio, or camera
access. Software rendering keeps GPU device access outside the permission set.

Install Snapcraft and build from the repository root:

```bash
sudo snap install snapcraft --classic
snapcraft pack --use-lxd --platform amd64
```

Replace `amd64` with `arm64` when building natively on an ARM64 host; both are
declared in the recipe. Install the resulting local build and launch it with:

```bash
sudo snap install --dangerous ./capy-work-clock_1.0.0_amd64.snap
capy-work-clock
```

Replace `amd64` with the architecture Snapcraft produced. Local clock data is
stored by WebKit below the snap's revision-independent user data directory, so
it survives snap refreshes. The JSON download and import actions use desktop
file choosers; copying a backup remains available as a second export path.

The snap build has its own deliberately small npm lockfile in
`snap/build-deps/`. Only React, React DOM, and Vite are installed in the build
environment, and none of them are copied as `node_modules` into the snap. To
audit a built package directly:

```bash
unsquashfs -ll capy-work-clock_1.0.0_amd64.snap
```

### macOS production build

Install GNU coreutils and expose its GNU-prefixed utilities under their usual
Linux names for the command:

```bash
brew install coreutils
PATH="$(brew --prefix coreutils)/libexec/gnubin:$PATH" npm run build
```

### Windows production build

Use WSL2 with a current Linux distribution, then run the standard commands
inside WSL:

```bash
npm ci
npm test
```

For ordinary development, try `npm ci` and `npm run dev` directly in
PowerShell first; use WSL2 if the Cloudflare local runtime does not start in
your Windows environment.

## Local data and privacy

The clock is local-only by default. It stores two versioned logical values
under the current website origin or Android installation:

- `capybara-boundary-clock.events.v1` — clock events and manual corrections
- `capybara-boundary-clock.settings.v1` — the weekly target

On the website these values live in IndexedDB. Existing `localStorage` values
are migrated on first read, and concurrent mutations from different tabs are
serialized in a single database transaction. Android stores the same logical
values through Capacitor Preferences and serializes native operations.

Nothing is uploaded by the application. Each browser profile and origin has
its own ledger, so `localhost:5173` and the hosted site do not share data. The
Android installation also has its own ledger and does not import browser
history. Android cloud backup and device-to-device transfer are explicitly
disabled for Preferences. Clearing website data or Android app data deletes
that copy's history.

**History & backup** is the only transfer mechanism. It creates a readable JSON
file or clipboard value at the user’s request. Imports validate the format,
ledger, and settings before replacing both values. Invalid saved values are
quarantined independently so a damaged target does not erase valid clock
history, or vice versa. Storage failures remain visible and the app does not
claim an unsaved action succeeded.

Old raw events are compacted into exact local-day totals after the ledger grows
large. Compaction preserves totals and the current running/break/ended state;
it never silently drops time merely to meet a size cap.

Calendar boundaries use the browser's local timezone. A day begins at local
midnight, and a week begins Monday at local midnight. Calendar arithmetic uses
local date operations so daylight-saving transitions are handled as local
calendar boundaries rather than assumed 24-hour days.

## Project structure

```text
app/
  page.tsx             Web entrypoint for the shared clock
  globals.css          Responsive visual design
  layout.tsx           Root layout and metadata
components/
  clock-app.tsx        Shared interactive UI used by web and Android
lib/
  clock.ts             Pure event-ledger and time-arithmetic functions
  clock-storage.ts     Versioned schemas, migration, and portable backups
  platform-storage.ts  Browser IndexedDB / Android Preferences transactions
mobile/
  index.html           Static Android web-shell document
  main.tsx             Android React entrypoint
desktop/
  index.html           Offline Linux desktop shell with a restrictive CSP
  main.tsx             Browser-only React entrypoint
  capy-work-clock.c    Minimal GTK/WebKit launcher used by the snap
android/               Native Capacitor/Gradle Android project
snap/                  Snapcraft recipe, desktop metadata, and build-only lockfile
assets/icon.png        Source for native launcher and platform splash artwork
public/
  *.webp               Optimized capybara scene artwork
tests/
  clock.test.ts        Deterministic arithmetic and state tests
  storage.test.ts      IndexedDB concurrency, migration, and recovery tests
  clock-app.test.tsx   Shared component behavior and accessibility tests
  e2e/clock.spec.ts    Desktop/mobile browser integration tests
  rendered-html.test.mjs
scripts/               Build/install validation helpers
worker/                Vinext/Cloudflare worker entrypoint
```

The shared application is built with React and TypeScript. The website uses
Vite with [Vinext](https://github.com/cloudflare/vinext), the
Cloudflare-oriented Next.js compatibility layer. A small second Vite entry
creates static files for [Capacitor](https://capacitorjs.com/) to package in the
native Android WebView. There is one clock component, stylesheet, arithmetic
library, and artwork set rather than separate web and Android implementations.

## Editing the app

- Change UI copy or component behavior in `components/clock-app.tsx`; both
  platforms receive the change.
- Change the look and responsive layout in `app/globals.css`.
- Change timer behavior in `lib/clock.ts`, then add or update a deterministic
  case in `tests/clock.test.ts`.
- Replace scene artwork in `public/`, keeping the filenames referenced by
  `app/page.tsx` or updating those references.

After changing timer logic, run at least:

```bash
npm run test:clock
```

On Linux/WSL, the full check is:

```bash
npm test
npm run lint
npm run test:e2e
```

If the Android SDK is installed, also run:

```bash
npm run android:check
```

## Troubleshooting

### `npm ci` reports an unsupported Node version

Check your version:

```bash
node --version
```

Install Node.js 22.13 or newer, remove any partially created `node_modules`
directory, and rerun `npm ci`.

### Port 5173 is already in use

Choose another port:

```bash
npm run dev -- --port 5174
```

### The timer history is different from the hosted site

This is expected. Browser storage is isolated by origin, so a local development
URL starts with a separate ledger and the fresh-install 40-hour target.

### The page was asleep for hours

Bring the tab to the foreground. The displayed total will be recalculated from
the stored timestamps immediately; missed interval ticks do not lose time.

## Current verification

The current project passes:

- 15 deterministic clock arithmetic and state tests
- 7 storage, schema migration, corruption, concurrency, and backup tests
- 8 shared-component persistence, failure, editing, history, and accessibility
  tests
- 4 performance and shared-component contract tests
- 8 Chromium desktop/mobile E2E checks covering reload persistence,
  simultaneous tabs, axe accessibility, dialog focus, and response headers
- 4 offline Android bundle/privacy/themed-icon contracts and shared TypeScript
  checking
- full-project TypeScript, production Vinext build/artifact validation,
  rendered metadata/header validation, ESLint, and dependency audits
- Android unit tests, warning-free debug/release lint, instrumentation APK
  compilation, debug APK assembly, and a minified/resource-shrunk release AAB

The checked-in CI workflow repeats the web suite and executes the Android
instrumentation tests on an API 35 emulator before publishing the unsigned AAB
as a workflow artifact.
