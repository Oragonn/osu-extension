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
  document.querySelectorAll('[data-select-toggle]').forEach((select) => {
    select.value = toggles[select.dataset.selectToggle] || select.value;
    select.addEventListener('change', () => {
      setToggle(select.dataset.selectToggle, select.value);
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

  // Full country rankings snapshot for the target-rank calculator — same
  // flow as the in-page settings panel (src/settings-panel.js). Chrome
  // closes the popup (and aborts the fetch) when it loses focus, hence the
  // "keep open" hint.
  const { getCountrySnapshot, fetchAndStoreCountrySnapshot } = window.OsuEnhancer.targetRank;
  const countryInput = document.getElementById('snapshotCountry');
  const modeSelect = document.getElementById('snapshotMode');
  const fetchBtn = document.getElementById('snapshotFetch');
  const fetchStatus = document.getElementById('snapshotStatus');

  function formatSnapshotAge(fetchedAt) {
    const days = Math.floor((Date.now() - fetchedAt) / (24 * 60 * 60 * 1000));
    if (days < 1) return 'today';
    if (days === 1) return '1 day ago';
    return `${days} days ago`;
  }

  async function refreshSnapshotStatus() {
    const countryCode = countryInput.value.trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(countryCode)) {
      fetchStatus.textContent = '';
      return;
    }
    const snapshot = await getCountrySnapshot(modeSelect.value, countryCode);
    fetchStatus.textContent = snapshot
      ? `Stored: ${snapshot.points.length.toLocaleString()} entries for ${countryCode}, fetched ${formatSnapshotAge(snapshot.fetchedAt)}.`
      : `No stored data yet for ${countryCode}.`;
  }
  countryInput.addEventListener('input', refreshSnapshotStatus);
  modeSelect.addEventListener('change', refreshSnapshotStatus);

  fetchBtn.addEventListener('click', async () => {
    const countryCode = countryInput.value.trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(countryCode)) {
      fetchStatus.textContent = 'Enter a valid 2-letter country code (e.g. FR).';
      return;
    }
    fetchBtn.disabled = true;
    fetchStatus.textContent = 'Fetching page 1/200… keep this popup open (takes a couple of minutes).';
    try {
      const points = await fetchAndStoreCountrySnapshot(modeSelect.value, countryCode, (page, total, count) => {
        fetchStatus.textContent = `Fetching page ${page}/${total}… (${count.toLocaleString()} entries so far) — keep this popup open.`;
      });
      fetchStatus.textContent = `Done — stored ${points.length.toLocaleString()} entries for ${countryCode} (${modeSelect.value}).`;
    } catch (err) {
      fetchStatus.textContent = 'Fetch failed — try again.';
    } finally {
      fetchBtn.disabled = false;
    }
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
