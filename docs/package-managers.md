# Package Manager Reference

Quick reference for each package manager's CLI, disk layout, and detection strategy. All paths assume macOS (Apple Silicon where applicable).

## Tier 1 — Core

### Homebrew Formulae

**CLI**

| Operation | Command | Output |
|---|---|---|
| List installed | `brew list --formula` | names, one per line |
| Check outdated | `brew outdated --formula --json` | JSON: `{ formulae: [{ name, installed_versions, current_version, pinned }] }` |
| Upgrade one | `brew upgrade <name>` | streaming terminal output |
| List files | `brew list <name>` | all installed file paths |
| Info | `brew info --json=v2 <name>` | JSON with versions, deps, service config |
| Services | `brew services info --all --json` | JSON array with name, running, pid, status, command |
| Update index | `brew update` | fetches latest formulae (2-5s) |

**Disk layout**
- Cellar: `/opt/homebrew/Cellar/<name>/<version>/bin/`
- Bin symlinks: `/opt/homebrew/bin/<binary>` → Cellar path
- Opt (stable link): `/opt/homebrew/opt/<name>/` → current version in Cellar
- Keg-only formulae (e.g., `openssl@3`) are NOT symlinked into `bin/`

**Binary discovery**: `brew list <name> | grep '/bin/'` — returns full paths to all binaries

**Process detection**: Match `ps -eo pid,comm` against Cellar paths or bin symlink basenames. Services detected via `brew services info --all --json` (check `running: true`).

**Restart**: Services via `brew services restart <name>`. CLI processes: manual restart (unknown original launch command).

**Skip conditions**: `pinned: true` in outdated JSON

---

### Homebrew Casks

**CLI**

| Operation | Command | Output |
|---|---|---|
| List installed | `brew list --cask` | names, one per line |
| Check outdated | `brew outdated --cask --greedy --json` | JSON: `{ casks: [{ name, installed_versions, current_version }] }` |
| Upgrade one | `brew upgrade --cask <name>` | streaming terminal output |
| Info | `brew info --json=v2 <name>` | JSON with artifacts, auto_updates, version |

**Disk layout**
- Caskroom: `/opt/homebrew/Caskroom/<name>/<version>/`
- Apps: moved to `/Applications/<Name>.app` (real directory, not symlink)
- Binaries: `/opt/homebrew/bin/<name>` → Caskroom path
- Fonts: `~/Library/Fonts/`

**Artifact types** (from `brew info --json=v2` `artifacts` array)

| Type | What it means | Detection relevance |
|---|---|---|
| `app` | `.app` bundle in `/Applications` | Match against running GUI apps |
| `binary` | CLI binary symlinked to `/opt/homebrew/bin` | Match against `ps` |
| `pkg` | macOS installer package | Apps may be in non-standard paths; use `pkgutil --files` |
| `installer.manual` | User must run installer manually | **Cannot auto-upgrade** |
| `uninstall.quit` | Bundle ID for graceful quit | Use for osascript quit before upgrade |
| `zap` | Cleanup metadata | Not relevant for upgrade/detection |

**Process detection — GUI apps**:
1. `osascript` → get running app names and bundle IDs
2. Match `app` artifact names against running app names
3. Match `uninstall.quit` bundle IDs against running bundle IDs
4. Fallback: `ps -eo pid,comm | grep '.app/'` for executable paths

**Quarantine**: `xattr -p com.apple.quarantine /Applications/<Name>.app` — present = not yet approved. Absent = user-approved. After upgrade, previously-approved apps lose approval. Restore with `xattr -dr com.apple.quarantine`.

**Skip conditions**:
- `installer.manual` artifacts → cannot auto-upgrade
- `version: "latest"` → no version tracking, not actionable
- `auto_updates: true` → app self-updates; `--greedy` needed to even see them

**`--greedy` sub-flags**: `--greedy-latest` (only version:latest), `--greedy-auto-updates` (only auto-update casks)

---

### Mac App Store (mas)

**CLI** (`mas` v6.x)

| Operation | Command | Output |
|---|---|---|
| List installed | `mas list` | `<id>  <name>  (<version>)` per line |
| Check outdated | `mas outdated` | `<id>  <name>  (<old> -> <new>)` per line |
| Upgrade one | `mas upgrade <id>` | streaming, final line has install path |
| Upgrade all | `mas upgrade` | upgrades everything |

**No JSON output** — all text, needs regex parsing.

Parsing patterns:
- `mas list`: `/^\s*(\d+)\s+(.+?)\s+\((.+?)\)$/`
- `mas outdated`: `/^\s*(\d+)\s+(.+?)\s+\((.+?)\s+->\s+(.+?)\)$/`

**Disk layout**: Apps install to `/Applications/`

**Name mismatch gotcha**: The name in `mas list` does NOT always match the `.app` folder name on disk (e.g., `Kindle` → `Amazon Kindle.app`). For reliable path resolution, use Spotlight (`mdfind`) or the upgrade output which includes the actual `.app` path.

**Process detection**: Same as casks — `osascript` for running GUI app names, match against `.app` folder name (not mas name).

**Auth**: Requires App Store sign-in (via GUI, no `mas signin` command). `mas outdated` and `mas list` need sign-in. `mas search` does not.

**`--bundle` flag**: Available on `list`, `outdated`, `upgrade` — accepts CFBundleIdentifier instead of numeric ID.

---

## Tier 2 — Developer Tools

### npm Global

**CLI**

| Operation | Command | Output |
|---|---|---|
| List installed | `npm list -g --json --depth=0` | JSON: `{ dependencies: { name: { version } } }` |
| Check outdated | `npm outdated -g --json` | JSON: `{ name: { current, wanted, latest, location } }` — **exit code 1 if any outdated** |
| Upgrade one | `npm install -g <name>@latest` | |
| Upgrade within range | `npm update -g <name>` | |

**Disk layout**: `$(npm prefix -g)/lib/node_modules/<pkg>/` with bin symlinks at `$(npm prefix -g)/bin/`. With nvm: `~/.nvm/versions/node/<version>/`.

**Binary discovery**: Read `<prefix>/lib/node_modules/<pkg>/package.json` → `bin` field (map of command name → script path). `npm list` does not include bin info.

**Process detection**: Processes show as `node <script_path>` in `ps`. Match against resolved bin symlink targets.

---

### Bun Global

**CLI**

| Operation | Command | Output |
|---|---|---|
| List installed | `bun pm ls -g` | tree format, no JSON flag |
| Check outdated | `bun outdated -g` | table: Package / Current / Update / Latest — **no JSON, exit code 0** |
| Upgrade within range | `bun update -g <name>` | has `--dry-run` |
| Upgrade to latest | `bun add -g <name>@latest` | |

**Disk layout**: `~/.bun/install/global/node_modules/<pkg>/` with bin symlinks at `~/.bun/bin/`. Manifest at `~/.bun/install/global/package.json`.

**Binary discovery**: Read `~/.bun/install/global/node_modules/<pkg>/package.json` → `bin` field.

**Process detection**: Processes show as `node <path>` or `bun <path>` depending on shebang (`#!/usr/bin/env node` vs `#!/usr/bin/env bun`).

**Structured data workaround**: No JSON CLI output. Read `~/.bun/install/global/package.json` for declared deps, individual `package.json` files for installed versions.

---

### Cargo (Rust)

**CLI**

| Operation | Command | Output |
|---|---|---|
| List installed | `cargo install --list` | `<name> v<version>:` followed by indented binary names |
| Check outdated | None built-in | Use crates.io API or `cargo-update` crate |
| Upgrade one | `cargo install <name>` | reinstalls if version differs |
| Force reinstall | `cargo install <name> --force` | |

**Disk layout**: `~/.cargo/bin/` for binaries.

**Structured data**: `~/.cargo/.crates2.json` — JSON with installed crate metadata including features, profile, rustc version, and `bins` array.

**Version checking via crates.io**:
- Full API: `https://crates.io/api/v1/crates/<name>` → `crate.newest_version`
- Sparse index (faster): `https://index.crates.io/<path>/<name>` — path based on name length (1-char=`1/`, 2-char=`2/`, 3-char=`3/<first>/`, 4+=`<first2>/<next2>/`)

**Binary discovery**: `cargo install --list` shows binaries per crate. Also in `.crates2.json` → `bins` array.

**Process detection**: Match `ps -eo pid,comm` against `~/.cargo/bin/<binary>`.

---

### uv Tools (Python)

**CLI**

| Operation | Command | Output |
|---|---|---|
| List installed | `uv tool list` | `<name> v<version>` with indented binary names |
| Check outdated | `uv tool list --outdated` | appends `[latest: X.Y.Z]` to outdated entries |
| Upgrade one | `uv tool upgrade <name>` | |
| Upgrade all | `uv tool upgrade --all` | |

**Disk layout**: Venvs at `~/.local/share/uv/tools/<name>/`, bin symlinks at `~/.local/bin/`.

**Structured data**: `~/.local/share/uv/tools/<name>/uv-receipt.toml` — TOML with requirements and entrypoints (name, install-path, source package).

**No JSON output** — use `uv-receipt.toml` for structured data.

**Useful flags**: `--show-paths`, `--show-version-specifiers`, `--show-python`, `--show-with`

**Process detection**: Binaries are Python scripts. `ps` may show script name in `comm`. Match against `~/.local/bin/<binary>`.

---

### Go

**CLI**

| Operation | Command | Output |
|---|---|---|
| List installed | None — scan `$GOBIN` or `~/go/bin/` | |
| Check outdated | None — query Go module proxy | |
| Upgrade one | `go install <package-path>@latest` | |
| Get binary metadata | `go version -m <binary>` | embedded module info: path, mod (version), deps |

**Disk layout**: `~/go/bin/` (or `$GOBIN`, `$GOPATH/bin`).

**Version checking**: `go version -m <binary>` extracts module path + version. Then query `https://proxy.golang.org/<module>/@latest` → JSON `{ Version, Time }`.

**Important**: The `path` field (main package, used with `go install`) may differ from the `mod` field (module, used with proxy query). Both are in `go version -m` output.

**Process detection**: Match `ps -eo pid,comm` against `~/go/bin/<binary>`.

---

## Tier 3 — Editor/Tool Ecosystems

### VS Code Extensions

**CLI**

| Operation | Command | Output |
|---|---|---|
| List installed | `code --list-extensions --show-versions` | `publisher.name@version` per line |
| Update all | `code --update-extensions` | updates everything, reports what changed |
| Install/update one | `code --install-extension <id>` | installs latest |

**No built-in "check outdated"**. Two strategies:
1. **Simple**: `code --update-extensions` — let VS Code handle it. No dry-run.
2. **Precise**: Compare `--list-extensions --show-versions` against Marketplace API.

**Marketplace API** (no auth required):
```
POST https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery
Content-Type: application/json
Accept: application/json;api-version=3.0-preview.1
```
- `filterType: 7` = match by `publisher.name`
- `flags: 1` = versions only (minimal). `flags: 914` = full metadata.
- Batch: up to 50 extensions per request
- `versions[0].version` = latest stable

**Disk layout**: `~/.vscode/extensions/<publisher.name-version>/`. Metadata in `~/.vscode/extensions/extensions.json`.

**Detection**: Check if VS Code is running via `osascript` (app name "Code") or `pgrep`. Extensions don't need individual restart — VS Code hot-reloads most extensions.

---

## Tier 4 — System

### macOS System Updates (softwareupdate)

**CLI**

| Operation | Command | Output |
|---|---|---|
| List available | `softwareupdate --list` | text: `* Label: <name>` lines with Title, Version, Size, Action |
| List (cached) | `softwareupdate --list --no-scan` | same, but uses cached results (instant) |
| Install one | `sudo softwareupdate --install "<label>"` | label must match exactly |
| Install all | `sudo softwareupdate --install --all` | |
| History | `softwareupdate --history` | table of past updates |

**No JSON output** — text parsing required. Format is stable across macOS versions.

Parsing: lines starting with `* Label: ` are update entries. The next tab-indented line has `Title:`, `Version:`, `Size:`, `Recommended:`, and optionally `Action: restart`.

**Sudo**: `--list` works without sudo. `--install` requires sudo (and possibly owner auth on Apple Silicon).

**Restart**: `Action: restart` in output means reboot required. Xcode CLI tools typically don't need restart.

**Xcode CLI tools version**: `pkgutil --pkg-info=com.apple.pkg.CLTools_Executables` → `version` field.

---

## Cross-Cutting: Process Detection

**Primary scan**: `ps -eo pid,comm` — single call, all processes. Match against known bin directories.

**GUI apps**: `osascript -e 'tell application "System Events" to get name of every process whose background only is false'` — returns app names. Also available: `bundle identifier` variant for precise matching.

**Verification**: `pgrep -x <name>` + `ps -p <pid> -o args=` for full command path when `comm` is truncated.

**Shebang matters**: Node/Python tools show as `node <path>` or `python <path>` in ps, not the script name directly.
