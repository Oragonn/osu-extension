/**
 * Defaults the beatmap-search "Mode" filter to osu! standard instead of
 * "Any" on a fresh visit to /beatmapsets. Clicks the real filter link
 * (rather than rewriting location.search ourselves) so osu-web's own
 * search logic runs exactly as if the user had clicked it — whether that's
 * a client-side re-fetch or a full navigation, whatever it normally does
 * for that link keeps working.
 *
 * Only fires while the URL has no `m` param at all, so it never fights an
 * explicit choice (including an explicit "Any", which also has no `m`
 * param — but by then the user has already navigated away from the bare
 * URL this checks for).
 */
(function (global) {
  'use strict';

  const OsuEnhancer = (global.OsuEnhancer = global.OsuEnhancer || {});
  const sel = OsuEnhancer.selectors;

  function isBeatmapsetsSearchPage() {
    return location.pathname === '/beatmapsets';
  }

  function applyDefaultMode() {
    if (!isBeatmapsetsSearchPage()) return;
    if (new URLSearchParams(location.search).has('m')) return;

    const osuLink = document.querySelector(sel.modeFilterOsuLink);
    if (osuLink) osuLink.click();
  }

  OsuEnhancer.modeFilter = { applyDefaultMode };
})(typeof window !== 'undefined' ? window : globalThis);
