# Topshelf Design Spec

> A "package manager manager" — aggregates all package managers on macOS, shows what's outdated, and upgrades selectively with post-upgrade hooks.

## 1. Plugin Interface

The core abstraction: every package manager is a plugin implementing `PackageManagerPlugin`.

```typescript
// --- Core types ---

interface PackageInfo {
  name: string;
  installedVersion: string;
  latestVersion: string;
  /** Plugin-specific metadata (e.g., cask artifacts, binary paths) */
  meta?: Record<string, unknown>;
}

interface UpgradeResult {
  package: string;
  success: boolean;
  fromVersion: string;
  toVersion: string;
  /** Non-fatal warnings (e.g., caveats) */
  warnings?: string[];
  error?: string;
}

interface DetectedProcess {
  packageName: string;
  displayName: string;
  pids: number[];
  kind: "gui-app" | "cli-process" | "service" | "extension";
}

interface PluginCapabilities {
  /** Can list installed packages */
  list: boolean;
  /** Can check for outdated packages */
  outdated: boolean;
  /** Can upgrade individual packages */
  upgradeSelective: boolean;
  /** Can upgrade all at once (some managers only support this) */
  upgradeAll: boolean;
  /** Can detect running processes affected by upgrades */
  detectRunning: boolean;
  /** Supports post-upgrade restart/reload */
  restart: boolean;
  /** Upgrade streams output to terminal (brew-style) */
  streaming: boolean;
}

// --- Plugin interface ---

interface PackageManagerPlugin {
  /** Unique identifier: "brew-formulae", "npm-global", "cargo", etc. */
  id: string;
  /** Human-readable name */
  displayName: string;
  /** What this plugin can do */
  capabilities: PluginCapabilities;

  /**
   * Check if this package manager is installed/available.
   * Called during plugin loading — disabled plugins are silently skipped.
   */
  isAvailable(): Promise<boolean>;

  /** List all globally-installed packages */
  listInstalled(): Promise<PackageInfo[]>;

  /** Return only packages with available updates */
  listOutdated(): Promise<PackageInfo[]>;

  /**
   * Upgrade a single package. Called once per package in the upgrade loop.
   * If capabilities.streaming, the plugin owns terminal output during this call.
   */
  upgrade(packageName: string): Promise<UpgradeResult>;

  /** Upgrade all packages at once (for managers that don't support selective) */
  upgradeAll?(): Promise<UpgradeResult[]>;

  /**
   * Detect running processes affected by the given packages.
   * Only called if capabilities.detectRunning is true.
   */
  detectRunning?(packages: PackageInfo[]): Promise<DetectedProcess[]>;

  /**
   * Restart/reload a detected process after upgrade.
   * Returns true if restart succeeded.
   */
  restart?(process: DetectedProcess): Promise<boolean>;

  /**
   * Plugin-specific filtering (e.g., brew skips unversioned casks,
   * installer-manual casks). Called after listOutdated().
   */
  filterOutdated?(packages: PackageInfo[]): Promise<{
    actionable: PackageInfo[];
    skipped: Array<PackageInfo & { reason: string }>;
  }>;
}
```

### Why this shape

- `isAvailable()` — plugins auto-disable when the manager isn't installed. No config needed for "I don't have cargo."
- `filterOutdated()` — brew has complex skip logic (unversioned casks, installer-manual). Other managers may have their own. Keeps filtering logic in the plugin, not the core.
- `capabilities` — the orchestrator adapts behavior per plugin (streaming vs. captured output, selective vs. bulk upgrade).
- `meta` on `PackageInfo` — brew needs cask artifact data for detection; other plugins may need similar escape hatches without polluting the core type.

## 2. Core Architecture

```
┌──────────────────────────────────────────────────┐
│                    CLI / TUI                      │
│  (commander + ink or simple output)               │
└──────────────┬───────────────────────────────────┘
               │
┌──────────────▼───────────────────────────────────┐
│              Orchestrator                         │
│  - Loads plugins                                  │
│  - Aggregates outdated across all managers        │
│  - Runs upgrade loop (per-package, per-plugin)    │
│  - Manages pre/post-upgrade hooks                 │
│  - Handles restart policy                         │
└──────┬───────────┬───────────┬───────────────────┘
       │           │           │
┌──────▼──┐ ┌─────▼───┐ ┌────▼────┐
│  brew   │ │  npm    │ │  cargo  │  ... (plugins)
│ plugin  │ │ plugin  │ │ plugin  │
└─────────┘ └─────────┘ └─────────┘
```

### Module breakdown

```
src/
├── cli.ts                  # Entry point, commander setup
├── config.ts               # Load/validate ~/.config/topshelf/config.toml
├── orchestrator.ts         # Core upgrade loop and aggregation
├── plugin-loader.ts        # Discover and initialize plugins
├── hooks.ts                # Pre/post-upgrade hook execution
├── types.ts                # Shared types (above interfaces)
├── output/
│   ├── table.ts            # Package table rendering
│   ├── spinner.ts          # Progress indicators
│   └── format.ts           # Version formatting, icons
├── plugins/
│   ├── brew-formulae.ts    # Homebrew formulae
│   ├── brew-casks.ts       # Homebrew casks (separate — different detection logic)
│   ├── mas.ts              # Mac App Store
│   ├── npm-global.ts       # npm -g
│   ├── bun-global.ts       # bun global
│   ├── cargo.ts            # cargo install --list
│   ├── uv.ts               # uv tool
│   ├── go.ts               # go install
│   ├── vscode.ts           # code --list-extensions
│   └── softwareupdate.ts   # macOS system updates
└── util/
    ├── exec.ts             # Subprocess helpers (captured + streaming)
    ├── pool.ts             # Concurrency limiter (from brew-bouncer)
    └── process.ts          # Running process detection helpers
```

### Plugin loader

Plugins are built-in (no dynamic loading for v1). The loader:

1. Imports all plugin modules from `src/plugins/`
2. Calls `isAvailable()` on each
3. Filters to those enabled in config (default: all available)
4. Returns ordered list (config controls display order)

External plugins are a future concern — the interface is designed for it, but v1 ships with built-ins only.

### Orchestrator flow

The orchestrator drives the upgrade workflow. Simplified:

```typescript
async function runStatus(plugins: PackageManagerPlugin[]): Promise<AggregatedStatus> {
  const results = await Promise.all(
    plugins.map(async (plugin) => {
      const outdated = await plugin.listOutdated();
      const filtered = plugin.filterOutdated
        ? await plugin.filterOutdated(outdated)
        : { actionable: outdated, skipped: [] };
      return { plugin, ...filtered };
    })
  );
  // Flatten and group for display
}

async function runUpgrade(
  targets: Array<{ plugin: PackageManagerPlugin; pkg: PackageInfo }>,
  hooks: HookRegistry,
  policies: UpgradePolicies,
): Promise<void> {
  for (const { plugin, pkg } of targets) {
    await hooks.runPre(plugin.id, pkg.name);

    const result = plugin.capabilities.streaming
      ? await plugin.upgrade(pkg.name)          // Plugin owns terminal
      : await upgradeWithProgress(plugin, pkg); // Core shows spinner

    if (result.success && plugin.capabilities.detectRunning) {
      const running = await plugin.detectRunning!([pkg]);
      for (const proc of running) {
        await handleRestart(plugin, proc, policies.restart);
      }
    }

    await hooks.runPost(plugin.id, pkg.name, result);
  }
}
```

### Brew plugin: split formulae vs. casks

Brew formulae and casks have fundamentally different detection and upgrade behavior. Modeling them as two separate plugins keeps each simple:

| Concern | brew-formulae | brew-casks |
|---------|--------------|------------|
| Outdated | `brew outdated --formula --json` | `brew outdated --cask --greedy --json` |
| Upgrade | `brew upgrade <name>` | `brew upgrade --cask <name>` |
| Detection | `brew list <name>` → match binaries in `ps` | Cask artifacts → match running .app bundles |
| Restart | `brew services restart` or "manual" | `osascript quit` + `open -a` |
| Filtering | Minimal | Unversioned, installer-manual |
| Quarantine | N/A | Snapshot/restore approved apps |

Both share `src/util/exec.ts` for brew command execution (ported from brew-bouncer's `brew/runner.ts`).

## 3. CLI Command Structure

```
topshelf                          # Default: show status (same as `topshelf status`)
topshelf status                   # Aggregated outdated across all managers
topshelf status --plugin brew     # Filter to one plugin
topshelf upgrade                  # Interactive upgrade (preview → confirm → execute)
topshelf upgrade -y               # Non-interactive: upgrade all, restart all
topshelf upgrade <pkg> [<pkg>...] # Upgrade specific packages
topshelf plugins                  # List plugins and their status (available/enabled/disabled)
topshelf plugins enable <id>      # Enable a plugin
topshelf plugins disable <id>     # Disable a plugin
topshelf config                   # Show current config
topshelf config edit              # Open config in $EDITOR
```

### Global options

```
--debug           Debug-level logging
--verbose         Info-level logging
--quiet           Errors only
--no-color        Disable color output
--json            JSON output (for scripting)
```

### Status output

Default output is a grouped table:

```
Homebrew Formulae (3 outdated)
  🍺 node       22.1.0  →  22.2.0
  🍺 ripgrep    14.0.3  →  14.1.1   ● running
  🍺 redis      7.2.4   →  7.4.0    ⟳ service restart

Homebrew Casks (2 outdated)
  🍷 1password  8.10.50 →  8.10.52  ⟳ restart needed
  🍷 wezterm    2024.1  →  2025.1

npm Global (1 outdated)
  📦 typescript  5.6.2  →  5.7.0

14 up to date · 6 outdated · 3 need restart
```

### Upgrade flow

Same model as brew-bouncer but across all plugins:

1. Show aggregated preview table
2. Confirm proceed (y/n/s for selective)
3. Ask restart policy if running processes detected (yes/ask/no)
4. Per-package upgrade loop with hooks
5. Summary line

## 4. Configuration Format

Location: `~/.config/topshelf/config.toml`

TOML chosen over JSON for readability of per-plugin config blocks. Over JSON: comments, multi-line strings, cleaner nested tables.

```toml
# Global settings
[settings]
# Default restart policy: "ask" | "yes" | "no"
restart_policy = "ask"

# Plugins to disable (all available plugins are enabled by default)
disabled_plugins = ["softwareupdate"]

# Display order (unlisted plugins appear after these, alphabetically)
plugin_order = [
  "brew-formulae",
  "brew-casks",
  "mas",
  "npm-global",
  "cargo",
]

# Global ignore list (package names, matched across all plugins)
ignore = []

# Per-plugin configuration
[plugins.brew-formulae]
ignore = ["node"]  # Managed by nvm/fnm instead

[plugins.brew-casks]
ignore = []
# Quarantine policy: "ask" | "yes" | "no"
quarantine_policy = "ask"

[plugins.npm-global]
# Some plugins may have specific config
ignore = []

[plugins.mas]
ignore = []
```

### Config loading

```typescript
interface TopshelfConfig {
  settings: {
    restart_policy: "ask" | "yes" | "no";
    disabled_plugins: string[];
    plugin_order: string[];
    ignore: string[];
  };
  plugins: Record<string, PluginConfig>;
}

interface PluginConfig {
  ignore: string[];
  [key: string]: unknown; // Plugin-specific options
}
```

Config is optional — topshelf works with zero configuration. Missing file = all defaults.

## 5. Brew-Bouncer → Brew Plugin Mapping

What brew-bouncer does today and where it lands in topshelf:

| brew-bouncer module | Topshelf location | Notes |
|---|---|---|
| `brew/runner.ts` | `src/util/exec.ts` | Generalized subprocess helpers, shared across plugins |
| `brew/parser.ts` | `src/plugins/brew-formulae.ts` + `brew-casks.ts` | Parsing logic splits with the plugins |
| `detect/matcher.ts` | `src/plugins/brew-casks.ts` + `brew-formulae.ts` | Each plugin implements `detectRunning()` |
| `detect/casks.ts` | `src/plugins/brew-casks.ts` + `src/util/process.ts` | `getRunningApps()` moves to shared util (other plugins may need it) |
| `detect/formulae.ts` | `src/plugins/brew-formulae.ts` + `src/util/process.ts` | `getRunningProcesses()` shared, formula-specific matching in plugin |
| `restart.ts` | `src/plugins/brew-*.ts` (each plugin's `restart()`) | GUI restart = casks plugin, service restart = formulae plugin |
| `quarantine.ts` | `src/plugins/brew-casks.ts` | Quarantine is cask-specific |
| `config.ts` | `src/config.ts` | Absorbed into topshelf's config (brew ignore → `plugins.brew-*.ignore`) |
| `commands/upgrade.ts` | `src/orchestrator.ts` | The upgrade loop generalizes across all plugins |
| `commands/status.ts` | `src/orchestrator.ts` | Status generalizes similarly |
| `prompt.ts` | `src/cli.ts` or `src/output/prompt.ts` | Prompts are UI-layer, not plugin-layer |
| `pool.ts` | `src/util/pool.ts` | Direct port |
| `spinner.ts` | `src/output/spinner.ts` | Direct port |
| `output/format.ts` | `src/output/table.ts` + `format.ts` | Extended for multi-plugin display |

### Key design change from brew-bouncer

brew-bouncer runs detection **before** showing the preview (one pass). Topshelf keeps this model — detection runs during the status phase so the preview table shows restart indicators. This means `detectRunning()` is called as part of `status`, not just `upgrade`.

## 6. Package Manager Tier List

### Tier 1 — Core (ship in v1)

| Manager | CLI for outdated | CLI for upgrade | Selective | Detection | Notes |
|---|---|---|---|---|---|
| **brew formulae** | `brew outdated --formula --json` | `brew upgrade <name>` | Yes | `brew list` + `ps` + `brew services` | Streaming output. Mature — port from brew-bouncer. |
| **brew casks** | `brew outdated --cask --greedy --json` | `brew upgrade --cask <name>` | Yes | Cask artifacts + `osascript` + `ps` | Quarantine management. Complex detection with fallback chain (artifacts → pkgutil → binaries). |
| **mas** | `mas outdated` | `mas upgrade <id>` | Yes | App name → running apps | Output is `<id> <name> (<old> -> <new>)`. Requires signed in to App Store. |

### Tier 2 — Developer tools

| Manager | CLI for outdated | CLI for upgrade | Selective | Detection | Notes |
|---|---|---|---|---|---|
| **npm global** | `npm outdated -g --json` | `npm update -g <name>` | Yes | Binary name → `ps` | JSON output has `current`, `wanted`, `latest`. Straightforward. |
| **bun global** | No `bun outdated -g` — must compare `bun pm ls -g` against registry | `bun update -g <name>` | Yes | Binary name → `ps` | **Gap**: No built-in outdated check. Need to query npm registry for latest versions. |
| **cargo** | `cargo install --list` + crates.io API | `cargo install <name>` | Yes | Binary name → `ps` | No built-in outdated command. Must compare installed versions against crates.io. [cargo-update](https://crates.io/crates/cargo-update) crate helps but is a third-party dep. |
| **uv tools** | `uv tool list` + pypi API | `uv tool upgrade <name>` | Yes | Binary name → `ps` | `uv tool list` shows installed tools. `uv tool upgrade` exists. Relatively new but well-designed CLI. |
| **go** | No built-in — must track installed binaries vs. proxy.golang.org | `go install <pkg>@latest` | Yes | Binary name → `ps` | Go doesn't track "globally installed" packages. Would need to scan `$GOBIN` and resolve module versions. Complex. |
| **pipx** | `pipx list --json` + pypi | `pipx upgrade <name>` | Yes | Binary name → `ps` | Alternative to uv for Python tools. `pipx` has `upgrade-all` too. |

### Tier 3 — Editor/tool ecosystems

| Manager | CLI for outdated | CLI for upgrade | Selective | Detection | Notes |
|---|---|---|---|---|---|
| **VS Code extensions** | `code --list-extensions --show-versions` + marketplace API | `code --install-extension <id>` (installs latest) | Yes | N/A (extensions reload on VS Code restart) | No built-in outdated check. Must query VS Code marketplace API. Extension updates usually happen automatically. |
| **Claude Code plugins** | TBD — marketplace API is new | TBD | TBD | N/A | API may not be stable yet. Wait for it to settle. |
| **JetBrains** | No standard CLI | N/A | N/A | N/A | JetBrains manages its own updates. Skip for now. |

### Tier 4 — System

| Manager | CLI for outdated | CLI for upgrade | Selective | Detection | Notes |
|---|---|---|---|---|---|
| **softwareupdate** | `softwareupdate --list` | `softwareupdate --install <name>` | Yes | N/A | May require restart. Output parsing is fragile. Often requires `sudo`. |
| **Xcode CLI tools** | `softwareupdate --list` (filters for CLI tools) | `softwareupdate --install` | No | N/A | Bundled with softwareupdate. |

### Implementation priority

**v1**: brew-formulae, brew-casks, mas, npm-global
**v1.1**: cargo, uv, bun-global
**v2**: vscode, softwareupdate, go
**Deferred**: Claude Code plugins, JetBrains

Rationale: v1 covers brew-bouncer feature parity (Tier 1) plus the single most common developer tool (npm). Tier 2 managers that lack built-in outdated detection (cargo, bun, go) need more work and can follow.

## 7. TUI Approach

### Decision: Commander + simple output for v1, Ink later

brew-bouncer's current stack (commander + chalk + cli-table3 + @inquirer/prompts) works well and is proven. agent-kit also uses commander without Ink. Starting with this stack:

- **Commander.js** — command routing, argument parsing
- **chalk** — colored output
- **cli-table3** — table rendering
- **@inquirer/prompts** — interactive selection (upgrade confirmation, restart policy, package selection)
- **Custom spinner** — port brew-bouncer's braille spinner

### Why not Ink for v1

- Ink adds React as a dependency (bundle size, complexity)
- brew-bouncer's simple output + inquirer prompts cover the v1 use case
- The "streaming upgrade" model (brew owns the terminal during upgrade) conflicts with Ink's rendering loop
- Ink's value proposition (reactive components, layout) matters more for a persistent dashboard — which is a v2 feature

### Ink migration path (v2)

When the TUI grows to need a persistent dashboard (live-updating status, interactive package selection with filtering, split-pane upgrade output), migrate to Ink:

- Commander still handles command parsing and routes to Ink app components
- Each "screen" (status dashboard, upgrade progress, plugin management) is an Ink component
- The streaming upgrade problem can be solved with Ink's `<Static>` component for completed output + a live area for the current package

### "bigtop" GUI (parallel effort)

Jason mentioned a GUI layer via "bigtop" framework. Topshelf's architecture supports this — the orchestrator and plugins are pure logic with no terminal dependencies. The CLI/TUI is a thin layer on top. A GUI can import the same orchestrator and plugins.

## 8. Post-Upgrade Hooks Model

Two categories: **built-in** (restart detection) and **custom** (user-defined scripts).

### Built-in: Restart detection

Ported from brew-bouncer. The plugin interface handles this — each plugin implements `detectRunning()` and `restart()`. The orchestrator manages the policy (ask/yes/no) and the loop.

Restart strategies by process kind:

| Kind | Strategy | Automatic? |
|---|---|---|
| `gui-app` | `osascript quit` → wait → `open -a` | Yes |
| `service` | `brew services restart` | Yes |
| `cli-process` | Print "restart manually" | No — don't know the original launch command |
| `extension` | Depends on host (VS Code: reload window) | Maybe |

### Built-in: Quarantine management (brew casks only)

Ported from brew-bouncer. Lives entirely in the brew-casks plugin:
1. Before upgrade: snapshot which apps are not quarantined (previously approved)
2. After upgrade: optionally remove quarantine attribute to restore approved state

### Custom hooks: per-package scripts

The `spike/package-hooks` branch is exploring this. Design for topshelf:

```toml
# In config.toml
[[hooks]]
plugin = "brew-casks"
package = "parallels"
phase = "post-upgrade"
command = "prlctl register-vm"

[[hooks]]
plugin = "brew-formulae"
package = "postgresql@16"
phase = "post-upgrade"
command = "brew services restart postgresql@16"

[[hooks]]
plugin = "*"
package = "*"
phase = "post-upgrade"
command = "~/.config/topshelf/hooks/notify.sh"
```

```typescript
interface Hook {
  /** Plugin ID pattern (glob-style, "*" = all) */
  plugin: string;
  /** Package name pattern (glob-style) */
  package: string;
  /** When to run */
  phase: "pre-upgrade" | "post-upgrade";
  /** Shell command to execute */
  command: string;
}

interface HookRegistry {
  runPre(pluginId: string, packageName: string): Promise<void>;
  runPost(pluginId: string, packageName: string, result: UpgradeResult): Promise<void>;
}
```

Hook execution:
- Hooks run in config order
- `post-upgrade` hooks receive the `UpgradeResult` as env vars (`TOPSHELF_PACKAGE`, `TOPSHELF_FROM_VERSION`, `TOPSHELF_TO_VERSION`, `TOPSHELF_SUCCESS`)
- Hook failure is logged but does not stop the upgrade loop (same principle as brew-bouncer: never bail)
- `--verbose` shows hook output, otherwise suppressed

## 9. Open Questions and Trade-offs

### Naming: brew-formulae + brew-casks vs. single brew plugin

**Split (current proposal)**: Simpler plugin code, clear separation of detection logic, each plugin stays focused. Downside: `brew update` runs once but two plugins use its results — need shared state or a pre-pass.

**Combined**: One plugin, internal split. More complex but avoids the shared-state problem. The orchestrator doesn't need to know about brew's internal distinction.

> Recommendation: Split. The shared `brew update` call can be handled by a plugin-group concept or simply by caching — `brew update` is idempotent and the second call is a no-op if run recently.

### Config format: TOML vs. JSON vs. YAML

**TOML** (proposed): Readable, supports comments, good for the nested plugin config pattern. Downside: less common in the JS ecosystem, needs a parser dep.

**JSON**: Zero deps, but no comments. Poor ergonomics for user-edited config.

**YAML**: Familiar, supports comments, but whitespace-sensitivity is an error magnet.

> Recommendation: TOML. The `smol-toml` package is small and well-maintained.

### External plugin loading (future)

The plugin interface is designed for it, but v1 ships built-in only. When we add external plugins:
- Where do they live? `~/.config/topshelf/plugins/`?
- How are they distributed? npm packages? Git repos?
- Security model? Plugins run shell commands — this is inherently trusted.

> Park this. The interface is ready; the distribution story can wait.

### Package identity across managers

Some packages exist in multiple managers (e.g., `node` via brew formula, `fnm`, `nvm`). Topshelf should not try to deduplicate — each plugin reports independently. The config `ignore` list handles "I manage node via fnm, ignore the brew formula."

### Bun/cargo/go: no built-in outdated check

These managers don't have `outdated` commands for globally-installed packages. Options:
1. Query package registries (crates.io, npm for bun, proxy.golang.org) — adds network calls and API deps
2. Require companion tools (cargo-update) — adds install requirements
3. Ship without outdated detection, just show installed versions — reduced utility

> Recommendation: Query registries directly. It's a few HTTP calls. The plugins can cache results for the session.

### Streaming output vs. captured output

brew-bouncer gives brew full terminal control during upgrades (streaming). This is important — brew's interactive prompts, caveats, and download progress are visible. Other managers (npm, cargo) also produce useful streaming output.

Trade-off: streaming output prevents the TUI from rendering around it. In v1 (simple output), this is fine. In v2 (Ink), it needs the `<Static>` + live area approach.

> For v1: all plugins that set `capabilities.streaming = true` get full terminal passthrough. Others get a spinner with captured output shown on failure.

### Detection scope: what counts as "running"?

brew-bouncer checks GUI apps (osascript), CLI processes (ps), and brew services. For other managers:
- npm/cargo/go global packages install binaries — same `ps` matching works
- VS Code extensions: "running" means VS Code is running. Always suggest reload.
- MAS apps: same GUI detection as casks

> Shared utilities in `src/util/process.ts`: `getRunningApps()` and `getRunningProcesses()` are reusable across plugins. Each plugin maps its packages to the appropriate detection method.

### `brew update` timing

`brew update` is slow (2-5s). brew-bouncer runs it once at the start of `upgrade`. Topshelf needs it for the brew plugins' `listOutdated()` calls. Options:
1. Run `brew update` implicitly when brew plugins are loaded
2. Run it once during the orchestrator's status phase, before calling any plugin's `listOutdated()`
3. Let each brew plugin call it (wasteful if both are enabled)

> Recommendation: The orchestrator calls a `prepare()` hook (optional on the plugin interface) before the status phase. Both brew plugins share a cached `brewUpdate()` call via a shared module.

```typescript
interface PackageManagerPlugin {
  // ... existing methods ...

  /**
   * Optional one-time setup before status/upgrade operations.
   * Use for expensive shared operations like `brew update`.
   */
  prepare?(): Promise<void>;
}
```
