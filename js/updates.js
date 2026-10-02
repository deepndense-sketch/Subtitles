/* global active, busy */
"use strict";
const SubtitleUpdates = (() => {
  let timer, promptTimer, checking=false, latest=null, prompted="", installing=false;
  const byId=id=>document.getElementById(id);
  function idle() {return !active && !busy && !document.querySelector("dialog[open]");}
  function offer() {
    if(!latest || installing || prompted===latest.version || !idle()) return;
    prompted=latest.version;
    byId("updateDialogVersion").textContent="Subtitle "+latest.version+" is available";
    byId("updateDialog").showModal();
  }
  function start(root) {
    const path=require("path"), fs=require("fs");
    const installed=require(path.join(root,"package.json")).version;
    const checker=require(path.join(root,"lib/update-checker.js"));
    const updater=require(path.join(root,"lib/cep-updater.js"));
    byId("versionLabel").textContent="v"+installed;
    function message(text) {byId("updateInstallSteps").hidden=false;byId("updateInstallSteps").textContent=text;}
    async function install() {
      if(!latest || installing) return;
      if(active || busy) {message("Finish the current operation and deactivate subtitle shortcuts, then click Update CEP.");return;}
      installing=true;byId("updateDialog").close();
      byId("updateDownload").disabled=true;byId("updateDialogDownload").disabled=true;
      message("Preparing and verifying the update…");
      try {
        const result=await updater.prepare(root,latest.version);
        message("Update ready. Save your project and close Premiere. It will install into the Subtitle CEP folder automatically; reopen Premiere after a few seconds.");
        const statusTimer=setInterval(()=>{
          if(!fs.existsSync(result.status)) return;
          try {
            const status=JSON.parse(fs.readFileSync(result.status,"utf8"));
            if(status.state==="failed") {message("Update failed: "+status.message);installing=false;byId("updateDownload").disabled=false;byId("updateDialogDownload").disabled=false;clearInterval(statusTimer);}
          } catch(_) {}
        },1000);
        window.addEventListener("beforeunload",()=>clearInterval(statusTimer));
      } catch(error) {
        message("Update failed: "+error.message+". Your installed files were not changed.");
        installing=false;byId("updateDownload").disabled=false;byId("updateDialogDownload").disabled=false;
      }
    }
    async function check() {
      if(checking || installing) return;
      checking=true;
      try {
        const result=await checker.check(installed);
        if(result) {latest=result;byId("updateNoticeText").textContent="Subtitle "+result.version+" is available";byId("updateNotice").hidden=false;offer();}
      } catch(_) {} finally {checking=false;}
    }
    byId("updateDownload").addEventListener("click",install);
    byId("updateDialogDownload").addEventListener("click",install);
    byId("updateLater").addEventListener("click",()=>byId("updateDialog").close());
    timer=setInterval(check,60*60*1000);promptTimer=setInterval(offer,3000);
    window.addEventListener("beforeunload",()=>{clearInterval(timer);clearInterval(promptTimer);});
    check();
  }
  return {start};
})();
