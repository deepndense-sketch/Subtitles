/* global active, busy */
"use strict";
const SubtitleUpdates = (() => {
  const byId=id=>document.getElementById(id);
  function start(root) {
    const path=require("path"), checker=require(path.join(root,"lib/update-checker.js"));
    const updater=require(path.join(root,"lib/cep-updater.js"));
    let latest=null, preparing=false, checking=false, errorText="";
    const seenKey="subtitleUpdatePromptSeen";
    function message(text) {byId("updateInstallSteps").hidden=!text;byId("updateInstallSteps").textContent=text;}
    function buttons(disabled,label) {
      ["updateDownload","updateDialogDownload"].forEach(id=>{byId(id).disabled=disabled;byId(id).textContent=label;});
    }
    function refresh() {
      const installed=updater.readVersion(root);
      byId("versionLabel").textContent="v"+installed;
      const pending=updater.pending(root);
      if(pending) {
        byId("updateNotice").hidden=false;
        byId("updateNoticeText").textContent=pending.state==="failed" ? "Update did not finish" : "Subtitle "+pending.version+" update pending";
        message(pending.message);
        buttons(pending.state!=="failed" || preparing,pending.state==="failed" ? "Retry update" : "Update pending");
        return pending;
      }
      if(latest && checker.isNewer(latest.version,installed)) {
        byId("updateNotice").hidden=false;
        byId("updateNoticeText").textContent="Subtitle "+latest.version+" is available";
        buttons(preparing,preparing ? "Preparing…" : errorText ? "Retry update" : "Update CEP");
        if(!preparing) message(errorText);
      } else {
        latest=null;byId("updateNotice").hidden=true;
        if(byId("updateDialog").open) byId("updateDialog").close();
      }
      return null;
    }
    function offer() {
      const pending=refresh();
      if(pending || !latest || errorText || preparing || active || busy || document.querySelector("dialog[open]") || localStorage.getItem(seenKey)===latest.version) return;
      localStorage.setItem(seenKey,latest.version);
      byId("updateDialogVersion").textContent="Subtitle "+latest.version+" is available";
      byId("updateDialog").showModal();
    }
    async function check() {
      if(checking || preparing) return;
      checking=true;
      try {latest=await checker.check(updater.readVersion(root));offer();}
      catch(_) {refresh();} finally {checking=false;}
    }
    async function install() {
      if(preparing) return;
      const pending=refresh();
      if(pending && pending.state!=="failed") return;
      if(!latest && pending) latest={version:pending.version};
      if(!latest) return;
      if(active || busy) {message("Finish the current operation and deactivate subtitle shortcuts, then retry.");return;}
      errorText="";preparing=true;byId("updateDialog").close();buttons(true,"Preparing…");message("Downloading and verifying update files…");
      try {await updater.prepare(root,latest.version);}
      catch(error) {errorText="Update failed: "+error.message;message(errorText);}
      finally {preparing=false;refresh();}
    }
    byId("updateDownload").addEventListener("click",install);
    byId("updateDialogDownload").addEventListener("click",install);
    byId("updateLater").addEventListener("click",()=>byId("updateDialog").close());
    const timer=setInterval(offer,1000);
    window.addEventListener("beforeunload",()=>clearInterval(timer));
    refresh();check();
  }
  return {start};
})();
