/**
 * Medal features (US-011/FR-12/FR-13): a single button above the medal grid
 * that cycles through All → Completed only → Missing only, plus suppressing
 * the "medal unlocked" popup whenever a filter is active (seeing that popup
 * while filtered to "missing only" would be self-contradictory anyway).
 */
(function (global) {
  'use strict';

  const OsuEnhancer = (global.OsuEnhancer = global.OsuEnhancer || {});
  const sel = OsuEnhancer.selectors;

  const HIDDEN_CLASS = 'osu-enhancer-medal-hidden';
  const CONTROLS_CLASS = 'osu-enhancer-medal-controls';
  const FILTER_STATES = ['all', 'completed', 'missing'];
  const FILTER_LABELS = { all: 'All medals', completed: 'Completed only', missing: 'Missing only' };
  let popupObserver = null;

  function isLockedTile(tile) {
    const hints = sel.medalLockedHint.split(',');
    const haystack = `${tile.className} ${tile.getAttribute('data-state') || ''}`.toLowerCase();
    return hints.some((hint) => haystack.includes(hint)) && !haystack.includes('unlocked');
  }

  function applyMedalFilter(filter) {
    // Scoped to the actual medal grid(s) only — the profile page also has a
    // separate "recently obtained" showcase (.page-extra__recent-medals-box)
    // using the same tile class, which should never be filtered since it's
    // always earned medals by definition.
    document.querySelectorAll(`${sel.medalsGroup} ${sel.medalTile}`).forEach((tile) => {
      const locked = isLockedTile(tile);
      const hide = (filter === 'completed' && locked) || (filter === 'missing' && !locked);
      tile.classList.toggle(HIDDEN_CLASS, hide);
    });
  }

  function setHideMedalPopup(enabled) {
    if (popupObserver) {
      popupObserver.disconnect();
      popupObserver = null;
    }
    if (!enabled) return;

    popupObserver = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (!(node instanceof Element)) return;
          const popup = node.matches(sel.medalUnlockedPopup)
            ? node
            : node.querySelector && node.querySelector(sel.medalUnlockedPopup);
          if (popup) popup.remove();
        });
      });
    });
    popupObserver.observe(document.body, { childList: true, subtree: true });
  }

  function makeFilterButton(initialFilter, onChange) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.filter = initialFilter;
    btn.className = 'osu-enhancer-medal-btn' + (initialFilter !== 'all' ? ' osu-enhancer-medal-btn--active' : '');
    btn.textContent = FILTER_LABELS[initialFilter];
    btn.addEventListener('click', () => {
      const next = FILTER_STATES[(FILTER_STATES.indexOf(btn.dataset.filter) + 1) % FILTER_STATES.length];
      btn.dataset.filter = next;
      btn.textContent = FILTER_LABELS[next];
      btn.classList.toggle('osu-enhancer-medal-btn--active', next !== 'all');
      onChange(next);
    });
    return btn;
  }

  /** Injects the filter-cycle button right above the medal grid, once. */
  function injectMedalControls(toggles) {
    if (document.querySelector(`.${CONTROLS_CLASS}`)) return;
    const firstGroup = document.querySelector(sel.medalsGroup);
    if (!firstGroup || !firstGroup.parentElement) return;

    const bar = document.createElement('div');
    bar.className = CONTROLS_CLASS;
    bar.appendChild(
      makeFilterButton(toggles.medalFilter || 'all', (next) => {
        OsuEnhancer.storage.setToggle('medalFilter', next);
        applyMedalFilter(next);
        setHideMedalPopup(next !== 'all');
      })
    );
    firstGroup.parentElement.insertBefore(bar, firstGroup);
  }

  OsuEnhancer.medals = { applyMedalFilter, setHideMedalPopup, injectMedalControls };
})(typeof window !== 'undefined' ? window : globalThis);
