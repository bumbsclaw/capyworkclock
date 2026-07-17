import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const sourceIcon = fileURLToPath(
  new URL("../assets/icon.png", import.meta.url),
);
const resourcesUrl = new URL("../android/app/src/main/res/", import.meta.url);
const resources = fileURLToPath(resourcesUrl);
const cream = { r: 246, g: 240, b: 227, alpha: 1 };
const densities = {
  ldpi: 0.75,
  mdpi: 1,
  hdpi: 1.5,
  xhdpi: 2,
  xxhdpi: 3,
  xxxhdpi: 4,
};

async function createSilhouette(size) {
  return sharp(sourceIcon)
    .resize(size, size, { fit: "contain" })
    .greyscale()
    .linear(-5, 1175)
    .blur(0.3)
    .extractChannel(0)
    .png()
    .toBuffer();
}

async function createColorCutout(size) {
  const color = await sharp(sourceIcon)
    .resize(size, size, { fit: "contain" })
    .removeAlpha()
    .png()
    .toBuffer();
  return sharp(color)
    .joinChannel(await createSilhouette(size))
    .png()
    .toBuffer();
}

async function placeOnTransparentCanvas(input, inputSize, canvasSize) {
  const offset = Math.floor((canvasSize - inputSize) / 2);
  return sharp({
    create: {
      width: canvasSize,
      height: canvasSize,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input, left: offset, top: offset }])
    .png()
    .toBuffer();
}

for (const [density, scale] of Object.entries(densities)) {
  const directory = join(resources, `mipmap-${density}`);
  await mkdir(directory, { recursive: true });
  const legacySize = Math.round(48 * scale);
  const adaptiveSize = Math.round(108 * scale);

  const legacyContentSize = Math.round(legacySize * 0.82);
  const legacyIcon = await placeOnTransparentCanvas(
    await createColorCutout(legacyContentSize),
    legacyContentSize,
    legacySize,
  );
  await sharp(legacyIcon).toFile(join(directory, "ic_launcher.png"));

  const roundContentSize = Math.round(legacySize * 0.9);
  const roundSource = await sharp(sourceIcon)
    .resize(roundContentSize, roundContentSize, { fit: "cover" })
    .ensureAlpha()
    .png()
    .toBuffer();
  const circleMask = Buffer.from(
    `<svg width="${roundContentSize}" height="${roundContentSize}"><circle cx="50%" cy="50%" r="50%" fill="white"/></svg>`,
  );
  const roundCutout = await sharp(roundSource)
    .composite([{ input: circleMask, blend: "dest-in" }])
    .png()
    .toBuffer();
  const roundIcon = await placeOnTransparentCanvas(
    roundCutout,
    roundContentSize,
    legacySize,
  );
  await sharp(roundIcon).toFile(join(directory, "ic_launcher_round.png"));

  await sharp({
    create: { width: adaptiveSize, height: adaptiveSize, channels: 4, background: cream },
  })
    .png()
    .toFile(join(directory, "ic_launcher_background.png"));

  const adaptiveSource = await sharp(sourceIcon)
    .resize(adaptiveSize, adaptiveSize, {
      fit: "contain",
    })
    .removeAlpha()
    .png()
    .toBuffer();
  const silhouette = await createSilhouette(adaptiveSize);

  await sharp(adaptiveSource)
    .joinChannel(silhouette)
    .png()
    .toFile(join(directory, "ic_launcher_foreground.png"));
  await sharp({
    create: {
      width: adaptiveSize,
      height: adaptiveSize,
      channels: 3,
      background: { r: 255, g: 255, b: 255 },
    },
  })
    .joinChannel(silhouette)
    .png()
    .toFile(join(directory, "ic_launcher_monochrome.png"));
}

for (const filename of ["ic_launcher.xml", "ic_launcher_round.xml"]) {
  const file = new URL(`mipmap-anydpi-v26/${filename}`, resourcesUrl);
  const source = await readFile(file, "utf8");
  const withMonochrome = source.includes("<monochrome>")
    ? source.replace(
        /android:drawable="@mipmap\/ic_launcher_foreground"(?=[^>]*\/>\s*<\/monochrome>)/,
        'android:drawable="@mipmap/ic_launcher_monochrome"',
      )
    : source.replace(
        "</adaptive-icon>",
        [
          "    <monochrome>",
          "        <inset android:drawable=\"@mipmap/ic_launcher_monochrome\" android:inset=\"16.7%\" />",
          "    </monochrome>",
          "</adaptive-icon>",
        ].join("\n"),
      );
  await writeFile(file, withMonochrome);
}

console.log(
  "Generated Android legacy, adaptive, and transparent monochrome launcher assets from assets/icon.png.",
);
