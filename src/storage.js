/**
 * chrome.storage.local-backed feature toggles, shared by the popup and the
 * content script. Every feature ships off by default except the dark theme
 * and PP-if-FC, which are the extension's core value proposition.
 */
(function (global) {
  'use strict';

  const OsuEnhancer = (global.OsuEnhancer = global.OsuEnhancer || {});

  const DEFAULTS = {
    darkTheme: true,
    ppIfFc: true,
    coverArt: true,
    playerCard: true,
    pickerDiffNames: true, // difficulty names + star rating on the beatmapset picker tray
    listingMaxSr: true, // max star rating chip on beatmapset listing/search cards
    coverDownloadButton: true, // download-cover button on beatmapset pages
    scoreAgeHighlight: true, // score age period highlight on profile Best Performance
    profileAccentColor: false, // purple site accent (nav underline, hover highlights, ...) on profile pages
    targetRankCalculator: true, // "how much pp for rank #N" button next to Global/Country Ranking
    ppPotential: true, // profile-page panel: Best Performance scores re-ranked by pp gain if misses were <= N
    ppPotentialLastMisses: 5, // last "<= misses" value entered in that panel, remembered across sessions
    beatmapPpCalculator: true, // beatmap-page panel: pp for a hypothetical score (mods/acc/combo/misses) on the open difficulty
    beatmapPpCalcLastAccuracy: 100, // last accuracy % entered in that panel, remembered across sessions
    beatmapPpCalcLastRuleset: 'lazer', // 'lazer' | 'stable' — last ruleset picked in that panel, remembered across sessions
    ppPotentialLastSortKey: 'gain', // last sort column picked in the PP potential panel ('current' | 'potential' | 'gain' | 'misses')
    ppPotentialLastSortDir: 'desc', // 'asc' | 'desc' — sort direction paired with ppPotentialLastSortKey
    defaultBeatmapMode: 'osu', // 'osu' | 'taiko' | 'fruits' | 'mania' | 'any' — Mode filter preselected on /beatmapsets; 'any' leaves osu!'s own default
    medalFilter: 'all', // 'all' | 'completed' | 'missing'
    ppEngine: 'rosu', // 'rosu' | 'official'
    osuApiClientId: '', // for the "DT only" leaderboard lookup (official osu! API v2)
    osuApiClientSecret: '',
    showLeaderboardRank: false, // needs osuApiClientId/Secret above — silently no-ops without them
  };

  const LISTENERS = [];

  function getToggles() {
    return new Promise((resolve) => {
      chrome.storage.local.get(DEFAULTS, (items) => resolve(items));
    });
  }

  function setToggle(key, value) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [key]: value }, resolve);
    });
  }

  function onToggleChange(fn) {
    LISTENERS.push(fn);
  }

  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local') return;
      for (const [key, { newValue }] of Object.entries(changes)) {
        if (key in DEFAULTS) {
          LISTENERS.forEach((fn) => fn(key, newValue));
        }
      }
    });
  }

  OsuEnhancer.storage = { DEFAULTS, getToggles, setToggle, onToggleChange };
})(typeof window !== 'undefined' ? window : globalThis);
