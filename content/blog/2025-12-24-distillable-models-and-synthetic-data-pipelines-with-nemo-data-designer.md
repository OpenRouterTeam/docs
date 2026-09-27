---
title: "Distillable Models and Synthetic Data Pipelines with NeMo Data Designer"
date: "2025-12-24T00:00:00.000Z"
author: "Shashank Goyal"
teaser: "How to generate license-safe synthetic data workflows for model specialization "
headerImage:
  url: "/images/distillable-models-and-synthetic-data-pipelines-with-nemo-data-designer.jpg"
  width: 1160
  height: 653
category: "tutorials"
---

As AI systems move towards customization, the next challenge emerges:
How do you efficiently create specialized models tailored to your domain, while staying compliant with licensing and data-usage constraints?

Today, we’re introducing two pieces that fit together to solve that problem:
1. [Distillable Models on OpenRouter](https://openrouter.ai/models?distillable=true)
2. A reference [synthetic-data workflow](https://github.com/NVIDIA/GenerativeAIExamples/blob/main/nemo/NeMo-Data-Designer/self-hosted-tutorials/community-contributions/qa-generation/product-question-answer-generator_OR_v3.ipynb) built with NVIDIA [NeMo Data Designer](https://github.com/NVIDIA-NeMo/DataDesigner)

## Distillable Models on OpenRouter
We now explicitly track Distillable Models available on OpenRouter.  These are models whose licenses allow generating synthetic training data. 

License metadata is collected directly from model labs and providers, so developers don’t have to interpret terms themselves.

Now you can:
- Filter for [distillable models](https://openrouter.ai/models?distillable=true) on the Models page
- Enforce compliance at runtime using the [enforce_distillable_text](https://openrouter.ai/docs/guides/routing/provider-selection#distillable-text-enforcement) request parameter
When enabled, OpenRouter guarantees that all outputs come from models whose licenses permit reuse for training and distillation.

## NVIDIA NeMo Data Designer
NVIDIA recently launched NeMo Data Designer, an [open-source](https://github.com/NVIDIA-NeMo/DataDesigner) framework for programmatically generating large, high-quality datasets tailored to specific domains. Instead of one-off prompt scripts, it lets you define data generators as code.

It supports:
- Instruction and task-oriented datasets
- Question–answer pairs
- Structured reasoning traces
- Multi-step agentic workflows
- Domain-specific schemas and constraints

## OpenRouter and NeMo Data Designer
Using OpenRouter and NeMo Data Designer together enables teams to generate large volumes of synthetic data with clear, enforceable license guarantees, distill large reasoning models into smaller task-optimized variants, and significantly reduce inference costs without sacrificing accuracy. This approach supports repeatable, production-ready specialization workflows built entirely on open tooling.

NVIDIA has also launched a few base models in the [Nemotron](https://openrouter.ai/nvidia) series, including [Nemotron 3 Nano](https://openrouter.ai/nvidia/nemotron-3-nano-30b-a3b:free), that are extremely well suited for generating synthetic data. 

## Getting Started
If you want to see how distillable endpoints and NeMo Data Designer work together in practice, the [notebook](https://github.com/NVIDIA/GenerativeAIExamples/blob/main/nemo/NeMo-Data-Designer/self-hosted-tutorials/community-contributions/qa-generation/product-question-answer-generator_OR_v3.ipynb) is the best place to start. 

The notebook walks you through:
- Selecting distillable models via OpenRouter
- Generating structured synthetic data with NeMo Data Designer
- Preparing the dataset for distillation and fine-tuning

You can also check out the OpenRouter [distillation guide](https://openrouter.ai/docs/guides/guides/distillation) and more docs about NeMo Data Designer [here](https://nvidia-nemo.github.io/DataDesigner/).