/**
 * Client-side PP calculation backed by ppy's own official osu!standard
 * ruleset code (ppy.osu.Game.Rulesets.Osu, MIT licensed), compiled to
 * WebAssembly by this project (see engine-bridge/OsuRulesetBridge and
 * lib/osu-ruleset-bridge/ — clean-room, not adapted from any third-party
 * browser extension). Runs in a hidden iframe (pages/official-engine-host.html)
 * since a .NET-in-WASM runtime can't be called synchronously in-process the
 * way the small rosu-pp module can; communication is via postMessage.
 */
(function (global) {
  'use strict';

  const OsuEnhancer = (global.OsuEnhancer = global.OsuEnhancer || {});
  OsuEnhancer.engines = OsuEnhancer.engines || {};

  function getExtensionApi() {
    return typeof chrome !== 'undefined' ? chrome : global.browser;
  }

  const CHANNEL = `oppc-${Math.random().toString(36).slice(2)}`;
  const INIT_TIMEOUT_MS = 30000;
  const CALL_TIMEOUT_MS = 20000;

  let iframePromise = null;
  let nextCallId = 1;
  const pending = new Map(); // id -> { resolve, reject, timeoutHandle }

  global.addEventListener('message', (event) => {
    const data = event.data;
    if (!data || data.source !== 'oppc-engine' || data.channel !== CHANNEL || data.type !== 'result') return;
    const entry = pending.get(data.id);
    if (!entry) return;
    pending.delete(data.id);
    clearTimeout(entry.timeoutHandle);
    entry.resolve(data.result);
  });

  function ensureIframe() {
    if (!iframePromise) {
      iframePromise = new Promise((resolve, reject) => {
        const frame = document.createElement('iframe');
        frame.hidden = true;
        frame.src = `${getExtensionApi().runtime.getURL('pages/official-engine-host.html')}?channel=${encodeURIComponent(CHANNEL)}`;

        const timeoutHandle = setTimeout(() => {
          global.removeEventListener('message', onReady);
          reject(new Error('official engine iframe did not become ready in time'));
        }, INIT_TIMEOUT_MS);

        function onReady(event) {
          const data = event.data;
          if (!data || data.source !== 'oppc-engine' || data.channel !== CHANNEL) return;
          if (data.type === 'ready') {
            clearTimeout(timeoutHandle);
            global.removeEventListener('message', onReady);
            resolve(frame);
          } else if (data.type === 'init-error') {
            clearTimeout(timeoutHandle);
            global.removeEventListener('message', onReady);
            reject(new Error(data.error || 'official engine failed to initialize'));
          }
        }
        global.addEventListener('message', onReady);
        document.documentElement.appendChild(frame);
      }).catch((err) => {
        iframePromise = null;
        throw err;
      });
    }
    return iframePromise;
  }

  /** @returns {Promise<{error?: string, [key: string]: any}>} */
  async function call(method, args) {
    const frame = await ensureIframe();
    const id = nextCallId++;
    return new Promise((resolve) => {
      const timeoutHandle = setTimeout(() => {
        pending.delete(id);
        resolve({ error: `official engine call "${method}" timed out` });
      }, CALL_TIMEOUT_MS);
      pending.set(id, { resolve, timeoutHandle });
      frame.contentWindow.postMessage({ source: 'oppc', channel: CHANNEL, id, type: 'call', method, args }, '*');
    });
  }

  function init() {
    return ensureIframe();
  }

  // --- beatmap text fetch/cache (mirrors rosu-engine.js's own logic almost
  // exactly; duplicated rather than shared so each engine module stays
  // independently self-contained and removable) ---
  const OSU_FILE_CACHE = 'osu-enhancer-beatmaps-v1';
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

  const beatmapCache = new Map(); // beatmapId -> Promise<{beatmapId, osuFileText} | null>

  async function getBeatmap(beatmapId) {
    if (!beatmapCache.has(beatmapId)) {
      const promise = (async () => {
        try {
          const osuFileText = await fetchOsuFile(beatmapId);
          return { beatmapId: String(beatmapId), osuFileText };
        } catch (err) {
          console.warn('[osu-enhancer] could not load beatmap for official PP engine', beatmapId, err);
          return null;
        }
      })();
      beatmapCache.set(beatmapId, promise);
      promise.then(
        (b) => { if (!b) beatmapCache.delete(beatmapId); },
        () => beatmapCache.delete(beatmapId)
      );
    }
    return beatmapCache.get(beatmapId);
  }

  function normalizeMods(mods) {
    return Array.isArray(mods) ? mods : [];
  }

  /**
   * Reconstructs a plausible N300/N100/N50 hit-count split for a target
   * accuracy — the real game calculators (unlike rosu-pp) only accept exact
   * hit counts, with no "just give me an accuracy" mode. Ported from ppy's
   * own official, MIT-licensed osu-tools CLI
   * (PerformanceCalculator/Simulate/OsuSimulateCommand.cs's
   * generateHitResults; Copyright (c) ppy Pty Ltd <contact@ppy.sh>).
   */
  function reconstructHitCounts(totalObjects, accuracyPercent, countMiss) {
    const accuracy = Math.max(0, Math.min(1, (accuracyPercent || 0) / 100));
    const relevantResultCount = totalObjects - countMiss;

    if (relevantResultCount <= 0) {
      return { n300: 0, n100: 0, n50: 0, misses: totalObjects };
    }

    let relevantAccuracy = (accuracy * totalObjects) / relevantResultCount;
    relevantAccuracy = Math.max(0, Math.min(1, relevantAccuracy));

    let countGood;
    let countMeh;
    let misses = countMiss;

    if (relevantAccuracy >= 0.25) {
      const ratio50To100 = Math.pow(1 - (relevantAccuracy - 0.25) / 0.75, 2);
      const count100Estimate = (6 * relevantResultCount * (1 - relevantAccuracy)) / (5 * ratio50To100 + 4);
      const count50Estimate = count100Estimate * ratio50To100;
      countGood = Math.round(count100Estimate);
      countMeh = Math.round(count100Estimate + count50Estimate) - countGood;
    } else if (relevantAccuracy >= 1 / 6) {
      const count100Estimate = 6 * relevantResultCount * relevantAccuracy - relevantResultCount;
      const count50Estimate = relevantResultCount - count100Estimate;
      countGood = Math.round(count100Estimate);
      countMeh = Math.round(count100Estimate + count50Estimate) - countGood;
    } else {
      const count50Estimate = 6 * relevantResultCount * relevantAccuracy;
      countGood = 0;
      countMeh = Math.round(count50Estimate);
      misses = totalObjects - countMeh;
    }

    const countGreat = totalObjects - countGood - countMeh - misses;
    return { n300: Math.max(0, countGreat), n100: countGood, n50: countMeh, misses };
  }

  // beatmapId -> Promise<{maxCombo, totalHits} | null>. Both are
  // mod-independent for osu!std (no mod changes hit object count or max
  // combo), so — like rosu-engine.js's own maxComboCache — this is cached
  // once per beatmap regardless of which mods a later calculatePp call uses.
  const modIndependentDifficultyCache = new Map();

  async function getModIndependentDifficulty(beatmapId) {
    if (!modIndependentDifficultyCache.has(beatmapId)) {
      const promise = (async () => {
        const beatmap = await getBeatmap(beatmapId);
        if (!beatmap) return null;
        try {
          const result = await call('CalculateDifficulty', [beatmap.beatmapId, beatmap.osuFileText, '[]']);
          if (result.error) throw new Error(result.error);
          return { maxCombo: result.maxCombo, totalHits: result.totalHits };
        } catch (err) {
          console.warn('[osu-enhancer] official engine difficulty calculation failed', beatmapId, err);
          return null;
        }
      })();
      modIndependentDifficultyCache.set(beatmapId, promise);
      promise.then(
        (d) => { if (!d) modIndependentDifficultyCache.delete(beatmapId); },
        () => modIndependentDifficultyCache.delete(beatmapId)
      );
    }
    return modIndependentDifficultyCache.get(beatmapId);
  }

  /** @param {number} beatmapId @param {object} scoreState see rosu-engine.js's calculatePp for the shared field shapes */
  async function calculatePp(beatmapId, scoreState) {
    const beatmap = await getBeatmap(beatmapId);
    if (!beatmap) return null;
    try {
      const misses = scoreState.misses || 0;
      let { n300, n100, n50 } = scoreState;
      const hasExactCounts = n300 != null || n100 != null || n50 != null;

      if (!hasExactCounts) {
        const modIndependent = await getModIndependentDifficulty(beatmapId);
        const totalObjects = modIndependent ? modIndependent.totalHits : 0;
        ({ n300, n100, n50 } = reconstructHitCounts(totalObjects, scoreState.accuracy, misses));
      }

      const statsJson = JSON.stringify({
        n300: n300 || 0,
        n100: n100 || 0,
        n50: n50 || 0,
        misses,
        combo: scoreState.combo,
        mods: normalizeMods(scoreState.mods),
        sliderTailHit: scoreState.sliderEndHits,
        largeTickHit: scoreState.largeTickHits,
        smallTickHit: scoreState.smallTickHits,
        // Scores set on stable (imported into lazer) use "classic" slider
        // accuracy/miss-estimation mechanics in the real performance
        // calculator (gated by an OsuModClassic mod instance + IsLegacyScore
        // on ScoreInfo, not by any of the fields above) -- omitting this
        // silently computed every score as if it were lazer-native, which is
        // wrong for stable-origin scores. See engine-bridge/FINDINGS.md.
        legacy: !!scoreState.isLegacy,
      });

      const result = await call('CalculatePerformance', [beatmap.beatmapId, beatmap.osuFileText, statsJson]);
      if (result.error) throw new Error(result.error);
      return result.pp;
    } catch (err) {
      console.warn('[osu-enhancer] official engine PP calculation failed', beatmapId, err);
      return null;
    }
  }

  /** Star rating adjusted for the given mods (e.g. DT/HR raise it, EZ/HT lower it). */
  async function calculateStarRating(beatmapId, mods) {
    const beatmap = await getBeatmap(beatmapId);
    if (!beatmap) return null;
    try {
      const result = await call('CalculateDifficulty', [
        beatmap.beatmapId,
        beatmap.osuFileText,
        JSON.stringify(normalizeMods(mods)),
      ]);
      if (result.error) throw new Error(result.error);
      return result.stars;
    } catch (err) {
      console.warn('[osu-enhancer] official engine star rating calculation failed', beatmapId, err);
      return null;
    }
  }

  /** The beatmap's own maximum achievable combo (independent of mods/score). */
  async function calculateMaxCombo(beatmapId) {
    const d = await getModIndependentDifficulty(beatmapId);
    return d ? d.maxCombo : null;
  }

  OsuEnhancer.engines.official = {
    init,
    getBeatmap,
    calculatePp,
    calculateStarRating,
    calculateMaxCombo,
  };
})(typeof window !== 'undefined' ? window : globalThis);
