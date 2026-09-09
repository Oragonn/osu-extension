using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices.JavaScript;
using System.Text;
using System.Text.Json.Nodes;
using System.Threading;
using osu.Framework.Audio.Track;
using osu.Framework.Graphics.Textures;
using osu.Game.Beatmaps;
using osu.Game.Beatmaps.Formats;
using osu.Game.IO;
using osu.Game.Rulesets;
using osu.Game.Rulesets.Mods;
using osu.Game.Rulesets.Osu;
using osu.Game.Rulesets.Osu.Objects;
using osu.Game.Rulesets.Scoring;
using osu.Game.Scoring;
using osu.Game.Skinning;
using osu.Game.Storyboards;

namespace OsuEnhancer.RulesetBridge;

internal static class Program
{
    private static void Main()
    {
        // Entry point required by the WebAssembly SDK's implied OutputType=Exe.
        // Everything callable from JS is exposed via [JSExport] on Bridge below.
    }
}

/// <summary>
/// JS-callable surface backed by the official, MIT-licensed osu!standard
/// ruleset (ppy.osu.Game.Rulesets.Osu) -- a clean-room bridge written for this
/// project, not adapted from any AGPL-licensed source.
/// </summary>
public static partial class Bridge
{
    // Declared as static fields at the very top of the class (matching the
    // exact declaration shape/order this project's own experimentation found
    // necessary -- see notes on Initialize() below) rather than constructed
    // locally inside each method.
    private static readonly OsuRuleset ruleset = new();

    private static readonly osu.Game.Rulesets.RulesetInfo[] decoderRulesets =
    {
        ruleset.RulesetInfo,
        new("taiko", "osu!taiko", string.Empty, 1),
        new("fruits", "osu!catch", string.Empty, 2),
        new("mania", "osu!mania", string.Empty, 3),
    };

    private static bool initialized;

    /// <summary>
    /// Registers a headless RulesetStore with the beatmap decoder before
    /// ever decoding anything, using RuntimeHelpers.GetUninitializedObject
    /// to skip RulesetStore's normal constructor. Must be called once before
    /// any decode/calculate call. This exact sequencing was arrived at
    /// empirically: osu.Framework.RuntimeInfo's static OS-detection has been
    /// observed, in this project's own testing, to be extremely sensitive to
    /// static-initialization ordering under the Mono browser-wasm
    /// interpreter -- the mechanism isn't fully understood, but this shape
    /// (decoderRulesets as an eager static field at class scope, populated
    /// before Initialize() runs) is what reliably avoids the crash.
    /// </summary>
    [JSExport]
    public static string Initialize()
    {
        try
        {
            if (!initialized)
            {
                var store = (HeadlessRulesetStore)RuntimeHelpers.GetUninitializedObject(typeof(HeadlessRulesetStore));
                osu.Game.Beatmaps.Formats.Decoder.RegisterDependencies(store);
                initialized = true;
            }
            return new JsonObject { ["ok"] = true }.ToJsonString();
        }
        catch (Exception ex)
        {
            return new JsonObject { ["error"] = DescribeException(ex) }.ToJsonString();
        }
    }

    private sealed class HeadlessRulesetStore : osu.Game.Rulesets.RulesetStore
    {
        public override IEnumerable<osu.Game.Rulesets.RulesetInfo> AvailableRulesets => decoderRulesets;

        private HeadlessRulesetStore()
        {
        }
    }

    [JSExport]
    public static string CalculatePerformance(string beatmapId, string osuFileText, string statsJson)
    {
        try
        {
            var working = BridgeWorkingBeatmap.GetOrCreate(beatmapId, osuFileText);

            var input = JsonNode.Parse(statsJson)!.AsObject();
            var mods = ParseMods(ruleset, input["mods"]?.AsArray());

            // Scores set on stable (imported into lazer) use "classic" slider
            // accuracy/miss-estimation mechanics in the real calculator --
            // gated by the presence of an OsuModClassic mod instance, not by
            // any hit-statistics field. Without this, every score is silently
            // computed as if it were lazer-native.
            bool legacy = input["legacy"]?.GetValue<bool>() ?? false;
            if (legacy && !mods.OfType<osu.Game.Rulesets.Osu.Mods.OsuModClassic>().Any())
                mods = mods.Append(new osu.Game.Rulesets.Osu.Mods.OsuModClassic()).ToArray();

            var beatmap = working.GetPlayableBeatmap(ruleset.RulesetInfo, mods);
            int totalObjects = beatmap.HitObjects.Count;

            int misses = (int?)input["misses"] ?? 0;
            int? n100 = (int?)input["n100"];
            int? n50 = (int?)input["n50"];
            int n300 = (int?)input["n300"] ?? Math.Max(0, totalObjects - (n100 ?? 0) - (n50 ?? 0) - misses);

            var statistics = new Dictionary<HitResult, int>
            {
                { HitResult.Great, n300 },
                { HitResult.Ok, n100 ?? 0 },
                { HitResult.Meh, n50 ?? 0 },
                { HitResult.Miss, misses },
            };

            if ((int?)input["sliderTailHit"] is int sliderTailHit)
                statistics[HitResult.SliderTailHit] = sliderTailHit;

            if ((int?)input["largeTickHit"] is int largeTickHit)
            {
                int totalLargeTicks = beatmap.HitObjects.Sum(o => o.NestedHitObjects.Count(x => x is SliderTick or SliderRepeat));
                statistics[HitResult.LargeTickHit] = largeTickHit;
                statistics[HitResult.LargeTickMiss] = Math.Max(0, totalLargeTicks - largeTickHit);
            }

            // NOTE: unconfirmed whether osu!std's real ScoreProcessor ever awards
            // SmallTickHit (it may be catch/mania-only) -- passed through
            // defensively since it's a real HitResult member either way. Verify
            // against a live lazer score during end-to-end testing.
            if ((int?)input["smallTickHit"] is int smallTickHit)
                statistics[HitResult.SmallTickHit] = smallTickHit;

            int maxCombo = (int?)input["combo"] ?? beatmap.GetMaxCombo();

            var scoreInfo = new ScoreInfo(beatmap.BeatmapInfo, ruleset.RulesetInfo)
            {
                Accuracy = ComputeAccuracy(beatmap, statistics),
                MaxCombo = maxCombo,
                Statistics = statistics,
                Mods = mods,
                IsLegacyScore = legacy,
            };

            var difficultyCalculator = ruleset.CreateDifficultyCalculator(working);
            var difficultyAttributes = difficultyCalculator.Calculate(mods);
            var performanceCalculator = ruleset.CreatePerformanceCalculator();
            var performanceAttributes = performanceCalculator?.Calculate(scoreInfo, difficultyAttributes);

            return new JsonObject { ["pp"] = performanceAttributes?.Total ?? 0 }.ToJsonString();
        }
        catch (Exception ex)
        {
            return new JsonObject { ["error"] = DescribeException(ex) }.ToJsonString();
        }
    }

    [JSExport]
    public static string CalculateDifficulty(string beatmapId, string osuFileText, string modsJson)
    {
        try
        {
            var working = BridgeWorkingBeatmap.GetOrCreate(beatmapId, osuFileText);
            var mods = ParseMods(ruleset, JsonNode.Parse(modsJson)?.AsArray());

            var beatmap = working.GetPlayableBeatmap(ruleset.RulesetInfo, mods);
            var difficultyCalculator = ruleset.CreateDifficultyCalculator(working);
            var difficultyAttributes = difficultyCalculator.Calculate(mods);

            return new JsonObject
            {
                ["stars"] = difficultyAttributes.StarRating,
                ["maxCombo"] = beatmap.GetMaxCombo(),
                ["totalHits"] = beatmap.HitObjects.Count,
            }.ToJsonString();
        }
        catch (Exception ex)
        {
            return new JsonObject { ["error"] = DescribeException(ex) }.ToJsonString();
        }
    }

    private static string DescribeException(Exception ex)
    {
        var parts = new List<string>();
        for (var current = ex; current != null; current = current.InnerException)
            parts.Add($"{current.GetType().FullName}: {current.Message}");
        return string.Join(" ---> ", parts) + "\n" + ex.ToString();
    }

    private static Mod[] ParseMods(OsuRuleset ruleset, JsonArray? acronyms)
    {
        if (acronyms == null)
            return Array.Empty<Mod>();

        return acronyms
            .Select(a => ruleset.CreateModFromAcronym((string)a!))
            .Where(m => m != null)
            .Cast<Mod>()
            .ToArray();
    }

    /// <summary>
    /// Adapted from ppy/osu-tools's OsuSimulateCommand.GetAccuracy (MIT Licence,
    /// Copyright (c) ppy Pty Ltd &lt;contact@ppy.sh&gt;): the real performance
    /// calculator reads ScoreInfo.Accuracy directly rather than deriving it
    /// solely from Statistics, so we compute it the same way the official CLI does.
    /// </summary>
    private static double ComputeAccuracy(IBeatmap beatmap, Dictionary<HitResult, int> statistics)
    {
        int countGreat = statistics.GetValueOrDefault(HitResult.Great);
        int countGood = statistics.GetValueOrDefault(HitResult.Ok);
        int countMeh = statistics.GetValueOrDefault(HitResult.Meh);
        int countMiss = statistics.GetValueOrDefault(HitResult.Miss);

        double total = 6 * countGreat + 2 * countGood + countMeh;
        double max = 6 * (countGreat + countGood + countMeh + countMiss);

        if (statistics.TryGetValue(HitResult.SliderTailHit, out int countSliderTailHit))
        {
            int countSliders = beatmap.HitObjects.Count(x => x is Slider);
            total += 3 * countSliderTailHit;
            max += 3 * countSliders;
        }

        if (statistics.TryGetValue(HitResult.LargeTickHit, out int countLargeTickHit))
        {
            int countLargeTicks = beatmap.HitObjects.Sum(o => o.NestedHitObjects.Count(x => x is SliderTick or SliderRepeat));
            total += 0.6 * countLargeTickHit;
            max += 0.6 * countLargeTicks;
        }

        return max > 0 ? total / max : 1;
    }
}

/// <summary>
/// Decodes a .osu file's text synchronously and serves it as an in-memory
/// beatmap, caching by beatmap ID (an .osu file for a given ranked beatmap ID
/// never changes) so repeated calls for the same beatmap don't re-parse it.
///
/// Implements <see cref="IWorkingBeatmap"/> directly rather than extending
/// the abstract <see cref="WorkingBeatmap"/> base class. That base class's
/// <c>Beatmap</c> property routes through an async Task-based
/// <c>loadBeatmapAsync</c>/<c>GetResultSafely</c> pipeline (with a 10-second
/// timeout) built for a real desktop thread pool; under the single-threaded
/// Mono browser-wasm interpreter that pipeline fails, and its catch block
/// reports the failure via <c>Logger.Error(...)</c> -- which is what actually
/// triggers <c>osu.Framework.RuntimeInfo</c>'s browser-incompatible
/// OS-detection to run and throw (confirmed by decompiling both an early,
/// crashing build of this bridge and a working reference build: RuntimeInfo,
/// DebugUtils, and Logger were byte-for-byte identical in both -- the only
/// difference was which code path got exercised). Implementing the interface
/// directly avoids that inherited machinery entirely; <see cref="Beatmap"/>
/// and <see cref="GetPlayableBeatmap(IRulesetInfo, IReadOnlyList{Mod})"/>
/// below are plain synchronous code.
/// </summary>
internal sealed class BridgeWorkingBeatmap : IWorkingBeatmap
{
    private static readonly Dictionary<string, BridgeWorkingBeatmap> Cache = new();

    private readonly Beatmap beatmap;

    public static BridgeWorkingBeatmap GetOrCreate(string beatmapId, string osuFileText)
    {
        if (Cache.TryGetValue(beatmapId, out var cached))
            return cached;

        var working = new BridgeWorkingBeatmap(ReadFromText(osuFileText));
        Cache[beatmapId] = working;
        return working;
    }

    private BridgeWorkingBeatmap(Beatmap beatmap)
    {
        this.beatmap = beatmap;
        beatmap.BeatmapInfo.Ruleset = new OsuRuleset().RulesetInfo;
    }

    private static Beatmap ReadFromText(string osuFileText)
    {
        using var stream = new MemoryStream(Encoding.UTF8.GetBytes(osuFileText));
        using var reader = new LineBufferedReader(stream);
        return osu.Game.Beatmaps.Formats.Decoder.GetDecoder<Beatmap>(reader).Decode(reader);
    }

    public IBeatmapInfo BeatmapInfo => beatmap.BeatmapInfo;
    public bool BeatmapLoaded => true;
    public bool TrackLoaded => false;
    public IBeatmap Beatmap => beatmap;

    public Texture GetBackground() => throw new NotSupportedException();
    public Texture GetPanelBackground() => throw new NotSupportedException();
    public Waveform Waveform => throw new NotSupportedException();
    public Storyboard Storyboard => throw new NotSupportedException();
    public ISkin Skin => throw new NotSupportedException();
    public Track Track => throw new NotSupportedException();
    public Track LoadTrack() => throw new NotSupportedException();
    public Stream GetStream(string storagePath) => throw new NotSupportedException();
    public void BeginAsyncLoad() { }
    public void CancelAsyncLoad() { }
    public void PrepareTrackForPreview(bool looping, double? offsetFromPreviewPoint = null) { }

    public IBeatmap GetPlayableBeatmap(IRulesetInfo rulesetInfo, IReadOnlyList<Mod> mods = null)
        => GetPlayableBeatmap(rulesetInfo, mods ?? Array.Empty<Mod>(), CancellationToken.None);

    /// <summary>
    /// A conversion pipeline dictated by osu.Game's own mod-application
    /// interfaces (IApplicableToBeatmapConverter must run before conversion,
    /// IApplicableAfterBeatmapConversion after, etc. -- their names describe
    /// the required order, this isn't a stylistic choice). Written fresh
    /// against those public, MIT-licensed interfaces.
    /// </summary>
    public IBeatmap GetPlayableBeatmap(IRulesetInfo rulesetInfo, IReadOnlyList<Mod> mods, CancellationToken cancellationToken)
    {
        var rulesetInstance = rulesetInfo.CreateInstance()
                               ?? throw new RulesetLoadException("Creating ruleset instance failed when attempting to create playable beatmap.");
        var converter = rulesetInstance.CreateBeatmapConverter(beatmap);

        if (beatmap.HitObjects.Count > 0 && !converter.CanConvert())
            throw new osu.Game.Rulesets.UI.BeatmapInvalidForRulesetException("Beatmap cannot be converted for the requested ruleset.");

        foreach (var mod in mods.OfType<IApplicableToBeatmapConverter>())
        {
            cancellationToken.ThrowIfCancellationRequested();
            mod.ApplyToBeatmapConverter(converter);
        }

        var converted = converter.Convert(cancellationToken);

        foreach (var mod in mods.OfType<IApplicableAfterBeatmapConversion>())
        {
            cancellationToken.ThrowIfCancellationRequested();
            mod.ApplyToBeatmap(converted);
        }

        foreach (var mod in mods.OfType<IApplicableToDifficulty>())
        {
            cancellationToken.ThrowIfCancellationRequested();
            mod.ApplyToDifficulty(converted.Difficulty);
        }

        var processor = rulesetInstance.CreateBeatmapProcessor(converted);
        if (processor != null)
        {
            foreach (var mod in mods.OfType<IApplicableToBeatmapProcessor>())
                mod.ApplyToBeatmapProcessor(processor);
            processor.PreProcess();
        }

        foreach (var hitObject in converted.HitObjects)
        {
            cancellationToken.ThrowIfCancellationRequested();
            hitObject.ApplyDefaults(converted.ControlPointInfo, converted.Difficulty, cancellationToken);
        }

        foreach (var mod in mods.OfType<IApplicableToHitObject>())
        {
            foreach (var hitObject in converted.HitObjects)
            {
                cancellationToken.ThrowIfCancellationRequested();
                mod.ApplyToHitObject(hitObject);
            }
        }

        processor?.PostProcess();

        foreach (var mod in mods.OfType<IApplicableToBeatmap>())
        {
            cancellationToken.ThrowIfCancellationRequested();
            mod.ApplyToBeatmap(converted);
        }

        return converted;
    }
}
