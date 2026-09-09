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

  const TOGGLE_DEFS = [
    { key: 'darkTheme', label: 'Dark theme' },
    { key: 'ppIfFc', label: 'PP if FC labels' },
    { key: 'coverArt', label: 'Beatmap cover art' },
    { key: 'playerCard', label: 'Downloadable player card' },
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

    return panel;
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
    if (document.querySelector('.osu-enhancer-nav-col')) return;
    const insertion = findInsertionPoint();
    if (!insertion || !insertion.host) return;

    const wrapper = document.createElement('div');
    wrapper.className = 'nav2__col nav2__col--menu osu-enhancer-nav-col';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'osu-enhancer-nav-btn';
    btn.setAttribute('aria-label', 'osu! Enhancer settings');
    btn.textContent = '⚙';
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

    if (insertion.before) {
      insertion.host.insertBefore(wrapper, insertion.before);
    } else {
      insertion.host.appendChild(wrapper);
    }
  }

  OsuEnhancer.settingsPanel = { init };
})(typeof window !== 'undefined' ? window : globalThis);
