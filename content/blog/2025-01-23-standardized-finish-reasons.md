---
title: "Standardized finish reasons"
date: "2025-01-23T00:00:00.000Z"
updated: "2026-06-11T20:49:47.000Z"
author: "OpenRouter"
teaser: "Models now return standardized finish\_reason values, aligned with OpenAI-style conventions. "
category: "announcements"
---

We've introduced `finish_reason` normalization to simplify the interpretation of responses:  

- Normalized Finish Reasons: Models now return standardized finish_reason values, aligned with OpenAI-style conventions.  

- Native Finish Reason: To retain model-specific details, the native_finish_reason is also returned.

### Why This Matters  

- Debugging and Understanding: Gain insight into a model's decision-making process.

- Cross-Model Consistency: Streamline development with unified finish reasons across reasoning-capable models.