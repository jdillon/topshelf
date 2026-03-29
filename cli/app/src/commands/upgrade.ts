import chalk from "chalk";
import {
  loadConfig,
  runStatus,
  runUpgrade,
  type PackageManagerPlugin,
  type PackageInfo,
  type DetectedProcess,
  type UpgradeResult,
  type UpgradeCallbacks,
} from "@topshelf/core";
import { loadPlugins } from "../plugin-loader.js";
import { renderPluginTable, renderSummary } from "../output/table.js";
import { spinner } from "../output/spinner.js";
import { pluginIcon, shortVersion } from "../output/format.js";
import {
  confirmUpgrade,
  confirmRestartPolicy,
  confirmRestart,
  selectPackages,
  type RestartPolicy,
} from "../prompt.js";

export interface UpgradeOptions {
  yes?: boolean;
  packages?: string[];
}

export async function upgradeCommand(opts: UpgradeOptions): Promise<void> {
  const config = await loadConfig();
  const { available } = await loadPlugins(config);

  if (available.length === 0) {
    console.log("No plugins available.");
    return;
  }

  // Status phase
  const s1 = spinner("Updating package indexes…");
  await Promise.all(available.filter((p) => p.prepare).map((p) => p.prepare!()));
  s1.done("Package indexes updated");

  const s2 = spinner("Checking for outdated packages…");
  const status = await runStatus(available, config);
  s2.done("Done");

  if (status.totalOutdated === 0) {
    console.log(chalk.green("\nEverything is up to date."));
    return;
  }

  // Build targets
  let targets: Array<{ plugin: PackageManagerPlugin; pkg: PackageInfo }> = [];
  for (const ps of status.plugins) {
    for (const pkg of ps.actionable) {
      targets.push({ plugin: ps.plugin, pkg });
    }
  }

  // Filter to specific packages if requested
  if (opts.packages && opts.packages.length > 0) {
    const names = new Set(opts.packages);
    targets = targets.filter((t) => names.has(t.pkg.name));
    if (targets.length === 0) {
      console.log("No matching packages found in outdated list.");
      return;
    }
  }

  // Build detection map for display
  const detectedMap = new Map<string, DetectedProcess>();
  for (const ps of status.plugins) {
    for (const d of ps.detected) {
      detectedMap.set(d.packageName, d);
    }
  }

  // Preview
  for (const ps of status.plugins) {
    const table = renderPluginTable(ps);
    if (table) console.log(`\n${table}`);
  }
  console.log(renderSummary(status));

  // Confirmation
  if (!opts.yes) {
    const choice = await confirmUpgrade();
    if (choice === "no") return;
    if (choice === "select") {
      targets = await selectPackages(targets, detectedMap);
      if (targets.length === 0) return;
    }
  }

  // Restart policy
  const affectedCount = targets.filter((t) => detectedMap.has(t.pkg.name)).length;
  let restartPolicy: RestartPolicy = config.settings.restart_policy as RestartPolicy;

  if (affectedCount > 0 && !opts.yes) {
    restartPolicy = await confirmRestartPolicy(affectedCount);
  } else if (opts.yes) {
    restartPolicy = "yes";
  }

  // Upgrade loop
  let successCount = 0;
  let failCount = 0;
  let restartedCount = 0;

  const callbacks: UpgradeCallbacks = {
    onUpgradeStart(_plugin, pkg) {
      console.log(
        `\n${pluginIcon(_plugin.id)} ${chalk.bold(pkg.name)} ${chalk.dim(shortVersion(pkg.installedVersion))} → ${chalk.green(shortVersion(pkg.latestVersion))}`,
      );
    },
    onUpgradeComplete(_plugin, _pkg, result) {
      if (result.success) {
        successCount++;
      } else {
        failCount++;
        if (result.error) {
          console.log(chalk.red(`  Failed: ${result.error}`));
        }
      }
    },
    async onRestartNeeded(_plugin, proc) {
      if (restartPolicy === "no") return false;
      if (restartPolicy === "yes") {
        restartedCount++;
        return true;
      }

      // "ask" policy
      const choice = await confirmRestart(proc.displayName);
      if (choice === "all") {
        restartPolicy = "yes";
        restartedCount++;
        return true;
      }
      if (choice === "yes") {
        restartedCount++;
        return true;
      }
      return false;
    },
  };

  console.log("");
  const results = await runUpgrade(targets, callbacks, config);

  // Summary
  const parts: string[] = [];
  parts.push(`${successCount} upgraded`);
  if (restartedCount > 0) parts.push(`${restartedCount} restarted`);
  if (failCount > 0) parts.push(chalk.red(`${failCount} failed`));
  console.log(`\n${parts.join(chalk.dim(" · "))}`);
}
