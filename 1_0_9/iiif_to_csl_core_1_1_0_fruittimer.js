"use strict";

/**
 * IIIF → CSL-JSON core conversion library
 * Version: 1.0.7
 *
 * This module exposes a single main entry point:
 *
 *   async iiifManifestUrlsToCSL(manifestUrls: string[]) => Promise<CSLItem[]>
 *
 * It is extracted from the iiif_to_csl_1_0_7 CLI script, with all
 * stdin/argv/fs logic removed, so it can be:
 *   - required from a Node CLI wrapper, or
 *   - bundled into browser code for use from a bookmarklet/extension.
 */

/**
 * looksLikeIIIFManifest(text)
 *
 * Very relaxed heuristic: for now we simply check that the response body
 * contains the string "iiif.io" somewhere, which is present in the
 * @context field of standard IIIF manifests.
 */
function looksLikeIIIFManifest(text) {
  if (!text) return false;
  return /iiif\.io/.test(text);
}

/**
 * iiifLabelToString(label)
 *
 * Normalize various IIIF label encodings to a plain string:
 *  - v2: "label": "Foo"
 *  - v3: "label": { "en": ["Foo", "Bar"] }
 *  - v2 variants: arrays of objects like {"@value": "Foo"}
 */
function iiifLabelToString(label) {
  if (!label) return "";

  // v3-style language map: { "en": ["Foo", "Bar"], ... }
  if (typeof label === "object" && !Array.isArray(label)) {
    const pieces = [];
    for (const lang in label) {
      const vals = label[lang];
      if (Array.isArray(vals)) {
        for (const v of vals) {
          if (v) pieces.push(String(v));
        }
      }
    }
    return pieces.join(" ").trim();
  }

  // v2-style: array of objects
  if (Array.isArray(label)) {
    const pieces = [];
    for (const item of label) {
      if (item && typeof item === "object" && "@value" in item) {
        pieces.push(String(item["@value"]));
      } else if (item != null) {
        pieces.push(String(item));
      }
    }
    return pieces.join(" ").trim();
  }

  // Plain string
  if (typeof label === "string") {
    return label.trim();
  }

  // Fallback: just stringify
  return String(label).trim();
}

/**
 * getFirstMetadataValue(manifest, keyCandidates)
 *
 * Given a manifest object and an array of label names (e.g. ["Author",
 * "Creator", "author", "creator"]), search the IIIF metadata for the
 * first matching label and return its value as a string. If no such label
 * is found, return an empty string.
 */
function getFirstMetadataValue(manifest, keyCandidates) {
  const metadata = manifest.metadata || [];
  for (const entry of metadata) {
    const labelStr = iiifLabelToString(entry.label || entry["label"]);
    for (const key of keyCandidates) {
      if (labelStr.toLowerCase() === key.toLowerCase()) {
        const valueStr = iiifLabelToString(entry.value || entry["value"]);
        if (valueStr) return valueStr;
      }
    }
  }
  return "";
}

/**
 * inferTypeFromMetadata(manifest)
 *
 * Try to infer a CSL type from IIIF metadata, label, or other hints.
 * Very simple for now: default to "book", with a few heuristic checks
 * for "manuscript" or "article-journal".
 */
function inferTypeFromMetadata(manifest) {
  const label = iiifLabelToString(manifest.label || manifest["label"]);
  const descCandidates = [
    iiifLabelToString(manifest.description || manifest["description"]),
    getFirstMetadataValue(manifest, ["Type", "type"])
  ].filter(Boolean);

  const haystack = (label + " " + descCandidates.join(" ")).toLowerCase();

  if (/manuscript|codex|ms\b/.test(haystack)) {
    return "manuscript";
  }
  if (/article|journal|periodical/.test(haystack)) {
    return "article-journal";
  }

  return "book";
}

/**
 * extractAuthors(manifest)
 *
 * Attempt to obtain the list of authors/creators from IIIF metadata. This
 * returns an array of CSL author objects: [{ given: "...", family: "..." }].
 */
function extractAuthors(manifest) {
  const creatorsRaw = getFirstMetadataValue(manifest, [
    "Author",
    "Authors",
    "Creator",
    "Creators",
    "author",
    "creator"
  ]);

  if (!creatorsRaw) return [];

  // Naive split on semicolon or newline; this can be refined later.
  const parts = creatorsRaw
    .split(/[;\n]+/)
    .map(p => p.trim())
    .filter(Boolean);

  return parts.map(nameStr => {
    // Very naive given/family split: last word = family, rest = given
    const tokens = nameStr.split(/\s+/);
    if (tokens.length === 1) {
      return { family: tokens[0] };
    } else {
      const family = tokens.pop();
      const given = tokens.join(" ");
      return { given, family };
    }
  });
}

// Labels like "Created", "Published", "Created/published", "Published - created",
// but *not* "Created by", "Published by", "Published for".
const CREATED_PUBLISHED_LABEL_RE =
  /^(created(?!\s*by)|published(?!\s*(by|for)))([-\/\s]+(created(?!\s*by)|published(?!\s*(by|for))))?$/i;

/**
 * extractDate(manifest)
 *
 * Look for a date in common metadata fields. For now, just return a string
 * like "1489" or "1489-01-01" if found, otherwise "".
 */
function extractDate(manifest) {
  // 1. First, try the explicit date-ish labels we already trust.
  let dateStr = getFirstMetadataValue(manifest, [
    "Date",
    "Publication Date",
    "date",
    "Issued"
  ]);

  // 2. If nothing found, look for "Created… / Published…" style labels
  //    (e.g. "Created/published", "Created - published").
  if (!dateStr) {
    const metadata = manifest.metadata || [];
    for (const entry of metadata) {
      const labelStr = iiifLabelToString(entry.label || entry["label"]);
      if (CREATED_PUBLISHED_LABEL_RE.test(labelStr)) {
        dateStr = iiifLabelToString(entry.value || entry["value"]);
        if (dateStr) break;
      }
    }
  }

  if (!dateStr) return "";

  // 3. As before: try to pick out a year; fall back to the trimmed string.
  const m = dateStr.match(/(1[0-9]{3}|20[0-9]{2})/);
  if (m) return m[1];

  return dateStr.trim();
}


/**
 * extractPublisher(manifest)
 */
function extractPublisher(manifest) {
  const publisher = getFirstMetadataValue(manifest, [
    "Publisher",
    "publisher",
    "Institution",
    "Holding Institution",
    "Repository"
  ]);
  return publisher || "";
}

/**
 * extractHomepageURL(manifest, manifestUrl)
 *
 * Try to find a human-facing homepage URL for the resource described by
 * the manifest. We look at IIIF v3 `homepage` first, and then common
 * v2-style related links. We do NOT fall back to the manifest URL here;
 * that remains available separately and is always included in the note.
 */
function extractHomepageURL(manifest, manifestUrl) { // eslint-disable-line no-unused-vars
  // IIIF Presentation 3: homepage can be a string, object, or array
  const homepage = manifest.homepage;
  const pickId = obj => {
    if (!obj || typeof obj !== "object") return "";
    if (typeof obj.id === "string") return obj.id;
    if (typeof obj["@id"] === "string") return obj["@id"];
    if (typeof obj.href === "string") return obj.href;
    return "";
  };

  if (homepage) {
    if (typeof homepage === "string") {
      return homepage;
    }
    if (Array.isArray(homepage) && homepage.length > 0) {
      const first = homepage[0];
      if (typeof first === "string") return first;
      const id = pickId(first);
      if (id) return id;
    } else if (typeof homepage === "object") {
      const id = pickId(homepage);
      if (id) return id;
    }
  }

  // IIIF Presentation 2 often uses `related` for landing pages
  const related = manifest.related;
  if (related) {
    if (typeof related === "string") return related;
    if (Array.isArray(related) && related.length > 0) {
      const first = related[0];
      if (typeof first === "string") return first;
      const id = pickId(first);
      if (id) return id;
    } else if (typeof related === "object") {
      const id = pickId(related);
      if (id) return id;
    }
  }

  // No homepage-like URL found
  return "";
}

/**
 * buildIiifNote(manifest, manifestUrl)
 *
 * Construct a human-readable summary of the IIIF manifest metadata to
 * be stored in the CSL `note` field (which Zotero will show in Extra).
 */
function buildIiifNote(manifest, manifestUrl) {
  const lines = [];
  lines.push("IIIF manifest metadata");
  lines.push("======================");
  lines.push("");

  if (manifestUrl) {
    lines.push(`Manifest URL: ${manifestUrl}`);
  }
  if (manifest["@id"]) {
    lines.push(`@id: ${manifest["@id"]}`);
  }
  if (manifest["@context"]) {
    lines.push(`@context: ${manifest["@context"]}`);
  }

  const metadata = manifest.metadata || [];
  if (metadata.length > 0) {
    lines.push("");
    lines.push("IIIF metadata:");
    for (const entry of metadata) {
      const k = iiifLabelToString(entry.label || entry["label"]);
      const v = iiifLabelToString(entry.value || entry["value"]);
      if (k || v) {
        lines.push(`${k || "?"}: ${v}`);
      }
    }
  }

  return lines.join("\n").trim();
}

/**
 * trimManifestDirectory(manifestUrl)
 *
 * Given the original manifest URL, drop the last path segment ("breadcrumb")
 * and strip any query/hash, in case a higher-level directory might serve as a
 * more human-facing landing page.
 */
function trimManifestDirectory(manifestUrl) {
  if (!manifestUrl) return "";
  try {
    const u = new URL(manifestUrl);
    // Strip query + fragment
    u.search = "";
    u.hash = "";

    const parts = u.pathname.split("/");
    // Remove empty tail from trailing slash
    if (parts.length > 1 && parts[parts.length - 1] === "") {
      parts.pop();
    }
    // Remove last real segment if there's more than just root
    if (parts.length > 1) {
      parts.pop();
    }
    let newPath = parts.join("/");
    if (!newPath.startsWith("/")) {
      newPath = "/" + newPath;
    }
    u.pathname = newPath;
    return u.toString();
  } catch (_e) {
    // If URL constructor fails (e.g. relative URL), just return original
    return manifestUrl;
  }
}

/**
 * extractIdFromManifest(manifest, manifestUrl)
 *
 * Try to determine a unique-ish ID for citekey purposes: prefer the
 * manifest ID or URL, but we can also fall back to label if needed.
 */
function extractIdFromManifest(manifest, manifestUrl) {
  if (manifest["@id"]) return String(manifest["@id"]);
  if (manifest.id) return String(manifest.id);
  if (manifestUrl) return String(manifestUrl);

  const label = iiifLabelToString(manifest.label || manifest["label"]);
  if (label) return label;

  return "";
}

/**
 * manifestToCSLItem(manifest, manifestUrl)
 *
 * Convert a single IIIF manifest object to a CSL-JSON item.
 */
function manifestToCSLItem(manifest, manifestUrl) {
  const title = iiifLabelToString(manifest.label || manifest["label"]) ||
    extractIdFromManifest(manifest, manifestUrl) ||
    "[untitled IIIF manifest]";

  const id = extractIdFromManifest(manifest, manifestUrl) || title;

  const authors = extractAuthors(manifest);
  const issued = extractDate(manifest);
  const publisher = extractPublisher(manifest);
  const type = inferTypeFromMetadata(manifest);
  const homepage = extractHomepageURL(manifest, manifestUrl);
  const note = buildIiifNote(manifest, manifestUrl);
  const trimmedManifestUrl = trimManifestDirectory(manifestUrl); // fixed

  const cslItem = {
    id,
    type,
    title,
    URL: homepage || manifest["@id"] || manifest.id || trimmedManifestUrl || ""
  };

  if (authors.length > 0) {
    cslItem.author = authors;
  }
  if (issued) {
    cslItem.issued = { "date-parts": [[issued]] };
  }
  if (publisher) {
    cslItem.publisher = publisher;
  }
  if (note) {
    cslItem.note = note;
  }

  return cslItem;
}
async function fetchWithTimeout(url, opts = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, { ...opts, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(id);
  }
}

async function fetchManifest(url) {
  const res = await fetchWithTimeout(url, {
    headers: {
      "User-Agent": "...",
      "Accept": "application/json, text/html;q=0.9, */*;q=0.8",
      "Accept-Language": "en-US,en;q=0.5"
    }
  }, 15000); // 15s, say

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }

  const text = await res.text();

  // Only continue if the body looks vaguely like a IIIF manifest.
  if (!looksLikeIIIFManifest(text)) {
    console.error("Body did not look like IIIF. First 500 chars:\n");
    console.error(text.slice(0, 500));
    throw new Error(`Not a IIIF Presentation manifest: ${url}`);
  }

  return JSON.parse(text);
}

/**
 * iiifManifestUrlsToCSL(manifestUrls)
 *
 * High-level core API: given an array of manifest URLs, fetch each
 * manifest and convert to a CSL-JSON item. Returns a Promise resolving
 * to an array suitable for Zotero's CSL importer.
 */
async function iiifManifestUrlsToCSL(manifestUrls) {
  if (!Array.isArray(manifestUrls)) {
    throw new TypeError("iiifManifestUrlsToCSL: manifestUrls must be an array of strings");
  }

  const items = [];
  for (const url of manifestUrls) {
    if (!url) continue;
    try {
      const manifest = await fetchManifest(url);
      const item = manifestToCSLItem(manifest, url);
      items.push(item);
    } catch (e) {
      // Let callers decide how to surface partial failures; for now we log.
      console.error(`Error processing ${url}: ${e.message || e}`);
    }
  }
  return items;
}

module.exports = {
  iiifManifestUrlsToCSL,
  // Export helpers too, in case the CLI or future code wants them.
  looksLikeIIIFManifest,
  iiifLabelToString,
  getFirstMetadataValue,
  inferTypeFromMetadata,
  extractAuthors,
  extractDate,
  extractPublisher,
  extractHomepageURL,
  buildIiifNote,
  trimManifestDirectory,
  extractIdFromManifest,
  manifestToCSLItem,
  fetchManifest
};
