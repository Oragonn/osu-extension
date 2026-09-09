// Hosts the official-ruleset WASM bridge (lib/osu-ruleset-bridge/) inside a
// hidden iframe and relays postMessage calls from src/engines/official-engine.js
// to it. Loaded as a module page so it can `import` dotnet.js's ES module
// export directly.
import { dotnet } from '../lib/osu-ruleset-bridge/_framework/dotnet.js';

const params = new URLSearchParams(location.search);
const channel = params.get('channel');

let bridgeExports = null;

function post(message) {
  window.parent.postMessage({ source: 'oppc-engine', channel, ...message }, '*');
}

window.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || data.source !== 'oppc' || data.channel !== channel || data.type !== 'call') return;
  const { id, method, args } = data;
  try {
    if (!bridgeExports) throw new Error('official engine not ready yet');
    const raw = bridgeExports.OsuEnhancer.RulesetBridge.Bridge[method](...args);
    post({ type: 'result', id, result: JSON.parse(raw) });
  } catch (err) {
    post({ type: 'result', id, result: { error: String((err && err.message) || err) } });
  }
});

(async () => {
  try {
    const runtime = await dotnet.create();
    const config = runtime.getConfig();
    bridgeExports = await runtime.getAssemblyExports(config.mainAssemblyName);
    // Must run before any decode/calculate call: registers a headless
    // RulesetStore with the beatmap decoder. Without this, the decoder logs
    // a "falling back to default AssemblyRulesetStore" warning on first use,
    // which is enough to trip the browser-wasm RuntimeInfo crash documented
    // in engine-bridge/FINDINGS.md.
    const initRaw = bridgeExports.OsuEnhancer.RulesetBridge.Bridge.Initialize();
    const initResult = JSON.parse(initRaw);
    if (initResult.error) throw new Error(initResult.error);
    post({ type: 'ready' });
  } catch (err) {
    post({ type: 'init-error', error: String((err && err.message) || err) });
  }
})();
