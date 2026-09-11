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

  // score.ruleset_id -> the mode name the osu! API's per-user rank lookup
  // needs (same 0/1/2/3 convention leaderboard-mod-filter.js's MODE_NAMES
  // is keyed by mode *name*, not id, for — this page's embedded score JSON
  // only gives the id).
  const RULESET_MODES = ['osu', 'taiko', 'fruits', 'mania'];

  // Appends the player's global rank next to their name in the player card
  // (.user-card__username-row, confirmed live to be a plain flex row — an
  // after-sibling here lands to the right with no special-casing needed,
  // unlike the beatmap leaderboard's *grid*-laid-out top card — see
  // leaderboard-mod-filter.js's insertRankBadge). Shares the lookup/cache
  // with that same "showLeaderboardRank" toggle via src/player-rank.js.
  function hasRankBadge(link) {
    return !!(link.nextElementSibling && link.nextElementSibling.classList.contains('osu-enhancer-player-rank'));
  }

  // This page actually renders *two* .user-card__username elements for the
  // same player (confirmed live: a responsive mobile/desktop pair, both
  // real DOM nodes — only one shown at a time via CSS) — a bare
  // document.querySelector grabs whichever comes first in DOM order, which
  // isn't necessarily the one CSS is currently showing, and inserting next
  // to the hidden one produces a badge that's genuinely in the DOM (findable
  // by class) but has a zero-size box at (0,0), invisible. getClientRects()
  // is empty for anything inside a display:none ancestor (unlike
  // offsetParent, this also works for position:fixed content), so this
  // picks the first candidate that's actually laid out.
  function findVisibleUsernameLink() {
    const candidates = document.querySelectorAll(sel.scoreDetailUsername);
    for (const el of candidates) {
      if (el.getClientRects().length > 0) return el;
    }
    return candidates[0] || null;
  }

  async function injectPlayerRank(score, toggles) {
    if (!toggles.showLeaderboardRank) return;
    const link = findVisibleUsernameLink();
    // Checking for the badge itself — not a one-time "already processed"
    // flag on the link — is what makes this self-healing. This page keeps a
    // live websocket connection (online-status/notification updates), and
    // osu-web's React re-renders .user-card__username-row off the back of
    // that independently of anything we do. Confirmed live: React reuses
    // the *same* <a> element across such a re-render (so a one-time marker
    // attribute on it would wrongly persist and be trusted), while
    // discarding any sibling it doesn't recognize from its own virtual DOM —
    // i.e. our badge — the insert had genuinely succeeded and then vanished
    // on the very next unrelated re-render. Re-checking presence every scan
    // means a rescan that finds the link but no badge just re-adds it.
    if (!link || hasRankBadge(link)) return;

    const mode = RULESET_MODES[score.ruleset_id];
    if (mode == null || score.user_id == null) return;

    const rank = (await OsuEnhancer.playerRank.getRanks([score.user_id], mode)).get(score.user_id);
    if (rank == null) return;

    // Re-query rather than trust `link` held across the await above, for
    // the same reason: it may have been swapped for a different (or
    // rebuilt) node while the rank lookup was in flight.
    const currentLink = findVisibleUsernameLink() || link;
    if (hasRankBadge(currentLink)) return; // a concurrent/earlier pass already added it
    currentLink.insertAdjacentElement('afterend', OsuEnhancer.playerRank.buildBadge(rank));
  }

  async function process(row, score, toggles) {
    // Raw {acronym, settings} objects, not just acronym strings — a
    // customized DT/NC/HT rate (e.g. a 2.00x "Rate Change" score) rides
    // along as mods[].settings.speed_change with no acronym of its own (see
    // scores.js's renderStarRating). Dropping settings here used to
    // silently compute every customized-rate score at that mod's *default*
    // rate instead of its real one.
    const mods = score.mods || [];
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

    const score = readScore();
    if (!score) return;

    // Independent of the stats row below: the player card is a separate
    // element with its own processed-marker (see injectPlayerRank), so one
    // failing/being reprocessed doesn't block the other.
    try {
      await injectPlayerRank(score, toggles);
    } catch (err) {
      console.warn('[osu-enhancer] failed to inject player rank on score detail page', err);
    }

    const row = document.querySelector(sel.scoreDetailStatsRow);
    if (!row || row.getAttribute(PROCESSED_ATTR)) return;

    row.setAttribute(PROCESSED_ATTR, '1');
    try {
      await process(row, score, toggles);
    } catch (err) {
      row.removeAttribute(PROCESSED_ATTR);
      console.warn('[osu-enhancer] failed to process score detail page', err);
    }
  }

  function clearAll() {
    // Checks every .user-card__username on the page (not just the visible
    // one) since the badge could in principle have ended up next to either
    // — see findVisibleUsernameLink.
    document.querySelectorAll(sel.scoreDetailUsername).forEach((link) => {
      if (hasRankBadge(link)) link.nextElementSibling.remove();
    });

    const row = document.querySelector(sel.scoreDetailStatsRow);
    if (!row) return;
    row.removeAttribute(PROCESSED_ATTR);
    row.querySelectorAll(':scope > .osu-enhancer-score-stat').forEach((el) => el.remove());
  }

  OsuEnhancer.scoreDetail = { scanAndProcess, clearAll, isScoreDetailPage };
})(typeof window !== 'undefined' ? window : globalThis);
