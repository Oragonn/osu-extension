/**
 * Recolors osu-web's own site accent to a fixed purple while viewing a
 * profile page — the "profileAccentColor" toggle. Covers the nav active-
 * tab underline, hover highlights, and every other element whose color is
 * built from osu-web's own `--hsl-h1`/`--hsl-c1`/`--hsl-b1`/etc. custom
 * properties (confirmed live 2026-09-12: all of them are defined on
 * `body` as `hue,S%,L%`, sharing one `hue` component). Icon artwork
 * (medal/mode/stat icons) doesn't use this system at all, so it's
 * untouched.
 *
 * osu-web already has a hue-override mechanism built in for exactly this
 * kind of recolor — it's how a supporter's own custom profile colour
 * recolors the whole page: that shared `hue` is itself
 * `var(--base-hue-override, var(--base-hue-default))`. Setting that one
 * property is enough to recolor everything built on top of it, so nothing
 * here has to enumerate individual selectors.
 *
 * rgb(140, 102, 255) is exactly hsl(255, 100%, 70%) — the same
 * saturation/lightness osu-web's own --hsl-h1 already uses (just hue 255
 * instead of its default pink, ~333) — confirmed by the standard HSL→RGB
 * conversion landing on that exact triple, not an approximation.
 */
(function (global) {
  'use strict';

  const OsuEnhancer = (global.OsuEnhancer = global.OsuEnhancer || {});

  const ACCENT_HUE = '255';

  function apply(enabled) {
    if (enabled && OsuEnhancer.profile.isProfilePage()) {
      document.body.style.setProperty('--base-hue-override', ACCENT_HUE);
    } else {
      document.body.style.removeProperty('--base-hue-override');
    }
  }

  OsuEnhancer.profileAccentColor = { apply };
})(typeof window !== 'undefined' ? window : globalThis);
