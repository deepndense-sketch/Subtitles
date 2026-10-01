/* global active, busy */
"use strict";
const SubtitleUpdates = (() => {
  let timer, promptTimer, checking = false, latest = null, prompted = "";
  const byId = id => document.getElementById(id);
  function idle() {
    return !active && !busy && !document.querySelector("dialog[open]");
  }
  function offer() {
    if (!latest || prompted === latest.version || !idle()) return;
    prompted = latest.version;
    byId("updateDialogVersion").textContent = "Subtitle " + latest.version + " is available";
    byId("updateDialog").showModal();
  }
  function download() {
    if (!latest) return;
    if (window.cep && window.cep.util && window.cep.util.openURLInDefaultBrowser) {
      window.cep.util.openURLInDefaultBrowser(latest.url);
    } else {
      window.open(latest.url, "_blank");
    }
    byId("updateInstallSteps").hidden = false;
  }
  function start(root) {
    const path = require("path");
    const installed = require(path.join(root, "package.json")).version;
    const checker = require(path.join(root, "lib", "update-checker.js"));
    byId("versionLabel").textContent = "v" + installed;
    async function check() {
      if (checking) return;
      checking = true;
      try {
        const result = await checker.check(installed);
        if (result) {
          latest = result;
          byId("updateNoticeText").textContent = "Subtitle " + result.version + " is available";
          byId("updateNotice").hidden = false;
          offer();
        }
      } catch (_) { /* Offline or unavailable: leave subtitle editing uninterrupted. */ }
      finally { checking = false; }
    }
    byId("updateDownload").addEventListener("click", download);
    byId("updateDialogDownload").addEventListener("click", download);
    byId("updateLater").addEventListener("click", () => byId("updateDialog").close());
    timer = setInterval(check, 60 * 60 * 1000);
    promptTimer = setInterval(offer, 3000);
    window.addEventListener("beforeunload", () => { clearInterval(timer); clearInterval(promptTimer); });
    check();
  }
  return {start};
})();
