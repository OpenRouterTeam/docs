# Otel Clickhouse Proxy

We connect to the Telemetry Clickhouse instance via Private Service Connect,
mostly for cost reasons. An interesting quirk of Clickhouse's PSC setup is that
they require a particular instance-specific DNS name to be sent on the wire,
even though we're connecting to a private address in our VPC. This is hard
to handle in the Golang Clickhouse client, so we set up a simple nginx proxy
that takes in unencrypted connections and creates encrypted ones with the
correct SNI hostname.
