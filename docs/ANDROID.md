# Android development and release

This project uses Capacitor 8 to package the existing React clock as a normal
Android application. Capacitor is a native container for web UI: it lets the
project keep one product implementation while still producing an APK or
Android App Bundle (AAB), using Android Studio and Gradle like other Android
apps.

The installed app does not point at the hosted website. Its HTML, JavaScript,
CSS, and artwork are copied into the APK, so the clock starts and works
offline. The manifest requests no Internet permission.

Capacitor's built-in System Bars integration supplies safe-area insets for
Android's edge-to-edge layout, including Android 16, and the shared stylesheet
uses those values without changing browser layout.

## How the two targets fit together

```text
components/clock-app.tsx + lib/clock.ts + app/globals.css + public/*
                 │
          ┌──────┴──────┐
          │             │
     app/page.tsx   mobile/main.tsx
          │             │
   Vinext web build  static Vite build
          │             │
  Cloudflare worker  dist-mobile/
                        │
                  Capacitor sync
                        │
                    android/
```

Only the thin platform shells differ. Android-specific APIs belong behind an
adapter in `lib/`, as storage is today, so feature code remains portable.

## Requirements

- Node.js 22.13 or newer
- Android Studio 2025.2.1 or newer
- Android SDK Platform 36 and Build Tools 36 (Android Studio can install these
  when it imports the project)
- A physical Android device with USB debugging enabled, or an API 24+ emulator

Capacitor 8 supports Android 7/API 24 and newer. Android Studio includes a
compatible JDK, so most developers should not install Java separately.

Official setup references:

- [Capacitor environment setup](https://capacitorjs.com/docs/getting-started/environment-setup)
- [Capacitor Android setup](https://capacitorjs.com/docs/android)
- [Android Studio installation](https://developer.android.com/studio/install)

## First run in Android Studio

1. Install dependencies with `npm ci`.
2. Run `npm run android:open`.
3. Allow Android Studio to finish its initial Gradle sync and install any SDK
   packages it requests.
4. Select a device or create an API 24+ virtual device.
5. Click the Run button.

`android:open` first runs `android:sync`, so the native project receives the
latest web bundle and plugin definitions before Android Studio opens.

For command-line development, connect a device or start an emulator and use:

```bash
npm run android:run
```

## Everyday workflow

When changing `components/`, `lib/`, `app/globals.css`, or `public/`, the
change is shared by both targets:

```bash
# Website with hot reload
npm run dev

# Refresh the offline bundle inside android/
npm run android:sync
```

Native Android edits under `android/` do not affect the website. The copied
files under `android/app/src/main/assets/public/` are generated and ignored by
Git; never edit them directly.

Useful checks:

```bash
# Shared TypeScript + static mobile bundle contracts
npm run test:android-bundle

# Native unit tests, debug/release lint, instrumentation APK, debug APK,
# and minified/resource-shrunk release AAB
npm run android:check

# Execute instrumentation tests on a connected device or emulator
npm run android:check:device
```

The Gradle command produces:

- `android/app/build/outputs/apk/debug/app-debug.apk`
- `android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk`
- `android/app/build/outputs/bundle/release/app-release.aab`

The release AAB is unsigned until a release signing configuration is supplied.
Android build outputs are ignored by Git.

## Storage and privacy

The website uses transactional IndexedDB with cross-tab change notifications
and automatically migrates the previous `localStorage` format. Android uses
the Capacitor Preferences plugin with the same two logical keys, because native
Preferences are more durable than raw WebView storage:

- `capybara-boundary-clock.events.v1`
- `capybara-boundary-clock.settings.v1`

Website and Android data are intentionally separate. Installing the Android
app does not copy history from a browser, and clearing Android app data deletes
the Android ledger. Ordinary app upgrades preserve Preferences as long as the
same application ID and signing identity are used.

The app promises local-only storage, so Android cloud backup and device
transfer are disabled in the manifest and both backup-rule formats exclude all
shared preferences. The explicit **History & backup** screen is the supported
way to move data: the user can copy or import a validated JSON backup. Android
does not silently send the clock ledger to Google or an OEM migration service.

Preferences writes are serialized, clock mutations commit before the UI
reports success, and invalid ledger/settings values are recovered separately.
Once the raw ledger grows large, exact per-day rollups preserve old totals
without allowing Preferences to grow indefinitely under normal use.

The Android manifest requests no user-facing or dangerous device permissions.
In particular, the current offline app does not request internet access.

## App identity and versions

The current application ID is `com.capyworkclock.timer`, configured in
`capacitor.config.ts` and generated into the Android project. Treat the final
ID as permanent before the first Play Store release: changing it later creates
a different Android app and will not upgrade existing installations.

`versionName` is read from the root `package.json`, keeping the web and Android
version synchronized. `versionCode` reads the positive `VERSION_CODE`
environment variable and defaults to `1` for local builds. Every Play upload
must use a larger value, for example:

```bash
VERSION_CODE=2 npm run android:check
```

The visible app name is `Capy Work Clock`. Change it in
`capacitor.config.ts` and `android/app/src/main/res/values/strings.xml` if
needed.

## Icons and splash screen

`assets/icon.png` is the checked-in source. After replacing it with another
square image of at least 1024×1024, regenerate the legacy launcher, adaptive
foreground/background, and transparent monochrome themed icon:

```bash
npm run android:assets
```

Review the result in Android Studio because adaptive icon masks vary by device.
The startup screen uses Android’s platform splash API with the cream app color
and generated foreground. A matching inline launch shell covers WebView startup
without a white flash; there are no redundant full-screen splash bitmaps.

## Automated verification

The native unit test checks the stable application ID and package-derived
version. The instrumentation suite verifies that backup and Internet are
disabled in the packaged manifest, loads the shared clock in the WebView, and
recreates the activity after backgrounding it. `android:check` compiles that
instrumentation APK even without a device; `android:check:device` executes it.

`.github/workflows/ci.yml` runs the complete web gate, the complete Android
build gate, and the instrumentation suite on an API 35 emulator. It uploads the
unsigned release AAB for inspection. A physical-device pass is still sensible
before store publication, especially for lifecycle, system-bar, themed-icon,
and launcher-mask behavior.

## Preparing a Play Store release

1. Decide the permanent application ID and choose a new `VERSION_CODE`.
2. Run `npm test`, `npm run lint`, `npm run test:e2e`, and
   `VERSION_CODE=<next> npm run android:check`.
3. Test the debug build on at least one physical device and one current Android
   emulator, including backgrounding the app while a timer is running.
4. In Android Studio, choose **Build → Generate Signed Bundle / APK**, select
   **Android App Bundle**, and create or select an upload key.
5. Store the keystore and passwords outside the repository and back them up.
   `*.jks` and `*.keystore` are ignored deliberately.
6. Upload the signed AAB to a Google Play internal testing track, complete the
   store listing and data-safety declarations, then promote it after testing.

Google Play accounts, legal declarations, store copy, screenshots, and signing
secrets are intentionally not embedded in this repository. Follow the current
[Capacitor Google Play guide](https://capacitorjs.com/docs/android/deploying-to-google-play)
and Google's [launch checklist](https://developer.android.com/distribute/best-practices/launch/launch-checklist)
when publishing, since store requirements change over time.
