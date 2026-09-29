# AmazonBedrock FAQ

## Converse vs Invoke diff?

Bedrock introduced 2 APIs to call their models: `converse` and `invoke`. Both has stream and non-stream version. `converse` was created as an "unifying" interface to call every models on Bedrock, whereas `invoke` requires downstream caller to send down engine-specific payload.

Bedrock recommended `converse` for most use cases, however we have found it to be very limiting.
