/** Information about an installed package */
export interface PackageInfo {
  name: string;
  installedVersion: string;
  latestVersion: string;
  /** Plugin-specific metadata (e.g., cask artifacts, binary paths) */
  meta?: Record<string, unknown>;
}

/** Result of upgrading a single package */
export interface UpgradeResult {
  package: string;
  success: boolean;
  fromVersion: string;
  toVersion: string;
  warnings?: string[];
  error?: string;
}

/** A running process affected by a package upgrade */
export interface DetectedProcess {
  packageName: string;
  displayName: string;
  pids: number[];
  kind: "gui-app" | "cli-process" | "service" | "extension";
}

/** What a plugin can do — the orchestrator adapts behavior accordingly */
export interface PluginCapabilities {
  list: boolean;
  outdated: boolean;
  upgradeSelective: boolean;
  upgradeAll: boolean;
  detectRunning: boolean;
  restart: boolean;
  streaming: boolean;
}

/** A skipped package with reason */
export interface SkippedPackage extends PackageInfo {
  reason: string;
}

/** Result of plugin-specific filtering */
export interface FilterResult {
  actionable: PackageInfo[];
  skipped: SkippedPackage[];
}

/** Plugin-specific config passed from the top-level config file */
export type PluginOptions = Record<string, unknown>;

/** The contract every package manager plugin must implement */
export interface PackageManagerPlugin {
  id: string;
  displayName: string;
  capabilities: PluginCapabilities;

  /** Receive plugin-specific config from the top-level config file. */
  configure?(options: PluginOptions): void;

  isAvailable(): Promise<boolean>;
  listInstalled(): Promise<PackageInfo[]>;
  listOutdated(): Promise<PackageInfo[]>;
  upgrade(packageName: string): Promise<UpgradeResult>;

  upgradeAll?(): Promise<UpgradeResult[]>;
  detectRunning?(packages: PackageInfo[]): Promise<DetectedProcess[]>;
  restart?(process: DetectedProcess): Promise<boolean>;
  filterOutdated?(packages: PackageInfo[]): Promise<FilterResult>;
  prepare?(): Promise<void>;
}
