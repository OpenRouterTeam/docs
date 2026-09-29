# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- **Launch DevTools viewer**:
  ```bash
  openrouter devtools
  ```
- **Build the project**:
  ```bash
  bun run build
  ```
- **Run tests**:
  ```bash
  bun test
  ```
- **Release a new version**:
  ```bash
  npm run release
  ```

## Architecture

This CLI provides developer tools for OpenRouter SDK:

- **Entry Point**: `src/cli.ts` - Command-line interface
- **DevTools Viewer**: `src/devtools/viewer/` - Web UI for SDK telemetry
  - Server: Hono server serving React SPA
  - Client: React + Vite for visualization
- **StatusLine**: `src/utils/statusline.ts` - Claude Code statusline integration
- **Configuration**: Simplified config in `~/.openrouter/`

### Commands

- `devtools` - Launch SDK DevTools viewer on port 4983
- `statusline` - Output formatted statusline for Claude Code
- `version` / `help` - Version and help information

## Configuration System

### File Locations

**System directories:**
- Home directory: `~/.openrouter/`
- Log file: `~/.openrouter/claude-code-proxy.log`
- User config: `~/.openrouter/claude-code-proxy.json`

### Configuration Loading

**Config loading** (src/utils/index.ts):
1. Read user config (`~/.openrouter/claude-code-proxy.json`)
2. If missing, use default config

**Environment variable interpolation:**
- Supports `$VAR_NAME` and `${VAR_NAME}` syntax
- Applied recursively to all string values in config
- Implemented in interpolateEnvVars() function

## Development

```bash
bun install
bun run build
bun test
```

## Building

```bash
bun run build
```

This creates:
- `dist/cli` - Standalone executable (includes CLI + DevTools server + client assets + all dependencies + Bun runtime)

## Testing

```bash
bun test
```

## No proxy functionality

The CLI has no proxy commands (`start`/`stop`/`restart`/`code`/`status`). `MIGRATION.md` is the user-facing guide for v0.x users.
