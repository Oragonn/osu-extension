/**
 * Replaces osu's own mod-filter icon row (.beatmapset-scoreboard__mods,
 * next to the Global/Country/Friend Ranking tabs on a beatmap difficulty
 * page) with a small icon-only, multi-select button group: No Mod, HD,
 * DT/NC/Rate Change, HR, FL, NF, EZ, HT, Classic/Lazer. Renders up to 50 matching
 * scores as real rows inside the native .beatmap-scoreboard-table, in
 * place of whatever's normally there — not a separate custom panel.
 *
 * The native row is removed outright rather than left in place: it 422s
 * for non-supporters — confirmed live: POST .../scores?mods[]=DT returns
 * 422, while the plain .../scores?type=global request (top 50) returns
 * 200 — so it's dead weight for most users, and even for a supporter it's
 * "contains DT" (HDDT counts), not "DT and only DT".
 *
 * This uses the official osu! API v2 instead, the same way the userscript
 * "osu+" does: with the user's own OAuth app (client credentials grant —
 * app-level, no associated osu! account, so there's no "current user" for
 * a supporter check to key off — that appears to be why the mods filter
 * isn't rejected here the way it is on the website). That requires the
 * user to register a free app at
 * osu.ppy.sh/home/account/edit#new-oauth-application and paste the client
 * ID/secret into this extension's settings — see settings-panel.js.
 *
 * Non-obvious things learned from reading osu+'s own working
 * implementation, both handled in src/background.js:
 * - GET /beatmaps/{id}/scores's official docs don't mention a `limit`
 *   param at all, but osu+ sends one (up to 100) and it visibly changes
 *   the result count — the docs are just incomplete, not `limit` being
 *   fake, so it's worth sending.
 * - There's no real mod acronym for "no mods", but the API still accepts
 *   the literal string "NM" as a mods[] filter value and returns nomod
 *   scores for it — an empty/omitted mods[] does not. And "CL" (Classic
 *   scoring) rides along on most stable-scored plays independent of what
 *   real mods were used, so a genuinely mod-less classic play still shows
 *   up as mods:[CL] — that has to be ignored when matching DT/HD/etc., or
 *   a strict client-side comparison rejects scores the server already
 *   matched.
 *
 * Multiple mod buttons can be selected at once (e.g. HD+HR together), each
 * toggling independently, combined into one exact-match query — same as
 * osu's own native mod picker allows. Real incompatibilities are enforced
 * when toggling one on: EZ/HR can't coexist, and DT/NC (a speed-up) can't
 * coexist with HT (a speed-down) — selecting one clears the other.
 * Selecting "No Mod" clears every other real mod (and vice versa: picking
 * any real mod turns "No Mod" back off). DT and NC themselves share one
 * button that cycles between them rather than being separate toggles,
 * since they're two distinct, separately-submittable mods for the same
 * slot — confirmed live against the native mod list, they're never merged
 * into one icon there either, and a score can't be both at once. That same
 * button has a 3rd state after NC: "Rate Change", for DT/NC played at a
 * customized (non-default) speed — not a real mod/acronym of its own (see
 * buildRateChangeIcon and background.js's fetchRateChangedScores), so it's
 * searched by querying the DT and NC pools separately and keeping only the
 * scores that actually carry a customized mods[].settings.speed_change.
 *
 * "Classic"/"Lazer" is a separate axis from the real-mod combo above: it
 * filters on presence/absence of the CL mod alone, ignoring every other
 * mod — a classic-scored HR play still counts as "Classic" whether or not
 * HR is also selected. It cycles Classic → Lazer → off independently of
 * the mod buttons, and can be used standalone (no real mods selected) or
 * layered on top of a mod combo. CL is a genuine selectable mod, so
 * Classic gets a real server-side filter attempt; Lazer has no such
 * shortcut (there's no "not CL" mod), so it's always checked client-side
 * against whatever pool was fetched — see src/background.js for both.
 */
(function (global) {
  'use strict';

  const OsuEnhancer = (global.OsuEnhancer = global.OsuEnhancer || {});
  const sel = OsuEnhancer.selectors;

  const BTN_CLASS = 'osu-enhancer-mod-filter-btn';
  const BTN_ACTIVE_CLASS = 'osu-enhancer-mod-filter-btn--active';
  const GROUP_CLASS = 'osu-enhancer-mod-filter-group';
  const RESULT_LIMIT = 50;

  const MODE_NAMES = { osu: 'osu', taiko: 'taiko', fruits: 'fruits', mania: 'mania' };

  // osu's own per-mod color coding (confirmed live against the native mod
  // list: e.g. HD/HR/DT/NC render mod--type-DifficultyIncrease, CL renders
  // mod--type-Conversion) — used for both the button icons and each result
  // row's mods cell so they always match the site's own colors.
  const MOD_TYPES = {
    EZ: 'DifficultyReduction',
    NF: 'DifficultyReduction',
    HT: 'DifficultyReduction',
    DC: 'DifficultyReduction',
    HR: 'DifficultyIncrease',
    SD: 'DifficultyIncrease',
    PF: 'DifficultyIncrease',
    DT: 'DifficultyIncrease',
    NC: 'DifficultyIncrease',
    HD: 'DifficultyIncrease',
    FL: 'DifficultyIncrease',
    RX: 'Automation',
    AP: 'Automation',
    AT: 'Automation',
    SO: 'Automation',
    CN: 'Automation',
    CL: 'Conversion',
    RD: 'Conversion',
    MR: 'Conversion',
    DA: 'Conversion',
    TP: 'Conversion',
    NM: 'System',
  };

  const MOD_TITLES = {
    NM: 'No Mod',
    HD: 'Hidden',
    DT: 'Double Time',
    NC: 'Nightcore',
    HR: 'Hard Rock',
    FL: 'Flashlight',
    NF: 'No Fail',
    EZ: 'Easy',
    HT: 'Half Time',
    CL: 'Classic',
    RC: 'Rate Change',
  };

  // Real osu! mod-incompatibility rules — selecting the key clears every
  // mod listed against it. EZ/HR are opposite difficulty adjustments; DT
  // and NC alternate on the same button (see DTNC_ACRONYMS below) but both
  // conflict with HT the same way (can't speed up and slow down at once).
  const MOD_EXCLUDES = {
    EZ: ['HR'],
    HR: ['EZ'],
    DT: ['HT'],
    NC: ['HT'],
    HT: ['DT', 'NC'],
  };
  const DTNC_ACRONYMS = ['DT', 'NC'];

  // One entry per button. `real: true` buttons contribute to the
  // multi-select mods combo; the "cllazer" button is its own independent
  // axis (see file comment) and isn't part of that combo at all.
  const MOD_BUTTONS = [
    { id: 'nm', kind: 'nomod', icon: 'NM' },
    { id: 'hd', kind: 'real', acronym: 'HD' },
    { id: 'dtnc', kind: 'cycle', acronyms: DTNC_ACRONYMS },
    { id: 'hr', kind: 'real', acronym: 'HR' },
    { id: 'fl', kind: 'real', acronym: 'FL' },
    { id: 'nf', kind: 'real', acronym: 'NF' },
    { id: 'ez', kind: 'real', acronym: 'EZ' },
    { id: 'ht', kind: 'real', acronym: 'HT' },
  ];

  // `${beatmapId}:${mode}:${cache key}` -> Promise<result from background>
  // — avoid refetching (and re-spending osu! API rate limit) for a combo
  // already seen.
  const cache = new Map();

  function getCurrentBeatmapContext() {
    const match = location.hash.match(/^#(osu|taiko|fruits|mania)\/(\d+)/);
    if (!match) return null;
    return { beatmapId: Number(match[2]), mode: MODE_NAMES[match[1]] };
  }

  // mods: null (no real-mod constraint) | string[] (exact combo, [] = nomod)
  function fetchScores(beatmapId, mode, mods, scoringVersion, rateChanged) {
    const modsKey = mods === null ? 'any' : mods.length === 0 ? 'NM' : [...mods].sort().join('+');
    const key = `${beatmapId}:${mode}:${modsKey}:${scoringVersion || 'any'}:${rateChanged ? 'rc' : 'norc'}`;
    if (!cache.has(key)) {
      cache.set(
        key,
        OsuEnhancer.storage.getToggles().then(
          (toggles) =>
            new Promise((resolve) => {
              chrome.runtime.sendMessage(
                {
                  type: 'osu-enhancer:fetch-official-mod-scores',
                  clientId: toggles.osuApiClientId,
                  clientSecret: toggles.osuApiClientSecret,
                  beatmapId,
                  mode,
                  mods,
                  scoringVersion,
                  rateChanged,
                },
                resolve
              );
            })
        )
      );
    }
    return cache.get(key);
  }

  // ---------- Player rank badges ("showLeaderboardRank" toggle) ----------
  //
  // Appends "#N" (global rank for the current mode) next to every username
  // on the page — both osu-web's own native leaderboard rows/top card and
  // the ones this file reconstructs when a mod filter is active, since both
  // use the exact same .beatmap-scoreboard-table__user-link /
  // .beatmap-score-top__username classes (see buildScoreRow/
  // buildTopScoreCard above). The actual lookup (OAuth call, cache, badge
  // markup) lives in src/player-rank.js, shared with score-detail.js's own
  // player card.
  const USER_LINK_SELECTOR = '.beatmap-scoreboard-table__user-link, .beatmap-score-top__username';

  // .beatmap-score-top__user-box (the top card) is `display: grid`, one
  // implicit row per direct child — a badge inserted *after* the username
  // link as its own sibling lands in its own grid row underneath it instead
  // of beside it. .beatmap-scoreboard-table__user-link's cell is a flex
  // *row* instead, where an after-sibling naturally sits to the right, so
  // only the top card needs the different placement: appended *inside* the
  // (plain `display: block`, unconstrained-width) username link so it flows
  // right after the name as inline content of the same single grid cell,
  // rather than as a new grid item of its own.
  function insertRankBadge(link, rank) {
    const badge = OsuEnhancer.playerRank.buildBadge(rank);
    if (link.classList.contains('beatmap-score-top__username')) link.appendChild(badge);
    else link.insertAdjacentElement('afterend', badge);
  }

  async function injectRankBadges() {
    const toggles = await OsuEnhancer.storage.getToggles();
    if (!toggles.showLeaderboardRank) return;
    const ctx = getCurrentBeatmapContext();
    if (!ctx) return;

    // .beatmap-scoreboard-top (the top card) is NOT a descendant of
    // .beatmapset-scoreboard (confirmed against refreshResults above, which
    // already queries it separately via a bare sel.scoreboardTop rather
    // than scoping it under sel.scoreboard) — scoping this search to just
    // the scoreboard would silently never find the top card's username at
    // all. Searching the whole document is safe: this only runs once
    // getCurrentBeatmapContext() confirms we're on a beatmap page, and
    // neither selector is used anywhere else on it.
    if (!document.querySelector(sel.scoreboard) && !document.querySelector(sel.scoreboardTop)) return;

    const links = Array.from(document.querySelectorAll(USER_LINK_SELECTOR)).filter(
      (link) => !link.getAttribute(OsuEnhancer.playerRank.PROCESSED_ATTR)
    );
    if (!links.length) return;
    links.forEach((link) => link.setAttribute(OsuEnhancer.playerRank.PROCESSED_ATTR, '1'));

    const entries = links
      .map((link) => ({ link, userId: OsuEnhancer.playerRank.userIdFromLink(link) }))
      .filter((e) => e.userId);
    const ranks = await OsuEnhancer.playerRank.getRanks(
      entries.map((e) => e.userId),
      ctx.mode
    );

    entries.forEach(({ link, userId }) => {
      const rank = ranks.get(userId);
      if (rank != null) insertRankBadge(link, rank);
    });
  }

  // Normalizes an osu! API v2 score object (see
  // https://osu.ppy.sh/docs/index.html#score) into the flat fields
  // buildScoreRow needs.
  function normalizeScore(apiScore, position) {
    const stats = apiScore.statistics || {};
    return {
      position,
      scoreId: apiScore.id,
      rank: apiScore.rank,
      score: apiScore.total_score ?? apiScore.legacy_total_score ?? apiScore.score ?? 0,
      accuracy: (apiScore.accuracy * 100).toFixed(2),
      country: apiScore.user && apiScore.user.country_code,
      userId: apiScore.user_id,
      userName: apiScore.user && apiScore.user.username,
      avatarUrl: apiScore.user && apiScore.user.avatar_url,
      maxCombo: apiScore.max_combo,
      perfect: !!apiScore.is_perfect_combo,
      count300: stats.great || 0,
      count100: stats.ok || 0,
      count50: stats.meh || 0,
      countMiss: stats.miss || 0,
      // Genuinely null (not 0) for most real lazer-scored plays right now
      // — confirmed live against osu!'s own scoreboard JSON: scores with no
      // legacy_score_id (true lazer, not a converted/classic play) come
      // back with pp: null, while every classic-scored (CL-carrying) score
      // on the same map has a real value. That's the server not having
      // computed pp for lazer scoring yet, not something this extension
      // can fill in — kept as null here (see buildPpSpan) instead of
      // coercing to 0, which would misrepresent "not awarded" as "scored
      // zero pp".
      ppValue: apiScore.pp,
      playDateIso: apiScore.ended_at,
      // Kept as the raw {acronym, settings} objects (not just acronym
      // strings) — a customized rate (DT/NC/HT played at something other
      // than its default speed) rides along as settings.speed_change, and
      // there's no separate "Rate Change" mod/acronym to detect: it's
      // still plain DT/NC/HT, just with settings present. buildNativeModIcon
      // reads that to render the same rate badge + "customised" cog osu's
      // own site shows — confirmed live against real scores (most DT/NC
      // have settings: null and render as a plain icon; only the ones
      // actually played at a non-default rate have settings.speed_change).
      mods: apiScore.mods || [],
    };
  }

  function countryFlagUrl(countryCode) {
    if (!countryCode || countryCode.length !== 2) return null;
    const codepoints = countryCode
      .toUpperCase()
      .split('')
      .map((c) => (0x1f1e6 + c.charCodeAt(0) - 65).toString(16));
    return `/assets/images/flags/${codepoints.join('-')}.svg`;
  }

  function formatRelativeTime(isoDateStr) {
    const then = new Date(isoDateStr).getTime();
    const diffSec = Math.max(0, (Date.now() - then) / 1000);
    const units = [
      ['y', 31536000],
      ['mo', 2592000],
      ['d', 86400],
      ['h', 3600],
      ['min', 60],
    ];
    for (const [label, secs] of units) {
      if (diffSec >= secs) return `${Math.floor(diffSec / secs)}${label}`;
    }
    return 'now';
  }

  // Matches osu's own row/card markup for a null pp value (see
  // normalizeScore) — a dash with an explanatory tooltip, instead of
  // rounding null down to a misleading "0".
  function buildPpSpan(ppValue) {
    const span = document.createElement('span');
    span.className = 'pp-value';
    if (ppValue === null || ppValue === undefined) {
      span.title = 'pp is not awarded for this score';
      span.textContent = '-';
    } else {
      span.title = String(ppValue);
      span.textContent = String(Math.round(ppValue));
    }
    return span;
  }

  function cellSpan(extraClass, content) {
    const cell = document.createElement('td');
    cell.className = 'beatmap-scoreboard-table__cell';
    const span = document.createElement('span');
    span.className = `beatmap-scoreboard-table__cell-content${extraClass ? ` ${extraClass}` : ''}`;
    if (typeof content === 'string') span.textContent = content;
    else if (content) span.appendChild(content);
    cell.appendChild(span);
    return cell;
  }

  // A native-styled mod icon: same markup/classes osu's own leaderboard
  // rows and mod-filter row use, so it renders with the site's own sprite
  // and color — no image assets of our own needed.
  //
  // `forButton` centers it via inline style rather than the CSS class
  // (.osu-enhancer-mod-filter-btn .mod {...} in theme.css) — that class
  // tested as pixel-exact in isolation, but the vendored dark theme
  // (styles/izuki-theme.css, ~36k lines, only loaded when the dark toggle
  // is on) very plausibly redefines .mod/.mod__icon somewhere in there
  // too, and whichever rule loads later wins the tie. An inline style set
  // right here always wins regardless of load order or specificity, no
  // need to go hunting through 36k lines to find the conflict.
  //
  // `settings` (a score's real mods[].settings, only meaningful for row/
  // top-card icons — button icons never pass this) is how "Rate Change"
  // shows up: DT/NC/HT aren't ever a distinct "RC" mod, there's no fixed
  // icon to match against — a customized rate is still plain DT/NC/HT,
  // just with settings.speed_change set to something other than default,
  // and osu's own site can't pick one of a fixed set of icons for it
  // either, since the rate is a free numeric value (confirmed live: most
  // DT/NC scores have settings: null and render as a bare icon; only the
  // ones actually played at a non-default rate carry speed_change, and
  // that's what triggers the "×"-badge + cog indicator below — same
  // condition osu's own leaderboard uses).
  function buildCustomisedIndicator() {
    const el = document.createElement('div');
    el.className = 'mod__customised-indicator';
    el.innerHTML =
      '<svg height="100%" viewBox="0 0 32 16" width="100%"><use href="/assets/images/mod-cog-badge.e2ff6737.svg#icon"></use></svg>';
    return el;
  }

  function buildNativeModIcon(acronym, title, forButton, settings) {
    const wrap = document.createElement('div');
    wrap.className = `mod mod--type-${MOD_TYPES[acronym] || 'DifficultyIncrease'}`;
    const rate = settings && typeof settings.speed_change === 'number' ? settings.speed_change : null;
    const rateLabel = rate !== null ? `${rate.toFixed(2)}×` : null;
    wrap.title = rateLabel ? `${title || acronym} (${rateLabel})` : title || acronym;
    if (forButton) {
      wrap.style.cssText = '--mod-height: 26px; position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);';
    }
    const icon = document.createElement('div');
    icon.className = `mod__icon mod__icon--${acronym}`;
    icon.dataset.acronym = acronym;
    wrap.appendChild(icon);
    if (rateLabel) {
      const extender = document.createElement('div');
      extender.className = 'mod__extender';
      const rateSpan = document.createElement('span');
      rateSpan.textContent = rateLabel;
      extender.appendChild(rateSpan);
      wrap.appendChild(extender);
      wrap.appendChild(buildCustomisedIndicator());
    }
    return wrap;
  }

  // No native "Lazer" mod/icon exists (lazer is the absence of Classic,
  // not a mod of its own) — reuses the Classic sprite with a strike
  // through it, the same "crossed out" visual language osu's own No Mod
  // icon already uses for "none of these".
  function buildLazerIcon(forButton) {
    const wrap = buildNativeModIcon('CL', 'Lazer (no Classic mod)', forButton);
    wrap.classList.add('osu-enhancer-lazer-icon');
    const strike = document.createElement('div');
    strike.className = 'osu-enhancer-lazer-icon__strike';
    wrap.appendChild(strike);
    return wrap;
  }

  // osu's own mod icons are two flat-color layers stacked on top of each
  // other (confirmed live via computed styles: a "plate" shape filled with
  // --type-bg-colour, and a glyph shape filled with --type-fg-colour on
  // top) — normally wired up as ::before/::after masks by osu's own CSS,
  // keyed to a real acronym class like .mod__icon--DT. There's no such
  // rule for a fake "RC" acronym, so this reimplements the same two-layer
  // idea by hand as two real, inline-masked child divs instead: the exact
  // same plate shape every other mod icon uses (so this button's
  // background matches its siblings pixel-for-pixel, not a smaller/
  // differently-shaped stand-in), with just the cog glyph — no circle of
  // its own, since the plate layer already provides one — masked on top.
  const RC_PLATE_MASK_URL = '/assets/images/mod-icon.dacd6669.svg';
  const RC_GEAR_MASK_URL =
    'data:image/svg+xml,' +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="21.5996 1.59961 8 8">' +
        '<path fill="white" d="M27.7676 6.15915L27.3683 5.92852C27.4086 5.71102 27.4086 5.4879 27.3683 5.2704L27.7676 5.03977C27.8136 5.01352 27.8342 4.95915 27.8192 4.90852C27.7151 4.57477 27.5379 4.2729 27.3064 4.02165C27.2708 3.98321 27.2126 3.97384 27.1676 4.00009L26.7683 4.23071C26.6004 4.08634 26.4073 3.97477 26.1983 3.90165V3.44134C26.1983 3.38884 26.1617 3.3429 26.1101 3.33165C25.7661 3.25477 25.4136 3.25852 25.0864 3.33165C25.0348 3.3429 24.9983 3.38884 24.9983 3.44134V3.90259C24.7901 3.97665 24.597 4.08821 24.4283 4.23165L24.0298 4.00102C23.9839 3.97477 23.9267 3.98321 23.8911 4.02259C23.6595 4.2729 23.4823 4.57477 23.3783 4.90946C23.3623 4.96009 23.3839 5.01446 23.4298 5.04071L23.8292 5.27134C23.7889 5.48884 23.7889 5.71196 23.8292 5.92946L23.4298 6.16009C23.3839 6.18634 23.3633 6.24071 23.3783 6.29134C23.4823 6.62509 23.6595 6.92696 23.8911 7.17821C23.9267 7.21665 23.9848 7.22603 24.0298 7.19978L24.4292 6.96915C24.597 7.11353 24.7901 7.22509 24.9992 7.29821V7.75946C24.9992 7.81196 25.0358 7.8579 25.0873 7.86915C25.4314 7.94603 25.7839 7.94228 26.1111 7.86915C26.1626 7.8579 26.1992 7.81196 26.1992 7.75946V7.29821C26.4073 7.22415 26.6004 7.11259 26.7692 6.96915L27.1686 7.19978C27.2145 7.22603 27.2717 7.21759 27.3073 7.17821C27.5389 6.9279 27.7161 6.62602 27.8201 6.29134C27.8342 6.23977 27.8136 6.1854 27.7676 6.15915ZM25.5983 6.34946C25.1848 6.34946 24.8483 6.0129 24.8483 5.59946C24.8483 5.18602 25.1848 4.84946 25.5983 4.84946C26.0117 4.84946 26.3483 5.18602 26.3483 5.59946C26.3483 6.0129 26.0117 6.34946 25.5983 6.34946Z"/>' +
      '</svg>'
    );

  // No native "Rate Change" mod/icon exists — a customized rate is always
  // specifically DT or NC underneath (see buildNativeModIcon's `settings`
  // doc), so this button's own icon deliberately doesn't reuse the DT/NC
  // sprite at all — it never looks like a 3rd variant of those two icons,
  // just a mod icon in its own right showing a plain gear.
  function buildRateChangeIcon(forButton) {
    const wrap = document.createElement('div');
    wrap.className = 'mod mod--type-DifficultyIncrease';
    wrap.title = MOD_TITLES.RC;
    if (forButton) {
      wrap.style.cssText = '--mod-height: 26px; position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);';
    }
    // 1.42em × 1em, not a square — matches real .mod__icon's own proportions
    // (confirmed live: 36.9px × 26px at --mod-height: 26px, i.e. width:height
    // ~= 1.42:1). Using 1.42em for both dimensions here made this box taller
    // than the .mod wrapper actually is, which overflowed it and threw the
    // translate(-50%, -50%) centering off by ~half that extra height.
    const box = document.createElement('div');
    box.className = 'osu-enhancer-rate-change-icon';
    box.style.cssText = 'position: relative; width: 1.42em; height: 1em;';
    const layerStyle =
      'position: absolute; inset: 0; mask-repeat: no-repeat; mask-position: center; mask-size: contain;' +
      '-webkit-mask-repeat: no-repeat; -webkit-mask-position: center; -webkit-mask-size: contain;';
    const plate = document.createElement('div');
    plate.style.cssText = `${layerStyle} background-color: var(--type-bg-colour); mask-image: url("${RC_PLATE_MASK_URL}"); -webkit-mask-image: url("${RC_PLATE_MASK_URL}");`;
    const glyph = document.createElement('div');
    glyph.style.cssText = `${layerStyle} background-color: var(--type-fg-colour); mask-image: url("${RC_GEAR_MASK_URL}"); -webkit-mask-image: url("${RC_GEAR_MASK_URL}");`;
    box.appendChild(plate);
    box.appendChild(glyph);
    wrap.appendChild(box);
    return wrap;
  }

  function buildModsCell(mods) {
    const cell = document.createElement('td');
    cell.className = 'beatmap-scoreboard-table__cell beatmap-scoreboard-table__cell--player u-relative';
    const wrap = document.createElement('div');
    wrap.className = 'beatmap-scoreboard-table__mods';
    const modsDiv = document.createElement('div');
    modsDiv.className = 'mods';
    mods.forEach((m) => {
      modsDiv.appendChild(buildNativeModIcon(m.acronym, MOD_TITLES[m.acronym], false, m.settings));
    });
    wrap.appendChild(modsDiv);
    cell.appendChild(wrap);
    return cell;
  }

  function buildScoreRow(score) {
    const tr = document.createElement('tr');
    tr.className = 'beatmap-scoreboard-table__body-row beatmap-scoreboard-table__body-row--highlightable';

    tr.appendChild(cellSpan('beatmap-scoreboard-table__cell-content--rank', `#${score.position}`));

    const gradeDiv = document.createElement('div');
    gradeDiv.className = `score-rank score-rank--tiny score-rank--${score.rank}`;
    tr.appendChild(cellSpan('beatmap-scoreboard-table__cell-content--grade', gradeDiv));

    tr.appendChild(cellSpan('beatmap-scoreboard-table__cell-content--score', score.score.toLocaleString()));
    tr.appendChild(cellSpan(null, `${score.accuracy}%`));

    const flagSpan = document.createElement('span');
    flagSpan.className = 'flag-country flag-country--flat';
    const flagUrl = countryFlagUrl(score.country);
    if (flagUrl) {
      flagSpan.style.backgroundImage = `url("${flagUrl}")`;
      flagSpan.title = score.country;
    }
    tr.appendChild(cellSpan(null, flagSpan));

    const playerCell = document.createElement('td');
    playerCell.className = 'beatmap-scoreboard-table__cell beatmap-scoreboard-table__cell--player';
    const userLink = document.createElement('a');
    userLink.className = 'beatmap-scoreboard-table__user-link';
    userLink.href = `https://osu.ppy.sh/users/${score.userId}/osu`;
    userLink.target = '_blank';
    userLink.rel = 'noopener noreferrer';
    userLink.textContent = score.userName || `#${score.userId}`;
    playerCell.appendChild(userLink);
    tr.appendChild(playerCell);

    tr.appendChild(
      cellSpan(
        score.perfect ? 'beatmap-scoreboard-table__cell-content--perfect' : null,
        `${score.maxCombo.toLocaleString()}x`
      )
    );

    tr.appendChild(cellSpan('beatmap-scoreboard-table__cell-content--hit-great', String(score.count300)));
    tr.appendChild(cellSpan('beatmap-scoreboard-table__cell-content--hit-ok', String(score.count100)));
    tr.appendChild(
      cellSpan(
        `beatmap-scoreboard-table__cell-content--hit-meh${score.count50 === 0 ? ' beatmap-scoreboard-table__cell-content--zero' : ''}`,
        String(score.count50)
      )
    );
    tr.appendChild(
      cellSpan(
        `beatmap-scoreboard-table__cell-content--hit-miss${score.countMiss === 0 ? ' beatmap-scoreboard-table__cell-content--zero' : ''}`,
        String(score.countMiss)
      )
    );

    tr.appendChild(cellSpan(null, buildPpSpan(score.ppValue)));

    tr.appendChild(
      cellSpan('beatmap-scoreboard-table__cell-content--time', formatRelativeTime(score.playDateIso))
    );

    tr.appendChild(buildModsCell(score.mods));

    const menuCell = document.createElement('td');
    menuCell.className = 'beatmap-scoreboard-table__popup-menu';
    tr.appendChild(menuCell);

    return tr;
  }

  // Rebuilds osu's own "top score" card (.beatmap-score-top, shown above
  // the paginated table — normally the #1 global score, plus your own
  // score if it isn't already that one) using the same classes/markup the
  // site renders itself, so every existing style (both theme.css and the
  // vendored dark theme) applies with no new CSS needed. Used to show the
  // #1 score *for the currently selected mod filter* instead of just
  // hiding this card while a filter is active.
  function buildTopScoreCard(score, mode) {
    const card = document.createElement('div');
    card.className = 'beatmap-score-top';

    if (score.scoreId) {
      const link = document.createElement('a');
      link.className = 'beatmap-score-top__link-container';
      link.href = `https://osu.ppy.sh/scores/${score.scoreId}`;
      card.appendChild(link);
    }

    const section = document.createElement('div');
    section.className = 'beatmap-score-top__section';
    card.appendChild(section);

    const left = document.createElement('div');
    left.className = 'beatmap-score-top__wrapping-container beatmap-score-top__wrapping-container--left';
    section.appendChild(left);

    const positionWrap = document.createElement('div');
    positionWrap.className = 'beatmap-score-top__position';
    const positionNumber = document.createElement('div');
    positionNumber.className = 'beatmap-score-top__position-number';
    positionNumber.textContent = `#${score.position}`;
    positionWrap.appendChild(positionNumber);
    const gradeDiv = document.createElement('div');
    gradeDiv.className = `score-rank score-rank--tiny score-rank--${score.rank}`;
    positionWrap.appendChild(gradeDiv);
    left.appendChild(positionWrap);

    const avatarWrap = document.createElement('div');
    avatarWrap.className = 'beatmap-score-top__avatar';
    const avatarLink = document.createElement('a');
    avatarLink.className = 'u-hover';
    avatarLink.href = `https://osu.ppy.sh/users/${score.userId}/osu`;
    const avatarSpan = document.createElement('span');
    avatarSpan.className = 'avatar avatar--guest';
    if (score.avatarUrl) avatarSpan.style.backgroundImage = `url("${score.avatarUrl}")`;
    avatarLink.appendChild(avatarSpan);
    avatarWrap.appendChild(avatarLink);
    left.appendChild(avatarWrap);

    const userBox = document.createElement('div');
    userBox.className = 'beatmap-score-top__user-box';
    const userLink = document.createElement('a');
    userLink.className = 'js-usercard beatmap-score-top__username u-hover';
    userLink.dataset.userId = String(score.userId);
    userLink.href = `https://osu.ppy.sh/users/${score.userId}/osu`;
    userLink.textContent = score.userName || `#${score.userId}`;
    userBox.appendChild(userLink);

    const achieved = document.createElement('div');
    achieved.className = 'beatmap-score-top__achieved u-hover';
    achieved.appendChild(document.createTextNode('achieved '));
    const achievedTime = document.createElement('time');
    achievedTime.className = 'js-timeago';
    achievedTime.dateTime = score.playDateIso;
    achievedTime.title = score.playDateIso;
    achievedTime.textContent = `${formatRelativeTime(score.playDateIso)} ago`;
    achieved.appendChild(achievedTime);
    userBox.appendChild(achieved);

    if (score.country) {
      const flagsWrap = document.createElement('div');
      flagsWrap.className = 'beatmap-score-top__flags';
      const flagLink = document.createElement('a');
      flagLink.className = 'u-hover';
      flagLink.href = `https://osu.ppy.sh/rankings/${mode}/performance?country=${score.country}`;
      const flagSpan = document.createElement('span');
      flagSpan.className = 'flag-country flag-country--flat';
      const flagUrl = countryFlagUrl(score.country);
      if (flagUrl) flagSpan.style.backgroundImage = `url("${flagUrl}")`;
      flagSpan.title = score.country;
      flagLink.appendChild(flagSpan);
      flagsWrap.appendChild(flagLink);
      userBox.appendChild(flagsWrap);
    }
    left.appendChild(userBox);

    const right = document.createElement('div');
    right.className = 'beatmap-score-top__wrapping-container beatmap-score-top__wrapping-container--right';
    section.appendChild(right);

    function statGroup(className) {
      const group = document.createElement('div');
      group.className = className ? `beatmap-score-top__stats ${className}` : 'beatmap-score-top__stats';
      right.appendChild(group);
      return group;
    }

    function stat(group, label, value, headerClass, valueClass) {
      const wrap = document.createElement('div');
      wrap.className = 'beatmap-score-top__stat';
      const header = document.createElement('div');
      header.className = `beatmap-score-top__stat-header${headerClass ? ` ${headerClass}` : ''}`;
      header.textContent = label;
      wrap.appendChild(header);
      const valueEl = document.createElement('div');
      valueEl.className = `beatmap-score-top__stat-value${valueClass ? ` ${valueClass}` : ''}`;
      if (typeof value === 'string') valueEl.textContent = value;
      else valueEl.appendChild(value);
      wrap.appendChild(valueEl);
      group.appendChild(wrap);
      return wrap;
    }

    stat(
      statGroup(null),
      'Total Score',
      score.score.toLocaleString(),
      'beatmap-score-top__stat-header--wider',
      'beatmap-score-top__stat-value--score'
    );

    const accComboGroup = statGroup(null);
    stat(accComboGroup, 'Accuracy', `${score.accuracy}%`, 'beatmap-score-top__stat-header--wider', null);
    stat(
      accComboGroup,
      'Max Combo',
      `${score.maxCombo.toLocaleString()}x`,
      'beatmap-score-top__stat-header--wider',
      score.perfect ? 'beatmap-score-top__stat-value--perfect' : null
    );

    const detailGroup = statGroup('beatmap-score-top__stats--wrappable');
    stat(detailGroup, 'great', String(score.count300), 'beatmap-score-top__stat-header--hit-great', 'beatmap-score-top__stat-value--smaller beatmap-score-top__stat-value--hit-great');
    stat(detailGroup, 'ok', String(score.count100), 'beatmap-score-top__stat-header--hit-ok', 'beatmap-score-top__stat-value--smaller beatmap-score-top__stat-value--hit-ok');
    stat(detailGroup, 'meh', String(score.count50), 'beatmap-score-top__stat-header--hit-meh', 'beatmap-score-top__stat-value--smaller beatmap-score-top__stat-value--hit-meh');
    stat(detailGroup, 'Miss', String(score.countMiss), 'beatmap-score-top__stat-header--hit-miss', 'beatmap-score-top__stat-value--smaller beatmap-score-top__stat-value--hit-miss');

    stat(detailGroup, 'pp', buildPpSpan(score.ppValue), null, 'beatmap-score-top__stat-value--smaller u-hover');

    const timeEl = document.createElement('time');
    timeEl.className = 'js-tooltip-time';
    timeEl.title = score.playDateIso;
    timeEl.textContent = formatRelativeTime(score.playDateIso);
    stat(detailGroup, 'Time', timeEl, null, 'beatmap-score-top__stat-value--smaller u-hover');

    const modsWrap = document.createElement('div');
    modsWrap.className = 'mods';
    score.mods.forEach((m) => {
      modsWrap.appendChild(buildNativeModIcon(m.acronym, MOD_TITLES[m.acronym], false, m.settings));
    });
    stat(detailGroup, 'Mods', modsWrap, 'beatmap-score-top__stat-header--mods', 'beatmap-score-top__stat-value--mods u-hover');

    return card;
  }

  function buildMessageRow(text) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 15;
    td.className = 'osu-enhancer-mod-filter-message-cell';
    td.textContent = text;
    tr.appendChild(td);
    return tr;
  }

  function buildCredentialsMessageRow() {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 15;
    td.className = 'osu-enhancer-mod-filter-message-cell';
    td.textContent = 'Add an osu! API client ID/secret in the extension settings (gear icon in the nav bar) to use this — ';
    const link = document.createElement('a');
    link.href = 'https://osu.ppy.sh/home/account/edit#new-oauth-application';
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'register a free app here';
    link.className = 'osu-enhancer-mod-filter-message-cell__link';
    td.appendChild(link);
    td.appendChild(document.createTextNode('.'));
    tr.appendChild(td);
    return tr;
  }

  function describeFilter(mods, scoringVersion, rateChanged) {
    let modsLabel = null;
    if (rateChanged) {
      modsLabel = [...(mods || []), 'Rate Change'].join('+');
    } else if (mods !== null) {
      modsLabel = mods.length === 0 ? 'No Mod' : mods.join('+');
    }
    const scoringLabel = scoringVersion === 'classic' ? 'Classic' : scoringVersion === 'lazer' ? 'Lazer' : null;
    return [modsLabel, scoringLabel].filter(Boolean).join(', ') || 'any';
  }

  function renderResults(tbody, state, mods, scoringVersion, rateChanged) {
    tbody.textContent = '';
    const label = describeFilter(mods, scoringVersion, rateChanged);

    if (state === 'loading') {
      tbody.appendChild(buildMessageRow(`Looking up ${label} scores via the osu! API…`));
      return;
    }
    if (!state.ok) {
      if (state.error === 'missing-credentials') {
        tbody.appendChild(buildCredentialsMessageRow());
      } else {
        tbody.appendChild(buildMessageRow(`Couldn't reach the osu! API (${state.error}).`));
      }
      return;
    }

    const matched = state.scores.slice(0, RESULT_LIMIT).map((s, i) => normalizeScore(s, i + 1));
    // osu!'s /beatmaps/{id}/scores endpoint returns a fixed-size leaderboard
    // per request (limit=100 is the highest osu+ was seen requesting), so
    // scannedCount is the entire pool this lookup had to search, not a
    // partial page — a count under 50 here means that's genuinely every
    // matching score found, not scores this extension failed to fetch.
    let ceilingNote;
    if (state.viaRateChangeSearch) {
      // Rate Change isn't a real mods[] value (see fetchRateChangedScores
      // in background.js) — this searched the DT and NC pools separately
      // and kept only the scores actually played at a non-default rate,
      // so scannedCount is DT scores + NC scores checked, not one pool.
      ceilingNote = ` (checked ${state.scannedCount} DT/NC scores for a customized rate, sorted by score)`;
    } else if (state.viaSweep) {
      // "Lazer" with no specific mods selected: there's no server-side
      // "not Classic" filter, so instead of one ~100-score pool this swept
      // several common mod combinations (each its own pool) and merged the
      // unique lazer-scored results — scannedCount is the total unique
      // scores checked across all of them.
      ceilingNote = ` (checked ${state.scannedCount} unique scores across several common mod combinations, sorted by score)`;
    } else if (state.viaModsFilter) {
      ceilingNote = ` (of ${state.scannedCount} scores osu!'s own leaderboard for this filter returns — that's a fixed-size list, not a partial fetch)`;
    } else {
      ceilingNote = ` (checked the ${state.scannedCount} scores osu!'s own leaderboard returns — no server-side shortcut existed for this filter, so it's whatever fraction of that fixed pool matches)`;
    }

    if (!matched.length) {
      tbody.appendChild(buildMessageRow(`No ${label} scores found${ceilingNote}.`));
      return;
    }

    tbody.appendChild(
      buildMessageRow(`${matched.length} ${label} score${matched.length === 1 ? '' : 's'}${ceilingNote}.`)
    );
    matched.forEach((score) => tbody.appendChild(buildScoreRow(score)));
  }

  // .beatmap-scoreboard-top can hold up to two cards: the #1 global score
  // (always) and, separately, your own score if it isn't already that one
  // — recognizable by its "Pin" button (.btn-osu-big, see theme.css), which
  // no other card has. That one is never touched by the mod filter: it's
  // your own persistent reference regardless of what filter is applied, so
  // only the #1-global card gets swapped for the filtered #1.
  function isOwnTopCard(card) {
    return !!card.querySelector('.btn-osu-big');
  }

  // Swaps the #1-global card above the table for one showing the #1 score
  // matching the active mod filter — same idea as renderResults, but for
  // that card instead of the table body (your own score card, if any, is
  // left alone — see isOwnTopCard). Only swaps once a valid replacement is
  // ready — while loading, erroring, or matching nothing, whatever card is
  // already showing (native, or the last successful filter's card) is
  // left alone rather than being cleared out to nothing.
  function renderTopScore(topContainer, state, mode) {
    if (!topContainer) return;
    if (state === 'loading' || !state.ok || !state.scores.length) return;
    const top = normalizeScore(state.scores[0], 1);
    const newCard = buildTopScoreCard(top, mode);
    const ownCard = Array.from(topContainer.children).find(isOwnTopCard) || null;
    Array.from(topContainer.children).forEach((child) => {
      if (child !== ownCard) child.remove();
    });
    topContainer.insertBefore(newCard, ownCard);
  }

  function injectButtons() {
    const tabs = document.querySelector(sel.scoreboardPageTabs);
    if (!tabs || document.querySelector(`.${GROUP_CLASS}`)) return;

    // Supporter-gated and non-functional for most users (see file
    // comment) — our own group below replaces it, in the same spot.
    const nativeMods = document.querySelector(`${sel.scoreboard} ${sel.scoreboardNativeMods}`);
    if (nativeMods) nativeMods.remove();

    const group = document.createElement('div');
    group.className = GROUP_CLASS;

    // Real-mod combo state: null = nothing selected at all (inactive
    // unless scoringVersion is set); Set<acronym> once at least one real
    // mod button (including "No Mod", which selects the empty set) is on.
    let selectedMods = null;
    let dtNcState = null; // null | 'DT' | 'NC' | 'RC' — which state that button is showing
    let scoringVersion = null; // null | 'classic' | 'lazer'
    let savedBody = null;
    let savedTopCards = null; // Node[] | null — the *original* live
    // "other" (non-own, see isOwnTopCard) top-score card node(s), not
    // clones, so restoring them keeps whatever behavior osu's own JS
    // wired up (live-updating "achieved x ago" text, hover usercard
    // popups, country-flag tooltips) instead of a dead reparsed copy. Your
    // own score card (if present) is never saved/touched here at all.
    const buttonEls = {};

    function isActive() {
      // "Rate Change" doesn't add anything to selectedMods (there's no
      // fixed acronym for it — see toggleDtNc), so it needs its own check
      // here or picking it with nothing else selected would look inactive.
      return selectedMods !== null || scoringVersion !== null || dtNcState === 'RC';
    }

    function updateButtonVisuals() {
      MOD_BUTTONS.forEach((def) => {
        const btn = buttonEls[def.id];
        let on;
        let title;
        let iconEl;
        if (def.kind === 'nomod') {
          on = selectedMods !== null && selectedMods.size === 0;
          title = MOD_TITLES.NM;
          iconEl = buildNativeModIcon('NM', title, true);
        } else if (def.kind === 'cycle') {
          on = dtNcState !== null;
          if (dtNcState === 'RC') {
            title = MOD_TITLES.RC;
            iconEl = buildRateChangeIcon(true);
          } else {
            const icon = dtNcState || def.acronyms[0];
            title = MOD_TITLES[icon];
            iconEl = buildNativeModIcon(icon, title, true);
          }
        } else {
          on = selectedMods !== null && selectedMods.has(def.acronym);
          title = MOD_TITLES[def.acronym];
          iconEl = buildNativeModIcon(def.acronym, title, true);
        }
        btn.classList.toggle(BTN_ACTIVE_CLASS, on);
        btn.textContent = '';
        btn.appendChild(iconEl);
        btn.setAttribute('aria-label', title);
      });

      const clBtn = buttonEls.cllazer;
      clBtn.classList.toggle(BTN_ACTIVE_CLASS, scoringVersion !== null);
      clBtn.textContent = '';
      clBtn.appendChild(
        scoringVersion === 'lazer' ? buildLazerIcon(true) : buildNativeModIcon('CL', 'Classic', true)
      );
      clBtn.setAttribute('aria-label', scoringVersion === 'lazer' ? 'Lazer' : 'Classic');
    }

    async function refreshResults() {
      const tbody = document.querySelector(`${sel.scoreboard} .beatmap-scoreboard-table__body`);
      const topContainer = document.querySelector(sel.scoreboardTop);
      if (!tbody) return;

      if (!isActive()) {
        if (savedBody) {
          tbody.replaceWith(savedBody);
          savedBody = null;
        }
        if (savedTopCards && topContainer) {
          const ownCard = Array.from(topContainer.children).find(isOwnTopCard) || null;
          Array.from(topContainer.children).forEach((child) => {
            if (child !== ownCard) child.remove();
          });
          savedTopCards.forEach((node) => topContainer.insertBefore(node, ownCard));
          savedTopCards = null;
        }
        return;
      }

      if (!savedBody) {
        savedBody = tbody.cloneNode(true);
        if (topContainer) {
          savedTopCards = Array.from(topContainer.children).filter((c) => !isOwnTopCard(c));
        }
      }

      const ctx = getCurrentBeatmapContext();
      if (!ctx) return;

      const mods = selectedMods === null ? null : [...selectedMods];
      const rateChanged = dtNcState === 'RC';
      const requestKey = `${mods === null ? 'null' : mods.sort().join('+')}:${scoringVersion}:${rateChanged}`;
      renderResults(tbody, 'loading', mods, scoringVersion, rateChanged);
      renderTopScore(topContainer, 'loading', ctx.mode);
      const result = await fetchScores(ctx.beatmapId, ctx.mode, mods, scoringVersion, rateChanged);
      // The selection may have changed again while this fetch was in
      // flight — don't clobber it with a stale result.
      const currentMods = selectedMods === null ? null : [...selectedMods];
      const currentKey = `${currentMods === null ? 'null' : currentMods.sort().join('+')}:${scoringVersion}:${dtNcState === 'RC'}`;
      if (currentKey === requestKey) {
        renderResults(tbody, result, mods, scoringVersion, rateChanged);
        renderTopScore(topContainer, result, ctx.mode);
        // Rank badges normally get (re-)applied by content.js's generic
        // rescan (MutationObserver + its fixed 1.5s/4s/7s retries after a
        // click) picking up the DOM change this render just made. That's
        // fine for a fast, single-pool lookup, but the "Lazer" sweep above
        // (fetchScores -> background.js's fetchLazerScoresViaSweep, up to
        // 96 requests) can easily run past all of those fixed retries with
        // nothing left to prompt a further one — the real rows would then
        // sit unbadged until some *unrelated* later mutation happened to
        // trigger a rescan. Calling this directly, right as the real rows
        // land, makes badging depend on this fetch actually finishing
        // rather than on how long it happened to take relative to those
        // fixed delays.
        injectRankBadges();
      }
    }

    function applyExclusions(acronym) {
      (MOD_EXCLUDES[acronym] || []).forEach((excluded) => {
        selectedMods.delete(excluded);
        if (DTNC_ACRONYMS.includes(excluded)) dtNcState = null;
      });
    }

    function toggleRealMod(acronym) {
      if (selectedMods === null) selectedMods = new Set();
      if (selectedMods.has(acronym)) {
        selectedMods.delete(acronym);
      } else {
        selectedMods.add(acronym);
        applyExclusions(acronym);
      }
      if (selectedMods.size === 0) selectedMods = null; // nothing left selected via real mods
    }

    function toggleNoMod() {
      if (selectedMods !== null && selectedMods.size === 0) {
        selectedMods = null; // was showing No Mod — turn off
      } else {
        selectedMods = new Set(); // (re)select No Mod, clearing any real mods
        dtNcState = null;
      }
    }

    // Steps `current` to its next (or, with reverse, previous) value in
    // `states`, wrapping around — used for both click (forward) and
    // right-click (backward, so you can back up to an earlier option
    // without cycling all the way around again).
    function stepCycle(states, current, reverse) {
      const idx = states.indexOf(current);
      const len = states.length;
      const nextIdx = reverse ? (idx - 1 + len) % len : (idx + 1) % len;
      return states[nextIdx];
    }

    // 'RC' ("Rate Change") is its own cycle state after NC, but unlike DT/NC
    // it never goes into selectedMods — there's no real "RC" mod acronym to
    // send the API (see fetchRateChangedScores in background.js, which
    // searches DT and NC separately and keeps only the ones with a
    // customized rate). It still excludes HT the same way DT/NC do, since
    // a rate change is still fundamentally a DT/NC-family speed mod.
    function toggleDtNc(reverse) {
      if (selectedMods === null) selectedMods = new Set();
      if (dtNcState === 'DT' || dtNcState === 'NC') selectedMods.delete(dtNcState);
      dtNcState = stepCycle([null, 'DT', 'NC', 'RC'], dtNcState, reverse);
      if (dtNcState === 'DT' || dtNcState === 'NC') {
        selectedMods.add(dtNcState);
        applyExclusions(dtNcState);
      } else if (dtNcState === 'RC') {
        applyExclusions('DT');
      }
      if (selectedMods.size === 0) selectedMods = null;
    }

    function toggleScoring(reverse) {
      scoringVersion = stepCycle([null, 'classic', 'lazer'], scoringVersion, reverse);
    }

    function handleModButtonAction(def, reverse) {
      // "reverse" only changes anything for multi-variant cycling buttons
      // (dtnc) — a plain on/off toggle (nomod, or a single real mod) has
      // no "previous option" beyond its own two states, so right-click
      // just does the same thing left-click does.
      if (def.kind === 'nomod') toggleNoMod();
      else if (def.kind === 'cycle') toggleDtNc(reverse);
      else toggleRealMod(def.acronym);
      updateButtonVisuals();
      refreshResults();
    }

    MOD_BUTTONS.forEach((def) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = BTN_CLASS;
      buttonEls[def.id] = btn;

      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        handleModButtonAction(def, false);
      });
      btn.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        handleModButtonAction(def, true);
      });

      group.appendChild(btn);
    });

    const clBtn = document.createElement('button');
    clBtn.type = 'button';
    clBtn.className = BTN_CLASS;
    buttonEls.cllazer = clBtn;
    function handleScoringAction(reverse) {
      toggleScoring(reverse);
      updateButtonVisuals();
      refreshResults();
    }
    clBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      handleScoringAction(false);
    });
    clBtn.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      handleScoringAction(true);
    });
    group.appendChild(clBtn);

    updateButtonVisuals();
    tabs.insertAdjacentElement('afterend', group);
  }

  // Called on every rescan (content.js). injectButtons() is idempotent
  // (bails if the group already exists), and a diff/mode switch that
  // replaces the whole scoreboard subtree removes the old group, so this
  // naturally re-injects a fresh one — with fresh state — for the new page.
  function refresh() {
    injectButtons();
    injectRankBadges();
  }

  OsuEnhancer.leaderboardModFilter = { refresh };
})(typeof window !== 'undefined' ? window : globalThis);
