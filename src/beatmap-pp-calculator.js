/**
 * "PP Calculator" panel on beatmapset pages (the "beatmapPpCalculator"
 * toggle) — a top-right corner button, in the same spirit as src/pp-
 * potential.js's profile-page panel, that works out the pp for a
 * *hypothetical* score on whichever difficulty is currently open: pick
 * Lazer or Stable, toggle real mods, enter either a target accuracy or
 * exact 300/100/50 hit counts, set combo/misses, and (Lazer only) optional
 * slider-end/large-tick/small-tick counts — see rosu-engine.js's
 * calculatePp doc for why those three have no stable equivalent.
 *
 * The current beatmap id + mode come from the URL hash
 * (`#osu/<id>` etc.), the same signal src/leaderboard-mod-filter.js
 * already relies on for the same page.
 *
 * All the actual math is delegated to OsuEnhancer.ppCalc (src/pp-calc.js),
 * which is already engine-agnostic (rosu-pp / official) and already
 * threads accuracy-vs-exact-counts and the lazer-only judgement fields
 * through — this file is purely the form UI on top of it.
 */
(function (global) {
  'use strict';

  const OsuEnhancer = (global.OsuEnhancer = global.OsuEnhancer || {});
  const sel = OsuEnhancer.selectors;

  const BTN_CLASS = 'osu-enhancer-pp-calc-btn';
  const PANEL_CLASS = 'osu-enhancer-pp-calc-panel';
  const RECALC_DEBOUNCE_MS = 350;

  // ---------------- Mods ----------------

  // Same per-acronym plate color osu's own site uses (matches
  // src/leaderboard-mod-filter.js's MOD_TYPES) — RX/AP/relax-family mods
  // are deliberately left out, same reasoning as everywhere else in this
  // extension: osu!'s own API already returns pp: null for those, so a
  // "calculated" number here would just be fiction.
  const MOD_TYPES = {
    EZ: 'DifficultyReduction',
    NF: 'DifficultyReduction',
    HT: 'DifficultyReduction',
    HR: 'DifficultyIncrease',
    SD: 'DifficultyIncrease',
    PF: 'DifficultyIncrease',
    DT: 'DifficultyIncrease',
    NC: 'DifficultyIncrease',
    HD: 'DifficultyIncrease',
    FL: 'DifficultyIncrease',
    SO: 'Automation',
  };
  const MOD_TITLES = {
    EZ: 'Easy',
    NF: 'No Fail',
    HT: 'Half Time',
    HD: 'Hidden',
    HR: 'Hard Rock',
    SD: 'Sudden Death',
    PF: 'Perfect',
    DT: 'Double Time',
    NC: 'Nightcore',
    FL: 'Flashlight',
    SO: 'Spun Out',
  };
  const MOD_ORDER = ['EZ', 'NF', 'HT', 'HD', 'HR', 'SD', 'PF', 'DT', 'NC', 'FL', 'SO'];
  // Same three exclusion pairs osu!'s own mod-select screen enforces:
  // EZ/HR are opposite difficulty adjustments, DT/NC/HT can't combine (two
  // rate changes at once), SD/PF can't combine (PF is the stricter of the
  // two, picking one always clears the other).
  const MOD_EXCLUDES = {
    EZ: ['HR'],
    HR: ['EZ'],
    HT: ['DT', 'NC'],
    DT: ['HT', 'NC'],
    NC: ['HT', 'DT'],
    SD: ['PF'],
    PF: ['SD'],
  };

  function buildModIcon(acronym) {
    const wrap = document.createElement('div');
    wrap.className = `mod mod--type-${MOD_TYPES[acronym] || 'DifficultyIncrease'}`;
    // Same centering trick as leaderboard-mod-filter.js's buildNativeModIcon
    // — an inline style wins regardless of the vendored dark theme's own
    // .mod/.mod__icon rules loading before or after this.
    wrap.style.cssText = '--mod-height: 26px; position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);';
    const icon = document.createElement('div');
    icon.className = `mod__icon mod__icon--${acronym}`;
    wrap.appendChild(icon);
    return wrap;
  }

  // ---------------- Beatmap context ----------------

  function isBeatmapPage() {
    return !!document.querySelector(sel.beatmapsetHeader);
  }

  function getCurrentBeatmapContext() {
    const match = location.hash.match(/^#(osu|taiko|fruits|mania)\/(\d+)/);
    if (!match) return null;
    return { beatmapId: Number(match[2]), mode: match[1] };
  }

  function readBeatmapMeta(beatmapId) {
    const script = document.querySelector(sel.beatmapsetJson);
    const raw = script && script.textContent && script.textContent.trim();
    if (!raw) return null;
    try {
      const data = JSON.parse(raw);
      const bm = Array.isArray(data.beatmaps) ? data.beatmaps.find((b) => Number(b.id) === beatmapId) : null;
      return {
        artist: data.artist || '',
        title: data.title || '',
        version: bm && bm.version != null ? String(bm.version) : '',
      };
    } catch {
      return null;
    }
  }

  // ---------------- Parsing / formatting ----------------

  function parseNonNegInt(text) {
    const n = parseInt(text, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }

  function parseAccuracyInput(text) {
    const n = parseFloat(text);
    if (!Number.isFinite(n)) return 100;
    return Math.max(0, Math.min(100, n));
  }

  // Standard osu!std accuracy formula — used only for the live readout when
  // the player is entering exact hit counts rather than a target accuracy.
  function accuracyFromCounts(n300, n100, n50, misses) {
    const total = n300 + n100 + n50 + misses;
    if (total <= 0) return 0;
    return ((n300 * 300 + n100 * 100 + n50 * 50) / (total * 300)) * 100;
  }

  function formatPp(pp) {
    return pp.toFixed(2);
  }

  function formatStars(stars) {
    return (Math.floor(stars * 100) / 100).toFixed(2);
  }

  // ---------------- UI ----------------

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  // The hint (e.g. "/ 842 max") renders below the input rather than beside
  // it in the same flex row — sharing that row let a 3-4 digit combo get
  // squeezed narrow enough to scroll inside its own input instead of
  // showing fully (see the "+999 combo, can't see it fully" feedback).
  function buildField(labelText, inputEl, hintEl) {
    const field = el('div', 'osu-enhancer-pp-calc-field');
    field.appendChild(el('span', 'osu-enhancer-pp-calc-field__label', labelText));
    const row = el('div', 'osu-enhancer-pp-calc-field__row');
    row.appendChild(inputEl);
    field.appendChild(row);
    if (hintEl) field.appendChild(hintEl);
    return field;
  }

  function buildNumberInput(placeholder) {
    const input = document.createElement('input');
    input.type = 'text';
    input.inputMode = 'decimal';
    input.className = 'osu-enhancer-pp-calc-input';
    input.autocomplete = 'off';
    input.spellcheck = false;
    if (placeholder != null) input.placeholder = placeholder;
    return input;
  }

  // Pill-style segmented control, same interaction as settings-panel.js's
  // buildSegmented but self-contained (no chrome.storage binding — this
  // panel's state only needs to live as long as the page does).
  function buildSegmented(options, initialValue, onChange) {
    const seg = el('div', 'osu-enhancer-pp-calc-segmented');
    seg.setAttribute('role', 'radiogroup');
    let value = initialValue;
    const buttons = options.map(([optValue, label]) => {
      const b = el('button', 'osu-enhancer-pp-calc-seg-btn', label);
      b.type = 'button';
      b.setAttribute('role', 'radio');
      seg.appendChild(b);
      return { value: optValue, b };
    });
    function mark() {
      buttons.forEach(({ value: v, b }) => {
        const on = v === value;
        b.classList.toggle('osu-enhancer-pp-calc-seg-btn--active', on);
        b.setAttribute('aria-checked', String(on));
      });
    }
    buttons.forEach(({ value: v, b }) =>
      b.addEventListener('click', () => {
        if (v === value) return;
        value = v;
        mark();
        onChange(value);
      })
    );
    mark();
    return {
      el: seg,
      get value() { return value; },
      // Sets the value without firing onChange — used to apply a
      // remembered value loaded from storage, where the caller drives its
      // own side effects (see the ruleset's storage load below) instead of
      // re-entering the click handler's.
      setValue(v) {
        if (v === value) return;
        value = v;
        mark();
      },
    };
  }

  function buildPanel() {
    const panel = el('div', PANEL_CLASS);
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'PP calculator');

    // ---- Ruleset (Lazer / Stable) — lives in the header (see below) rather
    // than its own card, to keep the scrollable body shorter.
    // Remembered across page reloads/sessions (see the accuracy field's own
    // comment below for the same pattern) — `rulesetTouched` guards against
    // this async load clobbering a click the player already made in the
    // moment before it resolves.
    let rulesetTouched = false;
    const ruleset = buildSegmented(
      [
        ['lazer', 'Lazer'],
        ['stable', 'Stable'],
      ],
      'lazer',
      (value) => {
        rulesetTouched = true;
        OsuEnhancer.storage.setToggle('beatmapPpCalcLastRuleset', value);
        syncLazerFieldsVisibility();
        scheduleRecalc(true);
      }
    );
    ruleset.el.classList.add('osu-enhancer-pp-calc-panel__ruleset');
    OsuEnhancer.storage.getToggles().then((toggles) => {
      if (rulesetTouched || toggles.beatmapPpCalcLastRuleset === ruleset.value) return;
      if (toggles.beatmapPpCalcLastRuleset !== 'lazer' && toggles.beatmapPpCalcLastRuleset !== 'stable') return;
      ruleset.setValue(toggles.beatmapPpCalcLastRuleset);
      syncLazerFieldsVisibility();
      scheduleRecalc(true);
    });

    // ---- Header
    const header = el('div', 'osu-enhancer-pp-calc-panel__header');
    const headerTop = el('div', 'osu-enhancer-pp-calc-panel__header-top');
    const headerText = el('div', 'osu-enhancer-pp-calc-panel__header-text');
    headerText.appendChild(el('span', 'osu-enhancer-pp-calc-panel__title', 'PP Calculator'));
    const subtitle = el('span', 'osu-enhancer-pp-calc-panel__subtitle', '');
    headerText.appendChild(subtitle);
    headerTop.appendChild(headerText);
    const closeBtn = el('button', 'osu-enhancer-pp-calc-panel__close', '×');
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'Close');
    headerTop.appendChild(closeBtn);
    header.appendChild(headerTop);
    header.appendChild(ruleset.el);
    panel.appendChild(header);

    const body = el('div', 'osu-enhancer-pp-calc-panel__body');
    panel.appendChild(body);

    const emptyState = el(
      'div',
      'osu-enhancer-pp-calc-panel__empty',
      'Pick a difficulty above to calculate pp for it.'
    );
    body.appendChild(emptyState);

    const form = el('div', 'osu-enhancer-pp-calc-form');
    form.hidden = true;
    body.appendChild(form);

    // ---- Mods
    const modsGroup = el('div', 'osu-enhancer-pp-calc-group');
    modsGroup.appendChild(el('div', 'osu-enhancer-pp-calc-group__label', 'Mods'));
    const modsGrid = el('div', 'osu-enhancer-pp-calc-mods-grid');
    const selectedMods = new Set();
    const modButtons = new Map();
    function syncModButtons() {
      modButtons.forEach((b, acronym) => {
        b.classList.toggle('osu-enhancer-mod-filter-btn--active', selectedMods.has(acronym));
      });
    }
    MOD_ORDER.forEach((acronym) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'osu-enhancer-mod-filter-btn';
      b.title = MOD_TITLES[acronym] || acronym;
      b.appendChild(buildModIcon(acronym));
      b.addEventListener('click', () => {
        if (selectedMods.has(acronym)) {
          selectedMods.delete(acronym);
        } else {
          (MOD_EXCLUDES[acronym] || []).forEach((ex) => selectedMods.delete(ex));
          selectedMods.add(acronym);
        }
        syncModButtons();
        scheduleRecalc(true);
      });
      modButtons.set(acronym, b);
      modsGrid.appendChild(b);
    });
    modsGroup.appendChild(modsGrid);
    form.appendChild(modsGroup);

    // ---- Judgements (accuracy or exact hit counts)
    const judgementGroup = el('div', 'osu-enhancer-pp-calc-group');
    judgementGroup.appendChild(el('div', 'osu-enhancer-pp-calc-group__label', 'Judgements'));
    const judgement = buildSegmented(
      [
        ['accuracy', 'Accuracy'],
        ['counts', '300 / 100 / 50'],
      ],
      'accuracy',
      (value) => {
        accuracyFields.hidden = value !== 'accuracy';
        countFields.hidden = value !== 'counts';
        scheduleRecalc(true);
      }
    );
    judgementGroup.appendChild(judgement.el);

    const accuracyFields = el('div', 'osu-enhancer-pp-calc-fields');
    const accuracyInput = buildNumberInput('100');
    accuracyInput.value = '100';
    // Remembered across page reloads/sessions (see the "acc should be
    // remembered" feedback) — same storage-toggle pattern as pp-potential.js's
    // last-misses value. `accuracyTouched` guards against this async load
    // clobbering something the player already typed in the moment before it
    // resolves.
    let accuracyTouched = false;
    accuracyInput.addEventListener('input', () => {
      accuracyTouched = true;
    });
    OsuEnhancer.storage.getToggles().then((toggles) => {
      if (accuracyTouched || toggles.beatmapPpCalcLastAccuracy == null) return;
      accuracyInput.value = String(toggles.beatmapPpCalcLastAccuracy);
      scheduleRecalc(true);
    });
    accuracyFields.appendChild(buildField('Accuracy %', accuracyInput));
    judgementGroup.appendChild(accuracyFields);

    const countFields = el('div', 'osu-enhancer-pp-calc-fields');
    countFields.hidden = true;
    const n300Input = buildNumberInput('0');
    const n100Input = buildNumberInput('0');
    const n50Input = buildNumberInput('0');
    countFields.appendChild(buildField('300', n300Input));
    countFields.appendChild(buildField('100', n100Input));
    countFields.appendChild(buildField('50', n50Input));
    judgementGroup.appendChild(countFields);

    const accReadout = el('div', 'osu-enhancer-pp-calc-acc-readout', '');
    judgementGroup.appendChild(accReadout);

    // Lazer-only judgement extras, folded into this same group (rather than
    // a separate card) to keep the panel's total height down — see the
    // "make it so I don't have to scroll" feedback. Left blank = assumed
    // all hit; Stable scores have no equivalent, hence the title tooltip
    // instead of a standing line of body text.
    const lazerFields = el('div', 'osu-enhancer-pp-calc-fields osu-enhancer-pp-calc-lazer-fields');
    lazerFields.title = 'Lazer only, optional — left blank = assumed all hit. Stable scores have no equivalent.';
    const sliderEndInput = buildNumberInput('all');
    const largeTickInput = buildNumberInput('all');
    const smallTickInput = buildNumberInput('all');
    lazerFields.appendChild(buildField('Slider ends', sliderEndInput));
    lazerFields.appendChild(buildField('Large ticks', largeTickInput));
    lazerFields.appendChild(buildField('Small ticks', smallTickInput));
    judgementGroup.appendChild(lazerFields);
    form.appendChild(judgementGroup);

    function syncLazerFieldsVisibility() {
      lazerFields.hidden = ruleset.value !== 'lazer';
    }
    syncLazerFieldsVisibility();

    // ---- Combo & misses
    const comboGroup = el('div', 'osu-enhancer-pp-calc-group');
    comboGroup.appendChild(el('div', 'osu-enhancer-pp-calc-group__label', 'Combo & misses'));
    const comboFields = el('div', 'osu-enhancer-pp-calc-fields');
    const comboInput = buildNumberInput('0');
    const comboHint = el('span', 'osu-enhancer-pp-calc-field__hint', '');
    const comboField = buildField('Combo', comboInput, comboHint);
    // Combo can run to 4 digits on long maps — give it noticeably more room
    // than misses/the FC button, which never need more than 2-3 characters
    // (see the "+999 combo, can't see it fully" / "misses input too big"
    // feedback).
    comboField.classList.add('osu-enhancer-pp-calc-field--wide');
    comboFields.appendChild(comboField);
    const missesInput = buildNumberInput('0');
    missesInput.value = '0';
    const missesField = buildField('Misses', missesInput);
    missesField.classList.add('osu-enhancer-pp-calc-field--narrow');
    comboFields.appendChild(missesField);
    // Inline rather than a full-width row below — same height as the
    // inputs beside it, to keep this group compact (see the "don't make me
    // scroll" feedback on the Lazer view).
    const fcField = el('div', 'osu-enhancer-pp-calc-field osu-enhancer-pp-calc-field--narrow');
    fcField.appendChild(el('span', 'osu-enhancer-pp-calc-field__label', ' '));
    const fcBtn = el('button', 'osu-enhancer-pp-calc-fc-btn', 'FC');
    fcBtn.type = 'button';
    fcBtn.title = 'Full combo — fills max combo, 0 misses';
    fcField.appendChild(fcBtn);
    comboFields.appendChild(fcField);
    comboGroup.appendChild(comboFields);
    form.appendChild(comboGroup);

    // ---- Result
    const result = el('div', 'osu-enhancer-pp-calc-result');
    result.hidden = true;
    const resultPp = el('div', 'osu-enhancer-pp-calc-result__pp', '— pp');
    result.appendChild(resultPp);
    const resultMeta = el('div', 'osu-enhancer-pp-calc-result__meta');
    const starsChip = el('span', 'osu-enhancer-pp-calc-result__chip', '★ —');
    const accChip = el('span', 'osu-enhancer-pp-calc-result__chip', '◆ —%');
    const comboChip = el('span', 'osu-enhancer-pp-calc-result__chip', '× —');
    resultMeta.appendChild(starsChip);
    resultMeta.appendChild(accChip);
    resultMeta.appendChild(comboChip);
    result.appendChild(resultMeta);
    panel.appendChild(result);

    // ---- Open/close plumbing
    function setOpen(open) {
      panel.classList.toggle('osu-enhancer-pp-calc-panel--open', open);
    }
    closeBtn.addEventListener('click', () => setOpen(false));
    // Closing requires both the press and the release to land outside the
    // panel, so selecting text inside and releasing the mouse outside it
    // doesn't close the panel mid-selection.
    let outsidePointerDown = false;
    document.addEventListener('mousedown', (e) => {
      outsidePointerDown = !panel.contains(e.target) && !e.target.closest(`.${BTN_CLASS}`);
    });
    document.addEventListener('mouseup', (e) => {
      if (
        outsidePointerDown &&
        panel.classList.contains('osu-enhancer-pp-calc-panel--open') &&
        !panel.contains(e.target) &&
        !e.target.closest(`.${BTN_CLASS}`)
      ) {
        setOpen(false);
      }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') setOpen(false);
    });
    panel.addEventListener('click', (e) => e.stopPropagation());

    // ---- Calculation
    let recalcToken = 0;
    let debounceHandle = null;
    let lastBeatmapId = null;

    // Each of these fields gets auto-filled with this beatmap's real max
    // once it's known (see refreshMapDefaults) — "touched" stops that
    // autofill from clobbering a value the player already typed in.
    let comboTouched = false;
    let n300Touched = false;
    let sliderEndTouched = false;
    let largeTickTouched = false;
    comboInput.addEventListener('input', () => {
      comboTouched = true;
      scheduleRecalc();
    });
    n300Input.addEventListener('input', () => {
      n300Touched = true;
      scheduleRecalc();
    });
    sliderEndInput.addEventListener('input', () => {
      sliderEndTouched = true;
      scheduleRecalc();
    });
    largeTickInput.addEventListener('input', () => {
      largeTickTouched = true;
      scheduleRecalc();
    });
    // "Full combo" means the smart default (max combo, 0 misses), not a
    // custom value the player typed in — so it un-sticks combo/300 from any
    // earlier manual edit and hands them back to the misses-tracking
    // defaults below, rather than marking them touched the way direct
    // typing does. Without this, clicking it once would permanently freeze
    // combo/300 at the map max even after the player then typed in misses
    // (exactly the "combo can't be at max if I got misses" bug).
    fcBtn.addEventListener('click', () => {
      missesInput.value = '0';
      comboTouched = false;
      n300Touched = false;
      applyComboDefault();
      applyN300Default();
      scheduleRecalc(true);
    });
    missesInput.addEventListener('input', () => {
      applyComboDefault();
      applyN300Default();
      scheduleRecalc();
    });
    [accuracyInput, n100Input, n50Input, smallTickInput].forEach((input) => {
      input.addEventListener('input', () => scheduleRecalc());
    });

    // A miss breaks combo, so the achieved combo can never actually sit at
    // the map's max once misses > 0 — this mirrors applyN300Default's own
    // max-combo-minus-misses logic (see the "combo can't be at max if I got
    // misses" feedback). No-ops until the max combo is known or once the
    // player's typed a custom combo in directly.
    function applyComboDefault() {
      if (comboTouched || !fcBtn.dataset.maxCombo) return;
      const maxCombo = Number(fcBtn.dataset.maxCombo);
      const misses = parseNonNegInt(missesInput.value);
      comboInput.value = String(Math.max(0, maxCombo - misses));
    }

    // n300's default tracks max-combo-minus-misses (same "assume the rest
    // were 300s" FC logic the Combo field itself uses) rather than the
    // map's real hit-object count — the latter is the more technically
    // exact ceiling for an n300 count, but came out looking "halved" next
    // to the combo/max-combo numbers already on screen for any map with
    // sliders (each slider is one object but many combo), which is exactly
    // the "300 should be max combo - miss" feedback. No-ops until the max
    // combo is known or once the player's typed into the 300 field directly.
    function applyN300Default() {
      if (n300Touched || !fcBtn.dataset.maxCombo) return;
      const maxCombo = Number(fcBtn.dataset.maxCombo);
      const misses = parseNonNegInt(missesInput.value);
      n300Input.value = String(Math.max(0, maxCombo - misses));
    }

    function scheduleRecalc(immediate) {
      if (debounceHandle) clearTimeout(debounceHandle);
      if (immediate) {
        recalc();
        return;
      }
      debounceHandle = setTimeout(recalc, RECALC_DEBOUNCE_MS);
    }

    // Fills combo/300/slider-ends/large-ticks in with this beatmap's real
    // ceiling instead of leaving them at 0/blank, once it's known — see the
    // "300 should have max combo by default" / "slider ends etc should be
    // the max number, not empty" feedback. nSliders/nLargeTicks come back
    // null on the official engine (no beatmap-level breakdown exposed by
    // that bridge — see calculateObjectCounts's own doc in each engine
    // file), in which case those two fields are just left as they were
    // rather than filled with a guess.
    async function refreshMapDefaults(beatmapId) {
      const counts = await OsuEnhancer.ppCalc.calculateObjectCounts(beatmapId);
      const stillCurrent = getCurrentBeatmapContext();
      if (!stillCurrent || stillCurrent.beatmapId !== beatmapId) return; // stale — difficulty changed again meanwhile
      if (!counts) {
        comboHint.textContent = '';
        delete fcBtn.dataset.maxCombo;
        return;
      }
      let changed = false;
      if (counts.maxCombo != null) {
        comboHint.textContent = `/ ${counts.maxCombo} max`;
        fcBtn.dataset.maxCombo = String(counts.maxCombo);
        if (!comboTouched) {
          applyComboDefault();
          changed = true;
        }
        if (!n300Touched) {
          applyN300Default();
          changed = true;
        }
      }
      if (counts.nSliders != null && !sliderEndTouched) {
        sliderEndInput.value = String(counts.nSliders);
        changed = true;
      }
      if (counts.nLargeTicks != null && !largeTickTouched) {
        largeTickInput.value = String(counts.nLargeTicks);
        changed = true;
      }
      if (changed) scheduleRecalc(true);
    }

    function updateSubtitle(ctx) {
      const meta = readBeatmapMeta(ctx.beatmapId);
      subtitle.textContent = meta && meta.artist ? `${meta.artist} - ${meta.title} [${meta.version}]` : '';
    }

    function setResultLoading(loading) {
      resultPp.classList.toggle('osu-enhancer-pp-calc-result__pp--loading', loading);
    }

    function renderError() {
      resultPp.textContent = '—';
      starsChip.textContent = '★ —';
      accChip.textContent = "Couldn't calculate";
      comboChip.textContent = '';
    }

    function renderResult(pp, stars, usedAccuracy, comboText) {
      resultPp.textContent = pp != null ? `${formatPp(pp)}pp` : '—';
      starsChip.textContent = stars != null ? `★ ${formatStars(stars)}` : '★ —';
      accChip.textContent = `◆ ${usedAccuracy.toFixed(2)}%`;
      comboChip.textContent = comboText;
    }

    async function recalc() {
      const ctx = getCurrentBeatmapContext();
      if (!ctx) {
        emptyState.hidden = false;
        form.hidden = true;
        result.hidden = true;
        lastBeatmapId = null;
        return;
      }
      emptyState.hidden = true;
      form.hidden = false;
      result.hidden = false;
      updateSubtitle(ctx);

      if (ctx.beatmapId !== lastBeatmapId) {
        lastBeatmapId = ctx.beatmapId;
        comboTouched = false;
        n300Touched = false;
        sliderEndTouched = false;
        largeTickTouched = false;
        comboHint.textContent = '';
        refreshMapDefaults(ctx.beatmapId);
      }

      const mods = Array.from(selectedMods).map((acronym) => ({ acronym }));
      const isLegacy = ruleset.value === 'stable';
      // rosu-pp (the default engine) has no separate "legacy score" flag —
      // it only tells classic/stable scoring apart from lazer scoring via
      // the real "Classic" (CL) mod, the same way lazer itself does (a
      // stable-set score always implies CL under the hood). The official
      // engine is handed `isLegacy` too (below) and does its own equivalent
      // of this internally, so adding CL here as well doesn't double it up
      // there — see engine-bridge/OsuRulesetBridge/Program.cs's ParseMods.
      const effectiveMods = isLegacy ? mods.concat([{ acronym: 'CL' }]) : mods;
      const misses = parseNonNegInt(missesInput.value);
      const comboRaw = comboInput.value.trim();
      const combo = comboRaw === '' ? undefined : parseNonNegInt(comboRaw);

      const scoreState = { mods: effectiveMods, isLegacy, misses, combo };
      let usedAccuracy;
      if (judgement.value === 'accuracy') {
        usedAccuracy = parseAccuracyInput(accuracyInput.value);
        scoreState.accuracy = usedAccuracy;
        OsuEnhancer.storage.setToggle('beatmapPpCalcLastAccuracy', usedAccuracy);
      } else {
        const n300 = parseNonNegInt(n300Input.value);
        const n100 = parseNonNegInt(n100Input.value);
        const n50 = parseNonNegInt(n50Input.value);
        scoreState.n300 = n300;
        scoreState.n100 = n100;
        scoreState.n50 = n50;
        usedAccuracy = accuracyFromCounts(n300, n100, n50, misses);
      }
      if (ruleset.value === 'lazer') {
        if (sliderEndInput.value.trim() !== '') scoreState.sliderEndHits = parseNonNegInt(sliderEndInput.value);
        if (largeTickInput.value.trim() !== '') scoreState.largeTickHits = parseNonNegInt(largeTickInput.value);
        if (smallTickInput.value.trim() !== '') scoreState.smallTickHits = parseNonNegInt(smallTickInput.value);
      }
      accReadout.textContent = `Accuracy: ${usedAccuracy.toFixed(2)}%`;

      const comboText = combo != null ? `× ${combo}${fcBtn.dataset.maxCombo ? `/${fcBtn.dataset.maxCombo}` : ''}` : '× FC';

      const token = ++recalcToken;
      setResultLoading(true);
      try {
        const [pp, stars] = await Promise.all([
          OsuEnhancer.ppCalc.calculatePp(ctx.beatmapId, scoreState),
          OsuEnhancer.ppCalc.calculateStarRating(ctx.beatmapId, effectiveMods),
        ]);
        if (token !== recalcToken) return;
        if (pp == null) {
          renderError();
        } else {
          renderResult(pp, stars, usedAccuracy, comboText);
        }
      } catch (err) {
        if (token !== recalcToken) return;
        renderError();
      } finally {
        if (token === recalcToken) setResultLoading(false);
      }
    }

    document.body.appendChild(panel);
    return { panel, setOpen, recalc };
  }

  let panelRefs = null;
  let hashListenerBound = false;

  function ensureHashListener() {
    if (hashListenerBound) return;
    hashListenerBound = true;
    global.addEventListener('hashchange', () => {
      if (panelRefs && panelRefs.panel.classList.contains('osu-enhancer-pp-calc-panel--open')) {
        panelRefs.recalc();
      }
    });
  }

  // osu!'s SPA route swap (e.g. beatmapset <-> profile) rebuilds
  // document.body's whole child list rather than patching around our own
  // appended elements — confirmed live: a plain marker div appended
  // directly to body does NOT survive a profile->beatmapset transition,
  // even though the JS realm itself does (no reload, module state like
  // `panelRefs` stays intact). apply()/renderButton() already re-create the
  // *button* on every rescan, which is why it always comes back — but the
  // panel is only ever built once, so once it's detached this way,
  // `panelRefs` keeps pointing at an orphaned node forever: setOpen(true)
  // still runs and still toggles the class, it's just toggling it on an
  // element no longer attached to the page, so nothing visibly happens.
  function open() {
    if (!panelRefs) panelRefs = buildPanel();
    else if (!panelRefs.panel.isConnected) document.body.appendChild(panelRefs.panel);
    panelRefs.setOpen(true);
    panelRefs.recalc();
  }

  function close() {
    if (panelRefs) panelRefs.setOpen(false);
  }

  function isOpen() {
    // Also requires isConnected — a detached panel can still carry the
    // --open class from before it got orphaned (see open()'s comment), and
    // without this check toggle() would call close() on it (a no-op, since
    // it's already invisible) instead of open() (which actually re-attaches
    // it), costing an extra click to recover.
    return !!(
      panelRefs &&
      panelRefs.panel.isConnected &&
      panelRefs.panel.classList.contains('osu-enhancer-pp-calc-panel--open')
    );
  }

  function toggle() {
    return isOpen() ? close() : open();
  }

  function renderButton() {
    if (document.querySelector(`.${BTN_CLASS}`)) return;
    ensureHashListener();
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = BTN_CLASS;
    btn.textContent = 'PP Calculator';
    btn.title = 'Calculate pp for a hypothetical score on this difficulty';
    btn.addEventListener('click', toggle);
    document.body.appendChild(btn);
  }

  function removeButton() {
    const btn = document.querySelector(`.${BTN_CLASS}`);
    if (btn) btn.remove();
  }

  function apply(enabled) {
    if (enabled && isBeatmapPage()) {
      renderButton();
    } else {
      removeButton();
      close();
    }
  }

  OsuEnhancer.beatmapPpCalculator = { isBeatmapPage, apply };
})(typeof window !== 'undefined' ? window : globalThis);
