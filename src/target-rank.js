/**
 * "Target rank" pp calculator on the profile page (next to Global/Country
 * Ranking). Unlike interpolating from a static rank->pp curve (what other
 * osu! extensions have done — e.g. finding a "similar" cached rank and
 * eyeballing its pp), this looks up the *exact* player currently holding the
 * requested rank via osu!'s own rankings listing (same-origin, no auth
 * needed — same trick scores.js uses for score lists), then works out how
 * much a single new score would need to be worth to close the gap by
 * actually simulating osu!'s weighted-pp aggregation (see WEIGHT_CAP/DECAY
 * below) rather than just diffing total pp — a naive diff overstates the
 * pp needed, since a new score of exactly `target - current` pp inserted
 * into the sorted list is itself devalued by the 0.95^n weighting and can
 * also bump a lower play out of the counted top 200.
 *
 * osu! itself (both the website and the official API v2) refuses to say
 * who's past rank #10,000 at all — see RANKINGS_HARD_CAP below — so a
 * target rank beyond that falls back to extrapolating from the real data
 * right up to that wall, clearly marked as an estimate rather than passed
 * off as exact. When the viewer's own current rank is itself past that
 * wall, its exact (rank, pp) — always available even though the rankings
 * *listing* isn't — anchors the extrapolation instead of just projecting
 * from the in-cap fit's intercept; see evaluateExtrapolation()'s comment
 * for why that matters.
 *
 * Every profile viewed with this feature active also has its own exact
 * (rank, pp) recorded into a small local `chrome.storage.local` history
 * (see recordAnchor()/getStoredAnchorPoints()) — genuinely real points
 * past the cap, for free, that accumulate over ordinary browsing instead
 * of only ever having the one profile currently open. Purely local, never
 * transmitted anywhere; only public rank/pp figures, nothing else.
 */
(function (global) {
  'use strict';

  const OsuEnhancer = (global.OsuEnhancer = global.OsuEnhancer || {});
  const sel = OsuEnhancer.selectors;

  // osu!'s aggregate-pp formula: scores sorted desc by pp, the Nth one
  // counts for pp_N * 0.95^(N-1), plus a small "bonus pp" term for having
  // many scored plays at all. Confirmed live 2026-09-22 against two real
  // profiles (a ~18.6k pp and a ~32.2k pp account): summing the top 200
  // (not top 100 — that undershot both accounts by 150-500pp) plus a bonus
  // near its ~416.67 cap reproduced the displayed total to within ~2pp.
  // This module never assumes the bonus constant directly — see
  // effectiveBonus() below — it backs it out of the player's own real
  // current total instead, which also absorbs this ~2pp residual.
  const WEIGHT_CAP = 200;
  const DECAY = 0.95;
  const SCORE_PAGE_SIZE = 100;
  const RANKINGS_PAGE_SIZE = 50;

  // Confirmed live 2026-09-22: `/rankings/<mode>/global/performance` clamps
  // to page 200 (rank #10,000) no matter how high a page is requested — and
  // this isn't just the website's own UI being conservative, the official
  // API v2's rankings endpoint shares the exact same 200-page ceiling. osu!
  // simply doesn't expose exact rank data past #10,000 through any
  // first-party route, so there's no "just fetch further" fix available.
  const RANKINGS_HARD_CAP = 10000;
  // Past the hard cap, this-many pages sampled log-spaced across ranks
  // ~100..10,000 (not just the handful of pages right before #10,000, and
  // not the extreme top either — see fetchExtrapolationFit) are used to fit
  // a power-law (ln(pp) linear in ln(rank), the standard shape for this
  // kind of long-tailed ranking distribution) and extrapolate — grounded in
  // osu!'s own current, real data, not a cached/stale table.
  //
  // Confirmed live 2026-09-22 that firing ~20 concurrent requests at this
  // same path trips Cloudflare's bot mitigation (a 429 that then blocked
  // the whole domain for that session for a while, not just this one
  // path) — and a real user hit it too even after switching to a small
  // sequential batch, so this is kept deliberately cheap on every axis:
  // a small sample, one request at a time with a spacing delay (see
  // EXTRAPOLATION_REQUEST_SPACING_MS), and the fitted curve is cached per
  // mode+country (see extrapolationFitCache) so it's only ever fetched once
  // per profile view no matter how many target ranks get tried past #10,000.
  const EXTRAPOLATION_SAMPLE_PAGE_COUNT = 5;
  const EXTRAPOLATION_REQUEST_SPACING_MS = 300;
  const RANKINGS_MAX_RETRIES = 3;

  // A personal, local history of every real (rank, pp) beyond the hard cap
  // ever seen on a profile page — see recordAnchor()/getStoredAnchorPoints().
  // Bounded in both directions: dropped once older than ANCHOR_MAX_AGE_MS
  // (pp keeps moving for an active player, so an old record slowly stops
  // being trustworthy) and capped at ANCHOR_MAX_ENTRIES total (oldest
  // evicted first) so this can't grow without bound over months of browsing.
  // 10,000 entries at ~100 bytes each is ~1MB, comfortably inside
  // chrome.storage.local's default 10MB quota — this was never actually
  // constrained by storage size, just picked as a round number.
  const ANCHOR_STORAGE_KEY = 'targetRankAnchors';
  const ANCHOR_MAX_ENTRIES = 10000;
  const ANCHOR_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

  // A full, manually-triggered snapshot of one country's entire rankings
  // list (all 200 pages instead of the 5-page log-spaced sample) — see
  // fetchFullCountryRankings()/settings-panel.js's "Fetch all rankings"
  // button. Kept separate from the per-profile anchor store above: this is
  // one full population per country, not individual accounts. Expires
  // later than the per-profile anchors (60 vs 30 days) since it's a much
  // bigger investment of fetch time to redo — the overall shape of a
  // country's pp curve also drifts more slowly than any one account's own
  // rank/pp does.
  const COUNTRY_SNAPSHOT_STORAGE_KEY = 'targetRankCountrySnapshots';
  const COUNTRY_SNAPSHOT_MAX_AGE_MS = 60 * 24 * 60 * 60 * 1000; // 60 days

  function isProfilePage() {
    return !!document.querySelector(sel.profileInfo);
  }

  function readProfileData() {
    const el = document.querySelector(sel.profileInitialData);
    if (!el) return null;
    let data;
    try {
      data = JSON.parse(el.getAttribute('data-initial-data'));
    } catch (err) {
      return null;
    }
    const user = data && data.user;
    if (!user || !user.statistics) return null;
    return {
      userId: user.id,
      mode: data.current_mode,
      countryCode: user.country && user.country.code,
      currentPp: user.statistics.pp,
      globalRank: user.statistics.global_rank,
      countryRank: user.statistics.country_rank,
    };
  }

  function loadAnchorStore() {
    return new Promise((resolve) => {
      chrome.storage.local.get(ANCHOR_STORAGE_KEY, (items) => resolve(items[ANCHOR_STORAGE_KEY] || {}));
    });
  }

  function saveAnchorStore(store) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [ANCHOR_STORAGE_KEY]: store }, resolve);
    });
  }

  // Only worth recording when the profile is past the hard cap — inside it,
  // every rank is exactly fetchable on demand anyway, so there's nothing
  // this would add. Keyed by mode+userId so revisiting the same profile
  // just refreshes its entry (and its timestamp) instead of duplicating it.
  // Fire-and-forget from render() — this should never slow down or fail the
  // rest of the page's rendering just because a storage write hiccuped.
  async function recordAnchor(profileData) {
    if (!profileData || profileData.userId == null || profileData.globalRank == null) return;
    if (profileData.globalRank <= RANKINGS_HARD_CAP) return;
    try {
      const store = await loadAnchorStore();
      const key = `${profileData.mode}:${profileData.userId}`;
      store[key] = {
        rank: profileData.globalRank,
        countryRank: profileData.countryRank,
        countryCode: profileData.countryCode,
        pp: profileData.currentPp,
        ts: Date.now(),
      };
      const entries = Object.entries(store);
      if (entries.length > ANCHOR_MAX_ENTRIES) {
        entries.sort((a, b) => a[1].ts - b[1].ts);
        for (let i = 0; i < entries.length - ANCHOR_MAX_ENTRIES; i++) delete store[entries[i][0]];
      }
      await saveAnchorStore(store);
    } catch (err) {
      // Storage can legitimately fail (quota, a disabled API in some
      // embedding) — this is a best-effort accuracy booster, not a
      // requirement, so just drop it rather than surfacing an error.
    }
  }

  // Real (not country-ratio-scaled) points beyond the cap, accumulated from
  // ordinary browsing — see recordAnchor(). Scoped to `mode` since a pp
  // figure only means anything within one ruleset.
  async function getStoredAnchorPoints(mode) {
    let store;
    try {
      store = await loadAnchorStore();
    } catch (err) {
      return [];
    }
    const now = Date.now();
    const points = [];
    Object.entries(store).forEach(([key, entry]) => {
      if (!entry || !key.startsWith(`${mode}:`)) return;
      if (entry.rank == null || !(entry.pp > 0)) return;
      if (now - entry.ts > ANCHOR_MAX_AGE_MS) return;
      points.push({ rank: entry.rank, pp: entry.pp });
    });
    return points;
  }

  // Last rank looked up through each widget — kept per PROFILE (not a
  // single global value), keyed by kind:mode:userId, so checking "100k" on
  // one account's Global Ranking doesn't then show that same "100k" gap
  // under every other profile you happen to browse afterwards. Entering "0"
  // in the popover (see run() below) deletes the entry for that profile
  // instead of trying to calculate a nonsensical rank #0.
  const LAST_RANK_STORAGE_KEY = 'targetRankLastChecked';

  function loadLastRankStore() {
    return new Promise((resolve) => {
      chrome.storage.local.get(LAST_RANK_STORAGE_KEY, (items) => resolve(items[LAST_RANK_STORAGE_KEY] || {}));
    });
  }

  function saveLastRankStore(store) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [LAST_RANK_STORAGE_KEY]: store }, resolve);
    });
  }

  function lastRankKey(kind, profileData) {
    return `${kind}:${profileData.mode}:${profileData.userId}`;
  }

  async function getLastRankForProfile(kind, profileData) {
    let store;
    try {
      store = await loadLastRankStore();
    } catch (err) {
      return null;
    }
    const val = store[lastRankKey(kind, profileData)];
    return typeof val === 'number' && val > 0 ? val : null;
  }

  async function setLastRankForProfile(kind, profileData, rank) {
    const store = await loadLastRankStore();
    const key = lastRankKey(kind, profileData);
    if (rank == null) {
      delete store[key];
    } else {
      store[key] = rank;
    }
    await saveLastRankStore(store);
  }

  function findRankElements() {
    const solo = document.querySelector(sel.profileStatsCardSolo);
    if (!solo) return null;
    const ranks = solo.querySelectorAll(sel.profileRankDisplay);
    if (ranks.length < 2) return null;
    return { globalEl: ranks[0], countryEl: ranks[1] };
  }

  // Every ranked score, sorted desc by pp — same endpoint scores.js already
  // uses for the current profile's own row data, just without needing to
  // match it back to any DOM row. Only pp values are kept.
  async function fetchTopPp(userId, mode) {
    const list = [];
    for (let offset = 0; offset <= WEIGHT_CAP; offset += SCORE_PAGE_SIZE) {
      const res = await fetch(`/users/${userId}/scores/best?mode=${mode}&limit=${SCORE_PAGE_SIZE}&offset=${offset}`, {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) break;
      const page = await res.json();
      if (!Array.isArray(page) || page.length === 0) break;
      page.forEach((s) => {
        if (typeof s.pp === 'number') list.push(s.pp);
      });
      if (page.length < SCORE_PAGE_SIZE) break;
    }
    list.sort((a, b) => b - a);
    return list;
  }

  let scoreListCache = null; // { key, promise }
  function getTopPpCached(userId, mode) {
    const key = `${userId}:${mode}`;
    if (!scoreListCache || scoreListCache.key !== key) {
      scoreListCache = { key, promise: fetchTopPp(userId, mode) };
    }
    return scoreListCache.promise;
  }

  function weightedTotal(ppSortedDesc, cap) {
    let sum = 0;
    const n = Math.min(cap, ppSortedDesc.length);
    for (let i = 0; i < n; i++) sum += ppSortedDesc[i] * Math.pow(DECAY, i);
    return sum;
  }

  // Inserts a hypothetical new score into the sorted list and re-weights,
  // same as osu! would after a new play landed in the top WEIGHT_CAP.
  function simulateInsertTotal(ppSortedDesc, newPp, cap) {
    let idx = ppSortedDesc.findIndex((v) => v < newPp);
    if (idx === -1) idx = ppSortedDesc.length;
    const merged = ppSortedDesc.slice(0, idx).concat([newPp], ppSortedDesc.slice(idx));
    return weightedTotal(merged, cap);
  }

  // Backs the "bonus pp" term out of the player's own real total instead of
  // assuming the ~416.6667 asymptote directly — exact for this player today
  // (and self-corrects for the ~2pp residual noted above), rather than
  // reintroducing that error for every calculation.
  function effectiveBonus(ppSortedDesc, currentTotalPp) {
    return currentTotalPp - weightedTotal(ppSortedDesc, WEIGHT_CAP);
  }

  // Binary search on the new score's own pp value for the smallest one that
  // pushes the recomputed aggregate total to/above targetTotalPp. The
  // function being searched is monotonic non-decreasing in newPp, so this
  // always converges.
  function ppNeededForTarget(ppSortedDesc, bonus, targetTotalPp) {
    let hi = Math.max(targetTotalPp - (weightedTotal(ppSortedDesc, WEIGHT_CAP) + bonus), ppSortedDesc[0] || 100, 100);
    let guard = 0;
    while (simulateInsertTotal(ppSortedDesc, hi, WEIGHT_CAP) + bonus < targetTotalPp && guard < 30) {
      hi *= 2;
      guard++;
    }
    let lo = 0;
    for (let i = 0; i < 35; i++) {
      const mid = (lo + hi) / 2;
      const total = simulateInsertTotal(ppSortedDesc, mid, WEIGHT_CAP) + bonus;
      if (total >= targetTotalPp) hi = mid;
      else lo = mid;
    }
    return hi;
  }

  // "18 735" (fr) / "18,735" (en) / "18 735" -> 18735. pp on this table
  // is always a whole number, so stripping every non-digit is safe.
  function parseCountedNumber(text) {
    if (!text) return null;
    const digits = text.replace(/[^\d]/g, '');
    return digits ? Number(digits) : null;
  }

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Same 429/Retry-After handling as scores.js's score-list fetcher — a
  // transient rate-limit on any single request (exact lookup or one page
  // of the extrapolation sample) still gets a normal retry-with-backoff.
  async function fetchRankingsHtml(url, attempt = 0) {
    const res = await fetch(url, { credentials: 'same-origin' });
    if (res.status === 429 && attempt < RANKINGS_MAX_RETRIES) {
      const retryAfter = Number(res.headers.get('Retry-After'));
      const delayMs = retryAfter > 0 ? retryAfter * 1000 : 400 * 2 ** attempt;
      await wait(delayMs);
      return fetchRankingsHtml(url, attempt + 1);
    }
    if (!res.ok) throw new Error('rankings request failed');
    return res.text();
  }

  // `/rankings/<mode>/global/performance` is the same same-origin page
  // osu!'s own rankings UI renders from; `country=XX` filters it to that
  // country's ordering.
  // Relative on osu.ppy.sh itself; absolute from the toolbar popup (an
  // extension page, where host_permissions lets it fetch osu.ppy.sh).
  const RANKINGS_ORIGIN = /(^|\.)osu\.ppy\.sh$/.test(global.location && global.location.hostname) ? '' : 'https://osu.ppy.sh';

  async function fetchRankingsRows(mode, page, countryCode) {
    const countryParam = countryCode ? `&country=${encodeURIComponent(countryCode)}` : '';
    const url = `${RANKINGS_ORIGIN}/rankings/${mode}/global/performance?cursor[page]=${page}${countryParam}`;
    const html = await fetchRankingsHtml(url);
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return Array.from(doc.querySelectorAll('.ranking-page-table tbody tr'));
  }

  // Confirmed live 2026-09-22: the pp cell is always the second `<td>`
  // whose class is the bare `ranking-page-table__column` (no
  // `--dimmed`/`--main`/`--rank-change` modifier) — the first such cell is
  // the rank number — which holds regardless of viewer locale or whether
  // the rank-change column is present (it's absent on the country-filtered
  // view).
  function extractRankPp(row) {
    const plainCols = Array.from(row.querySelectorAll('td')).filter((td) => td.className === 'ranking-page-table__column');
    const rank = parseCountedNumber(plainCols[0] && plainCols[0].textContent);
    const pp = parseCountedNumber(plainCols[1] && plainCols[1].textContent);
    return rank != null && pp != null ? { rank, pp } : null;
  }

  // Fetches the one ranking-table row for `rank` and reads its pp — the
  // *exact* value the player currently holding that rank has, not an
  // interpolated guess.
  //
  // A page number past the real end of the list doesn't 404 or come back
  // empty — confirmed live 2026-09-22 (`cursor[page]=10000000` still
  // returns 200 with 50 rows, silently clamped to the actual last page) —
  // so the returned row's own rank number is checked against what was
  // asked for; a mismatch means `rank` doesn't exist (more players than
  // that don't exist), not that its pp is whatever the last page holds.
  async function fetchExactPpAtRank(mode, rank, countryCode) {
    const page = Math.ceil(rank / RANKINGS_PAGE_SIZE);
    const indexInPage = (rank - 1) % RANKINGS_PAGE_SIZE;
    const rows = await fetchRankingsRows(mode, page, countryCode);
    const row = rows[indexInPage];
    if (!row) return null;
    const parsed = extractRankPp(row);
    if (!parsed || parsed.rank !== rank) return null;
    return { pp: parsed.pp, exact: true };
  }

  // Shared by both the live log-spaced sample and a full stored country
  // snapshot (see fetchFullCountryRankings) — everything downstream just
  // needs { slope, intercept, capPp, points } regardless of which one
  // produced it.
  function buildFitFromPoints(points) {
    if (!points || points.length < 10) return null;
    let sumX = 0;
    let sumY = 0;
    let sumXY = 0;
    let sumXX = 0;
    points.forEach(({ rank: r, pp }) => {
      const x = Math.log(r);
      const y = Math.log(pp);
      sumX += x;
      sumY += y;
      sumXY += x * y;
      sumXX += x * x;
    });
    const n = points.length;
    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;
    const capPoint = points.find((p) => p.rank === RANKINGS_HARD_CAP);
    return { slope, intercept, capPp: capPoint ? capPoint.pp : null, points };
  }

  function loadCountrySnapshots() {
    return new Promise((resolve) => {
      chrome.storage.local.get(COUNTRY_SNAPSHOT_STORAGE_KEY, (items) => resolve(items[COUNTRY_SNAPSHOT_STORAGE_KEY] || {}));
    });
  }

  function saveCountrySnapshots(snapshots) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [COUNTRY_SNAPSHOT_STORAGE_KEY]: snapshots }, resolve);
    });
  }

  // Pages one at a time, same spacing as the regular sample — this walks
  // all 200 pages instead of 5, so it's a couple of minutes of background
  // work, not something to ever run concurrently or on a timer. Stops early
  // if a page's first rank isn't exactly where it should be (`(page-1)*50 +
  // 1`) — that's the clamping behavior confirmed live 2026-09-22 (a page
  // past a country's real last page silently repeats that last page rather
  // than 404ing), so it means this country's real population ended before
  // this page and every further page would just be the same duplicate.
  async function fetchFullCountryRankings(mode, countryCode, onProgress) {
    const maxPage = Math.floor(RANKINGS_HARD_CAP / RANKINGS_PAGE_SIZE);
    const points = [];
    for (let page = 1; page <= maxPage; page++) {
      if (page > 1) await wait(EXTRAPOLATION_REQUEST_SPACING_MS);
      const rows = await fetchRankingsRows(mode, page, countryCode);
      const pageParsed = rows.map(extractRankPp).filter((p) => p && p.pp > 0);
      const expectedFirstRank = (page - 1) * RANKINGS_PAGE_SIZE + 1;
      if (pageParsed.length === 0 || pageParsed[0].rank !== expectedFirstRank) break;
      points.push(...pageParsed);
      if (onProgress) onProgress(page, maxPage, points.length);
    }
    return points;
  }

  async function fetchAndStoreCountrySnapshot(mode, countryCode, onProgress) {
    const points = await fetchFullCountryRankings(mode, countryCode, onProgress);
    const snapshots = await loadCountrySnapshots();
    snapshots[`${mode}:${countryCode}`] = { points, fetchedAt: Date.now() };
    await saveCountrySnapshots(snapshots);
    return points;
  }

  async function getCountrySnapshot(mode, countryCode) {
    if (!countryCode) return null;
    let snapshots;
    try {
      snapshots = await loadCountrySnapshots();
    } catch (err) {
      return null;
    }
    const snapshot = snapshots[`${mode}:${countryCode}`];
    if (!snapshot || !snapshot.points || snapshot.points.length < 10) return null;
    if (Date.now() - snapshot.fetchedAt > COUNTRY_SNAPSHOT_MAX_AGE_MS) return null;
    return snapshot;
  }

  // Beyond RANKINGS_HARD_CAP, osu! has nothing exact to offer (see that
  // constant's comment) — the least-bad option is a power-law fit
  // (ln(pp) = a + b*ln(rank), least squares). This only depends on
  // mode+country, not on any particular target rank, so it's fetched at
  // most once per mode+country (see extrapolationFitCache below) — trying
  // several target ranks past #10,000 in a row reuses the same fit instead
  // of refetching.
  //
  // A manually-fetched full snapshot (see fetchAndStoreCountrySnapshot,
  // wired to the settings panel's "Fetch all rankings" button) takes
  // priority when one exists for this exact mode+country and isn't too
  // stale — 10,000 real points beats a 250-point live sample every time.
  // Otherwise this falls back to sampling live, log-spaced across pages
  // 2..200 (ranks ~100..10,000), not just the handful of pages right at the
  // #10,000 boundary — that narrow a window (fitted 2026-09-22, before this
  // fix) turned out to be numerically unstable: a real report came back
  // needing an estimated ~6133pp for rank #150,000 when a real account
  // confirmed at #150,014 only needed ~4362pp, a ~40% miss from
  // over-trusting a slope measured across a razor-thin rank window. The
  // very top pages (~1..100) are excluded from the live sample too — that
  // handful of ranks is dominated by a few extreme outliers whose *local*
  // slope doesn't represent the broader curve, which would otherwise skew
  // the fit even further from the bulk of the distribution this is
  // extrapolating into.
  //
  // Pages are fetched one at a time with a spacing delay, not concurrently
  // — see EXTRAPOLATION_SAMPLE_PAGE_COUNT's comment on why a burst here is
  // risky.
  async function fetchExtrapolationFit(mode, countryCode) {
    const snapshot = await getCountrySnapshot(mode, countryCode);
    if (snapshot) return buildFitFromPoints(snapshot.points);

    const maxPage = Math.floor(RANKINGS_HARD_CAP / RANKINGS_PAGE_SIZE);
    const minPage = 2; // skip the top ~100 ranks — see comment above
    const pages = new Set();
    for (let i = 0; i < EXTRAPOLATION_SAMPLE_PAGE_COUNT; i++) {
      const frac = EXTRAPOLATION_SAMPLE_PAGE_COUNT === 1 ? 1 : i / (EXTRAPOLATION_SAMPLE_PAGE_COUNT - 1);
      // Log-spaced between minPage and maxPage, i.e. page = minPage * (maxPage/minPage)^frac.
      const page = Math.round(minPage * Math.pow(maxPage / minPage, frac));
      pages.add(Math.max(minPage, Math.min(maxPage, page)));
    }
    const sortedPages = Array.from(pages).sort((a, b) => a - b);

    const points = [];
    for (let i = 0; i < sortedPages.length; i++) {
      if (i > 0) await wait(EXTRAPOLATION_REQUEST_SPACING_MS);
      const rows = await fetchRankingsRows(mode, sortedPages[i], countryCode);
      rows.forEach((row) => {
        const parsed = extractRankPp(row);
        if (parsed && parsed.pp > 0) points.push(parsed);
      });
    }
    // A country with fewer than the cap's worth of ranked players would
    // never actually hit this path (its own last page would already have
    // matched `rank` exactly above) — this is just a sanity floor against
    // a near-empty sample if that assumption is ever wrong.
    return buildFitFromPoints(points);
  }

  // Keyed (not a single slot) — a global-target calculation can need both
  // the unfiltered global fit *and* the viewer's own country's fit in the
  // same call (see the country-proxy comment below), so both need to stay
  // cached at once instead of evicting each other.
  const extrapolationFitCache = new Map(); // key -> promise
  function getExtrapolationFitCached(mode, countryCode) {
    const key = `${mode}:${countryCode || ''}`;
    if (!extrapolationFitCache.has(key)) {
      extrapolationFitCache.set(key, fetchExtrapolationFit(mode, countryCode));
    }
    return extrapolationFitCache.get(key);
  }

  // A power law fit purely from real (in-cap) data and then projected 15x+
  // further out assumes the curve's slope never changes past #10,000 — it
  // does (confirmed live 2026-09-22: a user reported this estimating
  // ~6600pp for rank #150,000 when a real account confirmed at #150,014
  // only needed ~4362pp — the true curve is considerably steeper out there
  // than the in-cap sample's gentle slope suggests). There's no rankings
  // *listing* past the cap to measure that steeper region directly, but an
  // individual profile's own stats are never capped — only the aggregate
  // listing is — so when the viewer's own current rank is itself past
  // #10,000, it's a second real data point sitting right next to whatever
  // target they're asking about, and anchoring the curve there (rather than
  // the in-cap fit's own intercept) is exact in the limit as the target
  // approaches it.
  //
  // A single straight line (constant slope) between the cap boundary and
  // the anchor still isn't quite enough for a target rank *between* them
  // (confirmed live 2026-09-22: a 2-point linear interpolation using
  // #10,000 and a #150,014 anchor still came out ~200pp off at rank
  // #100,000) — the curve visibly bends even within the well-sampled
  // #100..#10,000 region (that's the whole reason a single global slope
  // failed in the first place), and there's no reason to assume it
  // suddenly goes straight beyond it. `fitQuadraticThroughAnchor` fits a
  // parabola (in log-log space) to the in-cap sample — hundreds of real
  // points, so its curvature is well-determined — while forcing it through
  // the anchor exactly, so the *shape* comes from real, abundant data and
  // the one real point beyond the cap is respected exactly rather than
  // just being one datum among hundreds that a plain regression would
  // mostly ignore.
  function fitQuadraticThroughAnchor(points, anchor) {
    if (!points || points.length < 10) return null;
    const xa = Math.log(anchor.rank);
    const ya = Math.log(anchor.pp);
    let sUU = 0;
    let sUV = 0;
    let sVV = 0;
    let sUW = 0;
    let sVW = 0;
    points.forEach(({ rank: r, pp }) => {
      const x = Math.log(r);
      const y = Math.log(pp);
      const u = x - xa;
      const v = x * x - xa * xa;
      const w = y - ya;
      sUU += u * u;
      sUV += u * v;
      sVV += v * v;
      sUW += u * w;
      sVW += v * w;
    });
    const det = sUU * sVV - sUV * sUV;
    if (!Number.isFinite(det) || Math.abs(det) < 1e-9) return null;
    const b = (sUW * sVV - sVW * sUV) / det;
    const c = (sUU * sVW - sUV * sUW) / det;
    const a = ya - b * xa - c * xa * xa;
    return { a, b, c };
  }

  // Fitting the quadratic across *every* available point (the full in-cap
  // sample plus, when present, the full country-proxy sample — 500 points
  // easily) over-smooths: confirmed live 2026-09-22 against two real French
  // accounts (#154,673/4299.39pp and #99,980/5187.71pp — the second one
  // shared specifically to check against) that fitting on the full blended
  // set predicted 4930-4946pp at #99,980 against a real 5187.71 — a ~5%
  // (~250pp) miss — because the far-away, genuinely-flatter in-cap points
  // (ranks #100..#10,000) still pull the curve's shape toward their own
  // shallower region even after the country-proxy is added. Restricting
  // the fit to only the points *nearest the anchor* (by log-rank distance,
  // regardless of whether they came from the in-cap sample or the country
  // proxy) cut that error to roughly a fifth: a 100-point local window
  // around the same anchor predicted ~5118-5134pp, ~1-1.5% off instead of
  // ~5%.
  //
  // A *fixed point-count* window broke again, in the opposite direction,
  // once the "fetch all rankings" full-country snapshot (2026-09-23) gave
  // it 10,000 real points to choose from instead of 250: confirmed live
  // that the nearest-100-by-count window then collapsed to a rank span
  // ratio of just ~1.02 (essentially one neighborhood) versus the
  // sparse-sample window's ~3.22 ratio, reintroducing the exact
  // "too-narrow-to-detect-curvature" instability the very first version of
  // this feature had — a real report's estimate for #100,000 got *worse*
  // (~4882pp) after fetching the France snapshot specifically because of
  // this. So the window now guards a *span*, not just a count:
  // MIN_LOCAL_WINDOW_LOG_RADIUS keeps expanding past MIN_LOCAL_WINDOW_POINTS
  // for as long as the current farthest included point is still closer than
  // that radius, so a dense data source pulls in more points to preserve
  // the same real-world spread a sparse one already had, rather than
  // stopping at an arbitrary count regardless of how little ground it
  // covers. Both constants are empirically chosen from these two real
  // accounts, not derived from first principles — there's no way to solve
  // for the theoretically "right" values without more ground truth than
  // this to check against.
  function selectLocalWindow(points, anchor, minPoints, minLogRadius) {
    if (!points || points.length === 0) return [];
    const xa = Math.log(anchor.rank);
    const sorted = points
      .map((p) => ({ point: p, dist: Math.abs(Math.log(p.rank) - xa) }))
      .sort((a, b) => a.dist - b.dist);
    let count = Math.min(minPoints, sorted.length);
    while (count < sorted.length && sorted[count - 1].dist < minLogRadius) count++;
    return sorted.slice(0, count).map((s) => s.point);
  }

  const MIN_LOCAL_WINDOW_POINTS = 100;
  const MIN_LOCAL_WINDOW_LOG_RADIUS = 0.5;

  function evaluateExtrapolation(rank, fit, anchor) {
    if (!anchor) return Math.exp(fit.intercept + fit.slope * Math.log(rank));

    const localPoints = selectLocalWindow(fit.points, anchor, MIN_LOCAL_WINDOW_POINTS, MIN_LOCAL_WINDOW_LOG_RADIUS);
    const quadratic = fitQuadraticThroughAnchor(localPoints, anchor);
    if (quadratic) {
      const x = Math.log(rank);
      return Math.exp(quadratic.a + quadratic.b * x + quadratic.c * x * x);
    }

    // Fallback: straight line between the exact cap-boundary point and the
    // anchor — still better than the in-cap fit's own (wrong-region) slope.
    const slope =
      fit.capPp != null
        ? Math.log(anchor.pp / fit.capPp) / Math.log(anchor.rank / RANKINGS_HARD_CAP)
        : fit.slope;
    return anchor.pp * Math.pow(rank / anchor.rank, slope);
  }

  // A *global* target's curvature fit only ever sees the unfiltered global
  // top #100..#10,000 — an extremely elite slice of the world. A single
  // country with more ranked players than the global cap covers (plenty of
  // countries qualify) has its own real, exact pp values reaching much
  // further down the skill range, just indexed by *country* rank instead of
  // global rank. The viewer's own profile already gives an exact
  // (globalRank, countryRank) pair for free, so `globalRank / countryRank`
  // is a real calibration ratio between the two scales *at that account's
  // own position*; applying it to every other real (countryRank, pp) point
  // from that same country's rankings gives an approximate-but-real-pp point
  // in exactly the global-rank region this curve most needs more data for —
  // at zero extra request cost, since it's the same lean fetch a country
  // *target* would need anyway (see getExtrapolationFitCached's cache
  // fix above for why that reuse doesn't collide with the global fetch).
  // Must do nothing for a small country that never reaches its own rank
  // #10,000 — but confirmed live 2026-09-22 that fetchExtrapolationFit's own
  // `points.length < 10` floor does NOT catch this: a page number past a
  // country's real last page clamps to that same last page (same behavior
  // as the global list — see fetchExactPpAtRank's comment) rather than
  // coming back short, so e.g. Antarctica (9 total ranked players) returns
  // those same 9 rows for every one of the 5 sample pages — 45 "points",
  // comfortably past the length-10 floor, but all duplicates of a
  // population far too small to say anything about the region a realistic
  // ratio would scale them into. `capPp` is the tell: it's only non-null
  // when the sample's page-200 request returned a real row at exactly rank
  // #10,000 (not a clamped smaller page), which — since rankings pages are
  // gapless — also proves every earlier sampled page in this same fetch was
  // real and unclamped too.
  async function fetchCountryProxyPoints(mode, countryCode, ratio) {
    if (!countryCode || !(ratio > 0)) return [];
    const proxyFit = await getExtrapolationFitCached(mode, countryCode);
    if (!proxyFit || !proxyFit.points || proxyFit.capPp == null) return [];
    return proxyFit.points.map((p) => ({ rank: p.rank * ratio, pp: p.pp }));
  }

  async function fetchExtrapolatedPpAtRank(mode, rank, countryCode, anchor, countryProxy) {
    const fit = await getExtrapolationFitCached(mode, countryCode);
    if (!fit) return null;

    let points = fit.points;
    let proxyUsed = false;
    if (countryProxy) {
      const proxyPoints = await fetchCountryProxyPoints(mode, countryProxy.countryCode, countryProxy.ratio);
      if (proxyPoints.length > 0) {
        points = points.concat(proxyPoints);
        proxyUsed = true;
      }
    }
    // Stored anchors are indexed by *global* rank (see recordAnchor) — only
    // meaningful to mix in when this fit is itself the unfiltered global
    // one (countryCode null here), not a country-filtered fit, which is on
    // a completely different rank scale.
    if (!countryCode) {
      const storedPoints = await getStoredAnchorPoints(mode);
      if (storedPoints.length > 0) points = points.concat(storedPoints);
    }

    const evalFit = points === fit.points ? fit : { ...fit, points };
    const estimatedPp = evaluateExtrapolation(rank, evalFit, anchor);
    if (!Number.isFinite(estimatedPp) || estimatedPp <= 0) return null;
    return { pp: estimatedPp, exact: false, anchored: !!anchor, proxyUsed };
  }

  function fetchPpAtRank(mode, rank, countryCode, anchor, countryProxy) {
    return rank > RANKINGS_HARD_CAP
      ? fetchExtrapolatedPpAtRank(mode, rank, countryCode, anchor, countryProxy)
      : fetchExactPpAtRank(mode, rank, countryCode);
  }

  async function calculate(kind, targetRank, profileData) {
    const { userId, mode, countryCode, currentPp, globalRank, countryRank } = profileData;
    const currentRank = kind === 'country' ? countryRank : globalRank;
    if (currentRank != null && targetRank >= currentRank) {
      return { alreadyThere: true, currentRank };
    }

    // Only usable as an anchor when it's itself past the hard cap — inside
    // it, the target lookup is already exact and needs no anchoring.
    const anchor = currentRank != null && currentRank > RANKINGS_HARD_CAP ? { rank: currentRank, pp: currentPp } : null;

    // The country-proxy trick (see fetchCountryProxyPoints) only makes sense
    // for a *global* target: a country target already samples that same
    // country's real data directly, with no scale mismatch to correct for.
    const countryProxy =
      kind === 'global' && anchor && countryCode && countryRank > 0
        ? { countryCode, ratio: globalRank / countryRank }
        : null;

    const [ppList, target] = await Promise.all([
      getTopPpCached(userId, mode),
      fetchPpAtRank(mode, targetRank, kind === 'country' ? countryCode : null, anchor, countryProxy),
    ]);

    if (target == null) {
      throw new Error('rank not found');
    }

    const bonus = effectiveBonus(ppList, currentPp);
    const neededPp = ppNeededForTarget(ppList, bonus, target.pp);
    return {
      neededPp,
      targetPp: target.pp,
      currentPp,
      exact: target.exact,
      anchored: target.anchored,
      proxyUsed: target.proxyUsed,
    };
  }

  // ---------------- UI ----------------

  // 4362 -> "4,362", 4299.39 -> "4,299.4", 20168 -> "20,168". One decimal
  // place (dropped when it'd just be ".0"), comma thousands separator —
  // real digits rather than the k-notation this used to round down to,
  // since a few hundred pp of difference between two estimates is exactly
  // what that rounding was hiding.
  function formatPp(pp) {
    const rounded = Math.round(pp * 10) / 10;
    return rounded.toLocaleString('en-US', { maximumFractionDigits: 1 });
  }

  // The rank input accepts the same k-notation it displays results in —
  // "100k" -> 100000, "1.1k" -> 1100 — since typing out "150000" every time
  // is exactly the friction that notation is meant to avoid. Plain digits
  // (with optional spaces/commas as thousands separators) still work too.
  // `parseInt("100k", 10)` alone would silently read this as 100, not
  // 100000 — it stops at the first non-digit rather than rejecting it.
  function parseRankInput(text) {
    if (!text) return null;
    const trimmed = text.trim().toLowerCase().replace(/[,\s]/g, '');
    const match = trimmed.match(/^(\d+(?:\.\d+)?)(k?)$/);
    if (!match) return null;
    const value = parseFloat(match[1]);
    if (!Number.isFinite(value)) return null;
    const rank = Math.round(match[2] === 'k' ? value * 1000 : value);
    return rank > 0 ? rank : null;
  }

  // 100000 -> "100k", 1100 -> "1.1k", 12345 -> "12,345" — same notation
  // parseRankInput() accepts, so the persistent line round-trips straight
  // back into the popover's input if reopened.
  function formatRankLabel(rank) {
    if (rank >= 1000 && rank % 100 === 0) {
      const k = rank / 1000;
      return `${Number(k.toFixed(1))}k`;
    }
    return rank.toLocaleString('en-US');
  }

  function closeAllPopovers() {
    document
      .querySelectorAll('.osu-enhancer-target-rank-popover--open')
      .forEach((p) => p.classList.remove('osu-enhancer-target-rank-popover--open'));
  }

  function setResult(resultEl, text, isError) {
    resultEl.textContent = text;
    resultEl.className = isError
      ? 'osu-enhancer-target-rank-result osu-enhancer-target-rank-result--error'
      : 'osu-enhancer-target-rank-result';
  }

  function buildWidget(kind, container) {
    if (!container || container.querySelector(':scope > .osu-enhancer-target-rank-btn')) return;
    container.classList.add('osu-enhancer-target-rank-anchor');

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'osu-enhancer-target-rank-btn';
    btn.title = 'How much pp for a target rank?';
    btn.textContent = '\u{1F3AF}'; // 🎯

    const popover = document.createElement('div');
    popover.className = 'osu-enhancer-target-rank-popover';
    popover.innerHTML =
      '<div class="osu-enhancer-target-rank-popover__row">' +
      '<span class="osu-enhancer-target-rank-popover__hash">#</span>' +
      '<input type="text" class="osu-enhancer-target-rank-input" placeholder="e.g. 100k">' +
      '<button type="button" class="osu-enhancer-target-rank-go">Go</button>' +
      '</div>' +
      '<div class="osu-enhancer-target-rank-result"></div>';

    const input = popover.querySelector('.osu-enhancer-target-rank-input');
    const goBtn = popover.querySelector('.osu-enhancer-target-rank-go');
    const resultEl = popover.querySelector('.osu-enhancer-target-rank-result');

    async function run() {
      const profileData = readProfileData();
      if (!profileData) {
        setResult(resultEl, 'Could not read profile stats.', true);
        return;
      }

      // "0" clears the remembered rank for this profile instead of erroring
      // on a nonsensical rank #0 — the explicit way to stop showing the
      // persistent line under this widget again.
      if (input.value.trim() === '0') {
        await setLastRankForProfile(kind, profileData, null);
        applyAutoDisplay(kind, container, profileData, null);
        input.value = '';
        setResult(resultEl, 'Cleared.', false);
        return;
      }

      const rank = parseRankInput(input.value);
      if (!rank || rank < 1) {
        setResult(resultEl, 'Enter a valid rank, or 0 to clear.', true);
        return;
      }
      setResult(resultEl, 'Calculating…', false);
      try {
        const result = await calculate(kind, rank, profileData);
        setLastRankForProfile(kind, profileData, rank);
        rememberAutoResult(kind, container, profileData, rank, result);
        if (result.alreadyThere) {
          setResult(resultEl, `Already there — you're #${result.currentRank}.`, false);
        } else {
          const targetNote = result.exact
            ? `rank #${rank} needs ${formatPp(result.targetPp)}pp total`
            : `rank #${rank} needs ~${formatPp(result.targetPp)}pp total${result.anchored ? '' : ' (rough)'}`;
          setResult(
            resultEl,
            `≈${formatPp(result.neededPp)}pp new play needed (${targetNote}; you have ${formatPp(result.currentPp)}pp)`,
            false
          );
        }
      } catch (err) {
        setResult(resultEl, "Couldn't look up that rank — try again.", true);
      }
    }

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = popover.classList.contains('osu-enhancer-target-rank-popover--open');
      closeAllPopovers();
      if (!isOpen) {
        popover.classList.add('osu-enhancer-target-rank-popover--open');
        if (!input.value) {
          const profileData = readProfileData();
          if (profileData) {
            getLastRankForProfile(kind, profileData).then((stored) => {
              if (stored && !input.value) input.value = formatRankLabel(stored);
            });
          }
        }
        input.focus();
      }
    });
    popover.addEventListener('click', (e) => e.stopPropagation());
    goBtn.addEventListener('click', run);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') run();
    });

    container.appendChild(btn);
    container.appendChild(popover);
  }

  // The persistent "Xpp for rank #Y" line shown under Global/Country Ranking
  // for whichever rank was last looked up *on this specific profile* through
  // that widget (see getLastRankForProfile/setLastRankForProfile above) —
  // kept in its own small element rather than reusing the popover's result
  // line, since this one has to stay visible with the popover closed. The
  // in-memory cache below is keyed by kind only (not by profile) since only
  // one instance of each widget is ever on the page at a time — its own
  // cacheKey (mode:userId:rank) is what actually invalidates it on a profile
  // or rank change.
  const autoDisplayCache = new Map(); // kind -> { cacheKey, promise }

  function ensureAutoDisplayEl(container) {
    let el = container.querySelector(':scope > .osu-enhancer-target-rank-auto');
    if (!el) {
      el = document.createElement('div');
      el.className = 'osu-enhancer-target-rank-auto';
      container.appendChild(el);
    }
    return el;
  }

  function renderAutoResult(el, rank, result) {
    el.classList.remove('osu-enhancer-target-rank-auto--error');
    if (result.alreadyThere) {
      el.textContent = `Already past rank ${formatRankLabel(rank)}`;
    } else {
      const prefix = result.exact ? '' : '~';
      el.textContent = `${prefix}${formatPp(result.targetPp)}pp for rank ${formatRankLabel(rank)}`;
    }
  }

  // Seeds the cache with a result the popover's own run() just computed
  // anyway, so confirming a target rank shows it under the rank display
  // immediately instead of waiting on a redundant second fetch.
  function rememberAutoResult(kind, container, profileData, rank, result) {
    const cacheKey = `${profileData.mode}:${profileData.userId}:${rank}`;
    autoDisplayCache.set(kind, { cacheKey, promise: Promise.resolve(result) });
    const el = ensureAutoDisplayEl(container);
    renderAutoResult(el, rank, result);
  }

  // Re-run only when the profile or the remembered rank actually changed —
  // render() calls this on every rescan pass (see content.js), which would
  // otherwise mean a fresh rankings lookup every ~400ms while a profile page
  // sits open and its DOM keeps getting rescanned.
  function refreshAutoDisplay(kind, container, profileData, rank) {
    const el = ensureAutoDisplayEl(container);
    const cacheKey = `${profileData.mode}:${profileData.userId}:${rank}`;
    let entry = autoDisplayCache.get(kind);
    if (!entry || entry.cacheKey !== cacheKey) {
      entry = { cacheKey, promise: calculate(kind, rank, profileData) };
      autoDisplayCache.set(kind, entry);
    }
    if (!el.textContent) el.textContent = 'Calculating…';
    entry.promise.then(
      (result) => {
        if (!el.isConnected || autoDisplayCache.get(kind) !== entry) return;
        renderAutoResult(el, rank, result);
      },
      () => {
        if (!el.isConnected || autoDisplayCache.get(kind) !== entry) return;
        el.textContent = `Rank ${formatRankLabel(rank)}: unavailable`;
        el.classList.add('osu-enhancer-target-rank-auto--error');
      }
    );
  }

  function applyAutoDisplay(kind, container, profileData, rank) {
    if (!rank) {
      const existing = container.querySelector(':scope > .osu-enhancer-target-rank-auto');
      if (existing) existing.remove();
      autoDisplayCache.delete(kind);
      return;
    }
    refreshAutoDisplay(kind, container, profileData, rank);
  }

  let outsideClickBound = false;
  function ensureOutsideClickHandler() {
    if (outsideClickBound) return;
    outsideClickBound = true;
    document.addEventListener('click', closeAllPopovers);
  }

  // content.js's MutationObserver re-runs render() many times over a single
  // page view (debounced rescans, click-triggered follow-ups) — this stops
  // recordAnchor() from doing a redundant storage read+write on every one of
  // them for what's still the same profile.
  let anchorRecordedForKey = null;

  function render() {
    if (!isProfilePage()) return;
    const elements = findRankElements();
    if (!elements) return;
    const profileData = readProfileData();
    if (!profileData) return;

    const anchorKey = `${profileData.mode}:${profileData.userId}`;
    if (anchorKey !== anchorRecordedForKey) {
      anchorRecordedForKey = anchorKey;
      recordAnchor(profileData).catch(() => {});
    }

    ensureOutsideClickHandler();
    if (profileData.globalRank != null) buildWidget('global', elements.globalEl);
    if (profileData.countryRank != null) buildWidget('country', elements.countryEl);

    if (profileData.globalRank != null) {
      getLastRankForProfile('global', profileData)
        .then((rank) => applyAutoDisplay('global', elements.globalEl, profileData, rank))
        .catch(() => {});
    }
    if (profileData.countryRank != null) {
      getLastRankForProfile('country', profileData)
        .then((rank) => applyAutoDisplay('country', elements.countryEl, profileData, rank))
        .catch(() => {});
    }
  }

  function remove() {
    document
      .querySelectorAll('.osu-enhancer-target-rank-btn, .osu-enhancer-target-rank-popover, .osu-enhancer-target-rank-auto')
      .forEach((e) => e.remove());
    document
      .querySelectorAll('.osu-enhancer-target-rank-anchor')
      .forEach((e) => e.classList.remove('osu-enhancer-target-rank-anchor'));
    autoDisplayCache.clear();
  }

  OsuEnhancer.targetRank = { isProfilePage, render, remove, fetchAndStoreCountrySnapshot, getCountrySnapshot };
})(typeof window !== 'undefined' ? window : globalThis);
