import { select, checkbox, confirm } from "@inquirer/prompts";
import type { PackageManagerPlugin, PackageInfo, DetectedProcess } from "@topshelf/core";
import { pluginIcon, shortVersion } from "./output/format.js";

export type ConfirmChoice = "yes" | "no" | "select";

export async function confirmUpgrade(): Promise<ConfirmChoice> {
  return select({
    message: "Proceed with upgrade?",
    choices: [
      { name: "Yes, upgrade all", value: "yes" as const },
      { name: "Select packages", value: "select" as const },
      { name: "Cancel", value: "no" as const },
    ],
  });
}

export type RestartPolicy = "yes" | "ask" | "no";

export async function confirmRestartPolicy(
  affectedCount: number,
): Promise<RestartPolicy> {
  return select({
    message: `${affectedCount} running process${affectedCount > 1 ? "es" : ""} affected. Restart policy?`,
    choices: [
      { name: "Ask for each", value: "ask" as const },
      { name: "Restart all", value: "yes" as const },
      { name: "Skip restarts", value: "no" as const },
    ],
  });
}

export type RestartChoice = "yes" | "no" | "all";

export async function confirmRestart(
  displayName: string,
): Promise<RestartChoice> {
  return select({
    message: `Restart ${displayName}?`,
    choices: [
      { name: "Yes", value: "yes" as const },
      { name: "No", value: "no" as const },
      { name: "Yes to all remaining", value: "all" as const },
    ],
  });
}

export async function selectPackages(
  targets: Array<{ plugin: PackageManagerPlugin; pkg: PackageInfo }>,
  detectedMap: Map<string, DetectedProcess>,
): Promise<Array<{ plugin: PackageManagerPlugin; pkg: PackageInfo }>> {
  const choices = targets.map((t) => {
    const proc = detectedMap.get(t.pkg.name);
    const status = proc ? " (running)" : "";
    const icon = pluginIcon(t.plugin.id);
    const label = `${icon} ${t.pkg.name} ${shortVersion(t.pkg.installedVersion)} → ${shortVersion(t.pkg.latestVersion)}${status}`;
    return { name: label, value: t, checked: true };
  });

  return checkbox({
    message: "Select packages to upgrade:",
    choices,
  });
}
