# Google PubSub Processor

This service leverages Google Pub/Sub to receive and process messages in batches using streaming pull with flow control. It ensures efficient processing of messages by handling them in bulk rather than one by one.

[k8s runbook here](https://www.notion.so/openrouter/Kubernetes-Runbooks-20d2fd57c4dc805abcd6e24359499627)

## Running the server

1. Install dependencies:

   ```
   bun install
   ```

2. Set up environment variables:
   Environment variables are managed through Infisical. See [INFISICAL.md](../../scripts/infisical/INFISICAL.md) for details.

   For local overrides, create `.env.development.local` at the repository root (not in this service directory) and add the following variables:

   ```
   GOOGLE_APPLICATION_CREDENTIALS_JSON=<JSON_CREDENTIALS>
   PUBSUB_SUBSCRIPTION_NAME=<your-pubsub-subscription-name>
   PUBSUB_QUEUE_NAME=<your-pubsub-queue-name>
   ```

   Make sure to replace the values with your actual Google Cloud credentials and configuration.

3. Run the server:
   ```
   bun run dev
   ```

## Building the Production Build

We are using tsup to bundle all of the internal packages inside the monorepo. This allows us to pre compile our
typescript code into javascript. However this also means, that anytime we update a dependency we have to manually
run the build and submit script to push the new code up to google artifact registry.

1. Run the build script:

   ```
   bun run build
   ```

2. This creates a `dist` folder with the production build of the monorepo.

## Building the Docker image

To build the Docker image for this service, follow these steps:

1. Make sure you have Docker installed on your system.

2. Navigate to the root directory of this service in your terminal.

3. Build the Docker image using the following command:

   ```
   docker build -t gcp-queue-worker .
   ```

   This command builds the Docker image using the Dockerfile in the current directory and tags it as "gcp-queue-worker".

4. Once the build process is complete, you can verify that the image was created by running:

   ```
   docker images
   ```

   You should see "gcp-queue-worker" in the list of images.

5. To run the container from this image, use:

   ```
   docker run -d --name gcp-queue-worker gcp-queue-worker
   ```

   This command starts a new container in detached mode (-d) with the name "gcp-queue-worker".

Note: Make sure all necessary environment variables are properly set in the Dockerfile or passed to the container at runtime for the service to function correctly.

# Google Pub Sub

## Message Retrieval Strategy

We use Streaming Pull with flow control to receive messages. In this method, messages are delivered continuously over a stream, allowing for real-time message processing without the need for repeated polling. The service is configured with a maximum batch size, meaning that at most, a specified number of messages are delivered in a single batch from the Pub/Sub subscription.

## Key Features

1. Streaming Pull with Flow Control:

   - Messages are streamed continuously, avoiding the need to poll for messages manually.
   - Flow control ensures that the number of messages delivered at once does not exceed the configured batch size.
   - This guarantees efficient message retrieval while preventing overloading of the system with too many messages at once.

1. Batch Processing via BatchProcessor:

   - Once messages are received, they are passed to the BatchProcessor, which processes a batch of messages in one go.
   - Messages are processed based on two conditions:
     1. When the specified batch size of messages is received.
     1. When the configured delay is reached, whichever happens first.

## Workflow Overview

- Batch Size: Controls the maximum number of messages to be processed together. If fewer messages are received within the set delay, they will still be processed.
- Delay: Ensures that messages are processed within a timely manner even if a full batch has not been received. This helps avoid waiting indefinitely for a full batch.

## Example

- If the batch size is set to 10 and the delay is 5000ms:
  - The BatchProcessor will process the batch as soon as 10 messages are received.
  - If fewer than 10 messages are received, it will still process them once 5000 milliseconds (5 seconds) have passed, ensuring timely message handling.

## Configuration

You can configure the following env vars based on your processing requirements:

- BATCH_SIZE: The maximum number of messages that can be processed in a batch.
- BATCH_DELAY_MS: The maximum time to wait before processing the messages, even if the batch is not full.
