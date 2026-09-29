---
level: error
title: MCP overlay tool names must be verb-first kebab-case
---
# MCP overlay tool naming

The `name:` values in the MCP overlay must use the `[verb]-[noun]` convention documented in the `add-mcp-tool` skill.

```grit
language yaml

`name: $name` where {
  $name <: not r"^[\"']?(?:generate|get|list|search|send|transcribe|view)-[a-z]+(?:-[a-z]+)*[\"']?$|^[\"']?ping[\"']?$"
}
```

## Invalid overlay name

```yaml
x-speakeasy-mcp:
  name: model-get
```

```yaml
x-speakeasy-mcp:
  name: model-get
```

## Quoted valid names

```yaml
x-speakeasy-mcp:
  name: "get-model"
another-entry:
  name: 'list-models'
```

## Quoted invalid name

```yaml
x-speakeasy-mcp:
  name: "model-get"
```

```yaml
x-speakeasy-mcp:
  name: "model-get"
```
