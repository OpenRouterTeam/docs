/*
  Live client component: renders a model's uptime comparison chart by fetching
  a fresh Datadog embed URL from the public API at page-render time.

  projects/docs must not import from other packages in the repo, so this fetches
  the public endpoint directly in the browser instead of importing monorepo code.
  Source of truth: https://openrouter.ai/api/frontend/v1/uptime-graphs?permaslug=...
*/
export const UptimeChart = ({ permaslug }) => {
  const [graphs, setGraphs] = useState(null);
  const [didError, setDidError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const url = `https://openrouter.ai/api/frontend/v1/uptime-graphs?permaslug=${encodeURIComponent(permaslug)}`;
    fetch(url, { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((body) => setGraphs(body.data ?? null))
      .catch((err) => {
        if (err.name !== "AbortError") setDidError(true);
      });
    return () => controller.abort();
  }, [permaslug]);

  if (didError || (graphs !== null && !graphs.comparisonGraphUrl)) {
    return <p>Uptime data could not be retrieved at this time.</p>;
  }

  if (graphs === null) {
    return <div className="bg-muted h-80 w-full animate-pulse rounded-lg" />;
  }

  return (
    <div className="border-border h-80 w-full overflow-hidden rounded-lg border">
      <iframe
        title="uptime comparison"
        src={`${graphs.comparisonGraphUrl}&height=320&width=800`}
        width="800"
        height="320"
      />
    </div>
  );
};
