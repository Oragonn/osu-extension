/**
 * Individual score permalink page (osu.ppy.sh/scores/<id>): adds an
 * estimated "pp" stat when the beatmap doesn't award real pp (unranked/
 * loved/graveyard/pending/WIP), and a "pp if fc" stat otherwise handled by
 * the "IF FC" label on profile score rows (scores.js) — this page has no
 * equivalent of its own, so it's added here instead.
 *
 * Unlike scores.js, there's no score list to fetch: osu-web already embeds
 * this exact page's score JSON server-side (see selectors.scoreDetailJson)
 * to hydrate its own React island, so that's read directly instead of
 * hitting an endpoint.
 */
(function (global) {
  'use strict';

  const OsuEnhancer = (global.OsuEnhancer = global.OsuEnhancer || {});
  const sel = OsuEnhancer.selectors;

  const PROCESSED_ATTR = 'data-osu-enhancer-score-detail';

  function isScoreDetailPage() {
    return /^\/scores\/\d+/.test(location.pathname);
  }

  function readScore() {
    const el = document.querySelector(sel.scoreDetailJson);
    if (!el) return null;
    try {
      return JSON.parse(el.textContent);
    } catch (err) {
      return null;
    }
  }

  function createStat(labelText, valueHtml) {
    const stat = document.createElement('div');
    stat.className = 'score-stats__stat osu-enhancer-score-stat';
    stat.innerHTML =
      `<div class="score-stats__stat-row score-stats__stat-row--label">${labelText}</div>` +
      `<div class="score-stats__stat-row">${valueHtml}</div>`;
    return stat;
  }

  async function process(row, score, toggles) {
    const mods = (score.mods || []).map((m) => m.acronym);
    const isLegacy = score.legacy_score_id != null;

    if (score.pp == null) {
      const stats = score.statistics || {};
      const estimatedPp = await OsuEnhancer.ppCalc.calculatePp(score.beatmap_id, {
        n300: stats.great,
        n100: stats.ok,
        n50: stats.meh,
        combo: score.max_combo,
        misses: stats.miss || 0,
        mods,
        sliderEndHits: stats.slider_tail_hit,
        largeTickHits: stats.large_tick_hit,
        smallTickHits: stats.small_tick_hit,
        isLegacy,
      });
      if (estimatedPp != null) {
        const title =
          'Estimated — this beatmap isn’t ranked, so it doesn’t award official pp. ' +
          'May also run behind osu!’s current pp formula until the bundled rosu-pp build is updated for the latest rework.';
        row.appendChild(
          createStat('pp', `<span class="osu-enhancer-score-detail-pp" title="${title}">${Math.round(estimatedPp)}</span>`)
        );
      }
    }

    if (toggles.ppIfFc && !score.is_perfect_combo) {
      const ppIfFc = await OsuEnhancer.ppCalc.calculatePpIfFc(score.beatmap_id, {
        accuracy: score.accuracy * 100,
        mods,
        isLegacy,
      });
      if (ppIfFc != null) {
        row.appendChild(createStat('pp if fc', `<span class="osu-enhancer-score-detail-fc">${Math.round(ppIfFc)}</span>`));
      }
    }
  }

  async function scanAndProcess(toggles) {
    if (!isScoreDetailPage()) return;

    const row = document.querySelector(sel.scoreDetailStatsRow);
    if (!row || row.getAttribute(PROCESSED_ATTR)) return;

    const score = readScore();
    if (!score) return;

    row.setAttribute(PROCESSED_ATTR, '1');
    try {
      await process(row, score, toggles);
    } catch (err) {
      row.removeAttribute(PROCESSED_ATTR);
      console.warn('[osu-enhancer] failed to process score detail page', err);
    }
  }

  function clearAll() {
    const row = document.querySelector(sel.scoreDetailStatsRow);
    if (!row) return;
    row.removeAttribute(PROCESSED_ATTR);
    row.querySelectorAll(':scope > .osu-enhancer-score-stat').forEach((el) => el.remove());
  }

  OsuEnhancer.scoreDetail = { scanAndProcess, clearAll, isScoreDetailPage };
})(typeof window !== 'undefined' ? window : globalThis);
