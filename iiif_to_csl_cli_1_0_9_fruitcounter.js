#!/usr/bin/env node
"use strict";

/**
 * IIIF → CSL-JSON CLI wrapper
 * Version: 1.0.7
 *
 * Usage:
 *   node iiif_to_csl_cli_1_0_7.js <manifest_url> [more_urls...] [--out result.json]
 *
 * Or:
 *   echo "https://example.org/iiif/manifest" | node iiif_to_csl_cli_1_0_7.js --out items.json
 *
 * URLs may come from argv, stdin, or both.
 */

const fs = require("fs");
const { iiifManifestUrlsToCSL } = require("./iiif_to_csl_core_1_0_9.js");

/* ------------------------------------------------------------
 * Parse command-line arguments
 * ------------------------------------------------------------ */
function parseArgs(argv) {
  let outFile = null;
  const urls = [];

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

    if (arg.startsWith("-")) {
      console.error(`Warning: unrecognized flag '${arg}' (ignored).`);
      continue;
    }

    urls.push(arg);
  }

  return { outFile, urls };
}

/* ------------------------------------------------------------
 * Read URLs from stdin (one per line)
 * ------------------------------------------------------------ */
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

/* ------------------------------------------------------------
 * Print usage help
 * ------------------------------------------------------------ */
function printUsage() {
  console.error(`
Usage:
  node iiif_to_csl_cli_1_0_7.js <manifest_url> [more_urls...] [--out result.json]

Examples:
  node iiif_to_csl_cli_1_0_7.js https://example.org/manifest.json
  echo "https://example.org/manifest" | node iiif_to_csl_cli_1_0_7.js --out out.json
`.trim());
}

/* ------------------------------------------------------------
 * Main
 * ------------------------------------------------------------ */
async function main() {
  const { outFile, urls: argvUrls } = parseArgs(process.argv.slice(2));
  const stdinUrls = await readLinesFromStdin();
  const urls = [...argvUrls, ...stdinUrls];

  if (urls.length === 0) {
    printUsage();
    process.exit(1);
  }

  const total = urls.length;

  try {
    // Core does per-URL logging to stderr for failures
    const items = await iiifManifestUrlsToCSL(urls);

    // 1) Always print the JSON result first (even if empty)
    const json = JSON.stringify(items, null, 2);
    if (outFile) {
      fs.writeFileSync(outFile, json, "utf8");
    } else {
      process.stdout.write(json + "\n");
    }

    // 2) Now compute and report failures at the very end
      const success = items.length;
      const failed = total - success;

      // Case 1: no successes at all
      if (success === 0) {
      console.error("No valid IIIF manifests were processed.");
      process.exitCode = 1;
      return;
      }

      // Case 2: all succeeded
      if (failed === 0) {
      console.error(`${success} of ${total} URL(s) converted successfully.`);
      // exitCode remains 0
      return;
      }

      // Case 3: partial success
      console.error(
      `Warning: ${failed} of ${total} URL(s) failed to convert. (${success} succeeded)`
      );
      process.exitCode = 1;

  } 
  catch (err) {
    // Catastrophic error (not per-URL), e.g. programming bug
    console.error("Fatal error:", err && err.message ? err.message : err);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
