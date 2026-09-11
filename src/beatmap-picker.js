/**
 * Difficulty names + star rating on the beatmapset picker tray (the row of
 * small diff-colored circle icons above the title on a beatmapset page) —
 * the "pickerDiffNames" toggle. Concept and pill-shaped layout inspired by
 * inix1257/osu_expertplus's picker-diff-names feature (per the README's
 * Credits & Inspiration section); this is an independent reimplementation,
 * not copied code — no rating/color computation of its own is needed
 * either way, since both the diff colors and the beatmap list already come
 * straight from data osu-web itself renders (see selectors.js).
 *
 * Each picker anchor gets one appended `.osu-enhancer-picker-meta` span
 * (name on top, star rating below), colored from that icon's own `--diff`
 * custom property copied onto the anchor — see styles/theme.css for the
 * pill layout and the color-mix() used to lighten very dark diff colors
 * (e.g. the near-black top of osu!'s own extreme/ultimate range) into
 * something readable as text on a dark background.
 */
(function (global) {
  'use strict';

  const OsuEnhancer = (global.OsuEnhancer = global.OsuEnhancer || {});
  const sel = OsuEnhancer.selectors;

  const ENABLED_CLASS = 'osu-enhancer-picker-names-enabled';
  const META_ATTR = 'data-osu-enhancer-picker-meta';
  const DIFF_VAR = '--osu-enhancer-diff-src';

  // osu! truncates (never rounds up) displayed star ratings to 2 decimals —
  // same reasoning/behavior as scores.js's own formatStars, duplicated here
  // rather than shared since it's two lines and this module has no other
  // reason to depend on scores.js.
  function formatStars(stars) {
    return (Math.floor(stars * 100) / 100).toFixed(2);
  }

  function beatmapIdFromAnchor(a) {
    const href = a.getAttribute('href') || '';
    const m = href.match(/#[a-z]+\/(\d+)\s*$/i);
    return m ? Number(m[1]) : null;
  }

  function readBeatmapsetData() {
    const script = document.querySelector(sel.beatmapsetJson);
    const raw = script && script.textContent && script.textContent.trim();
    if (!raw) return null;

    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return null;
    }
    if (!data || !Array.isArray(data.beatmaps)) return null;

    const map = new Map();
    for (const bm of data.beatmaps) {
      const id = Number(bm.id);
      if (!Number.isFinite(id)) continue;
      const rating = Number(bm.difficulty_rating);
      map.set(id, {
        version: bm.version != null ? String(bm.version) : '',
        rating: Number.isFinite(rating) ? rating : null,
      });
    }
    return map;
  }

  function buildMeta() {
    const meta = document.createElement('span');
    meta.className = 'osu-enhancer-picker-meta';
    meta.setAttribute(META_ATTR, '1');

    const version = document.createElement('span');
    version.className = 'osu-enhancer-picker-version';

    const star = document.createElement('span');
    star.className = 'osu-enhancer-picker-star';

    meta.appendChild(version);
    meta.appendChild(star);
    return meta;
  }

  function syncRow(a, dataMap) {
    const id = beatmapIdFromAnchor(a);
    const entry = id != null ? dataMap.get(id) : null;

    let meta = a.querySelector(`[${META_ATTR}]`);
    if (!meta) {
      meta = buildMeta();
      a.appendChild(meta);
    }

    const icon = a.querySelector(sel.beatmapPickerIcon);
    const diff = icon
      ? (icon.style.getPropertyValue('--diff') || getComputedStyle(icon).getPropertyValue('--diff')).trim()
      : '';
    if (diff) a.style.setProperty(DIFF_VAR, diff);
    else a.style.removeProperty(DIFF_VAR);

    meta.querySelector('.osu-enhancer-picker-version').textContent = entry ? entry.version : '';

    const starEl = meta.querySelector('.osu-enhancer-picker-star');
    if (entry && entry.rating != null) {
      starEl.textContent = `★ ${formatStars(entry.rating)}`;
      starEl.style.display = '';
    } else {
      starEl.textContent = '';
      starEl.style.display = 'none';
    }
  }

  function removeMeta(a) {
    const meta = a.querySelector(`[${META_ATTR}]`);
    if (meta) meta.remove();
    a.style.removeProperty(DIFF_VAR);
  }

  function apply(enabled) {
    const header = document.querySelector(sel.beatmapsetHeader);
    if (!header) return;

    const picker = header.querySelector(sel.beatmapPicker);
    const anchors = picker ? picker.querySelectorAll(sel.beatmapPickerItem) : [];

    // Also bails (and cleans up) if #json-beatmapset is missing/unparsable
    // — without it there's no name/rating to show, so leaving the native
    // tray untouched beats an enabled layout with empty pills.
    const dataMap = enabled && picker ? readBeatmapsetData() : null;

    if (!dataMap) {
      header.classList.remove(ENABLED_CLASS);
      anchors.forEach(removeMeta);
      return;
    }

    header.classList.add(ENABLED_CLASS);
    anchors.forEach((a) => syncRow(a, dataMap));
  }

  OsuEnhancer.beatmapPicker = { apply };
})(typeof window !== 'undefined' ? window : globalThis);
