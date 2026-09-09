/**
 * Dark theme toggle.
 *
 * The actual site-wide dark styling is `styles/izuki-theme.css` — a
 * personal-use copy of -Izuki-'s osu! redesign userstyle (see README
 * Credits: it has no license, so this file is vendored for the extension
 * owner's own local "Load unpacked" use, not for redistribution). It's
 * loaded as a `<link>` tag rather than a static manifest content_scripts
 * entry so it can be added/removed instantly when the toggle flips, with
 * no page reload.
 *
 * `html.osu-enhancer-dark` additionally gates a couple of small first-party
 * tweaks in styles/theme.css that the vendored file doesn't cover.
 */
(function (global) {
  'use strict';

  const OsuEnhancer = (global.OsuEnhancer = global.OsuEnhancer || {});

  const THEME_CLASS = 'osu-enhancer-dark';
  const LINK_ID = 'osu-enhancer-izuki-theme';

  function setEnabled(enabled) {
    document.documentElement.classList.toggle(THEME_CLASS, !!enabled);

    let link = document.getElementById(LINK_ID);
    if (enabled) {
      if (!link) {
        link = document.createElement('link');
        link.id = LINK_ID;
        link.rel = 'stylesheet';
        link.href = chrome.runtime.getURL('styles/izuki-theme.css');
        document.head.appendChild(link);
      }
    } else if (link) {
      link.remove();
    }
  }

  OsuEnhancer.theme = { setEnabled };
})(typeof window !== 'undefined' ? window : globalThis);
