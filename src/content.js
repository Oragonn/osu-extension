/**
 * Content script entry point. Reads the user's toggles, applies every
 * enabled feature, and keeps re-applying them as osu!'s single-page app
 * swaps content in and out (score tabs, pagination, medal unlocks, ...).
 */
(function () {
  'use strict';

  console.log('[osu! Enhancer] content script loaded on', location.href);

  const { storage, theme, scores, profile, medals, playerCard, settingsPanel, modeFilter } = window.OsuEnhancer;

  let currentToggles = null;
  let rescanQueued = false;

  function applyStaticToggles(toggles) {
    theme.setEnabled(toggles.darkTheme);
    medals.applyMedalFilter(toggles.medalFilter);
    medals.setHideMedalPopup(toggles.medalFilter !== 'all');
    medals.injectMedalControls(toggles);
    settingsPanel.init();
    scores.applyRankNumbers();
    modeFilter.applyDefaultMode();

    if (profile.isProfilePage() && toggles.playerCard) {
      profile.renderPlayerCardButton(() => playerCard.downloadPlayerCard());
    } else {
      profile.removePlayerCardButton();
    }

    if (profile.isProfilePage()) {
      profile.renderNoopButton();
    } else {
      profile.removeNoopButton();
    }
  }

  async function runScoreFeatures(toggles) {
    if (!toggles.ppIfFc && !toggles.coverArt) {
      scores.clearAll();
      return;
    }
    await scores.scanAndProcess(toggles);
  }

  async function applyAll() {
    currentToggles = await storage.getToggles();
    applyStaticToggles(currentToggles);
    await runScoreFeatures(currentToggles);
  }

  function queueRescan() {
    if (rescanQueued) return;
    rescanQueued = true;
    setTimeout(async () => {
      rescanQueued = false;
      if (!currentToggles) return;
      applyStaticToggles(currentToggles);
      await runScoreFeatures(currentToggles);
    }, 400);
  }

  // osu.ppy.sh is a single-page app: score tabs, pagination, and medal pops
  // all mutate the DOM without a full navigation, so keep watching for it.
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.addedNodes.length > 0) {
        queueRescan();
        break;
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // "Show more" (Pinned/Best/First all paginate this way) has been reported
  // to never get cover art/pp/the stat block applied to the rows it reveals.
  // Measured directly: clicking it can take ~5-6 SECONDS before osu!'s own
  // React app actually fetches and renders the next batch (50 rows, in one
  // measurement) — the MutationObserver above does correctly catch that
  // once it finally lands (debounce handles one isolated late mutation the
  // same as a quick burst), so this had probably actually been working,
  // just slowly enough to look broken if you check right away. These extra
  // passes are just insurance for a batch that lands even later than that,
  // or on the chance osu!'s own mutation timing doesn't cooperate the same
  // way every time. queueRescan()/applyAll() are both debounced/idempotent,
  // so an unrelated click just costs a few wasted (cheap) scans.
  document.addEventListener(
    'click',
    () => {
      queueRescan();
      [1500, 4000, 7000].forEach((delay) => setTimeout(applyAll, delay));
    },
    true
  );

  // Swapping profiles fast enough (back/forward through a couple you've
  // just visited) lets Chrome restore the page from its back/forward cache
  // instead of loading it fresh — and a bfcache restore doesn't re-run
  // content scripts at all (no document_end, nothing), so this script
  // just stays frozen in whatever state it was in the moment the page got
  // cached. If that moment was mid-scan (this page hadn't finished getting
  // cover art/pp/the stat block applied yet), it never will, since nothing
  // else is going to prompt a rescan on a page that isn't mutating any
  // more. `pageshow`'s `persisted` flag is the standard signal for exactly
  // this, so re-running everything there picks up wherever it left off —
  // applyAll() is already idempotent (every render function here no-ops on
  // rows/UI it already applied), so this is safe to call again for a
  // normal (non-bfcache) load too.
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) applyAll();
  });

  storage.onToggleChange((key, value) => {
    if (!currentToggles) return;
    currentToggles[key] = value;

    if (key === 'darkTheme') {
      theme.setEnabled(value);
    } else if (key === 'medalFilter') {
      medals.applyMedalFilter(value);
      medals.setHideMedalPopup(value !== 'all');
    } else if (key === 'playerCard') {
      if (profile.isProfilePage() && value) {
        profile.renderPlayerCardButton(() => playerCard.downloadPlayerCard());
      } else {
        profile.removePlayerCardButton();
      }
    } else if (key === 'ppIfFc' || key === 'coverArt') {
      scores.clearAll();
      runScoreFeatures(currentToggles);
    }
  });

  applyAll();

  // Belt-and-suspenders on top of the MutationObserver above: fast repeated
  // navigation has been reported to leave a profile's scores never getting
  // processed at all, even with the observer running and the score-list
  // fetch retry logic in scores.js. Root cause hasn't been pinned down yet
  // (osu!'s own React app can apparently be slow to render its Scores tab
  // under that kind of rapid back-to-back navigation, independent of
  // anything this script does) — these extra passes over the next few
  // seconds are a plain timing safety net so content that shows up late
  // still gets picked up, regardless of why the observer alone missed it.
  // applyAll() is idempotent, so repeating it costs nothing on a normal load.
  [1000, 2500, 5000].forEach((delay) => setTimeout(applyAll, delay));
})();
