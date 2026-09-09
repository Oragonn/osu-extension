# Official-ruleset pp engine — status: blocked, documented

This branch (`official-pp-calculator`) adds a second, selectable pp-calculation
engine backed by the official, MIT-licensed osu! ruleset code
(`ppy.osu.Game.Rulesets.Osu`, compiled to WebAssembly) alongside the existing
`rosu-pp` engine — the same general technique used by
[winterbirdhere/osu-pp-extension](https://github.com/winterbirdhere/osu-pp-extension),
reimplemented clean-room (see [Licensing](#licensing) below) since that project
is AGPL-3.0.

**Current state: the C# bridge builds, publishes, and passes every licensing
check — but it does not work at runtime.** `osu.Framework.RuntimeInfo`'s
static OS-detection throws unconditionally under browser-wasm. The JS-side
wiring (dispatcher, iframe/postMessage bridge, UI toggle) is fully built and
would work immediately if the runtime issue were resolved, but with the
`ppEngine` toggle set to `official`, calculations currently fail.

## What works

- `engine-bridge/OsuRulesetBridge/` — a clean-room C# project referencing
  `ppy.osu.Game.Rulesets.Osu` 2026.730.0 (MIT). Builds and publishes to
  `browser-wasm` successfully.
- **Licensing is verified clean**: `ppy.osu.Game.Resources` (CC-BY-NC 4.0) is
  excluded via `ExcludeAssets="all"` — confirmed its DLL never appears in the
  publish output, and no `.ttf/.png/.ogg/...` assets leak in either.
- **Size is reasonable**: ~13 MB raw (`lib/osu-ruleset-bridge/_framework/`),
  in line with the reference project's own footprint.
- **The JS↔C# boundary works**: `getAssemblyExports` correctly produces the
  `exports.OsuEnhancer.RulesetBridge.Bridge.MethodName(...)` shape; calls go
  through and return real JSON (just an error payload, currently — see below).
- **One real bug found and fixed along the way**: the .NET trimmer stripped
  `NUnit.Framework.Internal.TestExecutionContext+AdhocContext.AdhocTestMethod`,
  a method `osu.Framework.Development.DebugUtils.IsNUnitRunning()` reaches via
  reflection as a pure environment-detection probe. Fixed by rooting the whole
  `nunit.framework` assembly (`<TrimmerRootAssembly Include="nunit.framework" />`
  in the `.csproj`) — confirmed correct by independently discovering it, then
  finding osu-pp-extension's own `ILLink.Descriptors.xml` does the exact same
  thing.
- Phase C/D JS integration (`src/engines/rosu-engine.js`,
  `src/engines/official-engine.js`, `pages/official-engine-host.{html,js}`,
  the `ppEngine` storage toggle and its UI in the settings panel/popup) is
  complete and requires zero changes to `src/scores.js`.

## The blocker

`osu.Framework.RuntimeInfo`'s static constructor
([source](https://raw.githubusercontent.com/ppy/osu-framework/master/osu.Framework/RuntimeInfo.cs))
checks exactly five platforms —
`OperatingSystem.IsWindows/IsIOS/IsAndroid/IsMacOS/IsLinux()` — and throws
`PlatformNotSupportedException("Operating system could not be detected
correctly.")` if none match. There is no `#if`, no partial-class split, no
browser/WASM case in the `Platform` enum. Under our browser-wasm build, all
five checks return `false` (correctly — a browser genuinely isn't any of
those), so this throws every time, on the first thing that touches
`osu.Framework.Logging.Logger` (which every beatmap decode does via
`LegacyBeatmapDecoder`).

## What was ruled out (exhaustively)

Every variable below was tested and **matched exactly** what
osu-pp-extension's own public build config uses, with no change in outcome:

| Variable | How it was tested |
| --- | --- |
| SDK version | Installed their exact pinned `8.0.423` side-by-side; identical crash |
| AOT vs. interpreter mode | Both `RunAOTCompilation`/`WasmBuildNative` true and false | Identical crash |
| Trim mode + root descriptor | Matched their `TrimMode=full` + their exact `ILLink.Descriptors.xml` content verbatim | Identical crash |
| Resolved package versions | Confirmed identical to their `packages.lock.json` (`ppy.osu.Framework 2026.728.1`, `Realm 20.1.0`, etc.) | Identical crash |
| Source code structure | Matched their exact `Initialize()`/`HeadlessRulesetStore`/static-field declaration order (see `Program.cs`) | Identical crash |
| Host build OS | Built inside an actual Linux container (Docker, `mcr.microsoft.com/dotnet/sdk:8.0`) instead of Windows | Identical crash |
| Browser / origin | Ran under real Playwright Chromium (their exact pinned version, `1.62.1`) at a real `chrome-extension://` origin via `--load-extension`, not just a plain webpage | Identical crash |

**Their actual compiled binary** (downloaded directly from
`public/engine/_framework/` in their repo) **works perfectly** when run
side-by-side in the same test harness — Star rating 7.81, PP 601.30 on
Freedom Dive, matching a from-scratch console-app spike's numbers. This
proves the underlying approach is real and functional, not a fundamental
impossibility — the gap is specifically in how *this* build reproduces
whatever makes their build work.

The one remaining, unconfirmed lead: `osu.Framework.wasm` and
`dotnet.native.wasm` have identical file sizes but different SHA-256 hashes
between their build and this one. That alone doesn't prove a behavioral
difference (.NET builds embed non-deterministic metadata — module version
IDs, build paths — unless `Deterministic`/`ContinuousIntegrationBuild` are
set), but it's the only unexplained data point left. Confirming it one way or
the other would require decompiling and diffing the actual IL/bytecode inside
both files, which wasn't attempted.

## If someone picks this up

- Don't re-test anything in the table above — it's confirmed to make no
  difference.
- The productive next step is IL-level diffing of `osu.Framework.wasm`
  between a local build and osu-pp-extension's published one (ILSpy or
  similar), specifically around `RuntimeInfo`'s static constructor and
  whatever `DebugUtils`/`Logger` reach from it.
- Failing that, asking the osu-pp-extension maintainer directly what their
  CI environment does differently is likely faster than further guessing.

## Licensing

- `ppy.osu.Game.Rulesets.Osu`, `ppy.osu.Game`, `ppy.osu.Framework` are
  MIT-licensed (ppy Pty Ltd) — see
  `lib/osu-ruleset-bridge/LICENSE-osu-ruleset-bridge.txt`.
- `ppy.osu.Game.Resources` is CC-BY-NC 4.0 — excluded from the build output
  entirely (see above), never redistributed.
- `engine-bridge/OsuRulesetBridge/Program.cs` is original code for this
  project, not adapted from osu-pp-extension (AGPL-3.0) — the two small
  pieces adapted from prior art are both credited in code comments at their
  point of use, and both come from ppy's own separately MIT-licensed
  `osu-tools` CLI, not from the AGPL project: the `WorkingBeatmap` subclass
  pattern (`ProcessorWorkingBeatmap.cs`) and the accuracy-reconstruction
  formula (`OsuSimulateCommand.cs`).
- The `Initialize()`/`HeadlessRulesetStore` init sequence mirrors a technique
  learned by reading osu-pp-extension's public build files while diagnosing
  this exact crash — the *idea* (register a headless `RulesetStore` via
  `RuntimeHelpers.GetUninitializedObject` before decoding) isn't copyrightable
  expression on its own, and this project's version is independently written,
  but it's worth being aware of the provenance if this code is ever reused
  elsewhere.
