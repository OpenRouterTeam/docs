# ModelArchitecture

Model architecture information

## Example Usage

```typescript
import { ModelArchitecture } from "@openrouter-monorepo/management-sdk-generated/models";

let value: ModelArchitecture = {
  tokenizer: "GPT",
  instructType: "chatml",
  modality: "text->text",
  inputModalities: [
    "text",
  ],
  outputModalities: [
    "text",
  ],
};
```

## Fields

| Field                                                   | Type                                                    | Required                                                | Description                                             | Example                                                 |
| ------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------- |
| `tokenizer`                                             | [models.ModelGroup](../models/model-group.md)           | :heavy_minus_sign:                                      | Tokenizer type used by the model                        | GPT                                                     |
| `instructType`                                          | [models.InstructType](../models/instruct-type.md)       | :heavy_minus_sign:                                      | Instruction format type                                 | chatml                                                  |
| `modality`                                              | *string*                                                | :heavy_check_mark:                                      | Primary modality of the model                           | text->text                                              |
| `inputModalities`                                       | [models.InputModality](../models/input-modality.md)[]   | :heavy_check_mark:                                      | Supported input modalities                              |                                                         |
| `outputModalities`                                      | [models.OutputModality](../models/output-modality.md)[] | :heavy_check_mark:                                      | Supported output modalities                             |                                                         |