# Official-ruleset pp engine — status: **working**

This branch (`official-pp-calculator`) adds a second, selectable pp-calculation
engine backed by the official, MIT-licensed osu! ruleset code
(`ppy.osu.Game.Rulesets.Osu`, compiled to WebAssembly) alongside the existing
`rosu-pp` engine — the same general technique used by
[winterbirdhere/osu-pp-extension](https://github.com/winterbirdhere/osu-pp-extension),
reimplemented clean-room (see [Licensing](#licensing) below) since that project
is AGPL-3.0.

**The C# bridge builds, publishes, passes every licensing check, and now
works correctly at runtime**, verified end-to-end through the actual shipped
`pages/official-engine-host.js` + `src/engines/official-engine.js`
postMessage protocol. Set the "PP calculation engine" setting to "Official
game code (ppy)" to use it.

## The root cause (found and fixed)

The symptom was a deterministic crash on first use:

```
System.TypeInitializationException: osu.Framework.Logging.Logger
 ---> System.TypeInitializationException: osu.Framework.RuntimeInfo
 ---> System.PlatformNotSupportedException: Operating system could not be
      detected correctly.
```

`osu.Framework.RuntimeInfo`'s static constructor checks exactly five
platforms (`OperatingSystem.IsWindows/IsIOS/IsAndroid/IsMacOS/IsLinux()`) and
throws unconditionally if none match — which is always true under
browser-wasm, since a browser genuinely isn't any of those. This looked like
a hard, unconditional blocker, and an extensive investigation (documented in
git history on this branch) ruled out SDK version, AOT vs. interpreter mode,
trim configuration, exact resolved package versions, host build OS
(Linux via Docker), and browser/origin (`chrome-extension://` via real
Playwright Chromium) as explanations — none of it made any difference, while
osu-pp-extension's own compiled binary demonstrably worked.

**The actual answer, found by decompiling both a crashing build of this
bridge and osu-pp-extension's published binary** (via `ilspycmd` + a small
WebCil→PE unwrapper, since these `.wasm` files are actually .NET assemblies
wrapped for CSP compliance — see [Tooling](#tooling-used-for-the-decompile)):
`RuntimeInfo`, `DebugUtils`, and `Logger` were **byte-for-byte identical**
between the crashing and working builds. `RuntimeInfo.cctor()` was already
dead-code-eliminated by the linker to five `if (false) {}` blocks in *both*
builds (ILLink correctly substitutes all five `OperatingSystem.IsXxx()`
checks to `false` for the browser-wasm target) — meaning it deterministically
throws in **either** build the moment anything actually triggers it. The
mystery was never about the compiled framework code; it was about *whether
anything ever touches it at all*.

Two independent code paths could trigger it:

1. **`Decoder.GetDecoder<Beatmap>(reader).Decode(reader)` without first
   calling `Decoder.RegisterDependencies(...)`** — `LegacyBeatmapDecoder`
   falls back to `Logger.Log("A RulesetStore was not provided via
   Decoder.RegisterDependencies; falling back to default
   AssemblyRulesetStore.")`, which touches `Logger`. Fixed by calling
   `Bridge.Initialize()` once (registers a headless `RulesetStore` via
   `RuntimeHelpers.GetUninitializedObject`, matching the pattern learned from
   reading osu-pp-extension's public build files) before any decode call.
2. **Extending the abstract `osu.Game.Beatmaps.WorkingBeatmap` base class.**
   Its `Beatmap` property routes through an async
   `loadBeatmapAsync()`/`TaskExtensions.GetResultSafely()` pipeline (with a
   10-second timeout) built for a real desktop thread pool. Under the
   single-threaded Mono browser-wasm interpreter this pipeline fails, and its
   catch block reports the failure via `Logger.Error(...)` — which is what
   actually triggered the crash on every beatmap access. **Fixed by
   implementing the `IWorkingBeatmap` interface directly instead of
   extending `WorkingBeatmap`** (`BridgeWorkingBeatmap` in `Program.cs`),
   with a plain synchronous `Beatmap` property and a from-scratch synchronous
   `GetPlayableBeatmap` implementation. This is exactly how
   osu-pp-extension's own `BrowserWorkingBeatmap` avoids the same trap —
   independently re-derived here, not copied (see
   [Licensing](#licensing)).

Both fixes are now in `Program.cs`. Verified output for a no-miss SS on
Freedom Dive (beatmap 129891): star rating 7.8057886621261074, max combo
2385, pp 591.40 — matching both a from-scratch console-app spike and
osu-pp-extension's own published binary to full floating-point precision.
DT/HR mods correctly change the reported star rating.

## Follow-up accuracy fix: legacy/classic scoring

After the runtime fix above, calculated pp was noticeably closer to osu!'s
real values but still slightly off. Cause: `ScoreInfo.IsLegacyScore` was
never set (defaults to `false`), and `OsuModClassic` was never added to the
mods list for stable-origin scores. `OsuPerformanceCalculator` gates a real
chunk of its logic (slider-tail miss estimation, combo-based drop
estimation) behind `score.Mods.OfType<OsuModClassic>().Any(...)` — so every
score, regardless of whether it was actually set on stable, was silently
computed with pure lazer-native scoring mechanics.

Fixed by threading a real `isLegacy` flag through the whole pipeline
(`scores.js`'s `score.legacy_score_id != null` → `pp-calc.js` →
`official-engine.js`'s `legacy` field in `statsJson` → `Bridge.
CalculatePerformance`, which now sets `IsLegacyScore` and adds an
`OsuModClassic` mod instance when true). Verified effect on Freedom Dive
(129891), no-miss SS: **591.40 pp (lazer) → 601.3000716683429 pp
(legacy)** — the legacy number matches osu-pp-extension's own default
("stable" mode) output to full floating-point precision. A rougher play
(some 100s/50s/misses) showed a smaller but real difference (476.25 →
477.43), consistent with the affected logic being about slider-tail/combo
edge cases rather than a flat multiplier.

## Tooling used for the decompile

These `.wasm` files (for Mono-interpreter, non-AOT builds) are not real
WebAssembly bytecode — they're ordinary .NET assemblies wrapped in the
**WebCil** format (a real WebAssembly module with the assembly's PE/IL data
embedded as a custom section), used so managed assemblies satisfy
CSP wasm-content rules. To decompile them:

1. `dotnet tool install -g ilspycmd` — ILSpy's CLI decompiler.
2. A small (~200 line), MIT-licensed, single-file, dependency-free WebCil→PE
   unwrapper ([DavideFranchioni/webcil-converter](https://github.com/DavideFranchioni/webcil-converter))
   reconstructs a minimal valid PE header around the WebCil payload's
   sections, producing a `.dll` any decompiler can read directly. Read in
   full before use; it only reads/writes local files, no network access.
3. `ilspycmd -t <Fully.Qualified.TypeName> path/to/file.dll` to decompile a
   specific type, or `-l c` to list all classes.

## What was ruled out along the way (kept for reference)

Every variable below was tested and matched exactly what osu-pp-extension's
own public build config uses, before the actual cause was found — none of it
was the explanation, but it's worth knowing these dead ends don't need
re-testing:

| Variable | How it was tested |
| --- | --- |
| SDK version | Installed their exact pinned `8.0.423` side-by-side |
| AOT vs. interpreter mode | Both `RunAOTCompilation`/`WasmBuildNative` true and false |
| Trim mode + root descriptor | Matched their `TrimMode=full` + their exact `ILLink.Descriptors.xml` verbatim |
| Resolved package versions | Confirmed identical via their `packages.lock.json` |
| Host build OS | Built inside an actual Linux container (Docker) instead of Windows |
| Browser / origin | Real Playwright Chromium at a real `chrome-extension://` origin via `--load-extension` |

## Licensing

- `ppy.osu.Game.Rulesets.Osu`, `ppy.osu.Game`, `ppy.osu.Framework` are
  MIT-licensed (ppy Pty Ltd) — see
  `lib/osu-ruleset-bridge/LICENSE-osu-ruleset-bridge.txt`.
- `ppy.osu.Game.Resources` is CC-BY-NC 4.0 — excluded from the build output
  entirely (verified: its DLL never appears in the publish output), never
  redistributed.
- `engine-bridge/OsuRulesetBridge/Program.cs` is original code for this
  project, not adapted from osu-pp-extension (AGPL-3.0). Three pieces were
  independently derived after understanding a *technique* observed in their
  public build files or decompiled output (the idea of registering a
  headless `RulesetStore` via `RuntimeHelpers.GetUninitializedObject`; the
  idea of implementing `IWorkingBeatmap` directly instead of extending
  `WorkingBeatmap`) — ideas and techniques for calling a public MIT-licensed
  API aren't copyrightable expression, and both are written fresh here with
  different structure. Two other pieces are directly adapted from ppy's own,
  separately MIT-licensed `osu-tools` CLI (not the AGPL project), credited in
  code comments at their point of use: the accuracy-reconstruction formula
  and the general beatmap-decoding approach.
