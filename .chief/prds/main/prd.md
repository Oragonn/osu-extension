# PRD: osu! Enhancer — Dark Theme + PP Stats Extension

## 1. Introduction/Overview

osu! players who want a better web experience currently need to install multiple separate browser extensions/userstyles: one for a dark theme (e.g. the "Osu!Website Redesign | Dark Theme" Stylus userstyle by -Izuki-) and another for advanced PP (performance points) statistics (e.g. "osu! PP Calculator — 2026 Rework"). Running several extensions together is inconvenient, can conflict visually/functionally, and each covers only part of what an engaged player wants.

This project is a single Chrome extension for `osu.ppy.sh` that merges a site-wide dark theme redesign with client-side PP calculation features (PP-if-FC, PP-if-accuracy, PP potential analysis, downloadable player cards) and adds new quality-of-life features not covered by either reference project: beatmap cover art on score lists, wider "PP if FC" coverage, and medal-display toggles.

The two reference projects are **inspiration for scope and look, not code to copy wholesale**. Before reusing any of their code, we will check each project's license and only adapt code under terms that license permits (see Section 7 — Licensing).

## 2. Goals

- Ship a single Chrome (Manifest V3) extension that replaces the need to install both a separate dark-theme userstyle and a separate PP-stats extension for osu.ppy.sh.
- Apply a consistent dark theme across the osu! website (not just profile/score pages), matching the visual direction of the provided reference screenshots (dark background, rounded cards, accent-colored badges/pills).
- Provide client-side (offline-capable) PP calculations: current PP, PP-if-FC, and PP at other accuracy breakpoints, computed in the browser without depending on a third-party PP-calc web service.
- Add three new quality-of-life features not present in either reference project: cover art thumbnails on score lists, broader "PP if FC" display, and medal-visibility toggles.
- Let users control feature/theme toggles via an extension popup or options page, persisted with local storage (no account/login required).
- Correctly attribute and license-check any code or assets adapted from the two reference community projects.

## 3. User Stories

### US-001: Extension scaffold and content script injection
**Priority:** 1
**Description:** As a developer, I need a working Manifest V3 extension skeleton that injects a content script into osu.ppy.sh pages, so all later features have somewhere to run.

**Acceptance Criteria:**
- [ ] `manifest.json` (Manifest V3) declares a content script matching `*://osu.ppy.sh/*`
- [ ] Content script loads and logs a confirmation message on any osu.ppy.sh page, verified in Chrome DevTools console
- [ ] Extension loads via `chrome://extensions` "Load unpacked" with no manifest errors
- [ ] Basic extension icon and name appear in the Chrome toolbar

### US-002: Options/popup UI with persisted toggles
**Priority:** 2
**Description:** As a user, I want a popup where I can turn each feature (theme, PP-if-FC, cover art, medal toggles) on or off, so I can customize the extension without touching code.

**Acceptance Criteria:**
- [ ] Clicking the toolbar icon opens a popup listing each feature as a labeled on/off toggle
- [ ] Toggle state is persisted via `chrome.storage.local` and survives browser restart
- [ ] Content script reads toggle state on page load and applies only enabled features
- [ ] Changing a toggle updates the active osu.ppy.sh tab's behavior without requiring a manual page refresh (or, if refresh is required, the popup explicitly says so)

### US-003: Site-wide dark theme — core layout and navigation
**Priority:** 3
**Description:** As a user, I want the main osu! site chrome (top nav bar, page backgrounds, cards, buttons) restyled dark, so the whole site matches the look of the reference screenshots instead of just one page.

**Acceptance Criteria:**
- [ ] Top navigation bar (logo, home/beatmaps/rankings/community/store/help links, search, notification icons) restyled to dark background with light text, matching reference screenshot look
- [ ] Global page background and generic cards/panels restyled dark across at least: home page, beatmap listing page, rankings page, community/forum pages
- [ ] Default light-theme colors are fully overridden (no white/light "flash" panels remaining on the pages listed above)
- [ ] Theme is implemented as injected CSS (not a full page rewrite) so it degrades gracefully if osu! changes unrelated markup
- [ ] Visual check: side-by-side screenshot comparison against the provided reference screenshots for overall look and feel

### US-004: Dark theme — profile page (info tab)
**Priority:** 4
**Description:** As a user, I want my profile "info" tab restyled dark with the redesigned player card layout shown in the reference screenshot, so my profile matches the rest of the themed site.

**Acceptance Criteria:**
- [ ] Profile header (avatar, username, country/region flags, team badge, "player card" button) restyled to match reference screenshot layout
- [ ] Global/Country/Region ranking numbers and rank-history graph restyled dark with accent-colored line
- [ ] Grade count pills (SS/S/A etc.) restyled as rounded colored badges matching reference screenshot
- [ ] Stats panel (Ranked Score, Hit Accuracy, Play Count, etc.) restyled dark, right-aligned as in reference
- [ ] Tab bar (info/modding/playlists/multiplayer/ranked play) restyled dark with active-tab underline indicator

### US-005: Dark theme — score list pages (Scores/Historical/Recent/Firsts tabs)
**Priority:** 5
**Description:** As a user, I want score list rows (pinned scores, best performance, recent, first-place scores) restyled dark with per-row accent coloring, so I can browse my scores in the same visual style.

**Acceptance Criteria:**
- [ ] Each score row restyled dark with rounded corners and colored left/rank-icon accent, matching reference screenshot
- [ ] Score metadata (accuracy %, combo, mod icons, star rating, PP value) remains fully legible against the dark background (meets WCAG AA contrast minimum for text)
- [ ] Applies consistently across Scores, Historical, Recent, and Medals/Best tabs

### US-006: Client-side PP calculation engine
**Priority:** 6
**Description:** As a developer, I need a PP calculation library running inside the extension (not a network call to a third-party service) so PP-related features work offline and aren't subject to external rate limits.

**Acceptance Criteria:**
- [ ] A JS/WASM PP calculation library (e.g. a `rosu-pp` WASM build or equivalent) is bundled into the extension package
- [ ] Given a beatmap's stored difficulty attributes and a score's accuracy/combo/mods, the library returns a PP value within expected tolerance of osu!'s own displayed PP for a sample of at least 10 known scores (manual verification table recorded in test notes)
- [ ] Calculation runs without any outbound network request
- [ ] Calculation completes fast enough not to visibly block scrolling on a score list page (target: under 50ms per row on a mid-range machine)

### US-007: "PP if FC" on all applicable score rows
**Priority:** 7
**Description:** As a user, I want to see "PP if FC" next to every score row where the play wasn't already a full combo (not just unranked/loved/graveyard maps), so I can see my potential gain everywhere.

**Acceptance Criteria:**
- [ ] Every score row where combo < max combo shows an "IF FC ###pp" label, regardless of the beatmap's ranked status
- [ ] Rows that are already full combo do not show the label (avoids redundant/confusing display)
- [ ] Label styling matches the reference screenshot (small pill/text above or beside the main PP value)
- [ ] Feature respects its toggle in the options popup (US-002) — disabling it removes all "IF FC" labels without a page reload artifact

### US-008: PP-at-accuracy breakdown and profile PP-potential analysis
**Priority:** 8
**Description:** As a user, I want to see PP estimates at different accuracy levels and an overall "PP potential" summary on my profile, so I understand where to focus practice for the biggest PP gains.

**Acceptance Criteria:**
- [ ] On a score's detail view (or hover/expand on the row), shows PP estimates for at least 95%, 98%, 99%, 100% accuracy on that beatmap
- [ ] Profile page shows a "PP potential" summary section listing the user's top N scores by potential PP gain if FC'd
- [ ] All values computed via the client-side engine from US-006 (no external API call)

### US-009: Downloadable player card image
**Priority:** 9
**Description:** As a user, I want to export my profile as a shareable image ("player card"), so I can post it elsewhere without manually screenshotting.

**Acceptance Criteria:**
- [ ] A "Download Player Card" button appears on the profile page
- [ ] Clicking it generates a PNG image (via canvas rendering) containing username, avatar, rank, PP, accuracy, and grade counts, styled consistently with the dark theme
- [ ] Image downloads to the user's device with a filename like `<username>-playercard.png`

### US-010: Beatmap cover art on score list rows
**Priority:** 10
**Description:** As a user, I want to see the beatmap's cover art as a background/thumbnail on Pinned Scores, Best Performance, and First Place score rows, so I can visually recognize maps faster.

**Acceptance Criteria:**
- [ ] Each row on Pinned Scores, Best Performance, and First Place tabs shows the beatmap's cover art (fetched from osu!'s existing beatmap image CDN URLs) as a background image or thumbnail
- [ ] Cover art is visually blended (e.g. gradient overlay/opacity) so score text remains legible on top, matching the reference screenshot style
- [ ] Missing/failed image loads fall back gracefully to the plain dark row background (no broken-image icon)
- [ ] Feature respects its toggle in the options popup

### US-011: Medal display toggles
**Priority:** 11
**Description:** As a user, I want to optionally hide medals I haven't unlocked yet, and optionally hide the "medal unlocked" popup, so my medals page and browsing experience are less cluttered.

**Acceptance Criteria:**
- [ ] Options popup has two independent toggles: "Hide locked medals" and "Hide medal-unlocked popup"
- [ ] With "Hide locked medals" on, the Medals tab shows only medals the user has already earned (locked medal tiles are removed from layout, not just visually dimmed)
- [ ] With "Hide medal-unlocked popup" on, the in-page toast/popup that announces a newly unlocked medal does not appear
- [ ] Both toggles default to off (osu!'s normal behavior preserved unless the user opts in)

### US-012: Licensing compliance pass
**Priority:** 12
**Description:** As the project owner, I need confirmation of what we can legally reuse from the two reference projects before shipping, so the extension doesn't violate their licenses.

**Acceptance Criteria:**
- [ ] Written record of the license each reference project is published under (Stylus userstyle repo license file/terms; Chrome Web Store extension's listed license or source repo license, if available)
- [ ] For any code/CSS actually copied or adapted (not just visually inspired by), a note in the extension's README stating the source project, license, and required attribution
- [ ] If a reference project's license is unclear, incompatible, or the project has no public source (Chrome Web Store listing with no visible repo), we do not copy its code — only its visual/feature concept is used as inspiration, and this is documented
- [ ] README includes a "Credits & Inspiration" section naming both reference projects

### US-013: Basic README and install instructions
**Priority:** 13
**Description:** As a user or reviewer, I want clear instructions for installing and using the extension, so I can try it without asking the developer directly.

**Acceptance Criteria:**
- [ ] README documents manual "Load unpacked" install steps for Chrome
- [ ] README lists all features and their toggle names
- [ ] README includes the Credits & Inspiration section from US-012

## 4. Functional Requirements

- FR-1: The extension must be built as a Manifest V3 Chrome extension targeting `*://osu.ppy.sh/*`.
- FR-2: The extension must inject a dark theme via CSS across the whole osu! site (nav, home, beatmap listing, rankings, community/forum pages), not only profile/score pages.
- FR-3: The extension must restyle the profile "info" tab to match the layout in the provided reference screenshot (player card header, ranking graph, grade pills, stats panel, tab bar).
- FR-4: The extension must restyle score list rows (Pinned, Best Performance, Historical, Recent, First Place) with dark backgrounds and legible text/icons.
- FR-5: The extension must compute PP values (current PP, PP-if-FC, PP at 95/98/99/100% accuracy) entirely client-side using a bundled PP calculation library, with no network calls to third-party PP-calc services.
- FR-6: The extension must display a "PP if FC" label on every score row where the play is not already a full combo, regardless of the beatmap's ranked/loved/graveyard/unranked status.
- FR-7: The extension must show a profile-level "PP potential" section summarizing top scores by potential PP gain.
- FR-8: The extension must provide a "Download Player Card" button on the profile page that exports a PNG image of key profile stats.
- FR-9: The extension must display beatmap cover art on Pinned Scores, Best Performance, and First Place score rows, sourced from osu!'s existing public beatmap image URLs.
- FR-10: The extension must provide a popup UI with independent on/off toggles for: dark theme, PP-if-FC display, PP-potential section, player card download, cover art thumbnails, hide-locked-medals, and hide-medal-popup.
- FR-11: All toggle states must persist via `chrome.storage.local` and be re-read by the content script on every page load.
- FR-12: When "Hide locked medals" is enabled, locked medal tiles must be removed from the Medals tab layout (not merely hidden via opacity/visibility that still occupies space or remains in the DOM in a way that could leak state).
- FR-13: When "Hide medal-unlocked popup" is enabled, the site's native medal-unlock toast/notification must not be shown to the user.
- FR-14: The extension must not require the user to log into any third-party service; it operates purely as a client-side enhancement of the page the user is already logged into on osu.ppy.sh.
- FR-15: The project must document the license of each reference project consulted, and must not copy code from a reference project whose license prohibits reuse or whose source is unavailable.

## 5. Non-Goals (Out of Scope)

- No Firefox, Safari, or Edge-specific builds in this phase (Chrome/Chromium MV3 only; Edge/Brave get it "for free" as Chromium browsers, but only Chrome Web Store listing is targeted).
- No server-side component, backend API, or user accounts — the extension is 100% client-side against pages the user already has open.
- No modification of actual score submission, gameplay, or the osu! game client itself — this is strictly a website enhancement.
- No real-money or paid features; this is a free community-style extension.
- No automatic/background polling of osu! API for data the user isn't currently viewing (e.g. no background score-tracking service).
- No custom leaderboard, ranking, or social features beyond what osu.ppy.sh already provides.
- No support for restyling third-party sites (e.g. osu!track, osu!stats) — `osu.ppy.sh` only.
- No localization/i18n in the MVP — English UI only.
- No automated CI/CD publishing pipeline in this phase — manual "Load unpacked" for development, manual Chrome Web Store submission when ready.

## 6. Design Considerations

- Visual reference: the two screenshots provided by the user (dark score list with per-row cover-art backgrounds and inline "IF FC ###pp" labels; redesigned player-info card with rank graph, grade pills, medal count, and player-card button) are the source of truth for target look and feel.
- Color/style direction should follow the -Izuki- "Osu!Website Redesign | Dark Theme" userstyle as a starting reference point for palette and component shapes (rounded cards, accent-colored rank icons), rebuilt as our own CSS per the licensing approach in Section 7.
- Feature layout (PP-if-FC placement, PP-potential section, downloadable player card) should follow the general concept of "osu! PP Calculator — 2026 Rework" but with our own UI implementation.
- Ensure text-over-image contrast (cover art backgrounds behind score rows) meets at least WCAG AA for score text/numbers, using a gradient/overlay scrim as needed.
- Toggle UI in the popup should be a simple vertical list of labeled switches — no need for a complex settings page in MVP.

## 7. Technical Considerations

- **Architecture:** Manifest V3 extension with a content script injected into `osu.ppy.sh` pages; a popup (`popup.html`/`popup.js`) for toggles; `chrome.storage.local` for persisting preferences (no sync storage needed unless cross-device sync is requested later).
- **Theme delivery:** CSS injected via the content script (or a `content_scripts.css` entry) rather than rewriting page markup, to minimize breakage when osu! updates its site.
- **PP calculation:** Use an existing, actively-maintained client-side PP calculation library (e.g. a WASM build of `rosu-pp` or similar) rather than reimplementing osu!'s PP formula from scratch. Bundle it into the extension; do not fetch it from a CDN at runtime (keeps it available offline and avoids Manifest V3 remote-code restrictions).
  - **Future flexibility:** This is an MVP decision, not a permanent architectural constraint. If the local library proves inaccurate, hard to keep in sync with osu!'s scoring changes, or too heavy to bundle, a later version could swap it for a call to an external PP-calc API (e.g. the osu! API v2 or a community PP-calc service) behind the same internal interface. Keep the PP-calculation logic isolated behind a single module/function (e.g. `calculatePP(beatmap, score) -> ppValue`) so the local-vs-API decision can be changed later without touching the features that consume PP values (US-007, US-008, US-009).
- **Beatmap difficulty data:** Determine whether beatmap difficulty attributes needed for PP calc are already present in the page's embedded data (e.g. a JSON blob osu! includes in the page) or require an osu! API call; prefer scraping in-page data first to avoid needing API keys/OAuth.
- **Cover art:** osu! beatmap cover images are typically available at public, predictable CDN URLs tied to the beatmapset ID; no authentication should be required to load them as `<img>`/background-image sources.
- **Performance:** Score list pages can have many rows; PP calculations and DOM injection (cover art, IF-FC labels) should be batched/debounced (e.g. via `IntersectionObserver` or a simple visible-rows-first approach) to avoid jank on pages with long lists.
- **Resilience to site changes:** Since this targets a live third-party site's DOM, selectors should be centralized (e.g. a single `selectors.js` config) so future osu! redesigns require updating one file rather than hunting through feature code.
- **Licensing check (see US-012):**
  - -Izuki-'s "Osu!Website Redesign | Dark Theme" is hosted on GitHub (`9IZUKI9/Osu-Website-Redisign`) — check the repo for a LICENSE file before adapting any CSS; if none is present, treat it as "all rights reserved" by default and do not copy code, only use it as visual inspiration.
  - "osu! PP Calculator — 2026 Rework" is distributed via the Chrome Web Store; check its listing for a linked source repo and license. If no public source/license is available, do not attempt to extract or reverse-engineer its code — treat its feature list as inspiration only, reimplemented independently.
  - Record findings in the README's Credits & Inspiration section (US-012, US-013) regardless of outcome.

## 8. Success Metrics

- A user can install the extension and, within 5 minutes, have both the dark theme and PP-if-FC features visibly working on their own profile — no manual configuration beyond default toggles.
- Zero separate extensions/userstyles needed to get both the dark theme and PP-stats functionality (the stated core value proposition).
- PP-if-FC values are visible on 100% of non-full-combo score rows across Pinned, Best Performance, Recent, and First Place tabs (not just unranked/loved/graveyard maps).
- Cover art renders successfully (no broken-image fallback) on at least 95% of score rows in manual testing across a sample profile with 50+ scores.
- All toggles in the popup function independently — turning one off does not disable or visually break another feature.
- No console errors thrown by the content script on the profile, score list, or medals pages during manual QA.

## 9. Open Questions

- Should preferences sync across devices via `chrome.storage.sync` instead of `chrome.storage.local`, or is local-only acceptable for MVP?
- Do we need to handle osu!'s "supporter"-only profile customizations (e.g. custom profile colors/backgrounds) so our dark theme doesn't clash with them?
- Where should beatmap difficulty attributes for PP calculation actually come from — is everything needed already embedded in the page, or will we need an osu! API v2 OAuth client for some data (e.g. star rating with mods applied)?
- Local PP calculation is the MVP choice for offline/no-rate-limit reasons — if it turns out to be inaccurate or hard to maintain, should we revisit an API-based approach (osu! API v2 or a community PP-calc service) sooner rather than later?
- What's the actual license status of the two reference projects? This needs to be checked as part of US-012 before any code adaptation begins — until confirmed, default to "inspiration only, no code copied."
- Should the "PP potential" profile section be visible to anyone viewing a profile, or only when viewing your own profile while logged in?
- Is a Chrome Web Store listing planned for this phase, or is "Load unpacked" / private distribution sufficient for now?
- What's the catch-all "Open slot for more ideas" the user mentioned — are there specific additional features already in mind, or should this stay a placeholder for a v1.1 backlog?
