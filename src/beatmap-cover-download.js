/**
 * Cover download + copy-name buttons on beatmapset pages (both gated by the
 * "coverDownloadButton" toggle) — square icon buttons dropped into the
 * native `.beatmapset-header__buttons` row, styled with osu-web's own
 * `btn-osu-big--beatmapset-header-square` class so they sit flush with the
 * site's real square header buttons (favourite, hype, ...) rather than
 * custom-styled ones. Download button placement/icon were the visual
 * reference from inix1257/osu_expertplus's own "open background" header
 * button (see README Credits & Inspiration) — this one actually saves the
 * file instead of just opening it in a new tab: assets.ppy.sh sends no CORS
 * headers (confirmed live — no Access-Control-Allow-Origin), so a
 * content-script `fetch()` into a blob would only ever get an opaque,
 * unreadable response. `chrome.downloads.download()` isn't a `fetch()` and
 * isn't subject to that, but it's only available to the background service
 * worker, so the click here just hands the URL off to background.js (see
 * its own top-of-file comment on this same CORS split).
 *
 * The full-size URL itself (`.../covers/fullsize.jpg`) isn't one of the
 * sizes `#json-beatmapset`'s own `covers` object lists (cover/card/list/
 * slimcover, each ?2x) — it's built from the beatmapset id the same way
 * both the user's own example and osu_expertplus's reference button do.
 *
 * The copy-name button next to it copies the same "Artist - Title" string
 * used for the download filename (unsanitized) to the clipboard, for
 * pasting into search boxes, song request messages, etc.
 */
(function (global) {
  'use strict';

  const OsuEnhancer = (global.OsuEnhancer = global.OsuEnhancer || {});
  const sel = OsuEnhancer.selectors;

  const BUTTON_ATTR = 'data-osu-enhancer-cover-download';
  const COPY_BUTTON_ATTR = 'data-osu-enhancer-copy-name';

  function readBeatmapsetData() {
    const script = document.querySelector(sel.beatmapsetJson);
    const raw = script && script.textContent && script.textContent.trim();
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  // Characters Windows/macOS/Linux all either reject or silently mangle in
  // a filename, swapped for a plain underscore so the save always succeeds.
  function sanitizeFilename(name) {
    return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim();
  }

  function beatmapsetName(data, beatmapsetId) {
    return data && data.artist && data.title ? `${data.artist} - ${data.title}` : `beatmapset ${beatmapsetId}`;
  }

  function coverFilename(data, beatmapsetId) {
    return `${sanitizeFilename(beatmapsetName(data, beatmapsetId))} (cover).jpg`;
  }

  function buildButton(iconClass, title) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn-osu-big btn-osu-big--beatmapset-header-square';
    btn.title = title;
    btn.setAttribute('aria-label', title);

    const content = document.createElement('span');
    content.className = 'btn-osu-big__content btn-osu-big__content--center';

    const iconWrap = document.createElement('span');
    iconWrap.className = 'btn-osu-big__icon';

    const faFw = document.createElement('span');
    faFw.className = 'fa fa-fw';

    const icon = document.createElement('span');
    icon.className = iconClass;
    icon.setAttribute('aria-hidden', 'true');

    faFw.appendChild(icon);
    iconWrap.appendChild(faFw);
    content.appendChild(iconWrap);
    btn.appendChild(content);

    return { btn, icon };
  }

  function downloadCover(beatmapsetId, filename) {
    const url = `https://assets.ppy.sh/beatmaps/${beatmapsetId}/covers/fullsize.jpg`;
    chrome.runtime.sendMessage({ type: 'osu-enhancer:download-cover', url, filename });
  }

  function copyName(name, icon) {
    navigator.clipboard.writeText(name).then(() => {
      const original = icon.className;
      icon.className = 'fas fa-check';
      setTimeout(() => {
        icon.className = original;
      }, 1200);
    });
  }

  function apply(enabled) {
    const header = document.querySelector(sel.beatmapsetHeader);
    const buttons = header ? header.querySelector(sel.beatmapsetHeaderButtons) : null;

    if (!enabled || !buttons) {
      const existingDownload = document.querySelector(`[${BUTTON_ATTR}]`);
      if (existingDownload) existingDownload.remove();
      const existingCopy = document.querySelector(`[${COPY_BUTTON_ATTR}]`);
      if (existingCopy) existingCopy.remove();
      return;
    }

    if (buttons.querySelector(`[${BUTTON_ATTR}]`)) return;

    const data = readBeatmapsetData();
    const beatmapsetId = data ? Number(data.id) : null;
    if (!Number.isFinite(beatmapsetId)) return;

    const { btn: downloadBtn } = buildButton('fas fa-image', 'Download cover');
    downloadBtn.setAttribute(BUTTON_ATTR, '1');
    downloadBtn.addEventListener('click', () => downloadCover(beatmapsetId, coverFilename(data, beatmapsetId)));
    buttons.appendChild(downloadBtn);

    const { btn: copyBtn, icon: copyIcon } = buildButton('fas fa-copy', 'Copy name');
    copyBtn.setAttribute(COPY_BUTTON_ATTR, '1');
    copyBtn.addEventListener('click', () => copyName(beatmapsetName(data, beatmapsetId), copyIcon));
    buttons.appendChild(copyBtn);
  }

  OsuEnhancer.beatmapCoverDownload = { apply };
})(typeof window !== 'undefined' ? window : globalThis);
