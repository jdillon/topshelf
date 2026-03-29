import { allPlugins } from "@topshelf/plugins";
import type { TopshelfConfig, PackageManagerPlugin } from "@topshelf/core";

export interface LoadedPlugins {
  available: PackageManagerPlugin[];
  disabled: string[];
  unavailable: string[];
}

export async function loadPlugins(
  config: TopshelfConfig,
): Promise<LoadedPlugins> {
  const disabled: string[] = [];
  const unavailable: string[] = [];
  const available: PackageManagerPlugin[] = [];

  for (const plugin of allPlugins) {
    if (config.settings.disabled_plugins.includes(plugin.id)) {
      disabled.push(plugin.id);
      continue;
    }

    if (await plugin.isAvailable()) {
      available.push(plugin);
    } else {
      unavailable.push(plugin.id);
    }
  }

  // Sort by config order, unlisted go after
  const order = config.settings.plugin_order;
  if (order.length > 0) {
    available.sort((a, b) => {
      const ai = order.indexOf(a.id);
      const bi = order.indexOf(b.id);
      const oa = ai === -1 ? Infinity : ai;
      const ob = bi === -1 ? Infinity : bi;
      return oa - ob;
    });
  }

  return { available, disabled, unavailable };
}
