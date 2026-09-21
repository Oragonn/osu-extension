/**
 * Preselects a default "Mode" filter (the `defaultBeatmapMode` setting —
 * osu! standard unless changed; "any" turns this off) on /beatmapsets, in two
 * situations:
 *   - a fresh visit with no mode in the URL (osu!'s own default is "Any"),
 *   - a page reload (Ctrl+R / F5), from whatever mode was selected — so a
 *     reload always goes back to the default instead of sticking on taiko,
 *     catch or mania.
 * Clicks the real filter link (rather than rewriting location.search
 * ourselves) so osu-web's own search logic runs exactly as if the user had
 * clicked it — whether that's a client-side re-fetch or a full navigation,
 * whatever it normally does for that link keeps working.
 *
 * Runs at most once per visit to the page. "Any" is represented by having no
 * `m` param at all, so an explicit "Any" is indistinguishable from a fresh
 * bare URL by looking at the URL alone — and content.js re-runs this on every
 * DOM mutation, so without the once-per-visit latch it would re-click the
 * default right after the user picks "Any" (or any state that drops `m`). The
 * latch resets as soon as a rescan sees we're off the search page, so the
 * next visit gets the default again.
 */
(function (global) {
  'use strict';

  const OsuEnhancer = (global.OsuEnhancer = global.OsuEnhancer || {});
  const sel = OsuEnhancer.selectors;

  // data-filter-value of each mode's link in the Mode filter (same numbers
  // as osu!'s own ruleset ids and the `m` URL param).
  const FILTER_VALUES = { osu: '0', taiko: '1', fruits: '2', mania: '3' };

  function loadedByReload() {
    const entry = performance.getEntriesByType('navigation')[0];
    return !!entry && entry.type === 'reload';
  }

  let handledThisVisit = false;

  // A document's navigation type stays "reload" for its whole life, even
  // after in-site navigation swaps the page underneath it, so this is spent
  // (set false) the first time the reload's own page has been dealt with —
  // otherwise every later return to /beatmapsets would be treated as a
  // reload too and override an explicit mode in the URL.
  let reloadPending = loadedByReload();

  function isBeatmapsetsSearchPage() {
    return location.pathname === '/beatmapsets';
  }

  // Only the osu! link (value 0) is unique across the whole filter panel —
  // 1/2/3 also show up in Genre, Language and Rank Achieved — so the other
  // modes are looked up among the osu! link's own siblings, i.e. just the
  // Mode section's items.
  function findModeLink(value) {
    const osuLink = document.querySelector(sel.modeFilterOsuLink);
    if (!osuLink || value === FILTER_VALUES.osu) return osuLink;

    const group = osuLink.parentElement;
    return group && group.querySelector(`${sel.modeFilterItem}[data-filter-value="${value}"]`);
  }

  function applyDefaultMode(mode) {
    if (!isBeatmapsetsSearchPage()) {
      handledThisVisit = false;
      reloadPending = false;
      return;
    }
    if (handledThisVisit) return;

    const value = FILTER_VALUES[mode];
    if (!value) return; // "any" (or an unrecognised value): leave osu!'s own default alone

    // An explicit mode in the URL (shared link, back/forward, a previous
    // pick) is the user's choice — except right after a reload, where the
    // point is to snap back to the default. Either way, later switching to
    // "Any" or another mode must not be overridden.
    const currentMode = new URLSearchParams(location.search).get('m');
    if (currentMode !== null && (!reloadPending || currentMode === value)) {
      handledThisVisit = true;
      reloadPending = false;
      return;
    }

    // The filter panel may not have rendered yet on an early scan; leave the
    // latch open so a later rescan can still apply the default.
    const link = findModeLink(value);
    if (!link) return;

    handledThisVisit = true;
    reloadPending = false;
    link.click();
  }

  OsuEnhancer.modeFilter = { applyDefaultMode };
})(typeof window !== 'undefined' ? window : globalThis);
