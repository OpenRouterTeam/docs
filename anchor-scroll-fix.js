/*
 * Deep links (e.g. #response-data-pricing-overrides) can land behind the
 * sticky navbar: the browser scrolls to the anchor before hydration and
 * font loading finish, and the subsequent layout shift moves the target
 * up underneath the header. Re-align the anchor once the page has fully
 * settled, unless the user has already scrolled on their own.
 */
let didUserScrollAway = false;

function markUserScrollAway() {
  didUserScrollAway = true;
}

function anchorIdFromHash() {
  const rawId = window.location.hash.slice(1);
  try {
    return decodeURIComponent(rawId);
  } catch {
    return rawId;
  }
}

function realignAnchor() {
  if (didUserScrollAway) {
    return;
  }
  const target = document.querySelector(`[id="${CSS.escape(anchorIdFromHash())}"]`);
  // scrollIntoView respects the target's CSS scroll-margin-top,
  // which Mintlify sets to clear the sticky navbar.
  target?.scrollIntoView();
}

async function settleAnchorScroll() {
  await (document.fonts?.ready ?? Promise.resolve());
  setTimeout(realignAnchor, 150);
}

function initAnchorScrollFix() {
  if (!window.location.hash) {
    return;
  }
  for (const event of ['wheel', 'touchmove', 'keydown']) {
    window.addEventListener(event, markUserScrollAway, { passive: true, once: true });
  }
  if (document.readyState === 'complete') {
    settleAnchorScroll();
  } else {
    window.addEventListener('load', settleAnchorScroll, { once: true });
  }
}

initAnchorScrollFix();
