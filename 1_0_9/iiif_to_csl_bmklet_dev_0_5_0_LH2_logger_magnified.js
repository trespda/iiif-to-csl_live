javascript:(function(){
  const BASE="http://localhost:8000/";
  const SNIFFER=BASE+"iiif_to_csl_sniffer_0_2_0_dl.js";
  const BUNDLE=BASE+"iiif_to_csl_browser_1_0_9.bundle.js";
  function loadScript(u){
    return new Promise(function(R,E){
      var s=document.createElement("script");
      s.src=u; s.async=true;
      s.onload=function(){R()};
      s.onerror=function(){E(new Error("Failed to load "+u))};
      (document.head||document.documentElement).appendChild(s);
    });
  }
  async function main(){
    await loadScript(SNIFFER);
    await loadScript(BUNDLE);
    var S=window.iiifToCslSniffer,B=window.iiifToCslBrowser;
    if(!S||!B){alert("dev_0_5_0: missing sniffer/browser");return}
    var p;
    if(typeof S.sniffAndConvertManifests==="function"){
      p=S.sniffAndConvertManifests({quiet:false});
    }else if(typeof S.sniffManifestUrls==="function"){
      var info=S.sniffManifestUrls(document);
      var urls=info&&info.manifestUrls?info.manifestUrls:info;
      if(!urls||!urls.length){alert("dev_0_5_0: no manifests");return}
      console.log("[DEV 0.5.0] manifest URLs:",urls);
      p=B.fromManifestUrls(urls);
    }else{
      alert("dev_0_5_0: unknown sniffer API");return;
    }
    p&&typeof p.then==="function"&&p.then(function(i){
      console.log("[DEV 0.5.0] CSL items:",i);
      return i;
    }).catch(function(e){
      console.error("[DEV 0.5.0] error:",e);
    });
  }
  main();
})();
