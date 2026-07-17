import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);

test("desktop bundle is complete, relative, offline, and browser-only", async () => {
  const dist = new URL("../dist-desktop/", import.meta.url);
  const html = await readFile(new URL("index.html", dist), "utf8");

  assert.match(html, /<script[^>]+src="\.\/assets\/[^"]+\.js"/i);
  assert.doesNotMatch(html, /https?:\/\//i);
  assert.match(html, /connect-src 'none'/i);
  assert.match(html, /\.\/boundary-clock-icon\.webp/);

  for (const asset of [
    "boundary-clock-icon.webp",
    "favicon.png",
    "meadow-desk.webp",
    "state-break-four-toes.webp",
    "state-eod.webp",
    "state-idle.webp",
  ]) {
    await access(new URL(asset, dist));
  }

  const bundles = (await readdir(new URL("assets/", dist))).filter((file) =>
    file.endsWith(".js"),
  );
  const javascript = (
    await Promise.all(
      bundles.map((file) => readFile(new URL(`assets/${file}`, dist), "utf8")),
    )
  ).join("\n");
  assert.doesNotMatch(javascript, /@capacitor|Capacitor|Preferences\.get/);
  assert.match(javascript, /indexedDB\.open/);
});

test("snap recipe has strict metadata and a minimal build dependency graph", async () => {
  const recipe = await readFile(
    new URL("snap/snapcraft.yaml", projectRoot),
    "utf8",
  );
  const launcher = await readFile(
    new URL("desktop/capy-work-clock.c", projectRoot),
    "utf8",
  );
  const buildDependencies = JSON.parse(
    await readFile(
      new URL("snap/build-deps/package.json", projectRoot),
      "utf8",
    ),
  );

  assert.match(recipe, /^name: capy-work-clock$/m);
  assert.match(recipe, /^base: core24$/m);
  assert.match(recipe, /^confinement: strict$/m);
  assert.match(
    recipe,
    /^website: https:\/\/github\.com\/bowenfan96\/capy-work-clock$/m,
  );
  assert.match(
    recipe,
    /^contact: https:\/\/github\.com\/bowenfan96\/capy-work-clock\/issues$/m,
  );
  assert.match(
    recipe,
    /^source-code: https:\/\/github\.com\/bowenfan96\/capy-work-clock$/m,
  );
  assert.match(
    recipe,
    /^issues: https:\/\/github\.com\/bowenfan96\/capy-work-clock\/issues$/m,
  );
  assert.match(recipe, /description: \|\n  Clyde the Capybara works remotely/);
  assert.match(
    recipe,
    /uses minimal resources:[\s\S]+records[\s\S]+only once per\n  minute/,
  );
  assert.doesNotMatch(recipe, /^\s*extensions:/m);
  assert.match(
    recipe,
    /apps:\n  capy-work-clock:[\s\S]*?    plugs:\n      - desktop\n      - wayland\n\n/,
  );
  assert.match(recipe, /^  GDK_BACKEND: wayland$/m);
  assert.match(recipe, /^  LIBGL_ALWAYS_SOFTWARE: '1'$/m);
  assert.match(recipe, /^  WEBKIT_DISABLE_DMABUF_RENDERER: '1'$/m);
  assert.doesNotMatch(
    recipe,
    /^\s+- (audio-playback|audio-record|dbus|desktop-legacy|gsettings|home|network|network-bind|opengl|personal-files|removable-media|system-files|x11)$/m,
  );
  assert.doesNotMatch(
    recipe,
    /^  (gtk-3-themes|icon-themes|sound-themes):$/m,
  );
  assert.match(launcher, /G_APPLICATION_NON_UNIQUE/);
  assert.doesNotMatch(launcher, /G_APPLICATION_DEFAULT_FLAGS/);

  const dependencyNames = Object.keys({
    ...buildDependencies.dependencies,
    ...buildDependencies.devDependencies,
  });
  assert.deepEqual(dependencyNames.sort(), ["react", "react-dom", "vite"]);
  assert.doesNotMatch(
    JSON.stringify(buildDependencies),
    /capacitor|android|next|wrangler/i,
  );
});
