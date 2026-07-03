/*
  Live client component: renders each provider's terms-of-service (or privacy
  policy) link from the public API at page-render time.

  projects/docs must not import from other packages in the repo, so this fetches
  the public endpoint directly in the browser instead of importing monorepo code.
  Source of truth: https://openrouter.ai/api/frontend/all-providers
*/
export const TermsOfServiceDescriptions = () => {
  const [providers, setProviders] = useState(null);
  const [didError, setDidError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch("https://openrouter.ai/api/frontend/all-providers", { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((body) => setProviders(body.data ?? []))
      .catch((err) => {
        if (err.name !== "AbortError") setDidError(true);
      });
    return () => controller.abort();
  }, []);

  if (didError) {
    return <p>Provider terms of service could not be retrieved at this time.</p>;
  }

  if (providers === null) {
    return <div className="bg-muted h-40 w-full animate-pulse rounded-lg" />;
  }

  const entries = providers
    .map((provider) => ({
      name: provider.name,
      displayName: provider.displayName,
      url: provider.dataPolicy?.termsOfServiceURL || provider.dataPolicy?.privacyPolicyURL,
    }))
    .filter((entry) => Boolean(entry.url));

  return (
    <ul>
      {entries.map((entry) => (
        <li key={entry.name}>
          <code>{entry.displayName}</code>:{" "}
          <a href={entry.url} target="_blank" rel="noopener noreferrer">
            {entry.url}
          </a>
        </li>
      ))}
    </ul>
  );
};
