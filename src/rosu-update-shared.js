/**
 * Constants + pure helpers for the "is a newer rosu-pp-js out?" check.
 * Shared between the background service worker (which does the actual
 * fetch, since content scripts are subject to osu.ppy.sh's own CSP) and
 * the UI code (settings-panel.js, popup.js) that only ever reads the
 * cached result back out of chrome.storage.local.
 */
(function (global) {
  'use strict';

  const OsuEnhancer = (global.OsuEnhancer = global.OsuEnhancer || {});

  // The rosu-pp-js release currently vendored in lib/rosu-pp/ (see
  // README.md and lib/rosu-pp/LICENSE-rosu-pp-js.txt). Bump this whenever
  // lib/rosu-pp/ is refreshed from a newer upstream build.
  const BUNDLED_VERSION = '4.0.1';

  const STORAGE_KEY = 'rosuVersionCheck';
  const DISMISSED_STORAGE_KEY = 'rosuUpdateBannerDismissedVersion';
  const ALARM_NAME = 'osu-enhancer:rosu-version-check';
  const NPM_LATEST_URL = 'https://registry.npmjs.org/rosu-pp-js/latest';
  const NPM_PACKAGE_URL = 'https://www.npmjs.com/package/rosu-pp-js';

  function compareVersions(a, b) {
    const pa = String(a).split('.').map(Number);
    const pb = String(b).split('.').map(Number);
    const len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i++) {
      const na = pa[i] || 0;
      const nb = pb[i] || 0;
      if (na !== nb) return na - nb;
    }
    return 0;
  }

  function isUpdateAvailable(latest, bundled) {
    return !!latest && compareVersions(latest, bundled) > 0;
  }

  OsuEnhancer.rosuUpdate = {
    BUNDLED_VERSION,
    STORAGE_KEY,
    DISMISSED_STORAGE_KEY,
    ALARM_NAME,
    NPM_LATEST_URL,
    NPM_PACKAGE_URL,
    compareVersions,
    isUpdateAvailable,
  };
})(typeof window !== 'undefined' ? window : globalThis);
