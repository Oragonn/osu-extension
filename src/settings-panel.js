/**
 * In-page settings button, a floating action button pinned to the
 * bottom-left corner of every osu! page (moved out of osu!'s own top nav
 * per feedback — this replaces relying solely on the browser-toolbar popup
 * for day-to-day toggling). Medal toggles are
 * deliberately excluded here; those are their own buttons on the Medals
 * section (see medals.js).
 */
(function (global) {
  'use strict';

  const OsuEnhancer = (global.OsuEnhancer = global.OsuEnhancer || {});
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

  // Grouped into tabs so the menu stays short no matter how many features
  // pile up. `icon` is a plain text glyph drawn inside a tinted tile; `hue`
  // tints that tile (and the card when the feature is on).
  const TABS = [
    {
      id: 'look',
      label: 'Look',
      items: [
        { key: 'darkTheme', icon: '◐', hue: 280, label: 'Dark theme', desc: 'Site-wide dark redesign' },
        { key: 'profileAccentColor', icon: '◆', hue: 270, label: 'Purple accent', desc: 'Purple highlights on profile pages' },
        { key: 'coverArt', icon: '▣', hue: 200, label: 'Cover art', desc: 'Beatmap covers behind score rows' },
      ],
    },
    {
      id: 'profile',
      label: 'Profile',
      items: [
        { key: 'ppIfFc', icon: '✦', hue: 330, label: 'PP if FC', desc: 'Full-combo pp shown on every score' },
        { key: 'scoreAgeHighlight', icon: '◷', hue: 40, label: 'Score age highlight', desc: 'Colour Best Performance by score age' },
        { key: 'targetRankCalculator', icon: '▲', hue: 150, label: 'Target rank calculator', desc: 'PP needed to reach rank #N' },
        { key: 'ppPotential', icon: '≈', hue: 60, label: 'PP potential', desc: 'Near-FC plays (≤N misses) ranked by pp gained if FC’d' },
        { key: 'playerCard', icon: '▤', hue: 190, label: 'Player card', desc: 'Downloadable profile card image' },
        { key: 'showLeaderboardRank', icon: '#', hue: 10, label: 'Rank next to names', desc: 'Needs osu! API keys (Data tab)' },
      ],
    },
    {
      id: 'beatmaps',
      label: 'Beatmaps',
      items: [
        { key: 'pickerDiffNames', icon: '≡', hue: 220, label: 'Difficulty names', desc: 'Names + star rating on the picker' },
        { key: 'listingMaxSr', icon: '★', hue: 45, label: 'Max star rating', desc: 'Highest SR chip on listing cards' },
        { key: 'coverDownloadButton', icon: '↓', hue: 170, label: 'Cover download', desc: 'Save full-size covers + copy artist - title' },
        { key: 'beatmapPpCalculator', icon: 'ƒ', hue: 195, label: 'PP calculator', desc: 'PP for a hypothetical mods/acc/combo score' },
      ],
    },
    { id: 'data', label: 'Data', items: [] },
  ];

  const MODE_OPTIONS = [
    ['osu', 'osu!'],
    ['taiko', 'taiko'],
    ['fruits', 'catch'],
    ['mania', 'mania'],
  ];

  const ALL_BOOLEAN_KEYS = TABS.flatMap((tab) => tab.items.map((item) => item.key));
  const TAB_STORAGE_KEY = 'osuEnhancerMenuTab';

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function buildPanel(toggles) {
    const panel = el('div', 'osu-enhancer-settings-panel');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'osu! Enhancer settings');

    // ---- Header: gradient hero with a live "N of M on" counter + meter.
    const header = el('div', 'osu-enhancer-menu__header');
    const brand = el('div', 'osu-enhancer-menu__brand');
    brand.appendChild(el('span', 'osu-enhancer-menu__logo', 'osu!'));
    brand.appendChild(el('span', 'osu-enhancer-menu__name', 'Enhancer'));
    header.appendChild(brand);
    const counter = el('div', 'osu-enhancer-menu__counter');
    header.appendChild(counter);
    const meter = el('div', 'osu-enhancer-menu__meter');
    const meterFill = el('div', 'osu-enhancer-menu__meter-fill');
    meter.appendChild(meterFill);
    header.appendChild(meter);
    panel.appendChild(header);

    const noticeSlot = el('div', 'osu-enhancer-menu__notice-slot');
    panel.appendChild(noticeSlot);

    function refreshCounter() {
      const on = ALL_BOOLEAN_KEYS.filter((key) => toggles[key]).length;
      counter.textContent = `${on} of ${ALL_BOOLEAN_KEYS.length} features on`;
      meterFill.style.width = `${(on / ALL_BOOLEAN_KEYS.length) * 100}%`;
    }

    // ---- Tabs, with a sliding pill indicator under the active one.
    const tabBar = el('div', 'osu-enhancer-menu__tabs');
    tabBar.setAttribute('role', 'tablist');
    const indicator = el('span', 'osu-enhancer-menu__tab-indicator');
    indicator.style.width = `calc((100% - 8px) / ${TABS.length})`;
    tabBar.appendChild(indicator);
    panel.appendChild(tabBar);

    const body = el('div', 'osu-enhancer-menu__body');
    panel.appendChild(body);

    const tabButtons = [];
    const pages = [];
    const cards = {};

    function selectTab(index) {
      tabButtons.forEach((b, i) => {
        b.classList.toggle('osu-enhancer-menu__tab--active', i === index);
        b.setAttribute('aria-selected', String(i === index));
      });
      pages.forEach((p, i) => (p.hidden = i !== index));
      indicator.style.transform = `translateX(${index * 100}%)`;
      body.scrollTop = 0;
      try {
        localStorage.setItem(TAB_STORAGE_KEY, String(index));
      } catch (err) {
        // Storage blocked — the tab just won't be remembered.
      }
    }

    TABS.forEach((tab, index) => {
      const tabBtn = el('button', 'osu-enhancer-menu__tab', tab.label);
      tabBtn.type = 'button';
      tabBtn.setAttribute('role', 'tab');
      tabBtn.addEventListener('click', () => selectTab(index));
      tabBar.appendChild(tabBtn);
      tabButtons.push(tabBtn);

      const page = el('div', 'osu-enhancer-menu__page');
      page.setAttribute('role', 'tabpanel');
      tab.items.forEach((item, i) => {
        const entry = buildFeatureCard(item, toggles, refreshCounter);
        entry.card.style.animationDelay = `${i * 35}ms`;
        cards[item.key] = entry;
        page.appendChild(entry.card);
      });
      if (tab.id === 'beatmaps') {
        page.appendChild(
          buildSegmented('Default mode on beatmap listing', 'defaultBeatmapMode', toggles, [...MODE_OPTIONS, ['any', 'any']])
        );
      }
      if (tab.id === 'data') {
        page.appendChild(
          buildSegmented('PP calculation engine', 'ppEngine', toggles, [
            ['rosu', 'rosu-pp'],
            ['official', 'Official (ppy)'],
          ])
        );
        page.appendChild(buildApiCredentialsSection(toggles));
        page.appendChild(buildCountrySnapshotSection());
      }
      body.appendChild(page);
      pages.push(page);
    });

    let initialTab = 0;
    try {
      initialTab = Math.min(TABS.length - 1, Number(localStorage.getItem(TAB_STORAGE_KEY)) || 0);
    } catch (err) {
      // Fall back to the first tab.
    }
    selectTab(initialTab);
    refreshCounter();

    // ---- Footer
    const footer = el('div', 'osu-enhancer-menu__footer');
    footer.appendChild(el('span', 'osu-enhancer-menu__live-dot'));
    footer.appendChild(el('span', null, 'Changes apply instantly'));
    footer.appendChild(el('span', 'osu-enhancer-menu__version', `v${chrome.runtime.getManifest().version}`));
    panel.appendChild(footer);

    // Stay in sync with the toolbar popup (same storage keys).
    OsuEnhancer.storage.onToggleChange((key, value) => {
      if (!(key in cards)) return;
      toggles[key] = value;
      cards[key].input.checked = !!value;
      cards[key].card.classList.toggle('osu-enhancer-menu__card--on', !!value);
      refreshCounter();
    });

    return { panel, noticeSlot };
  }

  function buildFeatureCard(item, toggles, onChange) {
    const card = el('label', 'osu-enhancer-menu__card');
    card.style.setProperty('--oe-hue', item.hue);
    card.classList.toggle('osu-enhancer-menu__card--on', !!toggles[item.key]);

    card.appendChild(el('span', 'osu-enhancer-menu__icon', item.icon));

    const text = el('span', 'osu-enhancer-menu__card-text');
    text.appendChild(el('span', 'osu-enhancer-menu__card-title', item.label));
    text.appendChild(el('span', 'osu-enhancer-menu__card-desc', item.desc));
    card.appendChild(text);

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = !!toggles[item.key];
    input.addEventListener('change', () => {
      toggles[item.key] = input.checked;
      card.classList.toggle('osu-enhancer-menu__card--on', input.checked);
      OsuEnhancer.storage.setToggle(item.key, input.checked);
      onChange();
    });
    card.appendChild(input);
    card.appendChild(el('span', 'osu-enhancer-menu__switch'));

    return { card, input };
  }

  // Pill-style segmented control instead of a native <select>.
  function buildSegmented(label, key, toggles, options) {
    const group = el('div', 'osu-enhancer-menu__group');
    group.appendChild(el('div', 'osu-enhancer-menu__group-label', label));
    const seg = el('div', 'osu-enhancer-menu__segmented');
    seg.setAttribute('role', 'radiogroup');
    const current = toggles[key] || options[0][0];
    const buttons = options.map(([value, optionLabel]) => {
      const b = el('button', 'osu-enhancer-menu__seg-btn', optionLabel);
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.dataset.value = value;
      seg.appendChild(b);
      return b;
    });
    function mark(value) {
      buttons.forEach((b) => {
        const on = b.dataset.value === value;
        b.classList.toggle('osu-enhancer-menu__seg-btn--active', on);
        b.setAttribute('aria-checked', String(on));
      });
    }
    buttons.forEach((b) =>
      b.addEventListener('click', () => {
        mark(b.dataset.value);
        OsuEnhancer.storage.setToggle(key, b.dataset.value);
      })
    );
    mark(current);
    OsuEnhancer.storage.onToggleChange((changedKey, value) => {
      if (changedKey === key) mark(value);
    });
    group.appendChild(seg);
    return group;
  }

  function buildField(labelText, input) {
    const field = el('label', 'osu-enhancer-menu__field');
    field.appendChild(el('span', 'osu-enhancer-menu__field-label', labelText));
    field.appendChild(input);
    return field;
  }

  function buildTextInput(type, value, placeholder) {
    const input = document.createElement('input');
    input.type = type;
    input.className = 'osu-enhancer-menu__input';
    input.value = value || '';
    if (placeholder) input.placeholder = placeholder;
    input.autocomplete = 'off';
    input.spellcheck = false;
    return input;
  }

  // For the "DT only" leaderboard button (src/leaderboard-mod-filter.js) —
  // needs the user's own osu! API OAuth app since it queries the official
  // API v2 directly (see the comment in src/background.js for why it can't
  // just use a shared key). Free, one-time setup, no redirect URL needed
  // since this only ever uses the client-credentials grant.
  function buildApiCredentialsSection(toggles) {
    const group = el('div', 'osu-enhancer-menu__group');
    group.appendChild(el('div', 'osu-enhancer-menu__group-label', 'osu! API credentials'));
    [
      { key: 'osuApiClientId', label: 'Client ID', type: 'text' },
      { key: 'osuApiClientSecret', label: 'Client secret', type: 'password' },
    ].forEach(({ key, label, type }) => {
      const input = buildTextInput(type, toggles[key]);
      input.addEventListener('change', () => OsuEnhancer.storage.setToggle(key, input.value.trim()));
      group.appendChild(buildField(label, input));
    });
    return group;
  }

  // A country with more ranked players than the global #10,000 cap covers
  // (most do) has that same cap on its own rankings list — but a one-time
  // full walk of all 200 of its pages (instead of the 5-page live sample
  // src/target-rank.js normally uses) gives the target-rank calculator a
  // much richer, persistent real dataset for that country, stored in
  // chrome.storage.local until manually refreshed here. Takes a couple of
  // minutes (200 requests, paced the same as the live sample) since it's a
  // real batch job, not something to run automatically or on every page
  // load — see src/target-rank.js's fetchFullCountryRankings for the pacing
  // rationale.
  function formatSnapshotAge(fetchedAt) {
    const ageMs = Date.now() - fetchedAt;
    const days = Math.floor(ageMs / (24 * 60 * 60 * 1000));
    if (days < 1) return 'today';
    if (days === 1) return '1 day ago';
    return `${days} days ago`;
  }

  function buildCountrySnapshotSection() {
    const group = el('div', 'osu-enhancer-menu__group');
    group.appendChild(el('div', 'osu-enhancer-menu__group-label', 'Rank data (target rank calculator)'));

    const row = el('div', 'osu-enhancer-menu__field-row');
    const countryInput = buildTextInput('text', '', 'FR');
    countryInput.maxLength = 2;
    countryInput.classList.add('osu-enhancer-menu__input--country');
    row.appendChild(buildField('Country', countryInput));

    const modeSelect = document.createElement('select');
    modeSelect.className = 'osu-enhancer-menu__input';
    MODE_OPTIONS.forEach(([value, label]) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      modeSelect.appendChild(option);
    });
    row.appendChild(buildField('Mode', modeSelect));
    group.appendChild(row);

    const fetchBtn = el('button', 'osu-enhancer-menu__fetch-btn', 'Fetch all rankings');
    fetchBtn.type = 'button';
    group.appendChild(fetchBtn);

    const progress = el('div', 'osu-enhancer-menu__progress');
    const progressFill = el('div', 'osu-enhancer-menu__progress-fill');
    progress.appendChild(progressFill);
    progress.hidden = true;
    group.appendChild(progress);

    const status = el('div', 'osu-enhancer-menu__status');
    group.appendChild(status);

    async function refreshStatus() {
      const countryCode = countryInput.value.trim().toUpperCase();
      if (!/^[A-Z]{2}$/.test(countryCode)) {
        status.textContent = '';
        return;
      }
      const snapshot = await OsuEnhancer.targetRank.getCountrySnapshot(modeSelect.value, countryCode);
      status.textContent = snapshot
        ? `Stored: ${snapshot.points.length.toLocaleString()} entries for ${countryCode}, fetched ${formatSnapshotAge(snapshot.fetchedAt)}.`
        : `No stored data yet for ${countryCode}.`;
    }
    countryInput.addEventListener('input', refreshStatus);
    modeSelect.addEventListener('change', refreshStatus);

    fetchBtn.addEventListener('click', async () => {
      const countryCode = countryInput.value.trim().toUpperCase();
      if (!/^[A-Z]{2}$/.test(countryCode)) {
        status.textContent = 'Enter a valid 2-letter country code (e.g. FR).';
        return;
      }
      fetchBtn.disabled = true;
      fetchBtn.textContent = 'Fetching…';
      progress.hidden = false;
      progressFill.style.width = '0%';
      status.textContent = 'Starting… this takes a couple of minutes.';
      try {
        const points = await OsuEnhancer.targetRank.fetchAndStoreCountrySnapshot(modeSelect.value, countryCode, (page, total, count) => {
          progressFill.style.width = `${(page / total) * 100}%`;
          status.textContent = `Page ${page}/${total} · ${count.toLocaleString()} entries`;
        });
        progressFill.style.width = '100%';
        status.textContent = `Done — stored ${points.length.toLocaleString()} entries for ${countryCode} (${modeSelect.value}).`;
      } catch (err) {
        status.textContent = 'Fetch failed — try again.';
      } finally {
        fetchBtn.disabled = false;
        fetchBtn.textContent = 'Fetch all rankings';
        setTimeout(() => (progress.hidden = true), 1500);
      }
    });

    return group;
  }

  function getRosuUpdateStatus() {
    return new Promise((resolve) => {
      chrome.storage.local.get(ROSU_STORAGE_KEY, (items) => resolve(items[ROSU_STORAGE_KEY] || null));
    });
  }

  function buildRosuNotice(status) {
    const notice = document.createElement('a');
    notice.className = 'osu-enhancer-menu__notice';
    notice.href = NPM_PACKAGE_URL;
    notice.target = '_blank';
    notice.rel = 'noopener noreferrer';
    notice.textContent = `rosu-pp update available: v${status.bundled} → v${status.latest}`;
    return notice;
  }

  function applyRosuUpdateStatus(badgeDot, noticeSlot, status) {
    noticeSlot.textContent = '';
    const hasUpdate = !!(status && status.updateAvailable);
    badgeDot.style.display = hasUpdate ? '' : 'none';
    if (hasUpdate) noticeSlot.appendChild(buildRosuNotice(status));
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

  async function init() {
    initUpdateBanner();

    if (document.querySelector('.osu-enhancer-fab') || !document.body) return;

    const wrapper = document.createElement('div');
    wrapper.className = 'osu-enhancer-fab';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'osu-enhancer-fab__btn';
    btn.setAttribute('aria-label', 'osu! Enhancer settings');
    btn.setAttribute('aria-expanded', 'false');
    btn.title = 'osu! Enhancer settings';
    const { svg, badgeDot } = buildGearIcon();
    svg.setAttribute('width', '24');
    svg.setAttribute('height', '24');
    btn.appendChild(svg);

    const toggles = await OsuEnhancer.storage.getToggles();
    // Visibility is driven by the --open class so opening/closing can animate.
    const { panel, noticeSlot } = buildPanel(toggles);
    wrapper.appendChild(panel);
    wrapper.appendChild(btn);

    function setOpen(open) {
      wrapper.classList.toggle('osu-enhancer-fab--open', open);
      btn.setAttribute('aria-expanded', String(open));
    }
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      setOpen(!wrapper.classList.contains('osu-enhancer-fab--open'));
    });
    // Closing requires both the press and the release to land outside the
    // panel, so selecting text inside and releasing the mouse outside it
    // (e.g. over the page) doesn't close the panel mid-selection.
    let outsidePointerDown = false;
    document.addEventListener('mousedown', (e) => {
      outsidePointerDown = !wrapper.contains(e.target);
    });
    document.addEventListener('mouseup', (e) => {
      if (outsidePointerDown && !wrapper.contains(e.target)) setOpen(false);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') setOpen(false);
    });

    applyRosuUpdateStatus(badgeDot, noticeSlot, await getRosuUpdateStatus());
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'local' && changes[ROSU_STORAGE_KEY]) {
        applyRosuUpdateStatus(badgeDot, noticeSlot, changes[ROSU_STORAGE_KEY].newValue);
      }
    });

    document.body.appendChild(wrapper);
  }

  OsuEnhancer.settingsPanel = { init };
})(typeof window !== 'undefined' ? window : globalThis);
