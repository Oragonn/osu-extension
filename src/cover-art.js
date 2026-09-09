/**
 * Beatmap cover art backgrounds for score rows (US-010/FR-9).
 *
 * The cover is painted via a `::before` on the row (`.play-detail`, already
 * `position: relative`) rather than the row's own `background` — see
 * theme.css's `[data-osu-enhancer-cover]::before` rule for why (pinned rows
 * need it inset to exclude the drag handle's gutter). `.play-detail__group--
 * top` / `.play-detail__score-detail` render their own opaque backgrounds on
 * top of the row, so theme.css punches those two transparent on cover-
 * enabled rows so the image actually shows through.
 *
 * Marked with an attribute rather than a class: osu-web's own React re-
 * renders a row's full `className` from scratch on things as small as
 * opening its "..." menu, silently wiping any class added here from the
 * outside — confirmed live (clicking `.popup-menu` turned
 * "play-detail play-detail--highlightable osu-enhancer-cover-row" into
 * just "play-detail play-detail--active", cover gone). A plain attribute
 * survived the exact same re-render untouched, since React only manages
 * attributes it explicitly sets itself.
 *
 * The cover URL itself comes straight from the score JSON osu! already
 * serves (scores.js), so no CDN URL pattern needs to be guessed here.
 */
(function (global) {
  'use strict';

  const OsuEnhancer = (global.OsuEnhancer = global.OsuEnhancer || {});

  const APPLIED_ATTR = 'data-osu-enhancer-cover';

  /** Fallback in case a score doesn't carry a cover URL: osu!'s public, unauthenticated beatmap CDN. */
  function fallbackCoverUrl(beatmapsetId) {
    return `https://assets.ppy.sh/beatmaps/${beatmapsetId}/covers/list@2x.jpg`;
  }

  function applyCoverArt(row, beatmapsetId, coverUrl) {
    if (row.getAttribute(APPLIED_ATTR) === String(beatmapsetId)) return;

    const url = coverUrl || fallbackCoverUrl(beatmapsetId);
    // Applied optimistically (no waiting on a separate probe image's load
    // event first) — the browser has to fetch it either way, so pre-probing
    // just adds a second round trip before anything shows up. A background
    // check still cleans up the rare broken/404 image after the fact.
    // Attribute set last: this doubles as the "already applied" marker
    // above, so it should only go on once the row is actually in this state.
    row.style.setProperty('--osu-enhancer-cover-url', `url("${url}")`);
    row.setAttribute(APPLIED_ATTR, String(beatmapsetId));

    const probe = new Image();
    probe.onerror = () => removeCoverArt(row);
    probe.src = url;
  }

  function removeCoverArt(row) {
    row.style.removeProperty('--osu-enhancer-cover-url');
    row.removeAttribute(APPLIED_ATTR);
  }

  OsuEnhancer.coverArt = { applyCoverArt, removeCoverArt };
})(typeof window !== 'undefined' ? window : globalThis);
