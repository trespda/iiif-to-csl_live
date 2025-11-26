"use strict";
(() => {
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __commonJS = (cb, mod) => function __require() {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  };

  // iiif_to_csl_core_1_0_9_fruitcounter.js
  var require_iiif_to_csl_core_1_0_9_fruitcounter = __commonJS({
    "iiif_to_csl_core_1_0_9_fruitcounter.js"(exports, module) {
      "use strict";
      function looksLikeIIIFManifest(text) {
        if (!text) return false;
        return /iiif\.io/.test(text);
      }
      function iiifLabelToString(label) {
        if (!label) return "";
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
        if (typeof label === "string") {
          return label.trim();
        }
        return String(label).trim();
      }
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
        const parts = creatorsRaw.split(/[;\n]+/).map((p) => p.trim()).filter(Boolean);
        return parts.map((nameStr) => {
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
      var CREATED_PUBLISHED_LABEL_RE = /^(created(?!\s*by)|published(?!\s*(by|for)))([-\/\s]+(created(?!\s*by)|published(?!\s*(by|for))))?$/i;
      function extractDate(manifest) {
        let dateStr = getFirstMetadataValue(manifest, [
          "Date",
          "Publication Date",
          "date",
          "Issued"
        ]);
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
        const m = dateStr.match(/(1[0-9]{3}|20[0-9]{2})/);
        if (m) return m[1];
        return dateStr.trim();
      }
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
      function extractHomepageURL(manifest, manifestUrl) {
        const homepage = manifest.homepage;
        const pickId = (obj) => {
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
        return "";
      }
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
      function trimManifestDirectory(manifestUrl) {
        if (!manifestUrl) return "";
        try {
          const u = new URL(manifestUrl);
          u.search = "";
          u.hash = "";
          const parts = u.pathname.split("/");
          if (parts.length > 1 && parts[parts.length - 1] === "") {
            parts.pop();
          }
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
          return manifestUrl;
        }
      }
      function extractIdFromManifest(manifest, manifestUrl) {
        if (manifest["@id"]) return String(manifest["@id"]);
        if (manifest.id) return String(manifest.id);
        if (manifestUrl) return String(manifestUrl);
        const label = iiifLabelToString(manifest.label || manifest["label"]);
        if (label) return label;
        return "";
      }
      function manifestToCSLItem(manifest, manifestUrl) {
        const title = iiifLabelToString(manifest.label || manifest["label"]) || extractIdFromManifest(manifest, manifestUrl) || "[untitled IIIF manifest]";
        const id = extractIdFromManifest(manifest, manifestUrl) || title;
        const authors = extractAuthors(manifest);
        const issued = extractDate(manifest);
        const publisher = extractPublisher(manifest);
        const type = inferTypeFromMetadata(manifest);
        const homepage = extractHomepageURL(manifest, manifestUrl);
        const note = buildIiifNote(manifest, manifestUrl);
        const trimmedManifestUrl = trimManifestDirectory(manifestUrl);
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
      async function fetchManifest(url) {
        const res = await fetch(url, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0",
            "Accept": "application/json, text/html;q=0.9, */*;q=0.8",
            "Accept-Language": "en-US,en;q=0.5"
          }
        });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status} for ${url}`);
        }
        const text = await res.text();
        if (!looksLikeIIIFManifest(text)) {
          console.error("Body did not look like IIIF. First 500 chars:\n");
          console.error(text.slice(0, 500));
          throw new Error(`Not a IIIF Presentation manifest: ${url}`);
        }
        return JSON.parse(text);
      }
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
    }
  });

  // iiif_to_csl_browser_1_0_9_fruitcounter.js
  var require_iiif_to_csl_browser_1_0_9_fruitcounter = __commonJS({
    "iiif_to_csl_browser_1_0_9_fruitcounter.js"(exports, module) {
      var core = {};
      try {
        core = require_iiif_to_csl_core_1_0_9_fruitcounter();
      } catch (err) {
        core = typeof window !== "undefined" && window.iiifToCslCore || {};
      }
      var {
        iiifManifestUrlsToCSL
      } = core;
      function ensureCoreAvailable() {
        if (typeof iiifManifestUrlsToCSL !== "function") {
          throw new Error(
            "iiif_to_csl_browser_1_0_9: iiifManifestUrlsToCSL is not available.\nMake sure the core library is bundled correctly, or that your bundler\nis resolving './iiif_to_csl_core_1_0_9_fruitcounter.js' as expected."
          );
        }
      }
      async function fromManifestUrl(manifestUrl) {
        ensureCoreAvailable();
        if (!manifestUrl) {
          throw new TypeError("fromManifestUrl: manifestUrl must be a non-empty string");
        }
        return iiifManifestUrlsToCSL([manifestUrl]);
      }
      async function fromManifestUrls(manifestUrls) {
        ensureCoreAvailable();
        if (!Array.isArray(manifestUrls)) {
          throw new TypeError("fromManifestUrls: manifestUrls must be an array of strings");
        }
        return iiifManifestUrlsToCSL(manifestUrls);
      }
      function attachToGlobal() {
        const root = typeof globalThis !== "undefined" && globalThis || typeof window !== "undefined" && window || typeof global !== "undefined" && global || {};
        const NAMESPACE = "iiifToCslBrowser";
        const existing = root[NAMESPACE] && typeof root[NAMESPACE] === "object" ? root[NAMESPACE] : {};
        const api = Object.assign(existing, {
          version: "1.0.9",
          fromManifestUrl,
          fromManifestUrls
        });
        root[NAMESPACE] = api;
        return api;
      }
      var exportedGlobal = attachToGlobal();
      if (typeof module !== "undefined" && module.exports) {
        module.exports = {
          fromManifestUrl,
          fromManifestUrls,
          attachToGlobal,
          globalApi: exportedGlobal
        };
      }
    }
  });
  require_iiif_to_csl_browser_1_0_9_fruitcounter();
})();
