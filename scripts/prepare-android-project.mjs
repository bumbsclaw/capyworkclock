import { rmdir } from "node:fs/promises";

const generatedEmptyDirectories = [
  new URL("../android/app/src/main/res/drawable-v24/", import.meta.url),
];

for (const directory of generatedEmptyDirectories) {
  try {
    await rmdir(directory);
  } catch (error) {
    if (
      !error ||
      typeof error !== "object" ||
      !("code" in error) ||
      (error.code !== "ENOENT" && error.code !== "ENOTEMPTY")
    ) {
      throw error;
    }
  }
}
