javascript:(function () {
  // Adjust this to your GitHub Pages (or other) base URL
  const BASE    = "https://github.com/trespda/iiif-to-csl_live/";
  const SNIFFER = BASE + "iiif_to_csl_sniffer_0_1_0.js";
  const BUNDLE  = BASE + "iiif_to_csl_browser_1_0_9.bundle.js";

  function loadScriptOnce(url, globalCheck) {
    // If the global already exists, don’t reload
    if (globalCheck && window[globalCheck]) {
      return Promise.resolve();
    }

    return new Promise(function (resolve, reject) {
      // Check if we already injected this src
      var existing = document.querySelector('script[src="' + url + '"]');
      if (existing && (existing.dataset.loaded === "true")) {
        return resolve();
      }

      var s = document.createElement("script");
      s.src = url;
      s.async = true;
      s.dataset.loaded = "false";

      s.onload = function () {
        s.dataset.loaded = "true";
        resolve();
      };
      s.onerror = function () {
        reject(new Error("Failed to load " + url));
      };

      (document.head || document.documentElement).appendChild(s);
    });
  }

  async function main() {
    await loadScriptOnce(SNIFFER, "iiifToCslSniffer");
    await loadScriptOnce(BUNDLE,  "iiifToCslBrowser");

    if (!window.iiifToCslSniffer || !window.iiifToCslBrowser) {
      alert("iiif-to-CSL: sniffer or browser bundle not available (check console).");
      return;
    }

    // Main entry point — sniffer decides what to do with manifest URLs
    var result = window.iiifToCslSniffer.sniffConvertAndDownload();
    // If it happens to return a Promise, we’ll log errors:
    if (result && typeof result.then === "function") {
      result.catch(function (err) {
        console.error("iiif-to-CSL error:", err);
        alert("iiif-to-CSL bookmarklet hit an error (see console).");
      });
    }
  }

  try {
    main();
  } catch (e) {
    console.error("iiif-to-CSL fatal error:", e);
    alert("iiif-to-CSL bookmarklet failed to run (see console).");
  }
})();
