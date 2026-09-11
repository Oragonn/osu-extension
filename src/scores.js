/**
 * Score row features: "IF FC ###pp" labels (US-007) and cover-art hookup
 * (US-010, actual image-setting lives in cover-art.js).
 *
 * osu-web's score rows (`.play-detail`, see selectors.js) don't expose
 * combo or full-combo status as visible text, so instead of scraping the
 * DOM we fetch the same JSON osu!'s own React app uses to render this
 * section — `/users/<id>/scores/<type>` — which is same-origin (no auth
 * needed beyond the browser's existing session cookie) and gives exact
 * accuracy/mods/`is_perfect_combo`/pp/cover-art data per score. DOM rows
 * are then matched back to that data by beatmap id.
 */
(function (global) {
  'use strict';

  const OsuEnhancer = (global.OsuEnhancer = global.OsuEnhancer || {});
  const sel = OsuEnhancer.selectors;

  const SCORE_TYPES = ['best', 'firsts', 'pinned', 'recent'];
  const PROCESSED_ATTR = 'data-osu-enhancer-row';

  function getCurrentUserId() {
    const m = location.pathname.match(/\/users\/(\d+)/);
    return m ? Number(m[1]) : null;
  }

  function getCurrentMode() {
    const active = document.querySelector('.game-mode-link--active');
    return (active && active.dataset && active.dataset.mode) || 'osu';
  }

  // The MutationObserver-driven rescan in content.js fires repeatedly while
  // osu!'s React app is still incrementally rendering a page (and again on
  // every "Show more" click), which used to mean re-fetching all 4 score
  // endpoints from scratch each time. Caching per user+mode means only the
  // very first rescan pays that cost — later ones reuse the same data to
  // match newly-appeared rows against.
  //
  // Only caches a *complete* fetch (see fetchScoreIndex) — swapping
  // profiles fast enough packs a lot of concurrent requests onto the page
  // at once (medals, kudosu, beatmap packs, this), and one of these 4
  // occasionally comes back 429'd or otherwise fails. Caching that as if
  // it were the final answer meant whichever score type lost the race
  // (Pinned/Best/First seemingly at random) just stayed missing for the
  // rest of the page view — nothing would ever prompt a retry.
  let indexCache = null; // { key, promise }

  function fetchScoreIndexCached(userId, mode) {
    const key = `${userId}:${mode}`;
    if (!indexCache || indexCache.key !== key) {
      const promise = fetchScoreIndex(userId, mode);
      indexCache = { key, promise };
      promise.then((result) => {
        if (!result.complete && indexCache && indexCache.key === key) indexCache = null;
      });
    }
    return indexCache.promise;
  }

  const SCORE_LIST_MAX_RETRIES = 3;

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Same 429/Retry-After handling as pp-calc.js's beatmap-file fetcher —
  // this endpoint can get rate-limited the same way under enough
  // concurrent load.
  async function fetchScoreListWithRetry(url, attempt = 0) {
    const res = await fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
    if (res.status === 429 && attempt < SCORE_LIST_MAX_RETRIES) {
      const retryAfter = Number(res.headers.get('Retry-After'));
      const delayMs = retryAfter > 0 ? retryAfter * 1000 : 400 * 2 ** attempt;
      await wait(delayMs);
      return fetchScoreListWithRetry(url, attempt + 1);
    }
    return res;
  }

  // osu-web's own /users/<id>/scores/<type> endpoint silently caps `limit`
  // at 100 server-side regardless of what's requested (confirmed live:
  // `limit=200` still returns exactly 100) — it needs paging via `offset`
  // instead. Best Performance in particular routinely has up to 200 scores
  // (osu!'s well-known top-200-scores-count-for-pp rule), so a single
  // `limit=100&offset=0` request was silently missing the entire second
  // half of it — every row from #101 on had no matching score in the
  // index and so never got cover art/pp/the stat block, no error, nothing.
  const SCORE_LIST_PAGE_SIZE = 100;
  // 500 rather than exactly 200 to leave headroom for "firsts" (first-place
  // scores) on a very prolific account, which isn't capped by osu! the way
  // Best Performance is — just a finite backstop so this can't page forever.
  const SCORE_LIST_MAX_RESULTS = 500;

  /** Every page of one score type for one user, stopping at a short (final) page. */
  async function fetchScoreType(userId, mode, type) {
    const scores = [];
    for (let offset = 0; offset < SCORE_LIST_MAX_RESULTS; offset += SCORE_LIST_PAGE_SIZE) {
      const res = await fetchScoreListWithRetry(
        `/users/${userId}/scores/${type}?mode=${mode}&limit=${SCORE_LIST_PAGE_SIZE}&offset=${offset}`
      );
      if (!res.ok) return { scores, complete: false };
      const page = await res.json();
      if (!Array.isArray(page)) return { scores, complete: false };
      scores.push(...page);
      if (page.length < SCORE_LIST_PAGE_SIZE) break; // fewer than a full page = the last one
    }
    return { scores, complete: true };
  }

  /**
   * { index, recentByBeatmap, complete }
   * - index: beatmapId -> single score JSON, merged across every scores tab
   *   osu! exposes for this user (first match wins). Correct as long as a
   *   beatmap only has one score to show, which holds for Pinned/Best/Firsts
   *   (osu! itself only ever surfaces one row per beatmap there).
   * - recentByBeatmap: beatmapId -> every "recent" score for that beatmap, in
   *   the order /users/<id>/scores/recent returns them (newest first).
   *   Unlike the other 3 types, Recent can legitimately list the same
   *   beatmap several times in a row (retries) with different pp/accuracy —
   *   `index` can only remember one of them, so matching needs this instead.
   */
  async function fetchScoreIndex(userId, mode) {
    const index = new Map();
    const recentByBeatmap = new Map();
    let complete = true;
    await Promise.all(
      SCORE_TYPES.map(async (type) => {
        try {
          const result = await fetchScoreType(userId, mode, type);
          if (!result.complete) complete = false;
          result.scores.forEach((s) => {
            if (!s || s.beatmap_id == null) return;
            if (!index.has(s.beatmap_id)) index.set(s.beatmap_id, s);
            if (type === 'recent') {
              let list = recentByBeatmap.get(s.beatmap_id);
              if (!list) recentByBeatmap.set(s.beatmap_id, (list = []));
              list.push(s);
            }
          });
        } catch (err) {
          // A genuine network failure (not "this type doesn't apply to this
          // user" — that's a 200 with an empty array, handled above as a
          // normal success) — still worth surfacing since it's what marks
          // this result incomplete and unfit to cache.
          complete = false;
          console.warn('[osu-enhancer] failed to fetch score list', type, err);
        }
      })
    );
    return { index, recentByBeatmap, complete };
  }

  function beatmapIdFromRow(row) {
    const link = row.querySelector(sel.beatmapLink);
    if (!link) return null;
    const href = link.getAttribute('href') || '';
    const m = href.match(/\/beatmapsets\/\d+#\w+\/(\d+)/) || href.match(/\/beatmaps\/(\d+)/);
    return m ? Number(m[1]) : null;
  }

  // `index` maps a beatmap to a single score, which breaks when Recent Plays
  // lists the same beatmap several rows in a row (retries) — every one of
  // those rows would otherwise get matched to whichever one score happened
  // to win the merge, showing identical accuracy/pp/IF-FC on all of them
  // instead of each row's own. When that beatmap does have more than one
  // "recent" score, this instead counts the row's position among same-
  // beatmap rows within its own `.play-detail-list` (Pinned/Best/Firsts/
  // Recent each get their own container) and pairs it with the same
  // position in recentByBeatmap's array — osu! returns that newest-first,
  // the same order the rows themselves render top to bottom.
  function matchScoreToRow(row, index, recentByBeatmap) {
    const beatmapId = beatmapIdFromRow(row);
    const recentList = recentByBeatmap.get(beatmapId);
    if (recentList && recentList.length > 1) {
      const container = row.closest(sel.scoreRowList);
      if (container) {
        const siblings = Array.from(container.querySelectorAll(sel.scoreRow)).filter(
          (r) => beatmapIdFromRow(r) === beatmapId
        );
        const occurrenceIndex = siblings.indexOf(row);
        if (occurrenceIndex >= 0 && occurrenceIndex < recentList.length) {
          return recentList[occurrenceIndex];
        }
      }
    }
    return index.get(beatmapId);
  }

  function coverUrlFromScore(score) {
    const covers = score.beatmapset && score.beatmapset.covers;
    // Highest-res first — these rows are full-width, so the small "list"
    // thumbnail (meant for compact/mobile lists) looks visibly blurry
    // stretched across them.
    return (covers && (covers['cover@2x'] || covers.cover || covers['card@2x'] || covers.card)) || null;
  }

  // osu-web's actual current difficulty-colour spectrum: the domain/range
  // merged in github.com/ppy/osu-web#8317 (resources/assets/lib/utils/
  // beatmap-helper.ts), which superseded the older #7955 table and is what
  // the live site uses today. Below 0.1★ clamps to the first color, above
  // 9★ clamps to black — no special-casing needed for either.
  const STAR_COLOR_STOPS = [
    [0.1, [66, 144, 251]], // #4290FB
    [1.25, [79, 192, 255]], // #4FC0FF
    [2.0, [79, 255, 213]], // #4FFFD5
    [2.5, [124, 255, 79]], // #7CFF4F
    [3.3, [246, 240, 92]], // #F6F05C
    [4.2, [255, 128, 104]], // #FF8068
    [4.9, [255, 78, 111]], // #FF4E6F
    [5.8, [198, 69, 184]], // #C645B8
    [6.7, [101, 99, 222]], // #6563DE
    [7.7, [24, 21, 142]], // #18158E
    [9.0, [0, 0, 0]], // #000000
  ];

  // osu! truncates (never rounds up) displayed star ratings to 2 decimals —
  // otherwise e.g. 6.754 would visually "bump up" to 6.76, misleadingly
  // suggesting the map is harder than it measures. .toFixed(2) rounds, so
  // it needs an explicit floor first.
  function formatStars(stars) {
    return (Math.floor(stars * 100) / 100).toFixed(2);
  }

  function starRatingColor(stars) {
    if (stars <= STAR_COLOR_STOPS[0][0]) return STAR_COLOR_STOPS[0][1];
    for (let i = 1; i < STAR_COLOR_STOPS.length; i++) {
      const [hiStar, hiColor] = STAR_COLOR_STOPS[i];
      if (stars <= hiStar) {
        const [loStar, loColor] = STAR_COLOR_STOPS[i - 1];
        const t = hiStar === loStar ? 1 : (stars - loStar) / (hiStar - loStar);
        return loColor.map((c, idx) => Math.round(c + (hiColor[idx] - c) * t));
      }
    }
    return STAR_COLOR_STOPS[STAR_COLOR_STOPS.length - 1][1];
  }

  async function renderStarRating(row, score) {
    const baseRating = score.beatmap && score.beatmap.difficulty_rating;
    // Kept as the raw {acronym, settings} objects, not just acronym strings —
    // a customized DT/NC/HT rate (osu!'s "Rate Change", e.g. a 2.00x DT)
    // rides along as mods[].settings.speed_change with no separate acronym
    // of its own (see leaderboard-mod-filter.js's file comment). Stripping
    // settings here used to silently compute every customized-rate score at
    // that mod's *default* rate (1.5x/0.75x) instead of its real one.
    const mods = score.mods || [];
    let stars = baseRating;

    // The API's own difficulty_rating is ground truth for the unmodded map
    // (matches what osu! itself displays everywhere). rosu-pp-js's own
    // difficulty algorithm version doesn't exactly match osu!'s live one
    // (confirmed: it disagrees even at zero mods), so rather than trust its
    // absolute output, it's only used to measure the *ratio* a mod combo
    // changes difficulty by, applied on top of the trusted base rating —
    // that cancels out any version mismatch between the two calculators.
    if (mods.length > 0 && baseRating != null) {
      const [starsNoMods, starsWithMods] = await Promise.all([
        OsuEnhancer.ppCalc.calculateStarRating(score.beatmap_id, []),
        OsuEnhancer.ppCalc.calculateStarRating(score.beatmap_id, mods),
      ]);
      if (starsNoMods && starsWithMods) {
        stars = baseRating * (starsWithMods / starsNoMods);
      }
    }
    if (stars == null) return;

    const container = row.querySelector('.play-detail__beatmap-and-time');
    if (!container) return;
    let el = container.querySelector(':scope > .osu-enhancer-star-rating');
    if (!el) {
      el = document.createElement('span');
      el.className = 'osu-enhancer-star-rating';
      container.appendChild(el);
    }
    const [r, g, b] = starRatingColor(stars);
    el.style.setProperty('--osu-enhancer-star-color', `rgb(${r}, ${g}, ${b})`);
    el.textContent = `★ ${formatStars(stars)}`;
  }

  // Replaces the accuracy-only display in .play-detail__score-detail with a
  // two-line block: accuracy + combo on top, the 300/100/50/miss judgement
  // counts below. That slot already sits directly between the mods and the
  // pp value (see selectors.js), so this reuses it rather than adding a new
  // flex item that'd have to fight osu-web's own `order`-based layout.
  // Accuracy/combo-reached/judgement-counts all come from the score-list
  // JSON scores.js already fetches for pp/IF-FC purposes, but the beatmap's
  // *maximum* possible combo isn't part of that JSON (only the score's own
  // slimmer beatmap sub-object, confirmed missing `max_combo` against the
  // live /users/<id>/scores/<type> response) — that one's a real extra
  // calculation (cached per beatmap, see calculateMaxCombo).
  //
  // The achieved-combo number turns the same pink as the max-combo figure
  // when `is_perfect_combo` is set — i.e. the two numbers only match colors
  // when they'd also match in value, so a full combo reads as "89/89x" all
  // in pink at a glance instead of needing the numbers compared by hand.
  async function renderStatBlock(row, score) {
    const container = row.querySelector(sel.scoreRowScoreDetail);
    if (!container) return;

    let block = container.querySelector(':scope > .osu-enhancer-stat-block');
    if (!block) {
      block = document.createElement('div');
      block.className = 'osu-enhancer-stat-block';
      container.appendChild(block);
    }

    const accuracy = `${(score.accuracy * 100).toFixed(2)}%`;
    const stats = score.statistics || {};
    const maxCombo = await OsuEnhancer.ppCalc.calculateMaxCombo(score.beatmap_id);

    const achievedClass = score.is_perfect_combo
      ? 'osu-enhancer-stat-combo osu-enhancer-stat-combo--fc'
      : 'osu-enhancer-stat-combo';
    const comboHtml =
      maxCombo != null
        ? `<span class="${achievedClass}">${score.max_combo}</span>/<span class="osu-enhancer-stat-combo-max">${maxCombo}x</span>`
        : `<span class="${achievedClass}">${score.max_combo}x</span>`;

    // 300/100/50/miss each get their own color (matching the extension's
    // own star-rating gradient stops for 300/100/50, so the palette isn't
    // inventing new colors) and enough gap to read as four distinct figures
    // rather than one run-together number.
    block.innerHTML =
      `<span class="osu-enhancer-stat-line1"><span class="osu-enhancer-stat-acc">${accuracy}</span> · ${comboHtml}</span>` +
      `<span class="osu-enhancer-stat-line2">` +
      `<span class="osu-enhancer-judgement osu-enhancer-judgement--300">${stats.great || 0}</span>` +
      `<span class="osu-enhancer-judgement osu-enhancer-judgement--100">${stats.ok || 0}</span>` +
      `<span class="osu-enhancer-judgement osu-enhancer-judgement--50">${stats.meh || 0}</span>` +
      `<span class="osu-enhancer-judgement osu-enhancer-judgement--miss">${stats.miss || 0}</span>` +
      `</span>`;
  }

  // Appended inside .play-detail__pp itself, stacked directly under the
  // real pp value (see theme.css's :has() rule) — previously an absolutely
  // -positioned badge floating over the row's top-right corner instead,
  // reported as unclear (not visually connected to the pp number it's
  // about, and could land overlapping the title/mapper text depending on
  // row width).
  function renderIfFcLabel(row, ppValue) {
    const ppEl = row.querySelector(sel.scoreRowPp);
    if (!ppEl) return;
    let label = ppEl.querySelector(':scope > .osu-enhancer-if-fc');
    if (!label) {
      label = document.createElement('span');
      label.className = 'osu-enhancer-if-fc';
      ppEl.appendChild(label);
    }
    label.textContent = `if FC ${ppValue.toFixed(2)}pp`;
  }

  // Unranked/loved/graveyard/pending/WIP scores get `score.pp === null` from
  // osu! itself (only ranked/approved beatmaps award real pp), so osu-web's
  // own row just shows a "-" or a heart icon in .play-detail__pp instead of
  // a number — confirmed live on Pinned/First-place/Recent rows (the only
  // sections that can contain non-ranked scores; Best Performance is
  // pp-scores only by definition). Appending our own estimate there rather
  // than replacing osu-web's placeholder keeps this non-destructive, same
  // as the IF-FC label above.
  function renderUnrankedPp(row, ppValue) {
    const ppEl = row.querySelector(sel.scoreRowPp);
    if (!ppEl) return;
    let span = ppEl.querySelector(':scope > .osu-enhancer-unranked-pp');
    if (!span) {
      span = document.createElement('span');
      span.className = 'osu-enhancer-unranked-pp';
      span.title =
        'Estimated — this beatmap isn’t ranked, so it doesn’t award official pp. ' +
        'May also run behind osu!’s current pp formula until the bundled rosu-pp build is updated for the latest rework.';
      ppEl.appendChild(span);
    }
    span.textContent = `${ppValue.toFixed(2)}pp`;
  }

  // For a real (preserved or not) awarded score, osu-web renders its own
  // pp figure natively — `.play-detail__pp > .pp-value`, a leading text
  // node (the number, rounded to a whole pp by osu-web itself) followed by
  // a nested `.play-detail__pp-unit` span (the "pp" suffix). Only that
  // leading text node is replaced, so the "pp" suffix (and .pp-value's own
  // title tooltip/classes, including --non-preserved) stay exactly as
  // osu-web rendered them.
  function renderRealPp(row, ppValue) {
    const valueEl = row.querySelector(`${sel.scoreRowPp} .pp-value`);
    const textNode = valueEl && valueEl.firstChild;
    if (textNode && textNode.nodeType === Node.TEXT_NODE) {
      textNode.textContent = ppValue.toFixed(2);
    }
  }

  async function processRow(row, score, toggles) {
    if (row.getAttribute(PROCESSED_ATTR)) return null;
    row.setAttribute(PROCESSED_ATTR, '1');

    // Claimed up front (immediately above) so two overlapping scans can't
    // both pick up the same row, but everything that can actually fail
    // (a beatmap fetch, a WASM calculation) happens below — if any of it
    // throws, the row un-claims itself in the catch so the next scan
    // (triggered by the MutationObserver on the next bit of page activity)
    // retries it, instead of it staying permanently blank for a transient
    // hiccup with nothing about *this* row wrong.
    try {
      const beatmapsetId = score.beatmapset && score.beatmapset.id;
      if (toggles.coverArt && beatmapsetId) {
        const coverUrl = coverUrlFromScore(score);
        OsuEnhancer.coverArt.applyCoverArt(row, beatmapsetId, coverUrl); // row = the .play-detail element itself
      }

      await renderStarRating(row, score);
      await renderStatBlock(row, score);

      if (score.pp == null) {
        // Raw {acronym, settings} objects — see renderStarRating's comment
        // on why a customized DT/NC/HT rate needs settings, not just the
        // acronym, to compute correctly.
        const mods = score.mods || [];
        // score.statistics uses lazer's judgement names (great/ok/meh/miss) —
        // osu!std's n300/n100/n50/misses under different labels — giving
        // rosu-pp the exact per-judgement counts instead of an overall
        // accuracy percentage to reconstruct a guessed split from.
        const stats = score.statistics || {};
        const unrankedPp = await OsuEnhancer.ppCalc.calculatePp(score.beatmap_id, {
          n300: stats.great,
          n100: stats.ok,
          n50: stats.meh,
          combo: score.max_combo,
          misses: stats.miss || 0,
          mods,
          sliderEndHits: stats.slider_tail_hit,
          largeTickHits: stats.large_tick_hit,
          smallTickHits: stats.small_tick_hit,
          isLegacy: score.legacy_score_id != null,
        });
        if (unrankedPp != null) renderUnrankedPp(row, unrankedPp);
      } else {
        renderRealPp(row, score.pp);
      }

      let ppIfFc = null;
      if (toggles.ppIfFc && !score.is_perfect_combo) {
        const mods = score.mods || [];
        ppIfFc = await OsuEnhancer.ppCalc.calculatePpIfFc(score.beatmap_id, {
          accuracy: score.accuracy * 100,
          mods,
          isLegacy: score.legacy_score_id != null,
        });
        if (ppIfFc != null) renderIfFcLabel(row, ppIfFc);
      }

      return { row, score, ppIfFc };
    } catch (err) {
      row.removeAttribute(PROCESSED_ATTR);
      throw err;
    }
  }

  async function scanAndProcess(toggles, root) {
    const userId = getCurrentUserId();
    if (!userId) return [];

    const rows = Array.from((root || document).querySelectorAll(sel.scoreRow));
    const unprocessed = rows.filter((r) => !r.getAttribute(PROCESSED_ATTR));
    if (unprocessed.length === 0) return [];

    const { index, recentByBeatmap } = await fetchScoreIndexCached(userId, getCurrentMode());

    const queue = unprocessed
      .map((row) => ({ row, score: matchScoreToRow(row, index, recentByBeatmap) }))
      .filter((item) => item.score);

    // Rows used to be processed one at a time — each waiting on its own
    // beatmap-file fetch + WASM calc before the next even started. Running
    // a small pool concurrently instead collapses total wait time from
    // "sum of every row" down to roughly "the slowest single row".
    const CONCURRENCY = 10;
    const results = [];
    let i = 0;
    async function worker() {
      while (i < queue.length) {
        const { row, score } = queue[i++];
        try {
          const result = await processRow(row, score, toggles);
          if (result) results.push(result);
        } catch (err) {
          console.warn('[osu-enhancer] failed to process score row', err);
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
    return results;
  }

  function clearRow(row) {
    row.removeAttribute(PROCESSED_ATTR);
    const label = row.querySelector('.osu-enhancer-if-fc');
    if (label) label.remove();
    const unrankedPp = row.querySelector('.osu-enhancer-unranked-pp');
    if (unrankedPp) unrankedPp.remove();
    OsuEnhancer.coverArt.removeCoverArt(row);
  }

  function clearAll(root) {
    (root || document).querySelectorAll(`[${PROCESSED_ATTR}]`).forEach(clearRow);
  }

  // "#1", "#2", ... position numbers, per request — not something osu-web
  // itself renders. Only on Pinned/Best/First-Place (not Recent), numbered
  // by each row's plain DOM position within its own section's list, found
  // by matching that section's heading text and taking the next
  // `.play-detail-list` after it in document order.
  const RANK_NUMBER_CLASS = 'osu-enhancer-rank-number';
  const RANKED_SECTION_LABELS = ['Pinned Scores', 'Best Performance', 'First Place Scores'];

  // Confirmed real markup: <h3 class="title title--page-extra-small">Best
  // Performance<span class="title__count">200</span></h3> — the count span
  // is a child with no separator, so textContent would read
  // "Best Performance200"; comparing just the heading's own leading text
  // node avoids that.
  function findExactTextElement(label) {
    const headings = document.querySelectorAll(sel.scoreSectionHeading);
    for (const h of headings) {
      const firstNode = h.childNodes[0];
      const text = firstNode && firstNode.nodeType === Node.TEXT_NODE ? firstNode.textContent.trim() : '';
      if (text === label) return h;
    }
    return null;
  }

  function findFollowingScoreList(afterEl) {
    const result = document.evaluate(
      "following::*[contains(concat(' ', normalize-space(@class), ' '), ' play-detail-list ')][1]",
      afterEl,
      null,
      XPathResult.FIRST_ORDERED_NODE_TYPE,
      null
    );
    return result.singleNodeValue;
  }

  function applyRankNumbers() {
    RANKED_SECTION_LABELS.forEach((label) => {
      const heading = findExactTextElement(label);
      if (!heading) return;
      const list = findFollowingScoreList(heading);
      if (!list) return;

      Array.from(list.children).forEach((row, idx) => {
        if (!row.classList || !row.classList.contains('play-detail')) return;
        // Inserted as a real flex item ahead of the grade icon (inside the
        // row's existing top group, which is already a flex row) rather
        // than an absolute overlay, so it gets its own layout space instead
        // of floating on top of the icon.
        const groupTop = row.querySelector(sel.scoreRowGroupTop);
        if (!groupTop) return;
        let badge = groupTop.querySelector(`:scope > .${RANK_NUMBER_CLASS}`);
        if (!badge) {
          badge = document.createElement('span');
          badge.className = RANK_NUMBER_CLASS;
          groupTop.insertBefore(badge, groupTop.firstChild);
        }
        badge.textContent = `#${idx + 1}`;
      });
    });
  }

  OsuEnhancer.scores = { scanAndProcess, clearAll, applyRankNumbers, getCurrentUserId, getCurrentMode };
})(typeof window !== 'undefined' ? window : globalThis);
