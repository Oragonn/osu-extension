using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices.JavaScript;
using System.Text;
using System.Text.Json.Nodes;
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
/// <see cref="WorkingBeatmap"/> -- adapted from ppy/osu-tools's
/// ProcessorWorkingBeatmap (MIT Licence, Copyright (c) ppy Pty Ltd
/// &lt;contact@ppy.sh&gt;), reading from a string instead of a file path, and
/// caching by beatmap ID (an .osu file for a given ranked beatmap ID never
/// changes) so repeated calls for the same beatmap don't re-parse it.
/// </summary>
internal sealed class BridgeWorkingBeatmap : WorkingBeatmap
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
        : base(beatmap.BeatmapInfo, null)
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

    protected override IBeatmap GetBeatmap() => beatmap;
    public override Texture GetBackground() => throw new NotImplementedException();
    protected override Track GetBeatmapTrack() => throw new NotImplementedException();
    protected override ISkin GetSkin() => throw new NotImplementedException();
    public override Stream GetStream(string storagePath) => throw new NotImplementedException();
}
