/**
 * Max star rating chip on the beatmapset listing/search cards
 * (/beatmapsets) — the "listingMaxSr" toggle. Concept inspired by
 * inix1257/osu_expertplus's beatmap-card-extra star-range feature (per the
 * README's Credits & Inspiration section); independent reimplementation,
 * not copied code, except `diffColor`/`diffTextColor` below — those ramps'
 * exact domains/color stops are ported from osu_expertplus's own port of
 * osu-web's public `getDiffColour`/`getDiffTextColour` (resources/js/
 * utils/beatmap-helper.ts), kept verbatim (same as osu_expertplus's own
 * `buildStarChip`, which colors this exact chip the same way) so the
 * chip's colors actually match osu!'s own official ramps, always as the
 * matched pair they're designed to be, instead of an approximation of
 * them or a background from an unrelated source (see the big comment on
 * DIFF_DOMAIN below for what went wrong the one time this used the
 * background from a native dot instead).
 *
 * Each card's difficulty "dots" row is already server-rendered with one
 * colored dot per diff (see selectors.js) — but confirmed live, the actual
 * numeric star rating behind those colors is never sent to the client for
 * this page. osu-web's own search UI gets it from its own client-side
 * fetch to `/beatmapsets/search`, so this module makes that same
 * same-origin request itself (matching the current page's own query
 * string) rather than trying to reverse a color back into a number.
 *
 * "Load more" (osu-web's own infinite scroll) appends cards from a later
 * page than our own fetch covers, since it's driven by a `cursor_string`
 * the site keeps in its own React state, not the URL. Rather than
 * intercepting osu-web's own fetch calls to see it (a much bigger change,
 * reaching into the page's own JS context), this just keeps its own
 * pagination going: apply() notices a rendered card whose id isn't cached
 * yet and fetches the next page itself, using the `cursor_string` osu-
 * web's own `/beatmapsets/search` response already hands back — see
 * ensureFetched/fetchPage.
 */
(function (global) {
  'use strict';

  const OsuEnhancer = (global.OsuEnhancer = global.OsuEnhancer || {});
  const sel = OsuEnhancer.selectors;

  const CHIP_ATTR = 'data-osu-enhancer-max-sr';
  const SRC_VAR = '--osu-enhancer-max-sr-src';

  // beatmapset id -> Map<mode, maxRating>, filled in by ensureFetched().
  const cache = new Map();
  let lastFetchedQuery = null;
  // cursor_string for the next page under lastFetchedQuery — undefined
  // before the first fetch, null once osu-web's own response says there
  // isn't a next page.
  let nextCursor;
  let fetchInFlight = false;
  let lastAppliedEnabled = false;

  function isListingPage() {
    return location.pathname === '/beatmapsets';
  }

  // Same truncation as beatmap-picker.js's formatStars — osu! truncates
  // (never rounds up) displayed star ratings to 2 decimals.
  function formatStars(stars) {
    return (Math.floor(stars * 100) / 100).toFixed(2);
  }

  // Background/text color ramps, ported from osu-web's own getDiffColour /
  // getDiffTextColour (resources/js/utils/beatmap-helper.ts) — the same
  // pair inix1257/osu_expertplus uses for this exact chip (its own
  // buildStarChip colors both from the numeric rating, never from a native
  // dot). Originally this read the highest dot's own native --bg for the
  // background instead of computing it here — looked right on small sets,
  // but broke on sets with many difficulties: osu-web caps how many dots
  // it actually renders per mode and only shows a "+N" indicator past
  // that, so "the last dot in the DOM" silently stopped being the
  // highest-rated diff once a set had more diffs than that cap — pairing
  // some other diff's (much lighter) color with text computed for the
  // true (much higher) max rating, which is how you get e.g. near-white
  // getDiffTextColour text over a background nowhere near the near-black
  // getDiffColour would've produced for that same rating. Computing both
  // from the one rating this chip actually displays keeps them a matched
  // pair no matter how many diffs the set has.
  const DIFF_DOMAIN = [0.1, 1.25, 2, 2.5, 3.3, 4.2, 4.9, 5.8, 6.7, 7.7, 9];
  const DIFF_RANGE = [
    '#4290FB',
    '#4FC0FF',
    '#4FFFD5',
    '#7CFF4F',
    '#F6F05C',
    '#FF8068',
    '#FF4E6F',
    '#C645B8',
    '#6563DE',
    '#18158E',
    '#000000',
  ];
  const TEXT_SR_DOMAIN = [9, 9.9, 10.6, 11.5, 12.4];
  const TEXT_SR_RANGE = ['#F6F05C', '#FF8068', '#FF4E6F', '#C645B8', '#B0A8FF', '#E4E2FF'];

  function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }

  function rgbToHex(r, g, b) {
    const clamp = (x) => Math.max(0, Math.min(255, Math.round(x)));
    return `#${[clamp(r), clamp(g), clamp(b)].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
  }

  function lerpRamp(sr, domain, range) {
    for (let i = 0; i < domain.length - 1; i++) {
      const d0 = domain[i];
      const d1 = domain[i + 1];
      if (sr >= d0 && sr < d1) {
        const t = (sr - d0) / (d1 - d0);
        const a = hexToRgb(range[i]);
        const b = hexToRgb(range[i + 1]);
        return rgbToHex(a.r + (b.r - a.r) * t, a.g + (b.g - a.g) * t, a.b + (b.b - a.b) * t);
      }
    }
    return range[range.length - 1];
  }

  function diffColor(sr) {
    if (sr < 0.1) return '#AAAAAA';
    if (sr >= 9) return '#000000';
    return lerpRamp(sr, DIFF_DOMAIN, DIFF_RANGE);
  }

  function diffTextColor(sr) {
    if (sr < 6.5) return '#000000';
    if (sr < 9) return '#F6F05C';
    if (sr >= 12.4) return '#E4E2FF';
    return lerpRamp(sr, TEXT_SR_DOMAIN, TEXT_SR_RANGE);
  }

  function computeMaxRatings(beatmapset) {
    const ratings = new Map();
    if (!beatmapset || !Array.isArray(beatmapset.beatmaps)) return ratings;
    for (const bm of beatmapset.beatmaps) {
      const rating = Number(bm.difficulty_rating);
      if (!Number.isFinite(rating) || typeof bm.mode !== 'string') continue;
      const prev = ratings.get(bm.mode);
      if (prev == null || rating > prev) ratings.set(bm.mode, rating);
    }
    return ratings;
  }

  // True if some currently-rendered card's beatmapset id isn't cached yet
  // — either this is a fresh query, or osu-web's own "Load more" appended
  // cards from a later page than we've fetched ourselves.
  function hasUncachedPanel() {
    for (const panel of document.querySelectorAll(sel.beatmapsetListingPanel)) {
      const id = beatmapsetIdFromPanel(panel);
      if (id != null && !cache.has(id)) return true;
    }
    return false;
  }

  function fetchPage(query, cursorString) {
    fetchInFlight = true;
    const params = new URLSearchParams(query);
    if (cursorString) params.set('cursor_string', cursorString);
    else params.delete('cursor_string');

    fetch(`/beatmapsets/search?${params}`, { headers: { Accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data || !Array.isArray(data.beatmapsets)) return;
        for (const beatmapset of data.beatmapsets) {
          cache.set(beatmapset.id, computeMaxRatings(beatmapset));
        }
        // Empty page (no cursor_string back) means osu-web itself has
        // nothing further for this query — stop paging rather than
        // re-fetching the same empty tail on every rescan.
        nextCursor = data.cursor_string || null;
      })
      .catch(() => {})
      .finally(() => {
        fetchInFlight = false;
        // A newly-scrolled-in batch of cards, or data that simply arrived
        // after this apply() pass already ran without it — one more
        // idempotent pass picks it up (and queues the next page if that
        // batch still isn't fully covered).
        if (lastAppliedEnabled) apply(true);
      });
  }

  function ensureFetched() {
    if (fetchInFlight) return;
    const query = location.search;

    if (query !== lastFetchedQuery) {
      // New search/filter (including the very first run) — start over
      // from page 1 under this query.
      lastFetchedQuery = query;
      nextCursor = undefined;
      fetchPage(query, undefined);
      return;
    }

    // Same query as last time: only worth another request once "Load
    // more" has actually revealed cards our current cache doesn't cover
    // yet, and only while osu-web says there's still a next page.
    if (nextCursor === null) return;
    if (!hasUncachedPanel()) return;
    fetchPage(query, nextCursor);
  }

  function beatmapsetIdFromPanel(panel) {
    const link = panel.querySelector(sel.beatmapsetPanelLink);
    const href = link ? link.getAttribute('href') || '' : '';
    const m = href.match(/\/beatmapsets\/(\d+)/);
    return m ? Number(m[1]) : null;
  }

  function modeFromDotsGroup(group) {
    const icon = group.querySelector(`${sel.beatmapsetPanelModeIcon} i`);
    const m = icon ? icon.className.match(/fa-extra-mode-(\w+)/) : null;
    return m ? m[1] : null;
  }

  function buildChip() {
    const chip = document.createElement('span');
    chip.className = 'osu-enhancer-max-sr-chip';
    chip.setAttribute(CHIP_ATTR, '1');
    return chip;
  }

  function syncPanel(panel, ratings) {
    panel.querySelectorAll(sel.beatmapsetPanelDotsGroup).forEach((group) => {
      const mode = modeFromDotsGroup(group);
      const rating = mode && ratings ? ratings.get(mode) : null;

      let chip = group.querySelector(`[${CHIP_ATTR}]`);
      if (rating == null) {
        if (chip) chip.remove();
        return;
      }

      if (!chip) {
        chip = buildChip();
        group.appendChild(chip);
      }

      chip.style.setProperty(SRC_VAR, diffColor(rating));
      chip.style.color = diffTextColor(rating);

      chip.textContent = `★ ${formatStars(rating)}`;
    });
  }

  function apply(enabled) {
    lastAppliedEnabled = enabled;

    if (!enabled || !isListingPage()) {
      document.querySelectorAll(`[${CHIP_ATTR}]`).forEach((chip) => chip.remove());
      return;
    }

    ensureFetched();
    document.querySelectorAll(sel.beatmapsetListingPanel).forEach((panel) => {
      const id = beatmapsetIdFromPanel(panel);
      syncPanel(panel, id != null ? cache.get(id) : null);
    });
  }

  OsuEnhancer.maxSrChip = { apply };
})(typeof window !== 'undefined' ? window : globalThis);
