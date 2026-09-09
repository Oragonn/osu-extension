/**
 * Profile-page features: the "Download Player Card" button hookup (US-009)
 * and a top-right corner button (no behavior — placeholder). Dark
 * restyling of the info tab itself (US-004) is handled entirely by
 * styles/theme.css against the confirmed .profile-info /
 * .profile-detail-stats selectors.
 */
(function (global) {
  'use strict';

  const OsuEnhancer = (global.OsuEnhancer = global.OsuEnhancer || {});
  const sel = OsuEnhancer.selectors;

  function isProfilePage() {
    return !!document.querySelector(sel.profileInfo);
  }

  function getProfileMeta() {
    const nameEl = document.querySelector(`${sel.profileInfoName} .u-ellipsis-pre-overflow`);
    const avatarEl = document.querySelector(`${sel.profileInfoAvatar} .avatar`);
    let avatarUrl = null;
    if (avatarEl) {
      const m = (avatarEl.style.backgroundImage || '').match(/url\(["']?(.*?)["']?\)/);
      avatarUrl = m ? m[1] : null;
    }
    return {
      username: nameEl ? nameEl.textContent.trim() : 'player',
      avatarUrl,
    };
  }

  function renderPlayerCardButton(onClick) {
    if (document.querySelector('.osu-enhancer-playercard-btn')) return;
    const nameHeader = document.querySelector(sel.profileInfoName);
    if (!nameHeader) return;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'osu-enhancer-playercard-btn';
    btn.textContent = '⬇ Player Card';
    btn.addEventListener('click', onClick);
    nameHeader.appendChild(btn);
  }

  function removePlayerCardButton() {
    const btn = document.querySelector('.osu-enhancer-playercard-btn');
    if (btn) btn.remove();
  }

  function renderNoopButton() {
    if (document.querySelector('.osu-enhancer-noop-btn')) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'osu-enhancer-noop-btn';
    btn.textContent = 'PP potential';
    document.body.appendChild(btn);
  }

  function removeNoopButton() {
    const btn = document.querySelector('.osu-enhancer-noop-btn');
    if (btn) btn.remove();
  }

  OsuEnhancer.profile = {
    isProfilePage,
    getProfileMeta,
    renderPlayerCardButton,
    removePlayerCardButton,
    renderNoopButton,
    removeNoopButton,
  };
})(typeof window !== 'undefined' ? window : globalThis);
