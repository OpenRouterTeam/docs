# OpenRouter DevTools CLI

> SDK DevTools and utilities for OpenRouter development

[![npm version](https://badge.fury.io/js/%40openrouter%2Fcli.svg)](https://www.npmjs.com/package/@openrouter/cli)

## Features

- 📊 **SDK DevTools Viewer** - Visualize OpenRouter SDK telemetry in a beautiful web UI
- 📈 **StatusLine Integration** - Claude Code statusline showing model and token usage

## Installation

```bash
npm install -g @openrouter/cli
```

## Commands

### DevTools Viewer

The viewer reads an existing compatible `.devtools/openrouter-generations.json` telemetry file. There is currently no complete supported public client integration: `@openrouter/sdk` cannot attach the plain DevTools hooks through its typed public options, while Agent SDK `callModel` uses a streaming Responses API path that DevTools cannot yet complete or normalize.

Launch the viewer from the project containing the telemetry file:

```bash
openrouter devtools
```

Serves the web UI at http://localhost:4983. Open that URL in your browser.

### StatusLine

For Claude Code users, add a statusline showing model and token usage:

```bash
openrouter statusline
```

Configure in Claude Code settings to display:
- Current directory
- Git branch
- Model name
- Input/output tokens

## Configuration

Optional config at `~/.openrouter/claude-code-proxy.json`:

```json
{
  "LOG": true,
  "LOG_LEVEL": "debug",
  "StatusLine": {
    "currentStyle": "default"
  }
}
```

Set the DevTools viewer port when launching the command:

```bash
OPENROUTER_DEVTOOLS_PORT=5000 openrouter devtools
```

## Development

```bash
bun install
bun run build
bun test
```

## Migration from v0.x

**Breaking change:** v1.0.0 removes all proxy functionality (start/stop/restart/code commands).

See [MIGRATION.md](./MIGRATION.md) for details.

## License

SEE LICENSE IN LICENSE
