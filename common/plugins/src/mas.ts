import {
  exec,
  type PackageManagerPlugin,
  type PackageInfo,
  type UpgradeResult,
  type DetectedProcess,
  type PluginOptions,
} from "@topshelf/core";
import { getLogger } from "@logtape/logtape";

const log = getLogger(["topshelf", "mas"]);

let masPath = "mas";

// Regex for `mas list`: "  497799835  Xcode  (26.4)"
const LIST_RE = /^\s*(\d+)\s+(.+?)\s+\((.+?)\)$/;
// Regex for `mas outdated`: "  1444383602  Goodnotes  (7.0.36 -> 7.0.44)"
const OUTDATED_RE = /^\s*(\d+)\s+(.+?)\s+\((.+?)\s+->\s+(.+?)\)$/;

// --- Plugin state ---

const outdatedCache = new Map<string, PackageInfo>();

// --- Plugin implementation ---

export const masPlugin: PackageManagerPlugin = {
  id: "mas",
  displayName: "Mac App Store",
  capabilities: {
    list: true,
    outdated: true,
    upgradeSelective: true,
    upgradeAll: true,
    detectRunning: true,
    restart: false,
    streaming: false,
  },

  configure(options: PluginOptions) {
    if (typeof options.mas_path === "string") {
      masPath = options.mas_path;
      log.info`Using custom mas path: ${masPath}`;
    }
  },

  async isAvailable() {
    const result = await exec("which", ["mas"]);
    return result.exitCode === 0;
  },

  async listInstalled() {
    const result = await exec(masPath, ["list"]);
    if (result.exitCode !== 0) return [];

    const packages: PackageInfo[] = [];
    for (const line of result.stdout.trim().split("\n")) {
      const match = LIST_RE.exec(line);
      if (!match) continue;
      packages.push({
        name: match[2]!,
        installedVersion: match[3]!,
        latestVersion: match[3]!,
        meta: { type: "mas", appId: match[1]! },
      });
    }
    return packages;
  },

  async listOutdated() {
    const result = await exec(masPath, ["outdated"]);
    if (result.exitCode !== 0 || !result.stdout.trim()) return [];

    const packages: PackageInfo[] = [];

    for (const line of result.stdout.trim().split("\n")) {
      const match = OUTDATED_RE.exec(line);
      if (!match) continue;

      const pkg: PackageInfo = {
        name: match[2]!,
        installedVersion: match[3]!,
        latestVersion: match[4]!,
        meta: { type: "mas", appId: match[1]! },
      };
      packages.push(pkg);
      outdatedCache.set(pkg.name, pkg);
    }

    log.info`Found ${packages.length} outdated MAS apps`;
    return packages;
  },

  async upgrade(packageName) {
    const cached = outdatedCache.get(packageName);
    const appId = (cached?.meta?.appId as string) ?? packageName;

    const result = await exec(masPath, ["upgrade", appId]);

    return {
      package: packageName,
      success: result.exitCode === 0,
      fromVersion: cached?.installedVersion ?? "unknown",
      toVersion: cached?.latestVersion ?? "unknown",
      error: result.exitCode !== 0 ? result.stderr.trim() : undefined,
    };
  },

  async upgradeAll() {
    const result = await exec(masPath, ["upgrade"]);
    return [{
      package: "*",
      success: result.exitCode === 0,
      fromVersion: "",
      toVersion: "",
    }];
  },

  async detectRunning(packages) {
    // Get running GUI app names via osascript
    const result = await exec("osascript", [
      "-e",
      'tell application "System Events" to get name of every process whose background only is false',
    ]);
    if (result.exitCode !== 0) return [];

    const runningNames = result.stdout
      .trim()
      .split(", ")
      .map((n) => n.trim().toLowerCase());

    const detected: DetectedProcess[] = [];

    for (const pkg of packages) {
      // MAS app names don't always match .app names — try fuzzy match
      const appName = pkg.name.toLowerCase();
      const isRunning = runningNames.some(
        (r) => r === appName || r.includes(appName) || appName.includes(r),
      );

      if (isRunning) {
        detected.push({
          packageName: pkg.name,
          displayName: pkg.name,
          pids: [],
          kind: "gui-app",
        });
      }
    }

    return detected;
  },
};
