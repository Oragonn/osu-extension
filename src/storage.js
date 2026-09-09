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
    medalFilter: 'all', // 'all' | 'completed' | 'missing'
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
