/**
 * In-page settings button, placed in osu!'s own top nav between "help" and
 * the search icon (per feedback — this replaces relying solely on the
 * browser-toolbar popup for day-to-day toggling). Medal toggles are
 * deliberately excluded here; those are their own buttons on the Medals
 * section (see medals.js).
 */
(function (global) {
  'use strict';

  const OsuEnhancer = (global.OsuEnhancer = global.OsuEnhancer || {});
  const sel = OsuEnhancer.selectors;
  const {
    STORAGE_KEY: ROSU_STORAGE_KEY,
    DISMISSED_STORAGE_KEY: ROSU_DISMISSED_KEY,
    NPM_PACKAGE_URL,
  } = OsuEnhancer.rosuUpdate;

  // Material Design's "settings" glyph (Apache-2.0) — used instead of a text
  // character because font glyph metrics (line-height, vertical whitespace
  // above the mark) vary enough between fonts that a badge positioned off
  // the button's box can end up nowhere near the visible icon. A fixed-size
  // SVG box makes that positioning predictable.
  const GEAR_SVG_PATH =
    'M19.14,12.94c0.04-0.3,0.06-0.61,0.06-0.94c0-0.32-0.02-0.64-0.07-0.94l2.03-1.58c0.18-0.14,0.23-0.41,0.12-0.61' +
    'l-1.92-3.32c-0.12-0.22-0.37-0.29-0.59-0.22l-2.39,0.96c-0.5-0.38-1.03-0.7-1.62-0.94L14.4,2.81' +
    'c-0.04-0.24-0.24-0.41-0.48-0.41h-3.84c-0.24,0-0.43,0.17-0.47,0.41L9.25,5.35C8.66,5.59,8.12,5.92,7.63,6.29' +
    'L5.24,5.33c-0.22-0.08-0.47,0-0.59,0.22L2.74,8.87C2.62,9.08,2.66,9.34,2.86,9.48l2.03,1.58C4.84,11.36,4.8,11.69,4.8,12' +
    's0.02,0.64,0.07,0.94l-2.03,1.58c-0.18,0.14-0.23,0.41-0.12,0.61l1.92,3.32c0.12,0.22,0.37,0.29,0.59,0.22l2.39-0.96' +
    'c0.5,0.38,1.03,0.7,1.62,0.94l0.36,2.54c0.05,0.24,0.24,0.41,0.48,0.41h3.84c0.24,0,0.44-0.17,0.47-0.41l0.36-2.54' +
    'c0.59-0.24,1.13-0.56,1.62-0.94l2.39,0.96c0.22,0.08,0.47,0,0.59-0.22l1.92-3.32c0.12-0.22,0.07-0.47-0.12-0.61' +
    'L19.14,12.94z M12,15.6c-1.98,0-3.6-1.62-3.6-3.6s1.62-3.6,3.6-3.6s3.6,1.62,3.6,3.6S13.98,15.6,12,15.6z';

  const SVG_NS = 'http://www.w3.org/2000/svg';

  // Returns { svg, badgeDot }. The badge is drawn as a <circle> inside the
  // icon's own viewBox rather than CSS-positioned over the button — osu's
  // own vendored redesign stylesheet applies broad rules to plain `button`
  // elements, and chasing which one hijacks the positioning context isn't
  // worth it when drawing the dot inside the icon's own coordinate space
  // sidesteps the cascade entirely (nothing external can move it).
  function buildGearIcon() {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '18');
    svg.setAttribute('height', '18');
    svg.setAttribute('fill', 'currentColor');
    svg.setAttribute('aria-hidden', 'true');

    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', GEAR_SVG_PATH);
    svg.appendChild(path);

    const badgeDot = document.createElementNS(SVG_NS, 'circle');
    badgeDot.setAttribute('cx', '20');
    badgeDot.setAttribute('cy', '4.5');
    badgeDot.setAttribute('r', '4');
    badgeDot.setAttribute('fill', '#ff4d6d');
    badgeDot.style.display = 'none';
    svg.appendChild(badgeDot);

    return { svg, badgeDot };
  }

  const TOGGLE_DEFS = [
    { key: 'darkTheme', label: 'Dark theme' },
    { key: 'ppIfFc', label: 'PP if FC labels' },
    { key: 'coverArt', label: 'Beatmap cover art' },
    { key: 'playerCard', label: 'Downloadable player card' },
    { key: 'showLeaderboardRank', label: 'Player rank next to usernames (needs osu! API below)' },
  ];

  function buildPanel(toggles) {
    const panel = document.createElement('div');
    panel.className = 'osu-enhancer-settings-panel';
    panel.hidden = true;

    const title = document.createElement('div');
    title.className = 'osu-enhancer-settings-panel__title';
    title.textContent = 'osu! Enhancer';
    panel.appendChild(title);

    TOGGLE_DEFS.forEach(({ key, label }) => {
      const row = document.createElement('label');
      row.className = 'osu-enhancer-settings-panel__row';

      const text = document.createElement('span');
      text.textContent = label;

      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = !!toggles[key];
      input.addEventListener('change', () => OsuEnhancer.storage.setToggle(key, input.checked));

      const switchEl = document.createElement('span');
      switchEl.className = 'osu-enhancer-settings-panel__switch';

      row.appendChild(text);
      row.appendChild(input);
      row.appendChild(switchEl);
      panel.appendChild(row);
    });

    // Not a boolean toggle (like medalFilter, this gets bespoke UI rather
    // than being forced into TOGGLE_DEFS's checkbox loop above).
    const engineRow = document.createElement('label');
    engineRow.className = 'osu-enhancer-settings-panel__row osu-enhancer-settings-panel__row--select';

    const engineText = document.createElement('span');
    engineText.textContent = 'PP calculation engine';

    const engineSelect = document.createElement('select');
    engineSelect.className = 'osu-enhancer-settings-panel__select';
    [
      ['rosu', 'rosu-pp (bundled)'],
      ['official', 'Official game code (ppy)'],
    ].forEach(([value, label]) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      engineSelect.appendChild(option);
    });
    engineSelect.value = toggles.ppEngine || 'rosu';
    engineSelect.addEventListener('change', () => OsuEnhancer.storage.setToggle('ppEngine', engineSelect.value));

    engineRow.appendChild(engineText);
    engineRow.appendChild(engineSelect);
    panel.appendChild(engineRow);

    panel.appendChild(buildApiCredentialsSection(toggles));

    return panel;
  }

  // For the "DT only" leaderboard button (src/leaderboard-mod-filter.js) —
  // needs the user's own osu! API OAuth app since it queries the official
  // API v2 directly (see the comment in src/background.js for why it can't
  // just use a shared key). Free, one-time setup, no redirect URL needed
  // since this only ever uses the client-credentials grant.
  function buildApiCredentialsSection(toggles) {
    const section = document.createElement('div');
    section.className = 'osu-enhancer-settings-panel__api-section';

    const heading = document.createElement('div');
    heading.className = 'osu-enhancer-settings-panel__api-heading';
    heading.textContent = 'osu! API';
    section.appendChild(heading);

    [
      { key: 'osuApiClientId', label: 'Client ID', type: 'text' },
      { key: 'osuApiClientSecret', label: 'Client secret', type: 'password' },
    ].forEach(({ key, label, type }) => {
      const row = document.createElement('label');
      row.className = 'osu-enhancer-settings-panel__api-row';

      const text = document.createElement('span');
      text.textContent = label;

      const input = document.createElement('input');
      input.type = type;
      input.className = 'osu-enhancer-settings-panel__api-input';
      input.value = toggles[key] || '';
      input.autocomplete = 'off';
      input.spellcheck = false;
      input.addEventListener('change', () => OsuEnhancer.storage.setToggle(key, input.value.trim()));

      row.appendChild(text);
      row.appendChild(input);
      section.appendChild(row);
    });

    return section;
  }

  function getRosuUpdateStatus() {
    return new Promise((resolve) => {
      chrome.storage.local.get(ROSU_STORAGE_KEY, (items) => resolve(items[ROSU_STORAGE_KEY] || null));
    });
  }

  function buildRosuNotice(status) {
    const notice = document.createElement('a');
    notice.className = 'osu-enhancer-settings-panel__notice';
    notice.href = NPM_PACKAGE_URL;
    notice.target = '_blank';
    notice.rel = 'noopener noreferrer';
    notice.textContent = `rosu-pp update available: v${status.bundled} → v${status.latest}`;
    return notice;
  }

  function applyRosuUpdateStatus(badgeDot, panel, status) {
    const existingNotice = panel.querySelector('.osu-enhancer-settings-panel__notice');
    if (existingNotice) existingNotice.remove();

    const hasUpdate = !!(status && status.updateAvailable);
    badgeDot.style.display = hasUpdate ? '' : 'none';
    if (!hasUpdate) return;

    const title = panel.querySelector('.osu-enhancer-settings-panel__title');
    title.after(buildRosuNotice(status));
  }

  // How long a dismissed banner stays hidden before resurfacing (per
  // feedback: closing it shouldn't silence it forever). Stored as a plain
  // timestamp in chrome.storage.local, which survives a browser/PC
  // restart on its own — no separate "clear on restart" logic needed,
  // since the very next page load just compares against the clock.
  const DISMISS_DURATION_MS = 24 * 60 * 60 * 1000;

  // Page-wide banner (top of the viewport, like a site-wide announcement
  // bar) — a more prominent surface than the nav dropdown for something the
  // user should actually notice, with a dismiss button so it doesn't nag
  // once seen. Dismissal also clears itself if a further update ships.
  function buildUpdateBanner() {
    const banner = document.createElement('div');
    banner.className = 'osu-enhancer-update-banner';
    banner.hidden = true;

    const text = document.createElement('span');
    text.className = 'osu-enhancer-update-banner__text';

    const link = document.createElement('a');
    link.className = 'osu-enhancer-update-banner__link';
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.href = NPM_PACKAGE_URL;
    link.textContent = 'View on npm →';

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'osu-enhancer-update-banner__close';
    close.setAttribute('aria-label', 'Dismiss');
    close.textContent = '×';
    const bannerRefs = { banner, text };

    close.addEventListener('click', () => {
      banner.hidden = true;
      if (!banner.dataset.latest) return;

      chrome.storage.local.set({
        [ROSU_DISMISSED_KEY]: { version: banner.dataset.latest, dismissedAt: Date.now() },
      });

      // Covers a tab that's kept open past the 24h window without a
      // reload — everywhere else, the next page load re-checks the stored
      // timestamp on its own and doesn't need this.
      setTimeout(async () => {
        const [status, dismissal] = await Promise.all([getRosuUpdateStatus(), getRosuDismissal()]);
        applyUpdateBanner(bannerRefs, status, dismissal);
      }, DISMISS_DURATION_MS);
    });

    banner.appendChild(text);
    banner.appendChild(link);
    banner.appendChild(close);
    document.body.prepend(banner);
    return bannerRefs;
  }

  function getRosuDismissal() {
    return new Promise((resolve) => {
      chrome.storage.local.get(ROSU_DISMISSED_KEY, (items) => resolve(items[ROSU_DISMISSED_KEY] || null));
    });
  }

  function isDismissed(dismissal, status) {
    if (!dismissal || !status) return false;
    if (dismissal.version !== status.latest) return false;
    return Date.now() - dismissal.dismissedAt < DISMISS_DURATION_MS;
  }

  function applyUpdateBanner(bannerRefs, status, dismissal) {
    const { banner, text } = bannerRefs;
    const hasUpdate = !!(status && status.updateAvailable);
    banner.hidden = !hasUpdate || isDismissed(dismissal, status);
    if (!hasUpdate) return;

    banner.dataset.latest = status.latest;
    text.textContent = `The bundled rosu-pp PP calculator is outdated — v${status.bundled} is installed, v${status.latest} is out.`;
  }

  async function initUpdateBanner() {
    if (document.querySelector('.osu-enhancer-update-banner') || !document.body) return;
    const bannerRefs = buildUpdateBanner();
    const [status, dismissal] = await Promise.all([getRosuUpdateStatus(), getRosuDismissal()]);
    applyUpdateBanner(bannerRefs, status, dismissal);

    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local' || !(ROSU_STORAGE_KEY in changes || ROSU_DISMISSED_KEY in changes)) return;
      Promise.all([getRosuUpdateStatus(), getRosuDismissal()]).then(([nextStatus, nextDismissal]) =>
        applyUpdateBanner(bannerRefs, nextStatus, nextDismissal)
      );
    });
  }

  function findInsertionPoint() {
    const searchLink = document.querySelector(sel.navSearchLink);
    if (searchLink) {
      const col = searchLink.closest(sel.navCol);
      return { host: (col || searchLink).parentElement, before: col || searchLink };
    }
    const colGroup = document.querySelector(sel.navMenuColGroup);
    if (colGroup) return { host: colGroup, before: null };
    return null;
  }

  async function init() {
    initUpdateBanner();

    if (document.querySelector('.osu-enhancer-nav-col')) return;
    const insertion = findInsertionPoint();
    if (!insertion || !insertion.host) return;

    const wrapper = document.createElement('div');
    wrapper.className = 'nav2__col nav2__col--menu osu-enhancer-nav-col';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'osu-enhancer-nav-btn';
    btn.setAttribute('aria-label', 'osu! Enhancer settings');
    const { svg, badgeDot } = buildGearIcon();
    btn.appendChild(svg);
    wrapper.appendChild(btn);

    const toggles = await OsuEnhancer.storage.getToggles();
    const panel = buildPanel(toggles);
    wrapper.appendChild(panel);

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      panel.hidden = !panel.hidden;
    });
    document.addEventListener('click', (e) => {
      if (!wrapper.contains(e.target)) panel.hidden = true;
    });

    applyRosuUpdateStatus(badgeDot, panel, await getRosuUpdateStatus());
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'local' && changes[ROSU_STORAGE_KEY]) {
        applyRosuUpdateStatus(badgeDot, panel, changes[ROSU_STORAGE_KEY].newValue);
      }
    });

    if (insertion.before) {
      insertion.host.insertBefore(wrapper, insertion.before);
    } else {
      insertion.host.appendChild(wrapper);
    }
  }

  OsuEnhancer.settingsPanel = { init };
})(typeof window !== 'undefined' ? window : globalThis);
