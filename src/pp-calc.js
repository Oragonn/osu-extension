/**
 * Thin dispatcher over the two pp-calculation engines (src/engines/rosu-engine.js,
 * src/engines/official-engine.js), selected by the `ppEngine` storage toggle.
 * scores.js only ever calls OsuEnhancer.ppCalc.* — it doesn't know or care
 * which engine is behind it.
 */
(function (global) {
  'use strict';

  const OsuEnhancer = (global.OsuEnhancer = global.OsuEnhancer || {});

  // Resolved via a promise (not a plain cached string) so the very first
  // call after page load can't race the async storage read below.
  let enginePromise = OsuEnhancer.storage
    .getToggles()
    .then((toggles) => toggles.ppEngine || 'rosu');

  OsuEnhancer.storage.onToggleChange((key, value) => {
    if (key === 'ppEngine') enginePromise = Promise.resolve(value || 'rosu');
  });

  async function engine() {
    const name = await enginePromise;
    return OsuEnhancer.engines[name] || OsuEnhancer.engines.rosu;
  }

  /** PP if this play had been a full combo with the same accuracy/mods. */
  function calculatePpIfFc(beatmapId, { accuracy, mods }) {
    return OsuEnhancer.ppCalc.calculatePp(beatmapId, { accuracy, mods, misses: 0, combo: undefined });
  }

  /** PP at a fixed accuracy breakpoint, assuming full combo. */
  function calculatePpAtAccuracy(beatmapId, accuracy, mods) {
    return OsuEnhancer.ppCalc.calculatePp(beatmapId, { accuracy, mods, misses: 0, combo: undefined });
  }

  OsuEnhancer.ppCalc = {
    init: async (...args) => (await engine()).init(...args),
    getBeatmap: async (...args) => (await engine()).getBeatmap(...args),
    calculatePp: async (...args) => (await engine()).calculatePp(...args),
    calculatePpIfFc,
    calculatePpAtAccuracy,
    calculateStarRating: async (...args) => (await engine()).calculateStarRating(...args),
    calculateMaxCombo: async (...args) => (await engine()).calculateMaxCombo(...args),
  };
})(typeof window !== 'undefined' ? window : globalThis);
