# Relative Path Validator VS Code Extension

A TypeScript server plugin that validates relative path literals marked with `/* ts-relative-path */` comments.

## Usage

Add the `/* ts-relative-path */` comment before a string literal to validate that the relative path exists:

```ts
// @ts-relative-path
const validPath = './package.json';

// @ts-relative-path
const invalidPath = './non-existent-file.txt';

// Regular strings are not validated
const regularString = './some-path.txt'; // No validation
```

## Features

- Real-time validation of relative paths during development
- Integration with TypeScript's diagnostic system
- Only validates paths marked with the `// @ts-relative-path` comment
- Shows clear error messages for non-existent paths
- Resolves paths relative to the current file's directory

## Installation

This extension is automatically loaded when the workspace contains the `.vscode/extensions/relative-path-validator` directory. The TypeScript server plugin is configured via the workspace settings.

## Development

1. Make changes to `src/index.ts`
2. Run `bun run compile` to build
3. Restart the TypeScript server in VS Code (`Ctrl/Cmd + Shift + P` → "TypeScript: Restart TS Server")
