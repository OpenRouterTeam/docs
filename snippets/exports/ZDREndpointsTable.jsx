/*
  Live client component: renders the zero-data-retention (ZDR) endpoints table
  from the public API at page-render time.

  projects/docs must not import from other packages in the repo, so this fetches
  the public endpoint directly in the browser instead of importing monorepo code.
  Source of truth: https://openrouter.ai/api/v1/endpoints/zdr
*/
export const ZDREndpointsTable = () => {
  const [endpoints, setEndpoints] = useState(null);
  const [didError, setDidError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch("https://openrouter.ai/api/v1/endpoints/zdr", { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((body) => setEndpoints(body.data ?? []))
      .catch((err) => {
        if (err.name !== "AbortError") setDidError(true);
      });
    return () => controller.abort();
  }, []);

  if (didError) {
    return <p>ZDR endpoint data could not be retrieved at this time.</p>;
  }

  if (endpoints === null) {
    return <div className="bg-muted h-40 w-full animate-pulse rounded-lg" />;
  }

  const rows = [...endpoints].sort((a, b) => a.model_name.localeCompare(b.model_name));

  return (
    <table>
      <thead>
        <tr>
          <th>Model</th>
          <th>Provider</th>
          <th>Implicit Caching</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((endpoint) => (
          <tr key={endpoint.name}>
            <td>{endpoint.model_name}</td>
            <td>{endpoint.provider_name}</td>
            <td>{endpoint.supports_implicit_caching ? "Yes" : "No"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};
