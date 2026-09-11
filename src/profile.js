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

  // osu-web ships CSS for a colored active-tab underline on .page-mode-link
  // (.page-mode-link__stripe), but reusing that exact class rendered as an
  // oversized blob overlapping the tab text once the vendored dark theme
  // (styles/izuki-theme.css, ~36k lines) was active — something in there
  // conflicts with it in a way that wasn't worth hunting down line by line.
  // Using our own class instead means only styles/theme.css governs its
  // size, so nothing else can touch it; the color still tracks the site's
  // own per-section hsl(var(--hsl-h1)) variable (see styles/theme.css),
  // and .page-mode-link--is-active is still their own scrollspy JS toggling
  // as you scroll, so the underline still follows the active section.
  function injectStickyToolbarStripes() {
    document.querySelectorAll(`${sel.stickyToolbar} ${sel.pageModeLink}`).forEach((link) => {
      if (link.querySelector('.osu-enhancer-page-mode-stripe')) return;
      const stripe = document.createElement('span');
      stripe.className = 'osu-enhancer-page-mode-stripe';
      link.appendChild(stripe);
    });
  }

  OsuEnhancer.profile = {
    isProfilePage,
    getProfileMeta,
    renderPlayerCardButton,
    removePlayerCardButton,
    renderNoopButton,
    removeNoopButton,
    injectStickyToolbarStripes,
  };
})(typeof window !== 'undefined' ? window : globalThis);
