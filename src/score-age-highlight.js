/**
 * Score age period highlight — the "scoreAgeHighlight" toggle. Concept,
 * period-slider scheme, and highlight styling are ported from
 * inix1257/osu_expertplus's "Score age period highlight" feature (per the
 * README's Credits & Inspiration section); independent reimplementation,
 * not copied code, adapted to this project's own class names and dark
 * palette.
 *
 * Scoped to the profile's Best Performance section only (same as the
 * reference — it calls this section "Top Ranks"), since that's the one
 * score list where "how long ago was this played" is actually interesting
 * to filter by — Recent is already sorted by recency, and Pinned/First
 * Place are small enough to just read.
 *
 * A slider (0-36) picks a highlight window: 0 = off, 1-4 = weeks, 5-28 =
 * months, 29-36 = 3-10 years. Rows whose own achieved-date falls inside
 * that window (or outside it, with "Reverse" on) get a colored ring. No
 * fetch needed — every row already carries its own exact date as the
 * `datetime` attribute on its native timeago element (see selectors.js).
 */
(function (global) {
  'use strict';

  const OsuEnhancer = (global.OsuEnhancer = global.OsuEnhancer || {});
  const sel = OsuEnhancer.selectors;

  const BAR_CLASS = 'osu-enhancer-age-filter';
  const HIGHLIGHT_CLASS = 'osu-enhancer-age-highlight';
  const REVERSE_ON_CLASS = 'osu-enhancer-age-filter__reverse--on';
  const SECTION_LABEL = 'Best Performance';

  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  const MS_PER_WEEK = 7 * MS_PER_DAY;
  const MS_PER_MONTH = (365.25 / 12) * MS_PER_DAY;
  const IDX_MIN = 0;
  const IDX_MAX = 36;
  const IDX_WEEK_END = 4;
  const IDX_MONTH_END = 28;
  const YEAR_START_IDX = 29;
  const FIRST_YEAR = 3;

  function clampIdx(n) {
    let x = Math.round(Number(n));
    if (!Number.isFinite(x)) x = IDX_MIN;
    return Math.min(IDX_MAX, Math.max(IDX_MIN, x));
  }

  function lookbackMs(idx) {
    const i = clampIdx(idx);
    if (i <= 0) return 0;
    if (i <= IDX_WEEK_END) return i * MS_PER_WEEK;
    if (i <= IDX_MONTH_END) return (i - IDX_WEEK_END) * MS_PER_MONTH;
    const years = i - YEAR_START_IDX + FIRST_YEAR;
    return years * 12 * MS_PER_MONTH;
  }

  function formatPeriodLabel(idx) {
    const i = clampIdx(idx);
    if (i <= 0) return 'No highlight';
    if (i <= IDX_WEEK_END) return i === 1 ? '1 week' : `${i} weeks`;
    if (i <= IDX_MONTH_END) {
      const mo = i - IDX_WEEK_END;
      return mo === 1 ? '1 month' : `${mo} months`;
    }
    const y = i - YEAR_START_IDX + FIRST_YEAR;
    return `${y} years`;
  }

  // Same section-finding technique as scores.js's applyRankNumbers
  // (duplicated rather than shared — see that file's own comment on the
  // heading markup this matches against). This module reads dates
  // straight from the DOM instead of scores.js's fetched score JSON since
  // every date it needs is already sitting right there in each row's own
  // native <time datetime>, with no per-row matching required.
  function findExactTextElement(label) {
    const headings = document.querySelectorAll(sel.scoreSectionHeading);
    for (const h of headings) {
      const firstNode = h.childNodes[0];
      const text = firstNode && firstNode.nodeType === Node.TEXT_NODE ? firstNode.textContent.trim() : '';
      if (text === label) return h;
    }
    return null;
  }

  function findFollowingScoreList(afterEl) {
    const result = document.evaluate(
      "following::*[contains(concat(' ', normalize-space(@class), ' '), ' play-detail-list ')][1]",
      afterEl,
      null,
      XPathResult.FIRST_ORDERED_NODE_TYPE,
      null
    );
    return result.singleNodeValue;
  }

  function findBestPerformanceList() {
    const heading = findExactTextElement(SECTION_LABEL);
    return heading ? findFollowingScoreList(heading) : null;
  }

  function rowTimeMs(row) {
    const time = row.querySelector(sel.scoreRowTime);
    if (!time) return null;
    const ms = Date.parse(time.getAttribute('datetime'));
    return Number.isFinite(ms) ? ms : null;
  }

  function applyHighlights(list, idx, reversed) {
    const rows = list.querySelectorAll(':scope > .play-detail');
    const i = clampIdx(idx);
    if (i === 0) {
      rows.forEach((row) => row.classList.remove(HIGHLIGHT_CLASS));
      return;
    }
    const cutoff = Date.now() - lookbackMs(i);
    rows.forEach((row) => {
      const ms = rowTimeMs(row);
      if (ms == null) {
        row.classList.remove(HIGHLIGHT_CLASS);
        return;
      }
      const inWindow = reversed ? ms < cutoff : ms >= cutoff;
      row.classList.toggle(HIGHLIGHT_CLASS, inWindow);
    });
  }

  function setLabels(statusEl, tailEl, idx, reversed) {
    const i = clampIdx(idx);
    if (i === 0) {
      statusEl.textContent = 'No highlight';
      tailEl.textContent = ' — drag to set a period.';
    } else {
      statusEl.textContent = formatPeriodLabel(i);
      tailEl.textContent = reversed ? ' · older scores highlighted' : ' · recent scores highlighted';
    }
  }

  function buildBar(list) {
    const statusEl = document.createElement('strong');
    statusEl.className = 'osu-enhancer-age-filter__period';
    const tailEl = document.createElement('span');
    tailEl.className = 'osu-enhancer-age-filter__tail';
    setLabels(statusEl, tailEl, 0, false);

    const text = document.createElement('p');
    text.className = 'osu-enhancer-age-filter__text';
    text.append(statusEl, tailEl);

    const resetBtn = document.createElement('button');
    resetBtn.type = 'button';
    resetBtn.className = 'osu-enhancer-age-filter__btn';
    resetBtn.setAttribute('aria-label', 'Reset period and reverse');
    resetBtn.textContent = 'Reset';

    const revBtn = document.createElement('button');
    revBtn.type = 'button';
    revBtn.className = 'osu-enhancer-age-filter__btn osu-enhancer-age-filter__reverse';
    revBtn.setAttribute('aria-pressed', 'false');
    revBtn.setAttribute('aria-label', 'Reverse highlight to older scores outside the period');
    revBtn.textContent = 'Reverse';

    const actions = document.createElement('div');
    actions.className = 'osu-enhancer-age-filter__actions';
    actions.append(resetBtn, revBtn);

    const row = document.createElement('div');
    row.className = 'osu-enhancer-age-filter__row';
    row.append(text, actions);

    const range = document.createElement('input');
    range.type = 'range';
    range.className = 'osu-enhancer-age-filter__range';
    range.min = String(IDX_MIN);
    range.max = String(IDX_MAX);
    range.step = '1';
    range.value = '0';
    range.setAttribute('aria-label', 'Highlight window: off, then weeks, months, and years');

    const bar = document.createElement('div');
    bar.className = BAR_CLASS;
    bar.append(row, range);

    const readReversed = () => revBtn.getAttribute('aria-pressed') === 'true';

    range.addEventListener('input', () => {
      const idx = clampIdx(range.value);
      setLabels(statusEl, tailEl, idx, readReversed());
      applyHighlights(list, idx, readReversed());
    });

    revBtn.addEventListener('click', () => {
      const next = !readReversed();
      revBtn.setAttribute('aria-pressed', next ? 'true' : 'false');
      revBtn.classList.toggle(REVERSE_ON_CLASS, next);
      const idx = clampIdx(range.value);
      setLabels(statusEl, tailEl, idx, next);
      applyHighlights(list, idx, next);
    });

    resetBtn.addEventListener('click', () => {
      range.value = '0';
      revBtn.setAttribute('aria-pressed', 'false');
      revBtn.classList.remove(REVERSE_ON_CLASS);
      setLabels(statusEl, tailEl, 0, false);
      applyHighlights(list, 0, false);
    });

    return bar;
  }

  // Only one Best Performance section exists per profile page, so a plain
  // existence check is enough — building fresh every rescan (content.js
  // calls apply() on a ~400ms debounce) would reset whatever period/
  // reverse state the viewer had picked.
  function ensureBar(list) {
    const existing = document.querySelector(`.${BAR_CLASS}`);
    if (existing) return existing;
    const bar = buildBar(list);
    list.parentElement.insertBefore(bar, list);
    return bar;
  }

  function apply(enabled) {
    const list = findBestPerformanceList();

    if (!enabled || !list) {
      document.querySelectorAll(`.${BAR_CLASS}`).forEach((el) => el.remove());
      document.querySelectorAll(`.${HIGHLIGHT_CLASS}`).forEach((el) => el.classList.remove(HIGHLIGHT_CLASS));
      return;
    }

    const bar = ensureBar(list);
    const range = bar.querySelector('.osu-enhancer-age-filter__range');
    const revBtn = bar.querySelector('.osu-enhancer-age-filter__reverse');
    // "Show more" can add up to 200 rows to this same list (see scores.js) —
    // re-applying against the bar's current state on every rescan is what
    // picks those up, same as the reference's own MutationObserver does.
    applyHighlights(list, clampIdx(range.value), revBtn.getAttribute('aria-pressed') === 'true');
  }

  OsuEnhancer.scoreAgeHighlight = { apply };
})(typeof window !== 'undefined' ? window : globalThis);
