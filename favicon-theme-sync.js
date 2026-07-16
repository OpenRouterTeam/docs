const LIGHT_FAVICON_PATH = '/_generated/favicon/';
const DARK_FAVICON_PATH = '/_generated/favicon-dark/';

const syncFaviconTheme = () => {
  const shouldUseDarkFavicon = document.documentElement.classList.contains('dark');
  const nextFaviconPath = shouldUseDarkFavicon ? DARK_FAVICON_PATH : LIGHT_FAVICON_PATH;

  for (const link of document.querySelectorAll('link[rel~="icon"]')) {
    const href = link.getAttribute('href');
    if (!href?.includes(LIGHT_FAVICON_PATH) && !href?.includes(DARK_FAVICON_PATH)) {
      continue;
    }
    const nextHref = href
      .replace(LIGHT_FAVICON_PATH, nextFaviconPath)
      .replace(DARK_FAVICON_PATH, nextFaviconPath);
    link.setAttribute('href', nextHref);
    link.removeAttribute('media');
  }
};

const initFaviconThemeSync = () => {
  if (typeof document === 'undefined' || !document.documentElement) {
    return;
  }

  const start = () => {
    syncFaviconTheme();

    if (typeof MutationObserver === 'undefined') {
      return;
    }

    const themeObserver = new MutationObserver(syncFaviconTheme);
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });

    if (document.head) {
      const headObserver = new MutationObserver(syncFaviconTheme);
      headObserver.observe(document.head, { childList: true });
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
};

initFaviconThemeSync();
