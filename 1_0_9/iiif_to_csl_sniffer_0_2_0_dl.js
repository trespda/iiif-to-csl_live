"use strict";

/**
 * IIIF manifest sniffer + downloader (DOM → manifest URLs → CSL-JSON → file)
 * Version: 0.2.0
 *
 * 0.1.0  – basic DOM sniffer + iiifToCslBrowser bridge
 * 0.2.0  – adds sniffConvertAndDownload() and download helpers
 *
 * Scope:
 *  - Look only at REFERRER TEXT (link text/title/aria-label), NOT the href.
 *  - Canonical regex: /iiif[\s_-]*manifest/i
 *  - De-duplicate by resolved manifest URL.
 *  - Hand the final list to iiifToCslBrowser.fromManifestUrls().
 */

/* ------------------------------------------------------------
 * Configuration
 * ------------------------------------------------------------ */

// Text-based detector, applied to visible/accessible label, not href.
const MANIFEST_TEXT_RE = /iiif[\s_-]*manifest/i;

// Which elements count as “referring to” a manifest.
// Start minimal; you can add buttons etc. later if needed.
const SELECTOR_REFERRERS = "a, [role='link']";

/* ------------------------------------------------------------
 * Helpers
 * ------------------------------------------------------------ */

function getGlobal() {
  return (
    (typeof globalThis !== "undefined" && globalThis) ||
    (typeof window !== "undefined" && window) ||
    (typeof global !== "undefined" && global) ||
    {}
  );
}

/**
 * Get a “human” label for a node: textContent, or title, or aria-label.
 */
function getNodeLabel(node) {
  if (!node || typeof node !== "object") return "";
  const direct = (node.textContent || "").trim();
  if (direct) return direct;
  const title = (node.getAttribute && node.getAttribute("title")) || "";
  if (title.trim()) return title.trim();
  const aria = (node.getAttribute && node.getAttribute("aria-label")) || "";
  if (aria.trim()) return aria.trim();
  return "";
}

/**
 * Resolve href against document.location (or a given base URL).
 */
function resolveUrl(href, baseUrl) {
  if (!href) return null;
  try {
    const base = baseUrl || (typeof document !== "undefined" ? document.location.href : undefined);
    const url = base ? new URL(href, base) : new URL(href);
    return url.toString();
  } catch (_err) {
    return null;
  }
}

/* ------------------------------------------------------------
 * Core sniffer: DOM → manifest candidate list
 * ------------------------------------------------------------ */

/**
 * Find all DOM nodes that look like “IIIF manifest” referrers.
 *
 * Returns an array of objects:
 *   {
 *     node,         // the DOM element
 *     label,        // the label used for matching
 *     href,         // raw href (if any)
 *     resolvedHref  // fully resolved URL string or null
 *   }
 */
function findManifestReferrerNodes(root) {
  const rootNode = root || (typeof document !== "undefined" ? document : null);
  if (!rootNode) return [];

  const nodes = Array.from(rootNode.querySelectorAll(SELECTOR_REFERRERS));
  const results = [];

  for (const node of nodes) {
    const label = getNodeLabel(node);
    if (!label) continue;

    if (!MANIFEST_TEXT_RE.test(label)) {
      continue; // no canonical match in the *textual referrer*, skip
    }

    const href =
      (node.tagName === "A" && node.getAttribute("href")) ||
      (node.getAttribute && node.getAttribute("data-href")) ||
      null;

    const resolvedHref = resolveUrl(href);

    results.push({
      node,
      label,
      href,
      resolvedHref
    });
  }

  return results;
}

/**
 * De-duplicate candidates by resolvedHref.
 *
 * For each URL, keep the “best” candidate:
 *   - currently: shortest label (heuristic: less boilerplate)
 *   - future: can add scoring: exact "IIIF manifest", etc.
 */
function dedupeManifestCandidates(candidates) {
  const byUrl = new Map();

  for (const c of candidates) {
    if (!c.resolvedHref) continue;
    const existing = byUrl.get(c.resolvedHref);
    if (!existing) {
      byUrl.set(c.resolvedHref, c);
      continue;
    }

    // Heuristic: prefer more compact labels
    if ((c.label || "").length < (existing.label || "").length) {
      byUrl.set(c.resolvedHref, c);
    }
  }

  return Array.from(byUrl.values());
}

/**
 * High-level sniffer:
 *
 * Returns an object:
 *   {
 *     candidates,    // all nodes that matched the regex, before dedupe
 *     unique,        // unique candidates by resolved URL
 *     manifestUrls   // array of resolvedHref strings
 *   }
 */
function sniffManifestUrls(root) {
  const candidates = findManifestReferrerNodes(root);
  const unique = dedupeManifestCandidates(candidates);
  const manifestUrls = unique
    .map(c => c.resolvedHref)
    .filter(u => typeof u === "string" && u.length > 0);

  return { candidates, unique, manifestUrls };
}

/* ------------------------------------------------------------
 * Bridge to iiifToCslBrowser
 * ------------------------------------------------------------ */

/**
 * Run the sniffer and immediately hand URLs to iiifToCslBrowser.fromManifestUrls().
 *
 * Options:
 *   - root: DOM root to sniff (defaults to document)
 *   - quiet: if true, reduce console chatter
 *
 * Returns a Promise that resolves to the CSL items array
 * (or null if nothing was found).
 */
async function sniffAndConvertManifests(options) {
  const opts = options || {};
  const root = opts.root || (typeof document !== "undefined" ? document : null);
  const quiet = !!opts.quiet;

  const g = getGlobal();
  const browserApi = g.iiifToCslBrowser;

  if (!browserApi || typeof browserApi.fromManifestUrls !== "function") {
    throw new Error(
      "iiif_to_csl_sniffer: iiifToCslBrowser.fromManifestUrls not found on global object.\n" +
      "Make sure iiif_to_csl_browser_1_0_9.bundle.js is loaded first."
    );
  }

  const { manifestUrls, unique } = sniffManifestUrls(root);

  if (!manifestUrls.length) {
    if (!quiet) {
      console.warn("[iiif_to_csl_sniffer] No IIIF manifest referrers matched /iiif[\\s_-]*manifest/ in this page.");
    }
    return null;
  }

  if (!quiet) {
    console.log(
      `[iiif_to_csl_sniffer] Found ${manifestUrls.length} manifest URL(s):`,
      manifestUrls
    );
    console.log(
      "[iiif_to_csl_sniffer] Representative nodes:",
      unique.map(c => ({ label: c.label, href: c.href, resolvedHref: c.resolvedHref }))
    );
  }

  const items = await browserApi.fromManifestUrls(manifestUrls);

  if (!quiet) {
    console.log(
      `[iiif_to_csl_sniffer] Conversion result: ${Array.isArray(items) ? items.length : 0} CSL item(s).`,
      items
    );
  }

  return items;
}

/* ------------------------------------------------------------
 * Download helpers (0.2.0)
 * ------------------------------------------------------------ */

/**
 * Produce a timestamped filename like:
 *   iiif-items_2025-11-28T18-24-01.234Z.json
 */
function makeTimestampedFilename() {
  const now = new Date();
  const iso = now.toISOString().replace(/:/g, "-");
  return `iiif-items_${iso}.json`;
}

/**
 * Trigger a client-side JSON download.
 *
 * @param {string} json - stringified JSON data
 * @param {string} [filename] - optional filename; if omitted, use timestamped default
 */
function triggerDownloadFromJson(json, filename) {
  const name = filename || makeTimestampedFilename();
  const blob = new Blob([json], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();

  setTimeout(function cleanup() {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 200);
}

/**
 * Sniff → convert → download CSL-JSON.
 *
 * Options:
 *   - root: DOM root to sniff (defaults to document)
 *   - quiet: if true, reduce console chatter
 *   - filename: override default download filename
 *
 * Returns:
 *   Promise that resolves to the CSL items array (or null if no manifests).
 */
async function sniffConvertAndDownload(options) {
  const opts = options || {};
  const quiet = !!opts.quiet;

  const items = await sniffAndConvertManifests(opts);
  if (!items) {
    if (!quiet) {
      console.warn("[iiif_to_csl_sniffer] Nothing to download: no IIIF manifests found.");
    }
    return null;
  }

  const json = JSON.stringify(items, null, 2);
  triggerDownloadFromJson(json, opts.filename);
  return items;
}

/* ------------------------------------------------------------
 * Global export
 * ------------------------------------------------------------ */

(function attachToGlobal() {
  const g = getGlobal();
  const NAMESPACE = "iiifToCslSniffer";

  const existing = g[NAMESPACE] && typeof g[NAMESPACE] === "object"
    ? g[NAMESPACE]
    : {};

  const api = Object.assign(existing, {
    version: "0.2.0",
    MANIFEST_TEXT_RE,
    sniffManifestUrls,
    sniffAndConvertManifests,
    sniffConvertAndDownload,
    findManifestReferrerNodes,
    dedupeManifestCandidates,
    makeTimestampedFilename,
    triggerDownloadFromJson
  });

  g[NAMESPACE] = api;
})();

/* End of iiif_to_csl_sniffer_0_2_0.js */
