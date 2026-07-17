import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

test("the offline Android web bundle contains its entrypoint and local art", async () => {
  const html = await readFile(
    new URL("../dist-mobile/index.html", import.meta.url),
    "utf8",
  );

  assert.match(html, /<head>/i);
  assert.match(html, /<script[^>]+src="\/assets\/[^\"]+\.js"/i);
  assert.doesNotMatch(html, /https?:\/\//i);
  assert.match(html, /class="launch-shell"/i);
  await access(new URL("../dist-mobile/state-idle.webp", import.meta.url));
  await access(new URL("../dist-mobile/meadow-desk.webp", import.meta.url));
});

test("Capacitor packages the generated bundle instead of a remote website", async () => {
  const config = await readFile(
    new URL("../capacitor.config.ts", import.meta.url),
    "utf8",
  );
  const storage = await readFile(
    new URL("../lib/platform-storage.ts", import.meta.url),
    "utf8",
  );
  const browserStorage = await readFile(
    new URL("../lib/browser-storage.ts", import.meta.url),
    "utf8",
  );

  assert.match(config, /webDir:\s*"dist-mobile"/);
  assert.match(config, /backgroundColor:\s*"#f6f0e3"/i);
  assert.doesNotMatch(config, /\burl\s*:/);
  assert.match(storage, /Preferences\.(get|set)/);
  assert.match(browserStorage, /indexedDB\.open/);
});

test("Android excludes clock preferences from backup and requests no network", async () => {
  const manifest = await readFile(
    new URL("../android/app/src/main/AndroidManifest.xml", import.meta.url),
    "utf8",
  );
  const backupRules = await readFile(
    new URL("../android/app/src/main/res/xml/data_extraction_rules.xml", import.meta.url),
    "utf8",
  );

  assert.match(manifest, /android:allowBackup="false"/);
  assert.match(manifest, /android:dataExtractionRules="@xml\/data_extraction_rules"/);
  assert.doesNotMatch(manifest, /android\.permission\.INTERNET/);
  assert.match(backupRules, /<cloud-backup>/);
  assert.match(backupRules, /<device-transfer>/);
  assert.match(backupRules, /domain="sharedpref"\s+path="\."/);
});

test("Android launcher resources include a dedicated themed-icon mask", async () => {
  const adaptiveIcon = await readFile(
    new URL(
      "../android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(adaptiveIcon, /<monochrome>/);
  assert.match(adaptiveIcon, /@mipmap\/ic_launcher_monochrome/);
  await access(
    new URL(
      "../android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_monochrome.png",
      import.meta.url,
    ),
  );
});
