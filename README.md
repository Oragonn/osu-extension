# osu! Enhancer — Dark Theme + PP Stats

A single Chrome (Manifest V3) extension for `osu.ppy.sh` that combines a
site-wide dark theme with client-side PP (performance points) calculations,
so you don't need to install a separate dark-theme userstyle and a separate
PP-stats extension.

## Features

| Feature | Where to toggle it |
| --- | --- |
| Site-wide dark theme (nav, profile, score rows, generic pages) | Toolbar popup or the ⚙ button in osu!'s own nav bar (between "help" and search) |
| "IF FC ###pp" label on any non-FC score row | same |
| Beatmap cover art behind score rows | same |
| Downloadable PNG "player card" on your profile | same |
| Difficulty names + star rating on the beatmapset picker tray | same |
| Max star rating chip on beatmapset listing/search cards | same |
| Score age period highlight on profile Best Performance | same |
| Purple site accent color on profile pages | same |
| Hide medals you haven't unlocked yet | Button on the Medals section itself |
| Hide the "medal unlocked" popup | Button on the Medals section itself |

The medal toggles are deliberately *not* in the settings list — they're buttons right above the medal grid, since that's where you'd actually want to flip them.

All PP math runs **entirely client-side** via a bundled WebAssembly build of
[`rosu-pp`](https://github.com/MaxOhn/rosu-pp) — no third-party PP-calc
service, no network calls beyond osu.ppy.sh's own `/osu/<id>` beatmap file
endpoint (used by the game client itself) and the extension's own bundled
`.wasm`.

> **Experimental second engine:** a "PP calculation engine" setting (rosu-pp /
> "Official game code") switches to a second, clean-room engine under
> `engine-bridge/` and `src/engines/official-engine.js` that compiles ppy's
> own official ruleset code to WebAssembly, meant to track osu!'s real pp
> algorithm more closely than the vendored `rosu-pp-js` can (which lags
> osu!'s July 2026 pp rework). It works — verified end-to-end — but is new
> and less battle-tested than the default `rosu-pp` engine; see
> [`engine-bridge/FINDINGS.md`](engine-bridge/FINDINGS.md) for the full
> technical writeup (including a genuinely wild root-cause hunt for a
> browser-wasm compatibility bug it took a full decompile-and-diff to find).

## Install (unpacked, for development/testing)

1. Open `chrome://extensions` in Chrome.
2. Enable **Developer mode** (top-right toggle).
3. Click **Load unpacked** and select this project folder.
4. Visit any page on `osu.ppy.sh` — the toolbar icon opens the popup with
   all toggles.

No build step is required; everything under `src/`, `styles/`, `popup/`,
and `lib/` is plain JS/CSS/HTML/WASM checked in as-is.

## How it works

- `manifest.json` injects `styles/theme.css` and the scripts in `src/` as a
  content script on `*://osu.ppy.sh/*`.
- `src/selectors.js` centralizes every DOM selector the extension relies on
  (`.play-detail` for score rows, `.medals-group__medal` for medal tiles,
  `.nav2` for the top nav, etc.), so a future osu! redesign should only
  require editing that one file.
- `src/scores.js` doesn't scrape score data from the DOM at all — osu-web's
  own score rows don't expose combo/full-combo status as visible text, so
  instead it fetches the same JSON osu!'s React app uses to render the
  Scores tab (`/users/<id>/scores/<best|firsts|pinned|recent>`, same-origin,
  uses your existing session cookie) and matches each row back to its score
  by beatmap id. This is also where the accurate "already full combo?" flag
  (`is_perfect_combo`) and the beatmap's own cover-art URLs come from.
- `src/theme.js` adds/removes a `<link>` to `styles/izuki-theme.css` (the
  vendored full theme, see Credits below) and toggles `html.osu-enhancer-dark`
  for the extension's own small first-party tweaks, so turning the theme off
  is instant with no reload.
- `src/pp-calc.js` is a thin dispatcher over two engine modules
  (`src/engines/rosu-engine.js`, the vendored `rosu-pp-js` wrapper; and
  `src/engines/official-engine.js`, the experimental official-ruleset engine
  — see the note above), selected by the `ppEngine` storage toggle.
- `src/settings-panel.js` injects a ⚙ button into osu!'s own nav bar
  (between "help" and the search icon) that opens a small toggle panel —
  the primary way to control the extension day-to-day. The toolbar popup
  still works too and stays in sync (same `chrome.storage.local` keys).
- `src/medals.js` additionally injects two small buttons directly above the
  medal grid ("Hide locked medals" / "Hide unlock popup") rather than
  putting those in the settings list.
- `src/content.js` reads your toggles from `chrome.storage.local`, applies
  every enabled feature, and re-applies them via a `MutationObserver` since
  osu.ppy.sh is a single-page app that swaps content in without a full
  navigation (tab switches, pagination, new medal pops, etc.).

## Known limitations (see PRD Open Questions)

- "Hide locked medals" only hides a tile it can positively identify as
  locked (a class/attribute containing "locked"/"unearned"/"incomplete");
  it intentionally never hides a tile it's unsure about, since that specific
  modifier class wasn't confirmed live.
- Dark-theme coverage now comes from the full vendored `izuki-theme.css`
  (35k+ lines covering nearly the whole site), so remaining light panels
  should be rare — but if osu! ships a markup change that stylesheet
  doesn't account for, fixing it means editing that vendored file directly
  (or waiting for -Izuki- to update it upstream), not `styles/theme.css`.
- This was built and selector-verified against the live site from outside a
  logged-in session, so pages/states that require being logged in as the
  viewed user (e.g. the downloadable player card, which reads your own
  profile stats) should be spot-checked once loaded in a real, logged-in
  Chrome profile.

## Credits & Inspiration

This project's *scope and visual direction* were inspired by two existing
community projects, per the PRD's licensing requirements:

- **["Osu!Website Redesign | Dark Theme"](https://github.com/9IZUKI9/Osu-Website-Redisign)**
  by -Izuki- (also mirrored on [userstyles.world](https://userstyles.world/style/22220/osuwebsite-redesign-dark-theme-accent-colors),
  also "No License"). Neither the GitHub repo nor the userstyles.world page
  carries a license. `styles/izuki-theme.css` in this repo **is that
  userstyle's actual CSS**, vendored verbatim (only the Firefox-only
  `@-moz-document` wrapper was stripped so Chrome loads it) at the owner's
  request, for their own personal `Load unpacked` use — it is not
  original work and shouldn't be redistributed or published as part of this
  project without sorting out permission from -Izuki- first.
- **["osu! PP Calculator — 2026 Rework"](https://chromewebstore.google.com/)**
  (Chrome Web Store extension). No public source repository could be found
  for this specific listing, so per the PRD, **no code was inspected or
  copied** — only its general feature concept (PP-if-FC, PP-at-accuracy,
  PP potential) was used as inspiration, reimplemented independently on top
  of `rosu-pp-js`.
- **[`osu_expertplus`](https://github.com/inix1257/osu_expertplus)** by
  inix1257. No license file found in the repo. Its picker-diff-names feature
  (names + star rating next to each icon in the beatmapset difficulty tray)
  was the visual reference for `src/beatmap-picker.js`'s pill layout — its
  bundled userscript was read to understand *how* it works (osu-web itself
  already exposes each icon's color via an inline `--diff` custom property
  and the full beatmap list via `#json-beatmapset`, so neither project
  computes colors or scrapes ratings from rendered text), but no code from
  it is used here — `src/beatmap-picker.js` and `styles/theme.css`'s picker
  rules are this project's own implementation against that native osu-web
  data. Its beatmap-card-extra star-range feature (max star rating on
  beatmapset listing/search cards) was likewise a visual/feature reference
  for `src/max-sr-chip.js`, independently reimplemented against plain
  same-origin fetches to osu-web's own `/beatmapsets/search` endpoint
  (including its own `cursor_string` for paging alongside "Load more")
  rather than its more involved page-`fetch`/XHR-hooking approach — see
  that file's own header comment. One piece **is** taken directly, though:
  the chip's background/text color ramps (`diffColor`/`diffTextColor` in
  that file) are osu_expertplus's own port of osu-web's public
  `getDiffColour`/`getDiffTextColour` (`resources/js/utils/beatmap-
  helper.ts`), kept verbatim rather than re-derived — both colors are
  computed from the chip's own rating (matching osu_expertplus's own
  `buildStarChip`) rather than the background being read off a native dot,
  after that turned out to mismatch on sets with more diffs than osu-web
  actually renders dots for (see the file for the full story).
  osu_expertplus's "Score age period highlight" feature (profile Best
  Performance only: a slider highlighting scores by how recent they are,
  weeks through years, with reverse/reset) was likewise a direct feature
  reference for `src/score-age-highlight.js` — its 0-36 slider-index →
  weeks/months/years scheme is ported (same domain breakpoints), but the
  DOM code, UI markup, and CSS are this project's own, reading each row's
  date straight from its own native `<time datetime>` rather than the
  reference's own MutationObserver-driven page-tracking approach.
- **[`rosu-pp-js`](https://github.com/MaxOhn/rosu-pp-js)** by MaxOhn — MIT
  licensed (see `lib/rosu-pp/LICENSE-rosu-pp-js.txt`). This one **is**
  actually used: `lib/rosu-pp/rosu_pp.js` is the published npm package
  (`rosu-pp-js@4.0.1`, "nodejs" build target) with its Node-only bits
  (`require('util'/'fs'/'path')`, `__dirname`) replaced with browser
  globals and a `fetch()`-based async WebAssembly loader, so it can run
  inside a content script. No calculation logic was changed — see the
  header comment in that file for the exact patch.
- **`ppy.osu.Game.Rulesets.Osu`/`ppy.osu.Game`/`ppy.osu.Framework`** by ppy
  Pty Ltd — MIT licensed (see
  `lib/osu-ruleset-bridge/LICENSE-osu-ruleset-bridge.txt`). Used by the
  experimental official-engine bridge under `engine-bridge/`, compiled to
  WebAssembly by this project's own clean-room code — see
  `engine-bridge/FINDINGS.md` for the full build/verification writeup. The architectural idea (compile
  the official ruleset to WASM instead of a third-party reimplementation) was
  observed in `winterbirdhere/osu-pp-extension` (AGPL-3.0); no code from that
  project is used here.

## Project structure

```
manifest.json
popup/            toggle UI (US-002)
pages/            official-engine-host.{html,js} -- hidden iframe WASM host (experimental)
src/
  selectors.js    centralized DOM selectors
  storage.js      chrome.storage.local wrapper + toggle defaults
  pp-calc.js      thin dispatcher over src/engines/*
  engines/
    rosu-engine.js      rosu-pp-js wrapper (US-006)
    official-engine.js  experimental official-ruleset engine (see engine-bridge/FINDINGS.md)
  theme.js        dark-theme class toggle (US-003)
  cover-art.js    beatmap cover backgrounds (US-010)
  beatmap-picker.js  difficulty names + star rating on the beatmapset picker
  max-sr-chip.js  max star rating chip on beatmapset listing/search cards
  score-age-highlight.js  score age period highlight on Best Performance
  profile-accent-color.js  purple site accent on profile pages
  scores.js       score-row detection + "IF FC" labels (US-007)
  profile.js      player-card button (US-009) + corner button
  medals.js       medal visibility toggles (US-011)
  player-card.js  canvas PNG export (US-009)
  content.js      orchestrator / entry point (US-001)
styles/theme.css  all dark-theme + feature-UI CSS
lib/rosu-pp/            vendored, patched rosu-pp-js + its MIT license
lib/osu-ruleset-bridge/ compiled official-engine WASM output (experimental, verified working)
engine-bridge/          C# source for the official-engine WASM bridge + FINDINGS.md
icons/            toolbar icons
```

## Non-goals (this phase)

Firefox/Safari/Edge-specific builds, a backend, real-money features,
background API polling, and localization are explicitly out of scope for
this MVP — see the PRD for the full list.
