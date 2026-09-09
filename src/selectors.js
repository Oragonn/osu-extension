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

    // Extra-pages tab strip (me! / recent / Scores / Historical / Medals / Beatmaps / Kudosu!).
    pageModeItem: '.page-mode__item',
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

    // Beatmap search filter panel (/beatmapsets). data-filter-value="0" is
    // unique to the Mode section's "osu!" option — every other section uses
    // string keywords (Categories, Explicit, Extra, Played) or values
    // starting at 1 (Genre, Language, Rank Achieved) — confirmed against
    // the live filter panel's DOM, so no extra scoping to the "Mode" header
    // is needed.
    modeFilterOsuLink: '.beatmapsets-search-filter__item[data-filter-value="0"]',
  };
})(typeof window !== 'undefined' ? window : globalThis);
