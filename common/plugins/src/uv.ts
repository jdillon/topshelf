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

const log = getLogger(["topshelf", "uv"]);

let uvPath = "uv";

// Parse `uv tool list` output:
//   claude-monitor v3.1.0
//   - ccm
//   - claude-monitor
const TOOL_RE = /^(\S+)\s+v(.+)$/;
const BIN_RE = /^- (.+)$/;

// Parse `uv tool list --outdated` appended text:
//   specify-cli v0.0.20 [latest: 1.0.0]
const OUTDATED_RE = /^(\S+)\s+v(\S+)\s+\[latest:\s+(\S+)\]$/;

// --- Plugin state ---

const outdatedCache = new Map<string, PackageInfo>();

// --- Helpers ---

function parseToolList(output: string): Array<{ name: string; version: string; bins: string[] }> {
  const tools: Array<{ name: string; version: string; bins: string[] }> = [];
  let current: { name: string; version: string; bins: string[] } | null = null;

  for (const line of output.trim().split("\n")) {
    const toolMatch = TOOL_RE.exec(line);
    if (toolMatch) {
      if (current) tools.push(current);
      current = { name: toolMatch[1]!, version: toolMatch[2]!, bins: [] };
      continue;
    }

    const binMatch = BIN_RE.exec(line);
    if (binMatch && current) {
      current.bins.push(binMatch[1]!);
    }
  }

  if (current) tools.push(current);
  return tools;
}

// --- Plugin implementation ---

export const uvPlugin: PackageManagerPlugin = {
  id: "uv",
  displayName: "uv",
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
    if (typeof options.uv_path === "string") {
      uvPath = options.uv_path;
      log.info`Using custom uv path: ${uvPath}`;
    }
  },

  async isAvailable() {
    const result = await exec("which", ["uv"]);
    return result.exitCode === 0;
  },

  async listInstalled() {
    const result = await exec(uvPath, ["tool", "list"]);
    if (result.exitCode !== 0) return [];

    return parseToolList(result.stdout).map((tool) => ({
      name: tool.name,
      installedVersion: tool.version,
      latestVersion: tool.version,
      meta: { type: "uv", bins: tool.bins },
    }));
  },

  async listOutdated() {
    const result = await exec(uvPath, ["tool", "list", "--outdated"]);
    if (result.exitCode !== 0 || !result.stdout.trim()) return [];

    const packages: PackageInfo[] = [];

    // Parse outdated entries (they have [latest: X.Y.Z] appended)
    let currentBins: string[] = [];
    for (const line of result.stdout.trim().split("\n")) {
      const outdatedMatch = OUTDATED_RE.exec(line);
      if (outdatedMatch) {
        // Save bins from previous entry if any
        if (packages.length > 0 && currentBins.length > 0) {
          const prev = packages[packages.length - 1]!;
          prev.meta = { ...prev.meta, bins: currentBins };
        }
        currentBins = [];

        const pkg: PackageInfo = {
          name: outdatedMatch[1]!,
          installedVersion: outdatedMatch[2]!,
          latestVersion: outdatedMatch[3]!,
          meta: { type: "uv", bins: [] },
        };
        packages.push(pkg);
        outdatedCache.set(pkg.name, pkg);
        continue;
      }

      const binMatch = BIN_RE.exec(line);
      if (binMatch) {
        currentBins.push(binMatch[1]!);
      }
    }

    // Attach bins to last entry
    if (packages.length > 0 && currentBins.length > 0) {
      const last = packages[packages.length - 1]!;
      last.meta = { ...last.meta, bins: currentBins };
    }

    log.info`Found ${packages.length} outdated uv tools`;
    return packages;
  },

  async upgrade(packageName) {
    const cached = outdatedCache.get(packageName);
    const result = await exec(uvPath, ["tool", "upgrade", packageName]);

    return {
      package: packageName,
      success: result.exitCode === 0,
      fromVersion: cached?.installedVersion ?? "unknown",
      toVersion: cached?.latestVersion ?? "unknown",
      error: result.exitCode !== 0 ? result.stderr.trim() : undefined,
    };
  },

  async upgradeAll() {
    const result = await exec(uvPath, ["tool", "upgrade", "--all"]);
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

    for (const pkg of packages) {
      const bins = (pkg.meta?.bins as string[]) ?? [pkg.name];
      const matched = matchProcesses(bins, processes);

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
