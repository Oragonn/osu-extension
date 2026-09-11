/**
 * MV3 service worker. Two independent jobs, both here rather than in the
 * content script because a fetch initiated there is subject to
 * osu.ppy.sh's own CSP (outside our control) and to normal cross-origin
 * CORS restrictions; a service worker isn't subject to either, and with
 * host_permissions declared for a target origin can bypass CORS for it
 * outright:
 *
 * 1. Periodically ask npm whether rosu-pp-js has a newer release than
 *    what's vendored in lib/rosu-pp/, cached for the popup and settings
 *    panel to read.
 * 2. On request from the leaderboard mod-filter buttons ("DT only",
 *    "No Mod" — src/leaderboard-mod-filter.js), get an OAuth token for the
 *    user's own osu! API client and fetch scores matching an exact mod
 *    combination for a beatmap.
 */
importScripts('rosu-update-shared.js');

const { STORAGE_KEY, ALARM_NAME, BUNDLED_VERSION, NPM_LATEST_URL, isUpdateAvailable } = self.OsuEnhancer.rosuUpdate;

const CHECK_PERIOD_MINUTES = 12 * 60;

async function checkRosuVersion() {
  let result;
  try {
    const res = await fetch(NPM_LATEST_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error(`npm registry responded ${res.status}`);
    const data = await res.json();
    if (!data || !data.version) throw new Error('npm response missing version field');

    result = {
      bundled: BUNDLED_VERSION,
      latest: data.version,
      updateAvailable: isUpdateAvailable(data.version, BUNDLED_VERSION),
      checkedAt: Date.now(),
      error: null,
    };
  } catch (err) {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    const previous = stored[STORAGE_KEY] || { bundled: BUNDLED_VERSION, latest: null, updateAvailable: false };
    result = { ...previous, checkedAt: Date.now(), error: String((err && err.message) || err) };
  }

  await chrome.storage.local.set({ [STORAGE_KEY]: result });
  await chrome.action.setBadgeText({ text: result.updateAvailable ? '!' : '' });
  await chrome.action.setBadgeBackgroundColor({ color: '#ff4d6d' });

  return result;
}

function scheduleChecks() {
  checkRosuVersion();
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: CHECK_PERIOD_MINUTES });
}

chrome.runtime.onInstalled.addListener(scheduleChecks);
chrome.runtime.onStartup.addListener(scheduleChecks);

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) checkRosuVersion();
});

// Leaderboard mod-filter lookups ("DT only", "No Mod" —
// src/leaderboard-mod-filter.js) — use the official osu! API v2 with the
// user's own OAuth app (client credentials grant: app-level, not tied to
// any osu! account, so there's no "current user" for a supporter check to
// key off of — same pattern the userscript "osu+" uses). Credentials live
// in chrome.storage.local (set via the settings panel); this runs here
// rather than in the content script so the client_secret and the cached
// token never pass through page-context JS.
const OSU_TOKEN_URL = 'https://osu.ppy.sh/oauth/token';
const OSU_API_BASE = 'https://osu.ppy.sh/api/v2';
const TOKEN_CACHE_KEY = 'osuApiTokenCache';

async function getOsuApiToken(clientId, clientSecret) {
  const cached = (await chrome.storage.local.get(TOKEN_CACHE_KEY))[TOKEN_CACHE_KEY];
  if (cached && cached.clientId === clientId && cached.expiresAt > Date.now() + 60000) {
    return cached.accessToken;
  }

  const res = await fetch(OSU_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'client_credentials',
      scope: 'public',
    }),
  });
  if (!res.ok) throw new Error(`osu! OAuth token request failed (${res.status})`);
  const data = await res.json();
  if (!data.access_token) throw new Error('osu! OAuth response missing access_token');

  const cache = {
    clientId,
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  await chrome.storage.local.set({ [TOKEN_CACHE_KEY]: cache });
  return cache.accessToken;
}

async function osuApiGet(token, path, params) {
  const url = new URL(`${OSU_API_BASE}${path}`);
  Object.entries(params || {}).forEach(([key, value]) => {
    // osu-web is Laravel-based and parses array params via the `key[]`
    // suffix (confirmed live against its own scores endpoint: the site's
    // own mod-ranking request sends `mods%5B%5D=DT`, i.e. `mods[]=DT`) —
    // a bare repeated `mods=DT` wouldn't be read as an array server-side.
    if (Array.isArray(value)) value.forEach((v) => url.searchParams.append(`${key}[]`, v));
    else if (value !== undefined && value !== null) url.searchParams.set(key, value);
  });
  return fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'x-api-version': '20240529',
    },
  });
}

// "CL" (Classic scoring) rides along on most stable/legacy-scored plays
// regardless of what real mods were used — confirmed live, e.g.
// mods:[{HR},{HD},{CL}] on an otherwise-HDHR score — so a genuinely
// mod-less classic play shows up as mods:[CL], not mods:[]. Ignoring it
// when comparing is what the official API itself does server-side (see
// the "NM" handling below); this mirrors that so client-side matching
// doesn't re-reject scores the server already matched.
const NON_COUNTED_MODS = new Set(['CL']);

function normalizedModAcronyms(mods) {
  return (mods || []).map((m) => (typeof m === 'string' ? m : m.acronym)).filter((a) => !NON_COUNTED_MODS.has(a));
}

function hasClassicMod(score) {
  return (score.mods || []).some((m) => m.acronym === 'CL');
}

// "Rate Change" isn't a distinct mod — there's no such acronym — it's
// DT or NC (never HT — see fetchRateChangedScores) played at a non-default
// speed. osu! serializes that as mods[].settings.speed_change on the DT/NC
// entry itself; confirmed live: most DT/NC scores have settings: null
// (default rate, e.g. plain 1.5×) and only ones actually customized carry
// this field at all.
function hasCustomRate(score) {
  return (score.mods || []).some(
    (m) => (m.acronym === 'DT' || m.acronym === 'NC') && m.settings && typeof m.settings.speed_change === 'number'
  );
}

// mods is either null (don't constrain by real mods at all — used when
// only a scoringVersion filter is active) or an array of exact real mod
// acronyms to match (nothing more, nothing fewer — [] means nomod).
// scoringVersion is an independent axis on top of that: null (either),
// 'classic' (must have CL), or 'lazer' (must not have CL). A classic-scored
// HR play matches mods:['HR'] regardless of scoringVersion, same as it'd
// match mods:[] (nomod) if scoringVersion is 'classic' and no real mods
// are required — the two axes are genuinely independent.
function scoreMatchesFilter(score, mods, scoringVersion) {
  if (mods !== null) {
    const actual = normalizedModAcronyms(score.mods).sort();
    const target = normalizedModAcronyms(mods).sort();
    if (actual.length !== target.length || !actual.every((a, i) => a === target[i])) return false;
  }
  if (scoringVersion === 'classic' && !hasClassicMod(score)) return false;
  if (scoringVersion === 'lazer' && hasClassicMod(score)) return false;
  return true;
}

// A "Lazer, no specific real mods" lookup can't ask the server for "not
// Classic" (see below), so a single unfiltered fetch just checks whatever
// ~100 scores rank highest overall by score/pp — on an old, heavily-farmed
// map those are dominated by classic-era plays, so the lazer-only slice of
// that one pool can be tiny even though plenty of lazer scores exist
// across *other* mod combinations that don't crack the overall top 100.
// Sweeping every valid combination, each with its own ~100-score pool, and
// merging the unique results surfaces those — same idea as the userscript
// "osu+" letting you multi-select mods, just automated instead of
// requiring the user to click through each combination by hand.
// Every combination respects the same real exclusions the button group
// enforces (EZ/HR mutually exclusive; DT/NC/HT mutually exclusive as a
// group of alternatives) instead of every subset of every mod, which
// keeps it to a real 96 (4 speed options incl. none x 3 difficulty options
// incl. neither x 2^3 for HD/FL/NF each independently) rather than a
// combinatorial explosion that would include impossible scores like
// EZ+HR or DT+HT.
const SPEED_MOD_OPTIONS = [null, 'DT', 'NC', 'HT'];
const DIFFICULTY_MOD_OPTIONS = [null, 'EZ', 'HR'];
const INDEPENDENT_MODS = ['HD', 'FL', 'NF'];

function generateAllModCombos() {
  const combos = [];
  for (const speed of SPEED_MOD_OPTIONS) {
    for (const difficulty of DIFFICULTY_MOD_OPTIONS) {
      for (let mask = 0; mask < 1 << INDEPENDENT_MODS.length; mask += 1) {
        const combo = [];
        if (speed) combo.push(speed);
        if (difficulty) combo.push(difficulty);
        INDEPENDENT_MODS.forEach((mod, i) => {
          if (mask & (1 << i)) combo.push(mod);
        });
        combos.push(combo);
      }
    }
  }
  return combos;
}

async function fetchScoresForMods(token, beatmapId, mode, queryMods) {
  const res = await osuApiGet(token, `/beatmaps/${beatmapId}/scores`, {
    mode,
    legacy_only: 0,
    type: 'global',
    limit: 100,
    mods: queryMods,
  });
  if (!res.ok) return [];
  const data = await res.json();
  return data.scores || [];
}

// Same field every other path is implicitly already sorted by: osu's own
// leaderboard order (and the SCORE column the frontend renders) is raw
// score, not pp — a single combo's results come back pre-sorted this way
// from the API, so filtering them just preserves it. The sweep merges
// several *different* combos' results together, so it has to explicitly
// re-sort — sorting by pp instead (an earlier version of this did) left
// the merged list pp-ordered while the SCORE column it's displayed next
// to stayed in whatever order the merge happened to produce, which is why
// it looked "unsorted" even though it technically was, just by the wrong field.
function scoreValue(score) {
  return score.total_score ?? score.legacy_total_score ?? score.score ?? 0;
}

// Runs the sweep's ~96 requests in batches rather than all at once — the
// API's own guidance caps polite usage at ~60 requests/minute, and this
// alone would burst past that in one go if fired as a single Promise.all.
async function fetchInBatches(items, batchSize, mapFn) {
  const results = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    results.push(...(await Promise.all(batch.map(mapFn))));
  }
  return results;
}

async function fetchLazerScoresViaSweep(token, beatmapId, mode) {
  const combos = generateAllModCombos();
  const perCombo = await fetchInBatches(combos, 16, (combo) =>
    fetchScoresForMods(token, beatmapId, mode, combo.length === 0 ? ['NM'] : combo)
  );

  const seen = new Set();
  const lazerScores = [];
  for (const scores of perCombo) {
    for (const score of scores) {
      if (seen.has(score.id)) continue;
      seen.add(score.id);
      if (!hasClassicMod(score)) lazerScores.push(score);
    }
  }
  lazerScores.sort((a, b) => scoreValue(b) - scoreValue(a));

  return { scores: lazerScores.slice(0, 50), scannedCount: seen.size };
}

// "Rate Change" search (the dtnc filter button's 3rd state, after DT/NC —
// see leaderboard-mod-filter.js). There's no mods[] value that means "any
// customized rate", so this queries the DT and NC pools (each combined
// with whatever other real mods are also selected) separately and keeps
// only the scores that actually have a non-default settings.speed_change
// (see hasCustomRate) — same merge-and-dedupe idea as the lazer sweep
// above, just two queries instead of 96, since DT and NC are the only two
// mods a rate change can ride on (HT is excluded whenever this state is
// active, same as it is for plain DT/NC — see toggleDtNc).
async function fetchRateChangedScores(token, beatmapId, mode, baseMods, scoringVersion) {
  const base = baseMods || [];
  const dtCombo = [...base, 'DT'];
  const ncCombo = [...base, 'NC'];
  const [dtScores, ncScores] = await Promise.all([
    fetchScoresForMods(token, beatmapId, mode, dtCombo),
    fetchScoresForMods(token, beatmapId, mode, ncCombo),
  ]);

  const seen = new Map();
  dtScores.forEach((score) => {
    if (scoreMatchesFilter(score, dtCombo, scoringVersion) && hasCustomRate(score)) seen.set(score.id, score);
  });
  ncScores.forEach((score) => {
    if (scoreMatchesFilter(score, ncCombo, scoringVersion) && hasCustomRate(score)) seen.set(score.id, score);
  });

  const rateChangedScores = [...seen.values()].sort((a, b) => scoreValue(b) - scoreValue(a));
  return { scores: rateChangedScores.slice(0, 50), scannedCount: dtScores.length + ncScores.length };
}

// GET /beatmaps/{beatmap}/scores is documented (osu.ppy.sh/docs) as taking
// only legacy_only/mode/mods/type — no `limit` is listed. The userscript
// "osu+" sends one anyway (up to 100) and it visibly changes how many
// scores come back, so the docs are just incomplete here (ppy's own
// disclaimer: "consider it a work-in-progress... will likely contain
// errors") rather than `limit` being a dead param — sending it is correct.
//
// `mods` has the same gap: there's no real mod acronym for "no mods", but
// osu+ sends the literal string "NM" as the mods[] value to filter for a
// nomod leaderboard, and that's what actually returns nomod scores — an
// empty mods[] or omitting the param entirely does not.
//
// There's no way to ask the server for "not Classic" (lazer) — CL is a
// real mod so "Classic" gets a genuine server-side filter attempt, but its
// absence isn't expressible as a mods[] value. So scoringVersion is never
// sent to the server; it's always re-checked client-side via
// scoreMatchesFilter regardless of whether the raw pool came from a
// server-filtered or unfiltered fetch — same fixed-size ceiling either
// way, this only changes which ~100 scores get checked. The one exception
// is "Lazer with no specific mods", which uses the sweep above instead of
// a single unfiltered fetch (see its own comment for why). "Rate Change"
// (rateChanged: true) is a similar exception — see fetchRateChangedScores.
async function fetchOfficialScores(clientId, clientSecret, beatmapId, mode, mods, scoringVersion, rateChanged) {
  if (!clientId || !clientSecret) {
    return { ok: false, error: 'missing-credentials' };
  }

  const token = await getOsuApiToken(clientId, clientSecret);
  const matches = (s) => scoreMatchesFilter(s, mods, scoringVersion);

  if (rateChanged) {
    const { scores, scannedCount } = await fetchRateChangedScores(token, beatmapId, mode, mods, scoringVersion);
    return { ok: true, scores, scannedCount, viaModsFilter: true, viaRateChangeSearch: true };
  }

  if (mods === null && scoringVersion === 'lazer') {
    const { scores, scannedCount } = await fetchLazerScoresViaSweep(token, beatmapId, mode);
    return { ok: true, scores, scannedCount, viaModsFilter: true, viaSweep: true };
  }

  if (mods !== null) {
    // Unconfirmed whether this needs supporter the way the website's own
    // UI does — the app-level token has no associated user/supporter
    // status, so it may just work (confirmed for DT and NM).
    const queryMods = mods.length === 0 ? ['NM'] : mods;
    const filtered = await osuApiGet(token, `/beatmaps/${beatmapId}/scores`, {
      mode,
      legacy_only: 0,
      type: 'global',
      limit: 100,
      mods: queryMods,
    });
    if (filtered.ok) {
      const data = await filtered.json();
      const scores = data.scores || [];
      return { ok: true, scores: scores.filter(matches), scannedCount: scores.length, viaModsFilter: true };
    }
  }

  // Either mods is null (nothing to filter server-side), or the
  // server-side attempt above was rejected — fall back to the unfiltered
  // leaderboard, filtered entirely client-side.
  const unfiltered = await osuApiGet(token, `/beatmaps/${beatmapId}/scores`, {
    mode,
    legacy_only: 0,
    type: 'global',
    limit: 100,
  });
  if (!unfiltered.ok) throw new Error(`osu! API responded ${unfiltered.status}`);
  const data = await unfiltered.json();
  const scores = data.scores || [];
  return { ok: true, scores: scores.filter(matches), scannedCount: scores.length, viaModsFilter: false };
}

// Player global-rank lookups for the leaderboard's optional rank badges
// (src/leaderboard-mod-filter.js's "showLeaderboardRank" toggle). Reuses the
// same OAuth client-credentials setup as the mod-filter feature above.
//
// GET /users (batch, not /users/{id}/{mode}) takes up to 50 ids[] in one
// request and its response already includes statistics_rulesets for every
// returned user with no separate include= flag needed — confirmed against
// the official API docs' "Get Users" Response Format table ("Includes
// country, cover, groups, and statistics_rulesets"). A beatmap leaderboard
// never has more than RESULT_LIMIT (50, see leaderboard-mod-filter.js)
// unique players, so this is one HTTP round trip for the whole page instead
// of one per player — the earlier per-user /users/{id}/{mode} version (still
// batched 16-at-a-time) took several sequential rounds to finish for a full
// leaderboard, which is what made this feel slow.
const USERS_BATCH_MAX = 50;

async function fetchUserRanks(clientId, clientSecret, userIds, mode) {
  if (!clientId || !clientSecret) {
    return { ok: false, error: 'missing-credentials' };
  }
  const token = await getOsuApiToken(clientId, clientSecret);
  const uniqueIds = [...new Set(userIds)];

  const chunks = [];
  for (let i = 0; i < uniqueIds.length; i += USERS_BATCH_MAX) {
    chunks.push(uniqueIds.slice(i, i + USERS_BATCH_MAX));
  }

  const ranks = {};
  await Promise.all(
    chunks.map(async (chunk) => {
      const res = await osuApiGet(token, '/users', { ids: chunk });
      if (!res.ok) return;
      const data = await res.json();
      (data.users || []).forEach((user) => {
        const stats = user.statistics_rulesets && user.statistics_rulesets[mode];
        ranks[user.id] = (stats && stats.global_rank) || null;
      });
    })
  );

  return { ok: true, ranks };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message && message.type === 'osu-enhancer:check-rosu-version') {
    checkRosuVersion().then(sendResponse);
    return true; // keep the message channel open for the async response
  }
  if (message && message.type === 'osu-enhancer:fetch-official-mod-scores') {
    const { clientId, clientSecret, beatmapId, mode, mods, scoringVersion, rateChanged } = message;
    fetchOfficialScores(clientId, clientSecret, beatmapId, mode, mods, scoringVersion, rateChanged)
      .then((result) => sendResponse(result.ok === false ? result : { ok: true, ...result }))
      .catch((err) => sendResponse({ ok: false, error: String((err && err.message) || err) }));
    return true;
  }
  if (message && message.type === 'osu-enhancer:fetch-user-ranks') {
    const { clientId, clientSecret, userIds, mode } = message;
    fetchUserRanks(clientId, clientSecret, userIds, mode)
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, error: String((err && err.message) || err) }));
    return true;
  }
  return undefined;
});
