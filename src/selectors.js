/**
 * Centralized DOM selectors for osu.ppy.sh.
 *
 * osu-web's frontend (github.com/ppy/osu-web) uses plain, human-readable BEM
 * class names (not CSS-modules/hashed). Most selectors below were confirmed
 * directly against the live site; the score-row and medal ones were cross-
 * checked against a real community userstyle's selector list (see README
 * Credits & Inspiration) since those sections render lazily. If a future
 * osu! redesign changes markup, this is the only file that should need
 * updating — feature code (src/*.js) should never hardcode a raw selector.
 */
(function (global) {
  'use strict';

  const OsuEnhancer = (global.OsuEnhancer = global.OsuEnhancer || {});

  OsuEnhancer.selectors = {
    // Site-wide top navigation bar ("nav2" in osu-web).
    nav: '.nav2-header',
    navBar: '.nav2',
    navLogo: '.nav2__logo-link',
    navMenuLink: '.nav2__menu-link-main',
    navPopup: '.nav2__menu-popup',

    // Generic page chrome used across home/beatmaps/rankings/community.
    pageBody: '.osu-layout',
    footer: '.footer',
    card: '.osu-page, .beatmapset-panel, .simple-menu, .js-react--profile-page',

    // Profile page — header / info tab.
    profileInfo: '.profile-info',
    profileInfoAvatar: '.profile-info__avatar',
    profileInfoName: '.profile-info__name',
    profileDetail: '.profile-detail',
    profileDetailStats: '.profile-detail-stats',
    valueDisplay: '.value-display',
    rankValue: '.rank-value',
    profileRankCount: '.profile-rank-count',
    profileRankCountItem: '.profile-rank-count__item',
    scoreRankPill: '.score-rank',
    profileStatsEntry: '[class*="profile-stats__entry"]',
    profileBar: '.profile-bar',

    // Tab bar (info / modding / playlists / multiplayer / ranked play).
    profileTabs: '.header-nav-v4',
    profileTabLink: '.header-nav-v4__link',
    profileTabActive: '.header-nav-v4__link--active',

    // Extra-pages tab strip (me! / recent / Scores / Historical / Medals / Beatmaps / Kudosu!),
    // and the sticky scrollspy toolbar it lives in on profile pages.
    pageModeItem: '.page-mode__item',
    pageModeLink: '.page-mode-link',
    stickyToolbar: '.sticky-toolbar',
    beatmapsetPanel: '.beatmapset-panel',

    // Medals — confirmed against a real osu! userstyle's selector list
    // (see README Credits) which targets these exact osu-web classes.
    medalsGroup: '.medals-group',
    // Confirmed live: <div class="badge-achievement badge-achievement--listing
    // badge-achievement--locked">. The earlier ".medals-group__medal" guess
    // didn't exist on the page at all, so the toggle always matched zero tiles.
    medalTile: '.badge-achievement',
    medalLockedHint: 'locked,unearned,incomplete,disabled',
    medalUnlockedPopup: '.notification-popup-item--user_achievement_unlock',

    // Score rows (Pinned / Best / Recent / First place) — osu-web's real
    // "play-detail" component, confirmed the same way as the medal classes.
    scoreRowList: '.play-detail-list',
    scoreRow: '.play-detail',
    scoreRowPp: '.play-detail__pp',
    scoreRowIcon: '.play-detail__icon--main',
    beatmapLink: 'a[href*="/beatmapsets/"], a[href*="/beatmaps/"]',
    // Section headings ("Pinned Scores 0", "Best Performance 200", ...),
    // confirmed live: <h3 class="title title--page-extra-small">Best
    // Performance<span class="title__count">200</span></h3>.
    scoreSectionHeading: 'h3.title--page-extra-small',
    scoreRowGroupTop: '.play-detail__group--top',
    // Bottom row: mods, this, then pp — osu-web reorders `.play-detail__mods`
    // to the front via `order: -1` and leaves this and `.play-detail__pp` at
    // their natural `order: 0`, so it always renders directly between them.
    scoreRowScoreDetail: '.play-detail__score-detail',

    // Top nav — used to place the in-page settings button between "help"
    // and the search icon.
    navCol: '.nav2__col',
    navMenuColGroup: '.nav2__colgroup--menu',
    navSearchLink: '.nav2__menu-link-main--search',

    // Individual score permalink page (/scores/<id>), confirmed live: the
    // acc/max-combo/pp trio is the first ".score-stats__group-row" inside
    // ".score-stats__group--stats" (two more group-rows follow it for the
    // judgement-count and slider-tick breakdowns, same class, so this must
    // stay scoped to the first one rather than a bare ".score-stats__group-row").
    scoreDetailStatsRow: '.score-stats__group--stats > .score-stats__group-row:first-child',
    // The player card shown next to the score stats — same .user-card
    // component osu-web uses in several other spots (hover usercards,
    // rankings tables), but this page only ever renders one, and
    // score-detail.js already gates every use of this behind isScoreDetailPage().
    scoreDetailUsername: '.user-card__username',
    // osu-web hydrates this page's React island from a JSON blob it already
    // embeds server-side — the exact same score shape (mods/statistics/
    // beatmap_id/is_perfect_combo/pp/legacy_score_id) as the
    // /users/<id>/scores/<type> endpoint scores.js fetches, so no extra
    // network request is needed here.
    scoreDetailJson: '#json-show',

    // Beatmap leaderboard (/beatmapsets/<set>#<mode>/<diff>). The native
    // mod-specific ranking (.beatmapset-scoreboard__mods icon row) 422s for
    // non-supporters — confirmed live 2026-09-09 (GET .../scores?mods[]=DT
    // returns 422, plain .../scores?type=global returns 200) — so
    // src/leaderboard-mod-filter.js replaces that whole row with its own
    // button group backed by the official API v2 (see src/background.js).
    scoreboard: '.beatmapset-scoreboard',
    scoreboardPageTabs: '.beatmapset-scoreboard > .page-tabs',
    scoreboardNativeMods: '.beatmapset-scoreboard__mods',
    // Wrapper around the "top score" card(s) shown above the paginated
    // table — normally the #1 global score plus your own score if it
    // isn't already that one. leaderboard-mod-filter.js swaps its contents
    // for a single rebuilt card matching the active mod filter, since the
    // native card(s) reflect the unfiltered leaderboard.
    scoreboardTop: '.beatmap-scoreboard-top',
    scoreboardTopScore: '.beatmap-score-top',
    scoreboardRow: '.beatmap-scoreboard-table__body-row',

    // Beatmap search filter panel (/beatmapsets). data-filter-value="0" is
    // unique to the Mode section's "osu!" option — every other section uses
    // string keywords (Categories, Explicit, Extra, Played) or values
    // starting at 1 (Genre, Language, Rank Achieved) — confirmed against
    // the live filter panel's DOM, so no extra scoping to the "Mode" header
    // is needed.
    modeFilterOsuLink: '.beatmapsets-search-filter__item[data-filter-value="0"]',
  };
})(typeof window !== 'undefined' ? window : globalThis);
