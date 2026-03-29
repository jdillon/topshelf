import type {
  PackageManagerPlugin,
  PackageInfo,
  DetectedProcess,
  UpgradeResult,
  SkippedPackage,
} from "./types.js";
import type { TopshelfConfig } from "./config.js";

export interface PluginStatus {
  plugin: PackageManagerPlugin;
  actionable: PackageInfo[];
  skipped: SkippedPackage[];
  detected: DetectedProcess[];
}

export interface AggregatedStatus {
  plugins: PluginStatus[];
  totalOutdated: number;
  totalRunning: number;
  totalSkipped: number;
}

export interface UpgradeCallbacks {
  onUpgradeStart(plugin: PackageManagerPlugin, pkg: PackageInfo): void;
  onUpgradeComplete(
    plugin: PackageManagerPlugin,
    pkg: PackageInfo,
    result: UpgradeResult,
  ): void;
  onRestartNeeded(
    plugin: PackageManagerPlugin,
    proc: DetectedProcess,
  ): Promise<boolean>;
}

/** Build the ignore set for a plugin: global ignore + per-plugin ignore. */
function buildIgnoreSet(config: TopshelfConfig, pluginId: string): Set<string> {
  const ignore = new Set(config.settings.ignore);
  const pluginConfig = config.plugins[pluginId];
  if (pluginConfig) {
    for (const name of pluginConfig.ignore) {
      ignore.add(name);
    }
  }
  return ignore;
}

/** Aggregate outdated status across all plugins. */
export async function runStatus(
  plugins: PackageManagerPlugin[],
  config: TopshelfConfig,
): Promise<AggregatedStatus> {
  // Prepare all plugins (e.g., brew update)
  await Promise.all(
    plugins
      .filter((p) => p.prepare)
      .map((p) => p.prepare!()),
  );

  // Gather outdated from all plugins in parallel
  const pluginStatuses = await Promise.all(
    plugins.map(async (plugin): Promise<PluginStatus> => {
      const outdated = await plugin.listOutdated();

      // Plugin-level filtering (e.g., brew skips unversioned casks)
      let actionable: PackageInfo[];
      let skipped: SkippedPackage[];
      if (plugin.filterOutdated) {
        const filtered = await plugin.filterOutdated(outdated);
        actionable = filtered.actionable;
        skipped = filtered.skipped;
      } else {
        actionable = outdated;
        skipped = [];
      }

      // Config-level ignore filtering
      const ignore = buildIgnoreSet(config, plugin.id);
      if (ignore.size > 0) {
        const ignored = actionable.filter((p) => ignore.has(p.name));
        actionable = actionable.filter((p) => !ignore.has(p.name));
        skipped = [
          ...skipped,
          ...ignored.map((p) => ({ ...p, reason: "ignored in config" })),
        ];
      }

      // Detect running processes
      let detected: DetectedProcess[] = [];
      if (plugin.capabilities.detectRunning && plugin.detectRunning && actionable.length > 0) {
        detected = await plugin.detectRunning(actionable);
      }

      return { plugin, actionable, skipped, detected };
    }),
  );

  return {
    plugins: pluginStatuses,
    totalOutdated: pluginStatuses.reduce((n, s) => n + s.actionable.length, 0),
    totalRunning: pluginStatuses.reduce((n, s) => n + s.detected.length, 0),
    totalSkipped: pluginStatuses.reduce((n, s) => n + s.skipped.length, 0),
  };
}

/** Run the upgrade loop for selected packages. */
export async function runUpgrade(
  targets: Array<{ plugin: PackageManagerPlugin; pkg: PackageInfo }>,
  callbacks: UpgradeCallbacks,
  config: TopshelfConfig,
): Promise<UpgradeResult[]> {
  const results: UpgradeResult[] = [];

  for (const { plugin, pkg } of targets) {
    callbacks.onUpgradeStart(plugin, pkg);

    const result = await plugin.upgrade(pkg.name);
    results.push(result);

    callbacks.onUpgradeComplete(plugin, pkg, result);

    // Detect and handle restarts for successfully upgraded packages
    if (
      result.success &&
      plugin.capabilities.detectRunning &&
      plugin.detectRunning
    ) {
      const running = await plugin.detectRunning([pkg]);
      for (const proc of running) {
        const shouldRestart = await callbacks.onRestartNeeded(plugin, proc);
        if (shouldRestart && plugin.capabilities.restart && plugin.restart) {
          await plugin.restart(proc);
        }
      }
    }
  }

  return results;
}
