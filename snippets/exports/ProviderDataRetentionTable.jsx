/*
  Live client component: renders each provider's data-retention and
  train-on-prompts policy from the public API at page-render time.

  projects/docs must not import from other packages in the repo, so this fetches
  the public endpoint directly in the browser instead of importing monorepo code.
  Source of truth: https://openrouter.ai/api/frontend/v1/all-providers
*/
export const ProviderDataRetentionTable = () => {
  // Helpers are defined inside the component: Mintlify evaluates each exported
  // snippet component in an isolated scope, so module-level declarations are not
  // visible from the component body.
  const formatRetention = (policy) => {
    if (!policy || (policy.retentionDays === undefined && policy.retainsPrompts === undefined)) {
      return "Unknown retention policy";
    }
    if (policy.retainsPrompts) {
      if (policy.retentionDays === undefined) {
        return "Prompts are retained for unknown period";
      }
      return `Retained for ${policy.retentionDays} days`;
    }
    return "Zero retention";
  };

  const renderTrainingStatus = (isTraining) =>
    isTraining ? (
      <>
        <span className="text-red-500">✕</span> May train
      </>
    ) : (
      <>
        <span className="text-green-500">✓</span> Does not train
      </>
    );

  const [providers, setProviders] = useState(null);
  const [didError, setDidError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch("https://openrouter.ai/api/frontend/v1/all-providers", { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((body) => setProviders(body.data ?? []))
      .catch((err) => {
        if (err.name !== "AbortError") setDidError(true);
      });
    return () => controller.abort();
  }, []);

  if (didError) {
    return <p>Provider data-retention policies could not be retrieved at this time.</p>;
  }

  if (providers === null) {
    return <div className="bg-muted h-40 w-full animate-pulse rounded-lg" />;
  }

  const rows = [...providers].sort((a, b) => a.displayName.localeCompare(b.displayName));

  return (
    <table>
      <thead>
        <tr>
          <th>Provider</th>
          <th>Data Retention</th>
          <th>Train on Prompts</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((provider) => (
          <tr key={provider.name}>
            <td>{provider.displayName}</td>
            <td>{formatRetention(provider.dataPolicy)}</td>
            <td>{renderTrainingStatus(Boolean(provider.dataPolicy?.training))}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};
