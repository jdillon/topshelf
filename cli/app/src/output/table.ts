import Table from "cli-table3";
import chalk from "chalk";
import type { AggregatedStatus, PluginStatus, SkippedPackage } from "@topshelf/core";
import { pluginIcon, shortVersion, processKindLabel } from "./format.js";

export function renderPluginTable(status: PluginStatus): string {
  const { plugin, actionable, detected } = status;
  const detectedMap = new Map(detected.map((d) => [d.packageName, d]));

  if (actionable.length === 0) return "";

  const header = chalk.bold(
    `${pluginIcon(plugin.id)} ${plugin.displayName} (${actionable.length} outdated)`,
  );

  const table = new Table({
    chars: {
      top: "", "top-mid": "", "top-left": "", "top-right": "",
      bottom: "", "bottom-mid": "", "bottom-left": "", "bottom-right": "",
      left: "", "left-mid": "", mid: "", "mid-mid": "",
      right: "", "right-mid": "", middle: " ",
    },
    style: { "padding-left": 2, "padding-right": 1 },
  });

  for (const pkg of actionable) {
    const proc = detectedMap.get(pkg.name);
    const row = [
      pkg.name,
      chalk.dim(shortVersion(pkg.installedVersion)),
      chalk.dim("→"),
      chalk.green(shortVersion(pkg.latestVersion)),
    ];
    if (proc) {
      row.push(processKindLabel(proc.kind));
    }
    table.push(row);
  }

  return `${header}\n${table.toString()}`;
}

export function renderSkipped(skipped: SkippedPackage[]): void {
  if (skipped.length === 0) return;

  console.log(chalk.dim(`\n  Skipped: ${skipped.map((s) => `${s.name} (${s.reason})`).join(", ")}`));
}

export function renderSummary(status: AggregatedStatus): string {
  const parts: string[] = [];

  if (status.totalOutdated > 0) {
    parts.push(chalk.bold(`${status.totalOutdated} outdated`));
  } else {
    parts.push(chalk.green("everything up to date"));
  }

  if (status.totalRunning > 0) {
    parts.push(chalk.yellow(`${status.totalRunning} need restart`));
  }

  if (status.totalSkipped > 0) {
    parts.push(chalk.dim(`${status.totalSkipped} skipped`));
  }

  return `\n${parts.join(chalk.dim(" · "))}`;
}
