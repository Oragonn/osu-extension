/**
 * Shared "player rank next to username" helper (the "showLeaderboardRank"
 * toggle) — used by leaderboard-mod-filter.js (beatmap leaderboard rows/top
 * card) and score-detail.js (the score permalink page's player card), so
 * the osu! API OAuth lookup, in-memory rank cache, and badge markup aren't
 * duplicated between two otherwise-independent features.
 */
(function (global) {
  'use strict';

  const OsuEnhancer = (global.OsuEnhancer = global.OsuEnhancer || {});

  const PROCESSED_ATTR = 'data-osu-enhancer-rank';

  // userId:mode -> Promise<number|null> — shared across every page this
  // content script instance sees for the life of the tab (an in-app
  // navigation from a beatmap leaderboard to a score page, or back, doesn't
  // reset this), so a player already looked up once doesn't get re-fetched.
  const rankCache = new Map();

  function fetchRanksFromBackground(userIds, mode) {
    return OsuEnhancer.storage.getToggles().then(
      (toggles) =>
        new Promise((resolve) => {
          chrome.runtime.sendMessage(
            {
              type: 'osu-enhancer:fetch-user-ranks',
              clientId: toggles.osuApiClientId,
              clientSecret: toggles.osuApiClientSecret,
              userIds,
              mode,
            },
            resolve
          );
        })
    );
  }

  function buildBadge(rank) {
    const span = document.createElement('span');
    span.className = 'osu-enhancer-player-rank';
    span.textContent = `#${rank.toLocaleString()}`;
    return span;
  }

  function userIdFromLink(link) {
    const href = link.getAttribute('href') || '';
    const m = href.match(/\/users\/(\d+)/);
    return m ? Number(m[1]) : null;
  }

  /**
   * Resolves ranks for one or more players in `mode`, deduping against
   * already-cached/in-flight lookups and batching every not-yet-cached id
   * from this call into a single background request.
   * @returns {Promise<Map<number, number|null>>} userId -> global_rank
   */
  function getRanks(userIds, mode) {
    const uniqueIds = [...new Set(userIds)];
    const uncachedIds = uniqueIds.filter((id) => !rankCache.has(`${id}:${mode}`));

    if (uncachedIds.length) {
      const promise = fetchRanksFromBackground(uncachedIds, mode).then((result) =>
        result && result.ok ? result.ranks : {}
      );
      uncachedIds.forEach((id) => {
        rankCache.set(
          `${id}:${mode}`,
          promise.then((ranks) => ranks[id] ?? null)
        );
      });
    }

    return Promise.all(uniqueIds.map((id) => rankCache.get(`${id}:${mode}`).then((rank) => [id, rank]))).then(
      (entries) => new Map(entries)
    );
  }

  OsuEnhancer.playerRank = { PROCESSED_ATTR, buildBadge, userIdFromLink, getRanks };
})(typeof window !== 'undefined' ? window : globalThis);
