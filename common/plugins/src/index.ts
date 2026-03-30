import type { PackageManagerPlugin } from "@topshelf/core";
import { brewPlugin } from "./brew.js";
import { bunPlugin } from "./bun.js";
import { masPlugin } from "./mas.js";
import { npmPlugin } from "./npm.js";
import { uvPlugin } from "./uv.js";

export const allPlugins: PackageManagerPlugin[] = [
  brewPlugin,
  bunPlugin,
  masPlugin,
  npmPlugin,
  uvPlugin,
];

export { brewPlugin, bunPlugin, masPlugin, npmPlugin, uvPlugin };
