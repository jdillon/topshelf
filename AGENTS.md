# Topshelf

## Conventions

- **No scripts in package.json** — moon handles all task execution
- **Moon manages bun** — don't run `bun install` manually
- **ESM-first** — `"type": "module"` everywhere
- **Moon owns the build graph** — no `tsc --build`, no tsconfig project references
- **Library build tasks** use `deps: ['^:build']` for dependency ordering

## Issue Tracking

This project uses beads (`bd`). Follow all beads rules from `~/.agent/rules/beads.md` — especially epic/story/task hierarchy, status management, and closing rules.

## Commands

```bash
moon run :build          # Build all packages
moon run :typecheck      # Type check all packages
moon run :lint           # Lint all packages
moon run :test           # Test all packages
moon run cli:dev         # Run the CLI in dev mode
```
