(async function () {
  'use strict';

  const { getToggles, setToggle } = window.OsuEnhancer.storage;
  const inputs = document.querySelectorAll('[data-toggle]');

  const toggles = await getToggles();
  inputs.forEach((input) => {
    input.checked = !!toggles[input.dataset.toggle];
    input.addEventListener('change', () => {
      setToggle(input.dataset.toggle, input.checked);
    });
  });

  // Non-boolean settings (a <select>, unlike the checkboxes above) get their
  // own small binder rather than being squeezed into the [data-toggle] loop.
  document.querySelectorAll('[data-engine-toggle]').forEach((select) => {
    select.value = toggles[select.dataset.engineToggle] || select.value;
    select.addEventListener('change', () => {
      setToggle(select.dataset.engineToggle, select.value);
    });
  });

  // osu! API credentials for the "DT only" leaderboard button — plain text
  // fields, same [data-toggle]-style binding but its own attribute since
  // these aren't checkboxes or a <select>.
  document.querySelectorAll('[data-api-toggle]').forEach((input) => {
    input.value = toggles[input.dataset.apiToggle] || '';
    input.addEventListener('change', () => {
      setToggle(input.dataset.apiToggle, input.value.trim());
    });
  });

  const { STORAGE_KEY: ROSU_STORAGE_KEY, NPM_PACKAGE_URL } = window.OsuEnhancer.rosuUpdate;
  const notice = document.getElementById('rosuNotice');

  function applyRosuUpdateStatus(status) {
    const hasUpdate = !!(status && status.updateAvailable);
    notice.hidden = !hasUpdate;
    if (!hasUpdate) return;
    notice.href = NPM_PACKAGE_URL;
    notice.textContent = `rosu-pp update available: v${status.bundled} → v${status.latest}`;
  }

  chrome.storage.local.get(ROSU_STORAGE_KEY, (items) => applyRosuUpdateStatus(items[ROSU_STORAGE_KEY]));
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes[ROSU_STORAGE_KEY]) {
      applyRosuUpdateStatus(changes[ROSU_STORAGE_KEY].newValue);
    }
  });
})();
