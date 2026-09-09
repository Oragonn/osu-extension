/**
 * Client-side PP calculation, backed by a vendored build of rosu-pp-js
 * (lib/rosu-pp/rosu_pp.js + rosu_pp_js_bg.wasm — see US-006/FR-5). No
 * network calls other than fetching the beatmap's own .osu file and the
 * bundled .wasm, both of which stay on osu.ppy.sh / inside the extension.
 */
(function (global) {
  'use strict';

  const OsuEnhancer = (global.OsuEnhancer = global.OsuEnhancer || {});

  let initPromise = null;
  // beatmapId -> Promise<Beatmap | null>
  const beatmapCache = new Map();

  function init() {
    if (!initPromise) {
      const wasmUrl = chrome.runtime.getURL('lib/rosu-pp/rosu_pp_js_bg.wasm');
      // A rejected promise is still a truthy value, so a one-off failure
      // (a transient fetch hiccup) would otherwise get cached forever by
      // `if (!initPromise)` above and silently break PP/cover/star-rating
      // for the rest of this page's lifetime. Resetting on failure lets the
      // next caller retry from scratch instead.
      initPromise = global.RosuPP.__init(wasmUrl).catch((err) => {
        initPromise = null;
        throw err;
      });
    }
    return initPromise;
  }

  // Persists fetched .osu files across page loads (Cache Storage, not just
  // an in-memory Map) — a ranked beatmap's file essentially never changes,
  // so a beatmap you've already seen once (very likely on repeat visits to
  // your own profile) costs zero network time on every later visit.
  const OSU_FILE_CACHE = 'osu-enhancer-beatmaps-v1';

  // /osu/<id> is meant for the game client downloading one map at a time —
  // hitting it with many rows' worth of concurrent requests gets osu.ppy.sh
  // to start responding 429. A small dedicated queue (independent of the
  // row-processing pool in scores.js) plus Retry-After-aware backoff keeps
  // every request eventually succeeding instead of failing outright.
  const FETCH_CONCURRENCY = 2;
  const MAX_RETRIES = 5;
  let activeFetches = 0;
  const fetchQueue = [];

  function scheduleFetch(task) {
    return new Promise((resolve, reject) => {
      fetchQueue.push({ task, resolve, reject });
      pumpFetchQueue();
    });
  }

  function pumpFetchQueue() {
    while (activeFetches < FETCH_CONCURRENCY && fetchQueue.length > 0) {
      const { task, resolve, reject } = fetchQueue.shift();
      activeFetches++;
      task()
        .then(resolve, reject)
        .finally(() => {
          activeFetches--;
          pumpFetchQueue();
        });
    }
  }

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function fetchWithBackoff(url, attempt = 0) {
    const res = await fetch(url, { credentials: 'omit' });
    if (res.status === 429 && attempt < MAX_RETRIES) {
      const retryAfter = Number(res.headers.get('Retry-After'));
      const delayMs = retryAfter > 0 ? retryAfter * 1000 : 500 * 2 ** attempt;
      await wait(delayMs);
      return fetchWithBackoff(url, attempt + 1);
    }
    return res;
  }

  async function fetchOsuFile(beatmapId) {
    const url = `/osu/${beatmapId}`;
    let cache = null;
    try {
      cache = await caches.open(OSU_FILE_CACHE);
      const cached = await cache.match(url);
      if (cached) return cached.text();
    } catch (err) {
      // Cache Storage itself failing (rare) shouldn't block the calculation.
    }

    const res = await scheduleFetch(() => fetchWithBackoff(url));
    if (!res.ok) throw new Error(`failed to fetch .osu file for ${beatmapId}: ${res.status}`);
    if (cache) cache.put(url, res.clone());
    return res.text();
  }

  async function getBeatmap(beatmapId) {
    if (!beatmapCache.has(beatmapId)) {
      const promise = (async () => {
        await init();
        try {
          const text = await fetchOsuFile(beatmapId);
          return new global.RosuPP.Beatmap(text);
        } catch (err) {
          console.warn('[osu-enhancer] could not load beatmap for PP calc', beatmapId, err);
          return null;
        }
      })();
      beatmapCache.set(beatmapId, promise);
      // A ranked beatmap's file never changes, so a *successful* fetch is
      // cached for good (see OSU_FILE_CACHE below) — but a failed one
      // (network hiccup, wasm not ready yet) isn't a fact about the
      // beatmap, so it shouldn't stick around forever the same way.
      // Evicting it lets the next scan's call retry instead of everything
      // referencing this beatmap staying silently blank all page long.
      promise.then(
        (map) => { if (!map) beatmapCache.delete(beatmapId); },
        () => beatmapCache.delete(beatmapId)
      );
    }
    return beatmapCache.get(beatmapId);
  }

  /**
   * @param {number} beatmapId
   * @param {object} scoreState { accuracy, combo, misses, mods, n300, n100, n50,
   *   sliderEndHits, largeTickHits, smallTickHits }
   *   Exact hit counts (n300/n100/n50) take priority over `accuracy` when
   *   given — reconstructing a 100/50 split purely from an accuracy
   *   percentage is only an approximation (rosu-pp has to *guess* a
   *   plausible split), which can miss the real pp by double digits on an
   *   unusual judgement spread (e.g. a low-combo HR play with lots of
   *   misses). The real per-judgement counts, straight from osu!'s own
   *   score JSON, remove that guesswork entirely.
   *   sliderEndHits/largeTickHits/smallTickHits are lazer-only judgement
   *   counts (score.statistics.slider_tail_hit/large_tick_hit/small_tick_hit)
   *   with no stable equivalent — when omitted (e.g. a stable-set score),
   *   rosu-pp assumes every slider end/tick was hit, so leave them
   *   undefined rather than passing 0.
   * @returns {Promise<number|null>} pp value, or null if it couldn't be computed
   */
  async function calculatePp(beatmapId, scoreState) {
    const map = await getBeatmap(beatmapId);
    if (!map) return null;
    try {
      const args = {
        combo: scoreState.combo,
        misses: scoreState.misses || 0,
        mods: scoreState.mods || 0,
      };
      const hasExactCounts = scoreState.n300 != null || scoreState.n100 != null || scoreState.n50 != null;
      if (hasExactCounts) {
        args.n300 = scoreState.n300 || 0;
        args.n100 = scoreState.n100 || 0;
        args.n50 = scoreState.n50 || 0;
      } else {
        args.accuracy = scoreState.accuracy;
      }
      if (scoreState.sliderEndHits != null) args.sliderEndHits = scoreState.sliderEndHits;
      if (scoreState.largeTickHits != null) args.largeTickHits = scoreState.largeTickHits;
      if (scoreState.smallTickHits != null) args.smallTickHits = scoreState.smallTickHits;
      const perf = new global.RosuPP.Performance(args);
      const attrs = perf.calculate(map);
      const pp = attrs.pp;
      attrs.free && attrs.free();
      return pp;
    } catch (err) {
      console.warn('[osu-enhancer] PP calculation failed', beatmapId, err);
      return null;
    }
  }

  /** PP if this play had been a full combo with the same accuracy/mods. */
  function calculatePpIfFc(beatmapId, { accuracy, mods, misses }) {
    return calculatePp(beatmapId, { accuracy, mods, misses: 0, combo: undefined });
  }

  /** PP at a fixed accuracy breakpoint, assuming full combo. */
  function calculatePpAtAccuracy(beatmapId, accuracy, mods) {
    return calculatePp(beatmapId, { accuracy, mods, misses: 0, combo: undefined });
  }

  /** Star rating adjusted for the given mods (e.g. DT/HR raise it, EZ/HT lower it). */
  async function calculateStarRating(beatmapId, mods) {
    const map = await getBeatmap(beatmapId);
    if (!map) return null;
    try {
      const diff = new global.RosuPP.Difficulty({ mods: mods || 0 });
      const attrs = diff.calculate(map);
      const stars = attrs.stars;
      attrs.free && attrs.free();
      return stars;
    } catch (err) {
      console.warn('[osu-enhancer] star rating calculation failed', beatmapId, err);
      return null;
    }
  }

  // beatmapId -> Promise<number | null>. A map's own max combo doesn't
  // depend on mods or the score, so it's cached independently of (and
  // longer-lived than) any particular pp/star-rating calculation — the same
  // beatmap showing up in both Recent and Best Performance shouldn't run
  // the difficulty calculation twice.
  const maxComboCache = new Map();

  /** The beatmap's own maximum achievable combo (independent of mods/score). */
  async function calculateMaxCombo(beatmapId) {
    if (!maxComboCache.has(beatmapId)) {
      const promise = (async () => {
        const map = await getBeatmap(beatmapId);
        if (!map) return null;
        try {
          const diff = new global.RosuPP.Difficulty({});
          const attrs = diff.calculate(map);
          const maxCombo = attrs.maxCombo;
          attrs.free && attrs.free();
          return maxCombo;
        } catch (err) {
          console.warn('[osu-enhancer] max combo calculation failed', beatmapId, err);
          return null;
        }
      })();
      maxComboCache.set(beatmapId, promise);
      promise.then(
        (combo) => { if (combo == null) maxComboCache.delete(beatmapId); },
        () => maxComboCache.delete(beatmapId)
      );
    }
    return maxComboCache.get(beatmapId);
  }

  OsuEnhancer.ppCalc = {
    init,
    getBeatmap,
    calculatePp,
    calculatePpIfFc,
    calculatePpAtAccuracy,
    calculateStarRating,
    calculateMaxCombo,
  };
})(typeof window !== 'undefined' ? window : globalThis);
