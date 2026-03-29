export type {
  PackageInfo,
  UpgradeResult,
  DetectedProcess,
  PluginCapabilities,
  SkippedPackage,
  FilterResult,
  PackageManagerPlugin,
} from "./types.js";

export type { ExecResult } from "./exec.js";
export { exec, execStreaming } from "./exec.js";

export { pool } from "./pool.js";

export type { RunningProcess } from "./process.js";
export { getRunningProcesses } from "./process.js";

export type { TopshelfConfig, PluginConfig } from "./config.js";
export { loadConfig, configPath } from "./config.js";

export type {
  PluginStatus,
  AggregatedStatus,
  UpgradeCallbacks,
} from "./orchestrator.js";
export { runStatus, runUpgrade } from "./orchestrator.js";
