/**
 * "PP potential" panel (profile page, src/profile.js's corner button):
 * shows the player's own Best Performance scores that already have N
 * misses or fewer — i.e. realistic FC candidates, not a 20-miss play no
 * one's about to full-combo — ranked by how much pp each would gain if
 * FC'd. N is remembered across sessions (see LAST_MISSES_KEY) so
 * reopening the panel picks up right where you left off.
 *
 * The potential pp is exactly scores.js's "if FC" calculation
 * (OsuEnhancer.ppCalc.calculatePpIfFc — same accuracy held constant, full
 * combo assumed), just pre-filtered to plays within the player's own
 * stated miss tolerance and sorted by gain instead of shown inline on
 * every row.
 *
 * Both the fetched score list and the computed entries are cached (see
 * getBestScoresCached/lastComputedKey) so reopening the panel or resorting
 * doesn't redo work — but that cache is only trustworthy as long as the
 * player's own total pp hasn't moved, since a new/improved score is
 * exactly what would change which plays qualify or what they're worth. The
 * profile's own `statistics.pp` (already embedded in the page, same source
 * target-rank.js reads — see getCurrentTotalPp) is folded into both cache
 * keys, so a changed total transparently forces a real refetch/recompute
 * instead of serving stale numbers.
 */
(function (global) {
  'use strict';

  const OsuEnhancer = (global.OsuEnhancer = global.OsuEnhancer || {});
  const sel = OsuEnhancer.selectors;

  const SCORE_PAGE_SIZE = 100;
  // Matches osu!'s own top-200-scores-count-for-pp rule (see
  // target-rank.js's WEIGHT_CAP) — headroom past #200 wouldn't move total
  // pp anyway, so there's no point fetching further.
  const BEST_SCORE_FETCH_CAP = 200;
  const CONCURRENCY = 8;
  // The beatmap-file fetch queue this ultimately goes through
  // (rosu-engine.js's/official-engine.js's own scheduleFetch) is shared
  // extension-wide and deliberately throttled to 2 concurrent requests to
  // avoid tripping osu!'s rate limiting — with a batch this size, a single
  // request that never resolves would otherwise stall the whole panel
  // forever with no way out. This bounds any one candidate's calculation
  // (network fetch + WASM calc together) so a bad one is skipped instead.
  const CALC_TIMEOUT_MS = 15000;
  const LAST_MISSES_KEY = 'ppPotentialLastMisses';
  const MAX_MISSES_INPUT = 1000; // sanity cap against a stray typo, not a real limit on any map

  const SORT_OPTIONS = [
    { key: 'current', label: 'Current', value: (e) => e.score.pp },
    { key: 'potential', label: 'Potential', value: (e) => e.potentialPp },
    { key: 'gain', label: 'Gain', value: (e) => e.gain },
    { key: 'misses', label: 'Misses', value: (e) => e.misses },
  ];

  // The same `.js-react[data-initial-data]` payload target-rank.js reads
  // its (rank, pp) anchor from — `statistics.pp` is the profile's live
  // total, which moves the instant a new/improved score lands. Used purely
  // as a cache-invalidation signal below, not displayed anywhere.
  function getCurrentTotalPp() {
    const payloadEl = document.querySelector(sel.profileInitialData);
    if (!payloadEl) return null;
    try {
      const data = JSON.parse(payloadEl.getAttribute('data-initial-data'));
      const stats = data && data.user && data.user.statistics;
      return stats ? stats.pp : null;
    } catch (err) {
      return null;
    }
  }

  let scoreListCache = null; // { key, totalPp, promise }

  async function fetchBestScores(userId, mode) {
    const scores = [];
    for (let offset = 0; offset < BEST_SCORE_FETCH_CAP; offset += SCORE_PAGE_SIZE) {
      const res = await fetch(`/users/${userId}/scores/best?mode=${mode}&limit=${SCORE_PAGE_SIZE}&offset=${offset}`, {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) break;
      const page = await res.json();
      if (!Array.isArray(page) || page.length === 0) break;
      scores.push(...page);
      if (page.length < SCORE_PAGE_SIZE) break;
    }
    return scores;
  }

  function getBestScoresCached(userId, mode) {
    const key = `${userId}:${mode}`;
    const totalPp = getCurrentTotalPp();
    // A null totalPp (payload not found/parseable) just falls back to the
    // old userId+mode-only cache instead of forcing a refetch on every call.
    if (!scoreListCache || scoreListCache.key !== key || scoreListCache.totalPp !== totalPp) {
      scoreListCache = { key, totalPp, promise: fetchBestScores(userId, mode) };
      // A failed/partial fetch shouldn't stick around as the cached answer —
      // same reasoning as scores.js's own indexCache.
      scoreListCache.promise.catch(() => {
        if (scoreListCache && scoreListCache.key === key) scoreListCache = null;
      });
    }
    return scoreListCache.promise;
  }

  function withTimeout(promise, ms) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
      promise.then(
        (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        (err) => {
          clearTimeout(timer);
          reject(err);
        }
      );
    });
  }

  async function computeGain(score) {
    const misses = (score.statistics && score.statistics.miss) || 0;
    const potentialPp = await OsuEnhancer.ppCalc.calculatePpIfFc(score.beatmap_id, {
      accuracy: score.accuracy * 100,
      mods: score.mods || [],
      isLegacy: score.legacy_score_id != null,
    });
    if (potentialPp == null || score.pp == null) return null;
    const gain = potentialPp - score.pp;
    if (gain <= 0) return null;
    return { score, misses, potentialPp, gain };
  }

  /** Every qualifying entry, unsorted — the caller (buildPanel's renderList) owns sort order. */
  async function calculate(userId, mode, maxMisses, onProgress) {
    const scores = await getBestScoresCached(userId, mode);
    // Already-FC'd plays (0 misses) have nothing left to gain from this —
    // only plays that missed at all, but not more than the player's own
    // stated tolerance, count as realistic FC candidates.
    const candidates = scores.filter((s) => {
      if (s.beatmap_id == null || s.pp == null) return false;
      const misses = (s.statistics && s.statistics.miss) || 0;
      return misses > 0 && misses <= maxMisses;
    });
    if (onProgress) onProgress(0, candidates.length, scores.length);

    const results = [];
    let i = 0;
    let done = 0;
    async function worker() {
      while (i < candidates.length) {
        const score = candidates[i++];
        try {
          const entry = await withTimeout(computeGain(score), CALC_TIMEOUT_MS);
          if (entry) results.push(entry);
        } catch (err) {
          console.warn('[osu-enhancer] pp potential calculation failed/timed out', score.beatmap_id, err);
        }
        done++;
        if (onProgress) onProgress(done, candidates.length, scores.length);
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, candidates.length) }, worker));
    return results;
  }

  // ---------------- UI ----------------

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function formatPp(pp) {
    return pp.toFixed(1);
  }

  function beatmapHref(score) {
    const setId = (score.beatmapset && score.beatmapset.id) || score.beatmapset_id;
    if (!setId || score.beatmap_id == null) return null;
    return `/beatmapsets/${setId}#${OsuEnhancer.scores.getCurrentMode()}/${score.beatmap_id}`;
  }

  function renderRow(entry) {
    const { score, misses, potentialPp, gain } = entry;
    const row = document.createElement('a');
    row.className = 'osu-enhancer-pp-potential-row';
    const href = beatmapHref(score);
    if (href) {
      row.href = href;
      row.target = '_blank';
      row.rel = 'noopener noreferrer';
    }

    const info = el('div', 'osu-enhancer-pp-potential-row__info');
    const artist = score.beatmapset && score.beatmapset.artist;
    const mapTitle = score.beatmapset && score.beatmapset.title;
    info.appendChild(
      el('span', 'osu-enhancer-pp-potential-row__title', artist && mapTitle ? `${artist} - ${mapTitle}` : 'Unknown map')
    );
    const diff = (score.beatmap && score.beatmap.version) || '';
    const missLabel = `${misses} miss${misses === 1 ? '' : 'es'} → FC`;
    info.appendChild(el('span', 'osu-enhancer-pp-potential-row__diff', diff ? `${diff} · ${missLabel}` : missLabel));
    row.appendChild(info);

    const stats = el('div', 'osu-enhancer-pp-potential-row__stats');
    stats.appendChild(el('span', 'osu-enhancer-pp-potential-row__current', `${formatPp(score.pp)}pp`));
    stats.appendChild(el('span', 'osu-enhancer-pp-potential-row__arrow', '→'));
    stats.appendChild(el('span', 'osu-enhancer-pp-potential-row__potential', `${formatPp(potentialPp)}pp`));
    stats.appendChild(el('span', 'osu-enhancer-pp-potential-row__gain', `+${formatPp(gain)}`));
    row.appendChild(stats);

    return row;
  }

  function parseMissesInput(text) {
    const n = parseInt(text, 10);
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.min(n, MAX_MISSES_INPUT);
  }

  function buildPanel() {
    const panel = el('div', 'osu-enhancer-pp-potential-panel');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'PP potential');

    const header = el('div', 'osu-enhancer-pp-potential-panel__header');
    header.appendChild(el('span', 'osu-enhancer-pp-potential-panel__title', 'PP Potential'));
    const closeBtn = el('button', 'osu-enhancer-pp-potential-panel__close', '×');
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'Close');
    header.appendChild(closeBtn);
    panel.appendChild(header);

    panel.appendChild(
      el(
        'div',
        'osu-enhancer-pp-potential-panel__subtitle',
        'Best Performance plays with this many misses or fewer, ranked by how much pp each would gain if FC’d.'
      )
    );

    const controls = el('div', 'osu-enhancer-pp-potential-panel__controls');
    controls.appendChild(el('span', 'osu-enhancer-pp-potential-panel__label', '≤'));
    const input = document.createElement('input');
    input.type = 'text';
    input.inputMode = 'numeric';
    input.className = 'osu-enhancer-pp-potential-panel__input';
    controls.appendChild(input);
    controls.appendChild(el('span', 'osu-enhancer-pp-potential-panel__label', 'misses'));
    const goBtn = el('button', 'osu-enhancer-pp-potential-panel__go', 'Calculate');
    goBtn.type = 'button';
    controls.appendChild(goBtn);
    panel.appendChild(controls);

    // Sort control — re-sorts whatever's already been computed (no
    // recompute, no fetch), see renderList() below.
    let sortKey = 'gain';
    let sortDir = 'desc';
    // Remembered across page reloads/sessions (see the "misses" input's own
    // LAST_MISSES_KEY handling) — `sortTouched` guards against the async
    // storage load below clobbering a click the player already made in the
    // moment before it resolves.
    let sortTouched = false;
    const sortRow = el('div', 'osu-enhancer-pp-potential-panel__sort');
    sortRow.appendChild(el('span', 'osu-enhancer-pp-potential-panel__sort-label', 'Sort'));
    const sortButtons = SORT_OPTIONS.map(({ key, label }) => {
      const btn = el('button', 'osu-enhancer-pp-potential-panel__sort-btn', label);
      btn.type = 'button';
      btn.dataset.key = key;
      btn.addEventListener('click', () => {
        sortTouched = true;
        sortDir = sortKey === key ? (sortDir === 'desc' ? 'asc' : 'desc') : 'desc';
        sortKey = key;
        OsuEnhancer.storage.setToggle('ppPotentialLastSortKey', sortKey);
        OsuEnhancer.storage.setToggle('ppPotentialLastSortDir', sortDir);
        renderList();
      });
      sortRow.appendChild(btn);
      return btn;
    });
    panel.appendChild(sortRow);

    function updateSortButtons() {
      sortButtons.forEach((btn) => {
        const option = SORT_OPTIONS.find((o) => o.key === btn.dataset.key);
        const active = btn.dataset.key === sortKey;
        btn.classList.toggle('osu-enhancer-pp-potential-panel__sort-btn--active', active);
        btn.textContent = active ? `${option.label} ${sortDir === 'desc' ? '↓' : '↑'}` : option.label;
      });
    }
    updateSortButtons();
    OsuEnhancer.storage.getToggles().then((toggles) => {
      if (sortTouched) return;
      if (SORT_OPTIONS.some((o) => o.key === toggles.ppPotentialLastSortKey)) sortKey = toggles.ppPotentialLastSortKey;
      if (toggles.ppPotentialLastSortDir === 'asc' || toggles.ppPotentialLastSortDir === 'desc') sortDir = toggles.ppPotentialLastSortDir;
      updateSortButtons();
      if (currentEntries.length) renderList();
    });

    const progress = el('div', 'osu-enhancer-pp-potential-panel__progress');
    progress.hidden = true;
    panel.appendChild(progress);

    const list = el('div', 'osu-enhancer-pp-potential-panel__list');
    panel.appendChild(list);

    const footer = el('div', 'osu-enhancer-pp-potential-panel__footer');
    panel.appendChild(footer);

    function setOpen(open) {
      panel.classList.toggle('osu-enhancer-pp-potential-panel--open', open);
    }

    closeBtn.addEventListener('click', () => setOpen(false));
    // Closing requires both the press and the release to land outside the
    // panel, so selecting text inside and releasing the mouse outside it
    // doesn't close the panel mid-selection.
    let outsidePointerDown = false;
    document.addEventListener('mousedown', (e) => {
      outsidePointerDown =
        !panel.contains(e.target) && !e.target.closest('.osu-enhancer-pp-potential-btn');
    });
    document.addEventListener('mouseup', (e) => {
      if (
        outsidePointerDown &&
        panel.classList.contains('osu-enhancer-pp-potential-panel--open') &&
        !panel.contains(e.target) &&
        !e.target.closest('.osu-enhancer-pp-potential-btn')
      ) {
        setOpen(false);
      }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') setOpen(false);
    });
    panel.addEventListener('click', (e) => e.stopPropagation());

    // Full computed entry set for the last-run misses value, kept around so
    // clicking a sort button (or reopening with an unchanged input) is a
    // pure client-side re-render — no re-fetch, no WASM recompute.
    let currentEntries = [];
    let lastMaxMisses = 0;
    let lastComputedKey = null; // `${userId}:${mode}:${maxMisses}:${totalPp}`

    function renderList() {
      updateSortButtons();
      list.innerHTML = '';
      footer.textContent = '';
      if (currentEntries.length === 0) {
        list.appendChild(
          el(
            'div',
            'osu-enhancer-pp-potential-panel__empty',
            `No Best Performance play has 1-${lastMaxMisses} miss${lastMaxMisses === 1 ? '' : 'es'} — either already FC'd or further off than that.`
          )
        );
        return;
      }
      const option = SORT_OPTIONS.find((o) => o.key === sortKey);
      const sorted = [...currentEntries].sort((a, b) => {
        const diff = option.value(a) - option.value(b);
        return sortDir === 'asc' ? diff : -diff;
      });
      sorted.forEach((entry) => list.appendChild(renderRow(entry)));
      footer.textContent = `${sorted.length} play${sorted.length === 1 ? '' : 's'} within ≤${lastMaxMisses} miss${lastMaxMisses === 1 ? '' : 'es'} of FC.`;
    }

    async function run() {
      const maxMisses = parseMissesInput(input.value);
      input.value = String(maxMisses);
      OsuEnhancer.storage.setToggle(LAST_MISSES_KEY, maxMisses);

      const userId = OsuEnhancer.scores.getCurrentUserId();
      const mode = OsuEnhancer.scores.getCurrentMode();
      lastMaxMisses = maxMisses;
      currentEntries = [];
      if (!userId) {
        list.innerHTML = '';
        footer.textContent = '';
        list.appendChild(el('div', 'osu-enhancer-pp-potential-panel__empty', 'Could not read this profile.'));
        return;
      }

      goBtn.disabled = true;
      progress.hidden = false;
      progress.textContent = 'Fetching your scores…';
      try {
        currentEntries = await calculate(userId, mode, maxMisses, (done, totalCandidates, fetchedCount) => {
          progress.textContent =
            totalCandidates === 0
              ? `Fetched ${fetchedCount} Best Performance scores — none within ≤${maxMisses} misses.`
              : `Fetched ${fetchedCount} scores — calculating ${done}/${totalCandidates}…`;
        });
        lastComputedKey = `${userId}:${mode}:${maxMisses}:${getCurrentTotalPp()}`;
        renderList();
      } catch (err) {
        currentEntries = [];
        lastComputedKey = null;
        list.innerHTML = '';
        list.appendChild(el('div', 'osu-enhancer-pp-potential-panel__empty', "Couldn't calculate — try again."));
      } finally {
        progress.hidden = true;
        goBtn.disabled = false;
      }
    }

    // Reopening the panel with the same profile+mode+misses as last time
    // just re-shows what's already computed — only a genuinely new input
    // (or the explicit Calculate button/Enter, via run() directly) redoes
    // the fetch/WASM work.
    function openWithMisses(misses) {
      input.value = String(misses);
      const userId = OsuEnhancer.scores.getCurrentUserId();
      const mode = OsuEnhancer.scores.getCurrentMode();
      const key = `${userId}:${mode}:${misses}:${getCurrentTotalPp()}`;
      if (key === lastComputedKey) {
        renderList();
      } else {
        run();
      }
    }

    goBtn.addEventListener('click', run);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') run();
    });

    document.body.appendChild(panel);
    return { panel, input, setOpen, run, openWithMisses };
  }

  let panelRefs = null;

  // osu!'s SPA route swap (e.g. profile <-> beatmapset) rebuilds
  // document.body's whole child list rather than patching around our own
  // appended elements — confirmed live: a plain marker div appended
  // directly to body does NOT survive a profile->beatmapset transition,
  // even though the JS realm itself does (no reload, module state like
  // `panelRefs` stays intact). profile.js's corner button gets re-created
  // on every rescan, which is why it always comes back — but this panel is
  // only ever built once, so once it's detached this way, `panelRefs` keeps
  // pointing at an orphaned node forever: setOpen(true) still runs and
  // still toggles the class, it's just toggling it on an element no longer
  // attached to the page, so nothing visibly happens.
  async function open() {
    if (!panelRefs) panelRefs = buildPanel();
    else if (!panelRefs.panel.isConnected) document.body.appendChild(panelRefs.panel);
    const toggles = await OsuEnhancer.storage.getToggles();
    panelRefs.setOpen(true);
    panelRefs.openWithMisses(toggles.ppPotentialLastMisses);
  }

  function close() {
    if (panelRefs) panelRefs.setOpen(false);
  }

  function isOpen() {
    // Also requires isConnected — a detached panel can still carry the
    // --open class from before it got orphaned (see open()'s comment), and
    // without this check toggle() would call close() on it (a no-op, since
    // it's already invisible) instead of open() (which actually re-attaches
    // it), costing an extra click to recover.
    return !!(
      panelRefs &&
      panelRefs.panel.isConnected &&
      panelRefs.panel.classList.contains('osu-enhancer-pp-potential-panel--open')
    );
  }

  function toggle() {
    return isOpen() ? close() : open();
  }

  OsuEnhancer.ppPotential = { open, close, toggle };
})(typeof window !== 'undefined' ? window : globalThis);
