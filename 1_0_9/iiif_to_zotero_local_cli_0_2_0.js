#!/usr/bin/env node
"use strict";

/**
 * IIIF → CSL-JSON → Zotero JSON CLI
 * Version: 0.2.0
 *
 * Name: iiif_to_zotero_local_cli_0_2_0.js
 *
 * Purpose:
 *   - Local-first tool to turn IIIF manifests (via your core) or existing
 *     CSL-JSON files into Zotero-style item JSON.
 *   - Optionally upload the resulting items to Zotero via the Web API.
 *
 * Modes:
 *   A) IIIF URL mode:
 *        node iiif_to_zotero_local_cli_0_2_0.js <url> [more_urls...] [--out zotero.json]
 *      Or:
 *        cat urls.txt | node iiif_to_zotero_local_cli_0_2_0.js --out zotero.json
 *
 *   B) CSL file mode:
 *        node iiif_to_zotero_local_cli_0_2_0.js --csl items_csl.json [--out zotero.json]
 *
 *   C) Optional Web API upload (on top of A or B):
 *        node iiif_to_zotero_local_cli_0_2_0.js \
 *          <url> \
 *          --post-webapi \
 *          --api-user 123456 \
 *          --api-key YOUR_API_KEY \
 *          --out zotero.json
 *
 * Notes:
 *   - Output is always a Zotero JSON items array, written to stdout or --out file.
 *   - If --post-webapi is given, the same array is also POSTed to Zotero Web API.
 */

const fs = require("fs");
const path = require("path");

// ------------------------------------------------------------
// Core loader: prefer newest, then fall back
// ------------------------------------------------------------

let iiifManifestUrlsToCSL = null;

(function loadCore() {
  const candidates = [
    "./iiif_to_csl_core_1_1_0_fruittimer.js",
    "./iiif_to_csl_core_1_0_9_fruitcounter.js",
    "./iiif_to_csl_core_1_0_9.js"
  ];

  for (const candidate of candidates) {
    try {
      const core = require(candidate);
      if (core && typeof core.iiifManifestUrlsToCSL === "function") {
        iiifManifestUrlsToCSL = core.iiifManifestUrlsToCSL;
        console.error(`Using core: ${candidate}`);
        return;
      }
    } catch (_e) {
      // Ignore and try next candidate
    }
  }

  // If we get here, IIIF URL mode won't work, but CSL mode can still work.
  console.error(
    "Warning: no usable iiif_to_csl_core_* module found.\n" +
    "IIIF URL mode will not work unless you adjust the require paths."
  );
})();

// ------------------------------------------------------------
// CLI argument parsing
// ------------------------------------------------------------

function parseArgs(argv) {
  let outFile = null;
  let cslFile = null;
  const urls = [];

  // Web API flags
  let postWebAPI = false;
  let apiUser = null;
  let apiKey = null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === "--out") {
      const next = argv[i + 1];
      if (!next) {
        console.error("Error: --out flag requires a filename.");
        process.exit(1);
      }
      outFile = next;
      i++;
      continue;
    }

    if (arg.startsWith("--out=")) {
      outFile = arg.slice("--out=".length);
      continue;
    }

    if (arg === "--csl") {
      const next = argv[i + 1];
      if (!next) {
        console.error("Error: --csl flag requires a filename.");
        process.exit(1);
      }
      cslFile = next;
      i++;
      continue;
    }

    if (arg.startsWith("--csl=")) {
      cslFile = arg.slice("--csl=".length);
      continue;
    }

    // --- NEW: Web API flags ---
    if (arg === "--post-webapi") {
      postWebAPI = true;
      continue;
    }

    if (arg === "--api-user") {
      const next = argv[i + 1];
      if (!next) {
        console.error("Error: --api-user flag requires a userID.");
        process.exit(1);
      }
      apiUser = next;
      i++;
      continue;
    }

    if (arg === "--api-key") {
      const next = argv[i + 1];
      if (!next) {
        console.error("Error: --api-key flag requires a key string.");
        process.exit(1);
      }
      apiKey = next;
      i++;
      continue;
    }

    if (arg.startsWith("-")) {
      console.error(`Warning: unrecognized flag '${arg}' (ignored).`);
      continue;
    }

    // Positional argument → treat as manifest URL
    urls.push(arg);
  }

  return { outFile, cslFile, urls, postWebAPI, apiUser, apiKey };
}

// ------------------------------------------------------------
// Read lines from stdin (for manifest URLs)
// ------------------------------------------------------------

function readLinesFromStdin() {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");

    process.stdin.on("data", chunk => (data += chunk));
    process.stdin.on("error", reject);
    process.stdin.on("end", () => {
      if (!data) return resolve([]);
      resolve(
        data
          .split(/\r?\n/)
          .map(s => s.trim())
          .filter(Boolean)
      );
    });
  });
}

// ------------------------------------------------------------
// CSL → Zotero mapping
// ------------------------------------------------------------

/**
 * Map CSL type → Zotero itemType.
 * Extend this table as you broaden IIIF→CSL usage.
 */
function mapCslTypeToZoteroItemType(cslType) {
  const t = (cslType || "").toLowerCase();

  const MAP = {
    "book": "book",
    "article-journal": "journalArticle",
    "manuscript": "manuscript"
  };

  if (MAP[t]) return MAP[t];

  // Conservative default
  return "book";
}

/**
 * Convert CSL "author" array → Zotero "creators" array.
 */
function mapCslAuthorsToCreators(cslItem) {
  const authors = Array.isArray(cslItem.author) ? cslItem.author : [];
  const creators = [];

  for (const a of authors) {
    const given = (a.given || "").trim();
    const family = (a.family || "").trim();
    const literal = (a.literal || "").trim();

    let firstName = "";
    let lastName = "";

    if (family || given) {
      firstName = given;
      lastName = family || given; // fallback if only one part
    } else if (literal) {
      firstName = "";
      lastName = literal;
    } else {
      continue;
    }

    creators.push({
      creatorType: "author",
      firstName,
      lastName
    });
  }

  return creators;
}

/**
 * Flatten CSL issued date object → Zotero date string.
 * Expects: { "date-parts": [[YYYY, MM, DD]] }
 */
function mapCslIssuedToZoteroDate(cslItem) {
  const issued = cslItem.issued;
  if (!issued || !Array.isArray(issued["date-parts"])) return "";

  const parts = issued["date-parts"][0];
  if (!Array.isArray(parts) || parts.length === 0) return "";

  const [y, m, d] = parts;
  if (!y) return "";

  let out = String(y);
  if (m != null) {
    const mm = String(m).padStart(2, "0");
    out += "-" + mm;
    if (d != null) {
      const dd = String(d).padStart(2, "0");
      out += "-" + dd;
    }
  }
  return out;
}

/**
 * Convert a single CSL item → Zotero item JSON.
 */
function cslToZoteroItem(cslItem) {
  const zotItem = {};

  zotItem.itemType = mapCslTypeToZoteroItemType(cslItem.type);
  zotItem.title = cslItem.title || "[untitled]";

  // Creators
  const creators = mapCslAuthorsToCreators(cslItem);
  zotItem.creators = creators;

  // Date
  const dateStr = mapCslIssuedToZoteroDate(cslItem);
  if (dateStr) {
    zotItem.date = dateStr;
  }

  // Publisher and archival fields
  if (cslItem.publisher) {
    zotItem.publisher = cslItem.publisher;
  }
  if (cslItem.archive) {
    zotItem.archive = cslItem.archive;
  }
  if (cslItem["archive_location"]) {
    zotItem.archiveLocation = cslItem["archive_location"];
  }
  if (cslItem["collection-title"]) {
    // Treat digital project / IIIF portal as libraryCatalog
    zotItem.libraryCatalog = cslItem["collection-title"];
  }

  // URL
  if (cslItem.URL) {
    zotItem.url = cslItem.URL;
  }

  // Extra: for now, pour CSL note into extra as-is.
  if (cslItem.note) {
    zotItem.extra = cslItem.note;
  }

  return zotItem;
}

// ------------------------------------------------------------
// Zotero Web API upload helper
// ------------------------------------------------------------

async function uploadToZoteroWebAPI(userID, apiKey, items) {
  if (!Array.isArray(items) || items.length === 0) {
    console.error("No items to upload; skipping Web API call.");
    return;
  }

  const endpoint = `https://api.zotero.org/users/${userID}/items`;

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Zotero-API-Key": apiKey,
      "Content-Type": "application/json",
      "If-Unmodified-Since-Version": "0"
    },
    body: JSON.stringify(items)
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Zotero API error ${res.status}: ${text}`);
  }

  return await res.json();
}

// ------------------------------------------------------------
// Usage help
// ------------------------------------------------------------

function printUsage() {
  const script = path.basename(process.argv[1] || "iiif_to_zotero_local_cli_0_2_0.js");
  console.error(`
Usage:
  ${script} <manifest_url> [more_urls...] [--out zotero_items.json]
  echo "https://example.org/iiif/manifest" | ${script} --out zotero_items.json

  ${script} --csl items_csl.json [--out zotero_items.json]

Optional Web API upload:
  ${script} <url> [...] --post-webapi --api-user USERID --api-key KEY [--out zotero_items.json]

Options:
  --csl FILE       Read CSL-JSON from FILE instead of converting IIIF URLs.
  --out FILE       Write Zotero JSON array to FILE instead of stdout.
  --post-webapi    Also POST the Zotero items to Zotero Web API.
  --api-user ID    Zotero userID for Web API upload.
  --api-key  KEY   Zotero API key for Web API upload.

Notes:
  - If --csl is given, manifest URLs (argv + stdin) are ignored.
  - If neither --csl nor any URLs are provided, this help is shown.
`.trim());
}

// ------------------------------------------------------------
// Main
// ------------------------------------------------------------

async function main() {
  const {
    outFile,
    cslFile,
    urls: argvUrls,
    postWebAPI,
    apiUser,
    apiKey
  } = parseArgs(process.argv.slice(2));

  // Only read stdin if it is *not* a TTY (i.e. a pipe or redirected file)
  const shouldReadStdin = !process.stdin.isTTY;
  const stdinUrls = shouldReadStdin ? await readLinesFromStdin() : [];
  const urls = [...argvUrls, ...stdinUrls];

  let cslItems = [];

  // Mode A: CSL file provided
  if (cslFile) {
    let raw;
    try {
      raw = fs.readFileSync(cslFile, "utf8");
    } catch (err) {
      console.error(`Error: could not read CSL file '${cslFile}':`, err.message || err);
      process.exit(1);
    }

    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        cslItems = parsed;
      } else if (parsed && typeof parsed === "object") {
        cslItems = [parsed];
      } else {
        throw new Error("Top-level JSON is neither array nor object.");
      }
    } catch (err) {
      console.error(`Error: could not parse CSL JSON from '${cslFile}':`, err.message || err);
      process.exit(1);
    }
  }
  // Mode B: no CSL file → use IIIF URLs
  else {
    if (!urls || urls.length === 0) {
      printUsage();
      process.exit(1);
    }

    if (typeof iiifManifestUrlsToCSL !== "function") {
      console.error(
        "Error: iiifManifestUrlsToCSL is not available.\n" +
        "Fix the core require path at the top of this script or use --csl mode."
      );
      process.exit(1);
    }

    const totalUrls = urls.length;
    try {
      cslItems = await iiifManifestUrlsToCSL(urls);
      const success = cslItems.length;
      const failed = totalUrls - success;

      if (success === 0) {
        console.error("No valid IIIF manifests were converted to CSL.");
      } else if (failed === 0) {
        console.error(`${success} of ${totalUrls} URL(s) converted to CSL successfully.`);
      } else {
        console.error(
          `Warning: ${failed} of ${totalUrls} URL(s) failed to convert to CSL. (${success} succeeded)`
        );
      }
    } catch (err) {
      console.error("Fatal error during IIIF→CSL conversion:", err.message || err);
      process.exit(1);
    }
  }

  // CSL → Zotero mapping
  const zoteroItems = [];
  for (const item of cslItems) {
    try {
      const zi = cslToZoteroItem(item);
      zoteroItems.push(zi);
    } catch (err) {
      console.error("Error converting CSL item to Zotero item:", err.message || err);
    }
  }

  // Optional: Zotero Web API upload
  if (postWebAPI) {
    if (!apiUser || !apiKey) {
      console.error("Error: --post-webapi requires --api-user and --api-key.");
      process.exit(1);
    }

    try {
      await uploadToZoteroWebAPI(apiUser, apiKey, zoteroItems);
      console.error(
        `Uploaded ${zoteroItems.length} item(s) to Zotero Web API (user ${apiUser}).`
      );
    } catch (err) {
      console.error("Zotero upload failed:", err.message || err);
      process.exit(1);
    }
  }

  // Output Zotero JSON locally (as before)
  const jsonOut = JSON.stringify(zoteroItems, null, 2);
  if (outFile) {
    try {
      fs.writeFileSync(outFile, jsonOut, "utf8");
    } catch (err) {
      console.error(`Error writing output file '${outFile}':`, err.message || err);
      process.exit(1);
    }
  } else {
    process.stdout.write(jsonOut + "\n");
  }

  console.error(
    `Converted ${zoteroItems.length} CSL item(s) into Zotero JSON item(s).`
  );
}

if (require.main === module) {
  main();
}
