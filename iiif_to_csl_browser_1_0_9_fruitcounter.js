"use strict";

/**
 * IIIF → CSL-JSON browser wrapper
 * Version: 1.0.9
 *
 * This module adapts the Node-oriented core library so it can be used
 * from a browser context (bookmarklet, extension, or devtools console).
 *
 * It does NOT:
 *   - sniff manifests from the DOM,
 *   - talk to Zotero,
 *   - read from stdin or argv.
 *
 * It ONLY exposes a small, URL-based API:
 *
 *   iiifToCslBrowser.fromManifestUrl(url)      → Promise<CSLItem[]>
 *   iiifToCslBrowser.fromManifestUrls(urls[]) → Promise<CSLItem[]>
 *
 * The idea is:
 *   1. Something else (manifest-sniffer, user, extension) collects URLs.
 *   2. You feed them into these functions.
 *   3. You get back CSL-JSON items suitable for Zotero import.
 */

// Try to load the core module in environments that support require().
// In a pure browser bundle, your bundler (esbuild/rollup/webpack) will
// rewrite/inline this require call.
let core = {};
try {
  // NOTE: adjust this path to match your actual core filename.
  // In this fruitcounter branch the file is:
  //   "./iiif_to_csl_core_1_0_9_fruitcounter.js"
  core = require("./iiif_to_csl_core_1_0_9_fruitcounter.js");
} catch (err) {
  // In a pure browser context without bundling, require() won't exist.
  // We silently ignore that here because the bundler will handle it.
  // If you really do load this file directly in a browser without
  // bundling, you MUST ensure that `core` is provided some other way.
  core = (typeof window !== "undefined" && window.iiifToCslCore) || {};
}

const {
  iiifManifestUrlsToCSL
} = core;

/**
 * Basic guard to give a clearer error if the core wasn’t wired in
 * correctly into the bundle.
 */
function ensureCoreAvailable() {
  if (typeof iiifManifestUrlsToCSL !== "function") {
    throw new Error(
      "iiif_to_csl_browser_1_0_9: iiifManifestUrlsToCSL is not available.\n" +
      "Make sure the core library is bundled correctly, or that your bundler\n" +
      "is resolving './iiif_to_csl_core_1_0_9_fruitcounter.js' as expected."
    );
  }
}

/* ------------------------------------------------------------
 * Browser-facing API
 * ------------------------------------------------------------ */

/**
 * Convert a single IIIF manifest URL to CSL-JSON.
 *
 * Returns an array of CSL items (usually length 1), because the core
 * works in terms of "many URLs in, many items out".
 */
async function fromManifestUrl(manifestUrl) {
  ensureCoreAvailable();
  if (!manifestUrl) {
    throw new TypeError("fromManifestUrl: manifestUrl must be a non-empty string");
  }
  return iiifManifestUrlsToCSL([manifestUrl]);
}

/**
 * Convert multiple IIIF manifest URLs to CSL-JSON.
 *
 * This is the primary high-level API: give it an array of manifest URLs
 * (strings) and it returns a Promise resolving to an array of CSL items.
 */
async function fromManifestUrls(manifestUrls) {
  ensureCoreAvailable();
  if (!Array.isArray(manifestUrls)) {
    throw new TypeError("fromManifestUrls: manifestUrls must be an array of strings");
  }
  return iiifManifestUrlsToCSL(manifestUrls);
}

/* ------------------------------------------------------------
 * Global namespace wiring
 * ------------------------------------------------------------ */

function attachToGlobal() {
  // Try to be polite about which global object we use.
  const root =
    (typeof globalThis !== "undefined" && globalThis) ||
    (typeof window !== "undefined" && window) ||
    (typeof global !== "undefined" && global) ||
    {};

  const NAMESPACE = "iiifToCslBrowser";

  const existing = root[NAMESPACE] && typeof root[NAMESPACE] === "object"
    ? root[NAMESPACE]
    : {};

  const api = Object.assign(existing, {
    version: "1.0.9",
    fromManifestUrl,
    fromManifestUrls
  });

  root[NAMESPACE] = api;

  return api;
}

// Immediately attach to the global object when this script runs
// (whether in a raw <script> tag or as a bundled artifact).
const exportedGlobal = attachToGlobal();

/* ------------------------------------------------------------
 * Optional CommonJS export (for Node / tests / bundlers)
 * ------------------------------------------------------------ */

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    fromManifestUrl,
    fromManifestUrls,
    attachToGlobal,
    globalApi: exportedGlobal
  };
}
