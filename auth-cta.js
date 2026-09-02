/*
 * The navbar CTA in docs.json is a static "Sign In" button. The docs are
 * served same-origin under openrouter.ai, so Clerk's JS-readable
 * `__client_uat` cookie (a sign-in timestamp, `0` or absent when signed
 * out, possibly suffixed with a publishable-key hash) tells us whether
 * the reader is signed in.
 *
 * Signed out: keep "Sign In" but carry the current docs page as Clerk's
 * `redirect_url`, so signing in returns the reader to where they were.
 * Signed in: repoint the CTA to "Home", which — like the signed-in "Home"
 * link in the web app's own navbar — lands on the workspace list rather
 * than the marketing homepage.
 *
 * Mintlify's navbar is React-rendered, so a MutationObserver reapplies
 * the target whenever client-side navigation re-renders the button or
 * changes the page the sign-in should return to, and the cookie is
 * re-read when the tab regains focus so a sign-in or sign-out in another
 * tab is reflected without a reload.
 */
const SIGN_IN_HREF = 'https://openrouter.ai/sign-in';
// Mirrors navbar.primary.label in docs.json.
const SIGN_IN_LABEL = 'Sign In';
const HOME_HREF = 'https://openrouter.ai/workspaces';
const HOME_LABEL = 'Home';

function isSignedIn() {
  return document.cookie.split('; ').some((cookie) => {
    const [name, value] = cookie.split('=');
    return name?.startsWith('__client_uat') && value !== undefined && value !== '' && value !== '0';
  });
}

function signInHref() {
  const url = new URL(SIGN_IN_HREF);
  url.searchParams.set('redirect_url', window.location.href);
  return url.href;
}

function setLabel(link, text) {
  const label = [...link.querySelectorAll('*')].findLast(
    (el) => !(el instanceof SVGElement) && el.childElementCount === 0,
  );
  (label ?? link).textContent = text;
}

function applyCta() {
  const cta = document.querySelector('#topbar-cta-button');
  if (!cta) {
    return;
  }
  const link = cta.matches('a') ? cta : cta.querySelector('a');
  if (!link) {
    return;
  }
  const signedIn = isSignedIn();
  const href = signedIn ? HOME_HREF : signInHref();
  if (link.getAttribute('href') === href) {
    return;
  }
  link.setAttribute('href', href);
  setLabel(link, signedIn ? HOME_LABEL : SIGN_IN_LABEL);
}

function initAuthCta() {
  applyCta();
  new MutationObserver(applyCta).observe(document.body, {
    childList: true,
    subtree: true,
  });
  window.addEventListener('focus', applyCta);
  document.addEventListener('visibilitychange', applyCta);
}

initAuthCta();
