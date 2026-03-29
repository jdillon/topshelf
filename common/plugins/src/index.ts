import type { PackageManagerPlugin } from "@topshelf/core";
import { brewFormulaePlugin } from "./brew-formulae.js";

export const allPlugins: PackageManagerPlugin[] = [brewFormulaePlugin];

export { brewFormulaePlugin };
