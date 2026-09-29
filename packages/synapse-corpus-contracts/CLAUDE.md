# Synapse Corpus Contracts

This package deliberately contains no database, connector SDK, queue, Worker,
model, or storage code. Add a contract only when at least two later layers must
share it. Every breaking shape change increments its `schemaVersion` and keeps
the prior parser available until producers and consumers migrate.
