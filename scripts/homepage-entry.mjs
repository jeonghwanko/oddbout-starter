// @ts-check
// Retain legacy creator handoffs and normalize old homepage URLs without a reload.
const homepageRoute = `if (/\\/(?:index|league)\\.html$/.test(location.pathname)) {
  history.replaceState(null, "", "./" + location.search + location.hash);
}
const params = new URLSearchParams(location.search);
// Google's answer comes back here for a sign-in the home started (kaito_web platform/oddboutSession records the page it left for,
// "kaito_web.oddboutSignInPage.v1"): the home finishes it. Any other answer here is a creator-page sign-in and goes on to that page.
let homeSignIn = false;
try { homeSignIn = sessionStorage.getItem("kaito_web.oddboutSignInPage.v1") === location.pathname; } catch {}
const oauthParams = ["code", "error", "error_code", "error_description", "state"];
const publicAnchors = ["#main", "#fighters", "#match", "#join"];
if (params.has("apply") || (!homeSignIn && oauthParams.some(key => params.has(key))) || (location.hash && !publicAnchors.includes(location.hash))) {
  location.replace("./creator.html" + location.search + location.hash);
}`;

/** @param {string} homepage */
export function homepageEntries(homepage) {
  if (!homepage.includes('<head>') || !homepage.includes('<main')) throw new Error('Expected the built homepage document');
  const html = homepage.replace('<head>', '<head>\n<meta name="referrer" content="no-referrer">\n<script>' + homepageRoute + '</script>');
  // A full legacy document also works when a browser has cached the former root redirect.
  return { 'index.html': html, 'league.html': html };
}
