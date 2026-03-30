import {
  exec,
  getRunningProcesses,
  type PackageManagerPlugin,
  type PackageInfo,
  type UpgradeResult,
  type DetectedProcess,
  type PluginOptions,
  type RunningProcess,
} from "@topshelf/core";
import { getLogger } from "@logtape/logtape";

const log = getLogger(["topshelf", "gem"]);

let gemPath = "gem";

// gem outdated: "bigdecimal (4.0.1 < 4.1.0)"
const OUTDATED_RE = /^(\S+)\s+\((\S+)\s+<\s+(\S+)\)$/;
// gem list: "bigdecimal (4.0.1)" or "bundler (default: 4.0.8)"
const LIST_RE = /^(\S+)\s+\((?:default:\s+)?(\S+)\)$/;

// --- Plugin state ---

const outdatedCache = new Map<string, PackageInfo>();

// --- Plugin implementation ---

export const gemPlugin: PackageManagerPlugin = {
  id: "gem",
  displayName: "RubyGems",
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
    if (typeof options.gem_path === "string") {
      gemPath = options.gem_path;
      log.info`Using custom gem path: ${gemPath}`;
    }
  },

  async isAvailable() {
    const result = await exec("which", ["gem"]);
    return result.exitCode === 0;
  },

  async listInstalled() {
    const result = await exec(gemPath, ["list", "--no-versions"]);
    if (result.exitCode !== 0) return [];

    // gem list --no-versions just gives names; need versions too
    const fullResult = await exec(gemPath, ["list"]);
    if (fullResult.exitCode !== 0) return [];

    const packages: PackageInfo[] = [];
    for (const line of fullResult.stdout.trim().split("\n")) {
      const match = LIST_RE.exec(line);
      if (!match) continue;
      packages.push({
        name: match[1]!,
        installedVersion: match[2]!,
        latestVersion: match[2]!,
        meta: { type: "gem" },
      });
    }
    return packages;
  },

  async listOutdated() {
    const result = await exec(gemPath, ["outdated"]);
    if (result.exitCode !== 0 || !result.stdout.trim()) return [];

    const packages: PackageInfo[] = [];
    for (const line of result.stdout.trim().split("\n")) {
      const match = OUTDATED_RE.exec(line);
      if (!match) continue;

      const pkg: PackageInfo = {
        name: match[1]!,
        installedVersion: match[2]!,
        latestVersion: match[3]!,
        meta: { type: "gem" },
      };
      packages.push(pkg);
      outdatedCache.set(pkg.name, pkg);
    }

    log.info`Found ${packages.length} outdated gems`;
    return packages;
  },

  async upgrade(packageName) {
    const cached = outdatedCache.get(packageName);
    const result = await exec(gemPath, ["update", packageName]);

    return {
      package: packageName,
      success: result.exitCode === 0,
      fromVersion: cached?.installedVersion ?? "unknown",
      toVersion: cached?.latestVersion ?? "unknown",
      error: result.exitCode !== 0 ? result.stderr.trim() : undefined,
    };
  },

  async upgradeAll() {
    const result = await exec(gemPath, ["update"]);
    return [{
      package: "*",
      success: result.exitCode === 0,
      fromVersion: "",
      toVersion: "",
    }];
  },

  async detectRunning(packages) {
    const processes = await getRunningProcesses();
    const detected: DetectedProcess[] = [];

    // Gem binaries go to the gem bin dir
    const binDirResult = await exec(gemPath, ["environment", "gemdir"]);
    const gemDir = binDirResult.stdout.trim();

    for (const pkg of packages) {
      // Match by package name as binary name (most gems name their binary after the gem)
      const matched = matchProcesses([pkg.name], processes);
      if (matched.length > 0) {
        detected.push({
          packageName: pkg.name,
          displayName: matched[0]!.name,
          pids: matched.map((p) => p.pid),
          kind: "cli-process",
        });
      }
    }

    return detected;
  },
};

function matchProcesses(
  binNames: string[],
  processes: RunningProcess[],
): RunningProcess[] {
  const matched: RunningProcess[] = [];
  const seen = new Set<number>();

  for (const bin of binNames) {
    for (const proc of processes) {
      if (proc.name === bin && !seen.has(proc.pid)) {
        matched.push(proc);
        seen.add(proc.pid);
      }
    }
  }

  return matched;
}
