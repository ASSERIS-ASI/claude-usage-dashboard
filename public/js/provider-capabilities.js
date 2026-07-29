/**
 * @asseris-module       Provider Capability Index
 * @asseris-description  Declarative Provider × Capability matrix. Single source of truth
 *                       for which LLM/provider structurally supports which feed column /
 *                       report — so the UI can distinguish "empty (no value)" from
 *                       "not applicable" from "known extraction gap", and so future
 *                       providers plug in by adding one row (no render-code change).
 * @asseris-pillar       actuator
 * @asseris-domain       dashboard-ui
 * @asseris-stage        core
 * @asseris-implements   —
 * @asseris-anchor       —
 * @asseris-calls        —
 * @asseris-called-by    Gateway Section (request feed), Vendor filter chips
 * @asseris-emits        window.PROVIDER_CAPS, window.providerCapOf, window.providerCapLabel
 * @asseris-consumes     canonical vendor key (claude|anthropic|openai|augureai|cursor|…)
 *
 * Capability value semantics (the tri-state that disambiguates the feed's "—"):
 *   'yes'     — supported AND extracted → render the value; empty value renders as "—".
 *   'na'      — provider has no such concept → render dim "n/a" (never a data defect).
 *   'gap'     — applicable but NOT yet extracted (data we currently drop) → render dim
 *               "·" with a tooltip; this is the honest "we lose this" marker.
 *   'partial' — extracted but incomplete / different shape.
 *
 * Mirror (human-readable, GOV-15): docs/provider-capability-index.md.
 * This file is the machine source of truth; keep the two in sync when a provider is added.
 */
(function () {
  "use strict";

  // Canonical capability keys — also the feed-column mapping (see gwFeedCapCell).
  //   model · transport · usage · cache · thinking · fixes · quota · cursor_stream · evidence · profiler
  var PROVIDER_CAPS = {
    version: "1",
    // Ordered so the vendor chips render in a stable, sensible order; unknown
    // providers discovered in live data are appended after these.
    order: ["claude", "anthropic", "openai", "augureai", "cursor"],
    providers: {
      // Claude Code family (CLI / Desktop / VSCode) → api.anthropic.com
      claude: {
        label: "Claude", upstream: "api.anthropic.com", wire: "anthropic",
        caps: {
          model: "yes", transport: "yes", usage: "yes", cache: "yes",
          thinking: "yes", fixes: "yes", quota: "yes",
          cursor_stream: "na", evidence: "yes", profiler: "yes"
        }
      },
      // Other Anthropic-API clients (3rd-party SDK / unknown UA) → api.anthropic.com.
      // Gateway fixes run only for the Claude-Code /v1/messages shape → 'partial'.
      anthropic: {
        label: "Anthropic", upstream: "api.anthropic.com", wire: "anthropic",
        caps: {
          model: "yes", transport: "yes", usage: "yes", cache: "yes",
          thinking: "yes", fixes: "partial", quota: "yes",
          cursor_stream: "na", evidence: "yes", profiler: "yes"
        }
      },
      // OpenAI / Codex / ChatGPT → chatgpt.com, api.openai.com. cache = cached_tokens
      // (mapped by openai-parser). thinking = reasoning tokens exist but are not yet
      // counted → 'gap'. fixes/quota are Anthropic-only concepts → 'na'.
      openai: {
        label: "OpenAI", upstream: "chatgpt.com · api.openai.com", wire: "openai",
        caps: {
          model: "yes", transport: "yes", usage: "yes", cache: "yes",
          thinking: "gap", fixes: "na", quota: "na",
          cursor_stream: "na", evidence: "yes", profiler: "yes"
        }
      },
      // AugureAI (OpenAI-compatible today, own SDK) → api.augureai.ca.
      augureai: {
        label: "AugureAI", upstream: "api.augureai.ca", wire: "openai",
        caps: {
          model: "yes", transport: "yes", usage: "yes", cache: "partial",
          thinking: "gap", fixes: "na", quota: "na",
          cursor_stream: "na", evidence: "yes", profiler: "yes"
        }
      },
      // Cursor (Connect protocol). No Anthropic-style usage/cache; reasoning + text
      // blocks + frames are the native signal → cursor_stream.
      cursor: {
        label: "Cursor", upstream: "*.cursor.sh · cursor.com", wire: "connect",
        caps: {
          model: "yes", transport: "yes", usage: "na", cache: "na",
          thinking: "yes", fixes: "na", quota: "na",
          cursor_stream: "yes", evidence: "yes", profiler: "yes"
        }
      }
    },
    // Fallback for any provider discovered in live data but not yet catalogued.
    // Everything 'unknown' so the UI shows a neutral marker instead of asserting n/a.
    _default: {
      label: "", upstream: "", wire: "unknown",
      caps: {
        model: "unknown", transport: "unknown", usage: "unknown", cache: "unknown",
        thinking: "unknown", fixes: "unknown", quota: "unknown",
        cursor_stream: "unknown", evidence: "yes", profiler: "yes"
      }
    }
  };

  // Resolve the caps object for a canonical vendor key (falls back to _default).
  function providerCapOf(vendorKey) {
    var p = PROVIDER_CAPS.providers[vendorKey];
    return (p && p.caps) || PROVIDER_CAPS._default.caps;
  }

  // One capability value ('yes'|'na'|'gap'|'partial'|'unknown') for a vendor.
  function providerCap(vendorKey, capKey) {
    var caps = providerCapOf(vendorKey);
    return caps[capKey] || "unknown";
  }

  // Human label for a chip; falls back to a capitalised key.
  function providerCapLabel(vendorKey) {
    var p = PROVIDER_CAPS.providers[vendorKey];
    if (p && p.label) return p.label;
    if (!vendorKey) return "";
    return vendorKey.charAt(0).toUpperCase() + vendorKey.slice(1);
  }

  // Stable ordering helper: known order first, then any extra keys alphabetically.
  function providerCapOrder(keys) {
    var known = PROVIDER_CAPS.order;
    var seen = {};
    var out = [];
    for (var i = 0; i < known.length; i++) {
      if (keys.indexOf(known[i]) !== -1) { out.push(known[i]); seen[known[i]] = true; }
    }
    var extras = keys.filter(function (k) { return !seen[k]; }).sort();
    return out.concat(extras);
  }

  window.PROVIDER_CAPS = PROVIDER_CAPS;
  window.providerCapOf = providerCapOf;
  window.providerCap = providerCap;
  window.providerCapLabel = providerCapLabel;
  window.providerCapOrder = providerCapOrder;
})();
