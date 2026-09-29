# Chat Templates

This module contains chat templates for LLM models.

## How to Add a New Jinja Template

1. Create a new directory in `src`, following the structure of `qwen-3`.
2. Copy the `tokenizer_config.json` file from Hugging Face into that directory and rename it to `config.json`.
3. From the repository root, run the format script. For example, to generate a template for `qwen-3`, run:
   > bun run x packages/chat-templates/scripts/format-jinja.ts packages/chat-templates/src/qwen-3/config.json
4. This will create a new file at `packages/chat-templates/src/qwen-3/index.jinja` with indentation ready to be improved.

Alternatively, you can provide a `.jinja` file instead of a `config.json` file in step 2. For example, if you have a `qwen-3.jinja` file, you can run:

> bun run x packages/chat-templates/scripts/format-jinja.ts packages/chat-templates/src/qwen-3.jinja
