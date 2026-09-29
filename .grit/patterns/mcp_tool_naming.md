---
name: mcp_tool_naming
level: error
title: MCP tool names must be verb-first kebab-case
---
# MCP tool naming

MCP tool names must use the `[verb]-[noun]` convention documented in the `add-mcp-tool` skill. Approved verbs are `generate`, `get`, `install`, `list`, `search`, `send`, `spawn`, `transcribe`, and `view`; `ping` is the only standalone exception. (`spawn` entered the list with the `spawn-ori-eval` tool, whose name is also the public skill name in OpenRouterTeam/skills.)

```grit
language js

or {
  `name: '$name'`,
  `name: "$name"`
} where {
  $name <: not r"^(?:generate|get|install|list|search|send|spawn|transcribe|view)-[a-z]+(?:-[a-z]+)*$|^ping$"
}
```

## Valid names

```typescript
const getModel = { name: 'get-model' };
const dailyRankings = { name: 'list-daily-model-rankings' };
const generateImage = { name: 'generate-image' };
const ping = { name: 'ping' };
```

## Invalid noun-first name

```typescript
const invalid = { name: 'model-get' };
```

```typescript
const invalid = { name: 'model-get' };
```

## Invalid camelCase name

```typescript
const invalid = { name: 'getModel' };
```

```typescript
const invalid = { name: 'getModel' };
```

## Invalid snake_case name

```typescript
const invalid = { name: 'get_model' };
```

```typescript
const invalid = { name: 'get_model' };
```

## Invalid uppercase name

```typescript
const invalid = { name: 'Get-model' };
```

```typescript
const invalid = { name: 'Get-model' };
```

## Invalid bare word

```typescript
const invalid = { name: 'models' };
```

```typescript
const invalid = { name: 'models' };
```
