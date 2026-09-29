# JSONish - Flexible LLM Output Parser

A TypeScript library for parsing and extracting structured data from LLM outputs that may not be perfectly formatted JSON. Uses **Zod** for schemas, giving you full type safety and a clean API.

## Overview

JSONish handles the messy reality of LLM outputs. Instead of requiring perfect JSON, it:

- **Tries multiple parsing strategies** until one works
- **Handles malformed JSON** (missing brackets, commas, quotes)
- **Extracts JSON from markdown** code blocks
- **Finds multiple JSON objects** in text
- **Type-safe with Zod** - full TypeScript inference
- **Handles streaming** responses
- **Coerces to expected types** intelligently

## Installation

This is an internal package in the OpenRouter monorepo. Import from:

```typescript
import { parseWith } from '@openrouter-monorepo/response-healing';
```

## Quick Start

```typescript
import { parseWith } from '@openrouter-monorepo/response-healing';
import { z } from '@openrouter-monorepo/lib-zod';

// Define your schema with Zod
const PersonSchema = z.object({
  name: z.string(),
  age: z.number(),
});

// Parse messy LLM output - get typed results!
const person = parseWith('{"name": "Alice", "age": 30}', PersonSchema);
// person is typed as: { name: string, age: number }

console.log(person.name.toUpperCase()); // Type-safe!
```

## Why JSONish?

LLMs don't always return perfect JSON. They might:
- Wrap JSON in markdown code blocks (` ```json ... ``` `)
- Include extra text before/after ("Here's your data: {...}")
- Apologize and correct themselves mid-response
- Use inconsistent formatting (mixed quotes, trailing commas)
- Return incomplete data while streaming
- Make small syntax errors (missing brackets, unquoted keys)
- Mix Python/JavaScript/JSON syntax
- Add commentary and emojis
- Return multiple JSON objects
- Hallucinate extra fields

**JSONish handles all of this automatically!**

See the `examples/` directory for more examples.

## API

### `parseWith(text, schema, options?)`

The main function. Parses text using a Zod schema.

```typescript
function parseWith<T extends z.ZodTypeAny>(
  text: string,
  schema: T,
  options?: {
    streaming?: boolean;      // Default: false
    outputFormat?: object;    // Advanced: output format config
  }
): z.infer<T>
```

## Examples

### Parse Primitives

```typescript
import { parseWith } from '@openrouter-monorepo/response-healing';
import { z } from '@openrouter-monorepo/lib-zod';

// Numbers
parseWith('42', z.number());  // 42
parseWith('The answer is 42', z.number());  // 42
parseWith('$1,234.56', z.number());  // 1234.56

// Booleans
parseWith('true', z.boolean());  // true
parseWith('The answer is True', z.boolean());  // true

// Strings
parseWith('"hello"', z.string());  // "hello"
parseWith('Any text', z.string());  // "Any text"
```

### Parse Objects

```typescript
const UserSchema = z.object({
  name: z.string(),
  email: z.string(),
  age: z.number().optional(),
});

const user = parseWith(
  '{"name": "Bob", "email": "bob@example.com"}',
  UserSchema
);
// Type: { name: string, email: string, age?: number }
```

### Parse Arrays

```typescript
const numbers = parseWith('[1, 2, 3]', z.array(z.number()));
// [1, 2, 3] (type: number[])

const users = parseWith(
  '[{"name": "Alice", "age": 30}, {"name": "Bob", "age": 25}]',
  z.array(z.object({
    name: z.string(),
    age: z.number(),
  }))
);
// Type: Array<{ name: string, age: number }>
```

### Handle Markdown

JSONish automatically extracts JSON from markdown code blocks:

```typescript
const text = `
Here's the data:
\`\`\`json
{"name": "Charlie", "score": 95}
\`\`\`
Thanks!
`;

const result = parseWith(
  text,
  z.object({ name: z.string(), score: z.number() })
);
// { name: "Charlie", score: 95 }
```

### Handle Malformed JSON

```typescript
// Missing closing bracket
parseWith('[1, 2, 3', z.array(z.number()), { streaming: true });
// [1, 2, 3]

// Unquoted keys
parseWith('{name: "Alice"}', z.object({ name: z.string() }));
// { name: "Alice" }
```

### Enums

```typescript
const StatusSchema = z.enum(['pending', 'approved', 'rejected']);

parseWith('approved', StatusSchema);  // 'approved'
parseWith('Status: APPROVED', StatusSchema);  // 'approved' (case insensitive)
parseWith('Approvd', StatusSchema);  // 'approved' (fuzzy matching!)
```

### Union Types

```typescript
const StringOrNumber = z.union([z.string(), z.number()]);

parseWith('42', StringOrNumber);  // 42 (number)
parseWith('"hello"', StringOrNumber);  // "hello" (string)
```

### Nested Objects

```typescript
const CompanySchema = z.object({
  name: z.string(),
  employees: z.array(z.object({
    name: z.string(),
    role: z.string(),
  })),
});

const company = parseWith(
  `{
    "name": "Acme",
    "employees": [
      {"name": "Alice", "role": "Engineer"},
      {"name": "Bob", "role": "Designer"}
    ]
  }`,
  CompanySchema
);

// Fully typed!
company.employees[0].name.toUpperCase(); // "ALICE"
```

### Optional Fields & Defaults

```typescript
const ConfigSchema = z.object({
  host: z.string(),
  port: z.number().default(3000),
  ssl: z.boolean().optional(),
});

parseWith('{"host": "localhost"}', ConfigSchema);
// { host: "localhost", port: 3000 }
```

### Records/Maps

```typescript
const ScoresSchema = z.record(z.number());

parseWith('{"alice": 95, "bob": 87, "charlie": 92}', ScoresSchema);
// { alice: 95, bob: 87, charlie: 92 } (type: Record<string, number>)
```

## Parsing Strategies

JSONish tries multiple strategies in order:

1. **Standard JSON** - Try `JSON.parse()` first (fastest)
2. **Markdown extraction** - Find JSON in ` ```json ... ``` ` blocks
3. **Multi-JSON** - Extract multiple `{...}` or `[...]` objects
4. **Fixing parser** - Attempt to fix malformed JSON
5. **Fallback to string** - Return as raw string if nothing else works

## Streaming Support

For streaming LLM responses:

```typescript
// While streaming (incomplete)
const partial = parseWith(
  '{"status": "ok", "data',  // Incomplete
  z.object({ status: z.string(), data: z.array(z.number()) }),
  { streaming: true }
);

// Final complete response
const complete = parseWith(
  '{"status": "ok", "data": [1, 2, 3]}',
  z.object({ status: z.string(), data: z.array(z.number()) })
);
```

## Type Safety

Because we use Zod, you get full TypeScript inference:

```typescript
const schema = z.object({
  id: z.number(),
  name: z.string(),
  tags: z.array(z.string()),
  metadata: z.object({
    created: z.string(),
    updated: z.string(),
  }).optional(),
});

const result = parseWith(text, schema);

// TypeScript knows the exact type!
result.id.toFixed(2);          // ✅ id is number
result.name.toLowerCase();      // ✅ name is string
result.tags.map(t => t.trim()); // ✅ tags is string[]
result.metadata?.created;       // ✅ metadata is optional
```

## Advanced: Type Coercion

JSONish does intelligent type coercion:

```typescript
// String to number
parseWith('"42"', z.number());  // 42

// Number with commas
parseWith('$1,234,567', z.number());  // 1234567

// Fractions
parseWith('1/5', z.number());  // 0.2

// Boolean from text
parseWith('The answer is yes... wait, false!', z.boolean());  // false

// Enum fuzzy matching
const Color = z.enum(['red', 'green', 'blue']);
parseWith('Red', Color);  // 'red' (normalized)
```

## Error Handling

```typescript
import { z } from '@openrouter-monorepo/lib-zod';
import { parseWith } from '@openrouter-monorepo/response-healing';

try {
  const result = parseWith('invalid data', z.number());
} catch (error) {
  if (error instanceof z.ZodError) {
    console.error('Validation failed:', error.errors);
  }
}
```

## Comparison

### Before (without JSONish):

```typescript
const text = 'Here is the data: {"name": "Alice", age: 30}';  // Unquoted key!
const data = JSON.parse(text);  // Throws error
```

### After (with JSONish):

```typescript
const schema = z.object({ name: z.string(), age: z.number() });
const data = parseWith(text, schema);  // Works!
// { name: "Alice", age: 30 }
```

## Development

```bash
# Run tests
bun run test

# Run tests in watch mode
bun run test:watch

# Type check
bun run typecheck
```

## License

MIT

## Contributing

Contributions welcome! This is a flexible JSON parser for LLM outputs with Zod integration for better DX.
