# Migration Guide: v0.x → v1.0

## Breaking Changes

v1.0 removes all proxy functionality.

### Removed Commands

- ❌ `openrouter start` - Proxy server removed
- ❌ `openrouter stop` - Proxy server removed
- ❌ `openrouter restart` - Proxy server removed
- ❌ `openrouter code` - Claude Code proxy removed
- ❌ `openrouter status` - Proxy status removed

### What Remains

- ✅ `openrouter devtools` - SDK DevTools viewer
- ✅ `openrouter statusline` - Claude Code statusline
- ✅ `openrouter version` - Version info
- ✅ `openrouter help` - Help

### Configuration Changes

**Old config:**
```json
{
  "OPENROUTER_API_KEY": "sk-or-xxx",
  "HOST": "127.0.0.1",
  "PORT": 3000,
  "models": {
    "default": "anthropic/claude-sonnet-4"
  }
}
```

**New config:**
```json
{
  "LOG": true,
  "LOG_LEVEL": "debug",
  "DEVTOOLS_PORT": 4983
}
```

## Migration Steps

1. Uninstall old version:
   ```bash
   npm uninstall -g @openrouter/cli
   ```

2. Install v1.0:
   ```bash
   npm install -g @openrouter/cli@1.0.0
   ```

3. Update config file (or delete it - most fields optional)

4. If using devtools, no changes needed

## Questions?

Open an issue: https://github.com/openrouter/openrouter-web/issues
