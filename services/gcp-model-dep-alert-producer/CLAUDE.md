# Model deprecation alert producer agent guidance

## Local development

Enable the `model-dep-alert-producer` Tilt resource to run the one-shot sweep
repeatedly while developing. It runs once immediately, then every 15 seconds by
default. Set `MODEL_DEPRECATED_SWEEP_INTERVAL_SECONDS` to change the interval.
