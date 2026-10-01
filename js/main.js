/* global SubtitleIndex */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const childProcess = require("child_process");

const stateFolder = path.join(process.env.LOCALAPPDATA || os.tmpdir(), "PremiereSubtitleNavigator");
const activePath = path.join(stateFolder, "active");
const heartbeatPath = path.join(stateFolder, "heartbeat");
const stopPath = path.join(stateFolder, "stop");
const queuePath = path.join(stateFolder, "commands.queue");
const importPlanPath = path.join(stateFolder, "import-plan.txt");
let subtitleFolder = localStorage.getItem("subtitleFolder") || "";
let selectedTrackIndex = parseInt(localStorage.getItem("videoTrackIndex") || "0", 10);
let selectedImportTrackIndex = parseInt(localStorage.getItem("importTrackIndex") || String(selectedTrackIndex), 10);
let selectedExtraSourceIndex = parseInt(localStorage.getItem("extraSourceTrackIndex") || String(selectedTrackIndex), 10);
let pngIndex = { entries: [], ignored: [], duplicateKeys: [] };
let active = false;
let busy = false;
let pendingCommands = [];
let draining = false;
let queueOffset = 0;
let queueRemainder = "";
let heartbeatTimer = null;
let queueTimer = null;

function getExtensionRoot() {
  try {
    let pathname = decodeURIComponent(window.location.pathname || "");
    if (/^\/[A-Za-z]:\//.test(pathname)) pathname = pathname.substring(1);
    if (pathname) return path.dirname(pathname.replace(/\//g, path.sep));
  } catch (_) {}
  if (typeof __dirname !== "undefined") return path.basename(__dirname).toLowerCase() === "js" ? path.dirname(__dirname) : __dirname;
  return "";
}

const extensionRoot = getExtensionRoot();
function $(id) { return document.getElementById(id); }
function setStatus(text, kind) { $("status").textContent = text; $("status").className = "status" + (kind ? " " + kind : ""); }
function setFileResult(text, kind) { $("fileResult").textContent = text; $("fileResult").className = "status" + (kind ? " " + kind : ""); }
function escapeHost(value) { return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r/g, "\\r").replace(/\n/g, "\\n"); }
function callHost(script) {
  return new Promise((resolve) => {
    if (!window.__adobe_cep__ || !window.__adobe_cep__.evalScript) { resolve('{"ok":false,"error":"Open this panel inside Premiere Pro."}'); return; }
    window.__adobe_cep__.evalScript(script, resolve);
  });
}
function parseHost(raw) { try { return JSON.parse(raw); } catch (_) { return { ok: false, error: "Premiere returned unreadable data: " + raw }; } }
function ensureStateFolder() { if (!fs.existsSync(stateFolder)) fs.mkdirSync(stateFolder, { recursive: true }); }
function safeUnlink(file) { try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch (_) {} }
function currentTrackIndex() { return Math.max(0, parseInt($("trackSelect").value || "0", 10)); }

function refreshIndex() {
  if (!subtitleFolder || !fs.existsSync(subtitleFolder)) {
    pngIndex = { entries: [], ignored: [], duplicateKeys: [] };
    setFileResult("Choose a valid subtitle PNG folder.", "warn");
    return false;
  }
  const names = fs.readdirSync(subtitleFolder).filter((name) => /\.png$/i.test(name) && fs.statSync(path.join(subtitleFolder, name)).isFile());
  pngIndex = SubtitleIndex.buildIndex(names);
  if (pngIndex.duplicateKeys.length) {
    setFileResult("Duplicate line/variant numbers: " + pngIndex.duplicateKeys.slice(0, 3).map((pair) => pair.join(" / ")).join("; "), "bad");
    return false;
  }
  if (!pngIndex.entries.length) { setFileResult("No PNG names ending in a subtitle number were found.", "bad"); return false; }
  setFileResult("Found " + pngIndex.entries.length + " usable PNG files. Missing numbers are skipped automatically.", "good");
  return true;
}

function chooseFolder() {
  const result = window.cep.fs.showOpenDialogEx(false, true, "Choose subtitle PNG folder", subtitleFolder || undefined);
  if (result && result.data && result.data[0]) {
    subtitleFolder = result.data[0];
    localStorage.setItem("subtitleFolder", subtitleFolder);
    $("folderPath").textContent = subtitleFolder;
    refreshIndex();
  }
}

async function refreshTracks() {
  if (busy || active) return false;
  const result = parseHost(await callHost("psnGetTrackInfo()"));
  const select = $("trackSelect");
  const importSelect = $("importTrackSelect");
  const extraSelect = $("extraSourceTrackSelect");
  select.innerHTML = "";
  importSelect.innerHTML = "";
  extraSelect.innerHTML = "";
  if (!result.ok) { setStatus(result.error, "bad"); return false; }
  if (!result.trackCount) { setStatus("The active sequence has no video tracks.", "bad"); return false; }
  for (let index = 0; index < result.trackCount; index += 1) {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = "V" + (index + 1);
    select.appendChild(option);
    const importOption = document.createElement("option");
    importOption.value = String(index);
    importOption.textContent = "V" + (index + 1);
    importSelect.appendChild(importOption);
    const extraOption = document.createElement("option");
    extraOption.value = String(index);
    extraOption.textContent = "V" + (index + 1);
    extraSelect.appendChild(extraOption);
  }
  selectedTrackIndex = Math.min(Math.max(0, selectedTrackIndex), result.trackCount - 1);
  select.value = String(selectedTrackIndex);
  selectedImportTrackIndex = Math.min(Math.max(0, selectedImportTrackIndex), result.trackCount - 1);
  importSelect.value = String(selectedImportTrackIndex);
  selectedExtraSourceIndex = Math.min(Math.max(0, selectedExtraSourceIndex), result.trackCount - 1);
  extraSelect.value = String(selectedExtraSourceIndex);
  return true;
}

function confirmExtraImport(trackIndex, count, issue) {
  const dialog = $("extraConfirm");
  $("extraConfirmTitle").textContent = issue ? "Confirm subtitle track" : "Subtitle track detected";
  $("extraConfirmTrack").textContent = "V" + (trackIndex + 1);
  $("extraConfirmCount").textContent = issue ? "Selected subtitle track" : count + " matching subtitle PNGs";
  $("extraConfirmIssue").textContent = issue || "";
  $("extraConfirmIssue").hidden = !issue;
  $("extraConfirmPlan").textContent = "If missing extras are found, a new V" + (trackIndex + 2) + " will be created directly above V" + (trackIndex + 1) + " to import and align them.";
  return new Promise(resolve => {
    const finish = accepted => {
      dialog.close();
      $("extraConfirmCancel").onclick = null;
      $("extraConfirmAccept").onclick = null;
      dialog.oncancel = null;
      resolve(accepted);
    };
    $("extraConfirmCancel").onclick = () => finish(false);
    $("extraConfirmAccept").onclick = () => finish(true);
    dialog.oncancel = event => { event.preventDefault(); finish(false); };
    dialog.showModal();
    $("extraConfirmCancel").focus();
  });
}

async function importExtras() {
  if (busy) return;
  if (active) stopListener();
  if (!$("extraSourceTrackSelect").options.length && !(await refreshTracks())) return;
  busy = true;
  $("importExtras").disabled = true;
  try {
    setStatus("Looking for the track with the most ordered subtitle PNGs…", "");
    const detected = parseHost(await callHost("psnDetectExtraSource()"));
    let script;
    if (detected.ok) {
      selectedExtraSourceIndex = detected.sourceIndex;
      $("extraSourceTrackSelect").value = String(selectedExtraSourceIndex);
      localStorage.setItem("extraSourceTrackIndex", String(selectedExtraSourceIndex));
      if (!(await confirmExtraImport(detected.sourceIndex, detected.count))) {
        setStatus("Import cancelled. No tracks or clips changed.", "");
        return;
      }
      script = "psnImportDetectedExtras()";
    } else {
      const selected = Number($("extraSourceTrackSelect").value);
      if (!(await confirmExtraImport(selected, 0, detected.error))) {
        setStatus("Import cancelled. Select the subtitle track and try again.", "");
        return;
      }
      script = "psnImportExtras(" + selected + ")";
    }
    setStatus("Checking existing subtitles and aligning missing extras…", "");
    const result = parseHost(await callHost(script));
    if (!result.ok) throw new Error(result.error);
    selectedTrackIndex = result.sourceIndex;
    localStorage.setItem("videoTrackIndex", String(selectedTrackIndex));
    if (result.count && selectedImportTrackIndex > result.sourceIndex) {
      selectedImportTrackIndex += 1;
      localStorage.setItem("importTrackIndex", String(selectedImportTrackIndex));
    }
    setStatus((result.count ? "Imported and aligned " + result.count + " extra subtitles on V" + (result.trackIndex + 1) + "." : "No missing extras to import.") +
      " Already in sequence: " + result.skipped + ". No matching original: " + result.unmatched + "." +
      (result.shortened ? " " + result.shortened + " shorter extras kept aligned to their planned positions." : ""), "good");
    $("currentFile").textContent = result.count ? result.groups + " groups aligned. Originals under 2 seconds: extras start afterward; longer originals: extras end with them. Use Undo Subtitle Edit to remove this batch." : "Existing subtitles were left unchanged.";
  } catch (error) { setStatus(error.message || String(error), "bad"); }
  finally { busy = false; $("importExtras").disabled = false; await refreshTracks(); }
}

async function importAll() {
  if (busy || active || !refreshIndex()) { if (active) setStatus("Deactivate subtitle shortcuts before importing.", "warn"); return; }
  if (!$("importTrackSelect").options.length && !(await refreshTracks())) return;
  busy = true;
  $("importAll").disabled = true;
  setStatus("Importing and placing " + pngIndex.entries.length + " PNGs…", "");
  try {
    ensureStateFolder();
    const paths = pngIndex.entries.map((entry) => path.join(subtitleFolder, entry.fileName));
    fs.writeFileSync(importPlanPath, paths.join("\r\n"), "utf8");
    const trackIndex = Number($("importTrackSelect").value);
    const result = parseHost(await callHost('psnImportAll("' + escapeHost(importPlanPath) + '",' + trackIndex + ")"));
    if (!result.ok) throw new Error(result.error);
    $("currentFile").textContent = result.count + " PNGs on V" + (result.trackIndex + 1) + ", " + result.start.toFixed(3) + "s–" + result.end.toFixed(3) + "s";
    setStatus("Imported all subtitles as consecutive one-second clips.", "good");
  } catch (error) { pendingCommands = []; setStatus(error.message || String(error), "bad"); }
  finally { busy = false; $("importAll").disabled = false; if (active && pendingCommands.length > 0) drainQueue(); }
}

function writeHeartbeat() { if (active) { try { fs.writeFileSync(heartbeatPath, String(Date.now()), "utf8"); } catch (_) {} } }
function startListener() {
  ensureStateFolder();
  safeUnlink(stopPath);
  safeUnlink(queuePath);
  queueOffset = 0;
  queueRemainder = "";
  fs.writeFileSync(activePath, "active", "utf8");
  writeHeartbeat();
  const exe = path.join(extensionRoot, "native", "KeyListener.exe");
  if (!fs.existsSync(exe)) throw new Error("KeyListener.exe is missing. Run build_key_listener.bat, then reinstall the panel.");
  const helper = childProcess.spawn(exe, [stateFolder], { detached: true, windowsHide: true, stdio: "ignore" });
  helper.unref();
  heartbeatTimer = setInterval(writeHeartbeat, 500);
  queueTimer = setInterval(pollQueue, 25);
}
function stopListener() {
  active = false;
  pendingCommands = [];
  queueRemainder = "";
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  if (queueTimer) clearInterval(queueTimer);
  heartbeatTimer = null;
  queueTimer = null;
  safeUnlink(activePath);
  safeUnlink(heartbeatPath);
  try { ensureStateFolder(); fs.writeFileSync(stopPath, "stop", "utf8"); } catch (_) {}
  $("activate").textContent = "Activate Subtitle Shortcuts";
  $("activate").className = "primary";
  $("stateBadge").textContent = "INACTIVE";
  $("stateBadge").className = "badge off";
}
async function toggleActive() {
  if (active) { stopListener(); setStatus("Subtitle shortcuts released.", ""); return; }
  if (busy) return;
  if (!$("trackSelect").options.length && !(await refreshTracks())) return;
  busy = true;
  try {
    const trackIndex = currentTrackIndex();
    const check = parseHost(await callHost("psnValidateSubtitleTrack(" + trackIndex + ")"));
    if (!check.ok) throw new Error(check.error);
    active = true;
    startListener();
    $("activate").textContent = "Deactivate Subtitle Shortcuts";
    $("activate").className = "primary active";
    $("stateBadge").textContent = "ACTIVE";
    $("stateBadge").className = "badge on";
    setStatus("Active on V" + (trackIndex + 1) + ". ← brings next; → brings previous; [ trims left; ] trims right; Ctrl+Z undoes; Ctrl+Shift+Z redoes subtitle edits. Deactivate for normal Premiere shortcuts.", "good");
  } catch (error) { stopListener(); setStatus(error.message || String(error), "bad"); }
  finally { busy = false; }
}

function pollQueue() {
  if (!active) return;
  if (!fs.existsSync(activePath)) {
    stopListener();
    setStatus("Subtitle shortcuts turned off after another key. Click Activate Subtitle Shortcuts to use them again.", "");
    return;
  }
  if (!fs.existsSync(queuePath)) return;
  try {
    const size = fs.statSync(queuePath).size;
    if (size < queueOffset) { queueOffset = 0; queueRemainder = ""; }
    if (size === queueOffset) { drainQueue(); return; }
    const fd = fs.openSync(queuePath, "r");
    const buffer = Buffer.alloc(size - queueOffset);
    fs.readSync(fd, buffer, 0, buffer.length, queueOffset);
    fs.closeSync(fd);
    queueOffset = size;
    const lines = (queueRemainder + buffer.toString("utf8")).split(/\r?\n/);
    queueRemainder = lines.pop();
    const commands = lines.filter(Boolean);
    commands.forEach(line => {
      const command = line.split("|")[0];
      if (["left", "right", "trim-left", "trim-right", "undo", "redo"].indexOf(command) !== -1) pendingCommands.push(command);
    });
    drainQueue();
  } catch (error) { setStatus("Key queue error: " + error.message, "bad"); }
}

async function drainQueue() {
  if (draining || busy || !active) return;
  draining = true;
  try {
    while (active && pendingCommands.length > 0) {
      const command = pendingCommands.shift();
      if (command === "undo") await undoLastAdvance();
      else if (command === "redo") await redoLastAdvance();
      else if (command === "trim-left" || command === "trim-right") await trimSubtitle(command.substring(5));
      else await advanceSubtitle(command === "right");
    }
  } finally { draining = false; }
}

async function advanceSubtitle(previous) {
  if (busy) return;
  if (!$("trackSelect").options.length && !(await refreshTracks())) return;
  busy = true;
  $("advance").disabled = true;
  try {
    const trackIndex = currentTrackIndex();
    const result = parseHost(await callHost((previous ? "psnPreviousAtPlayhead(" : "psnAdvanceAtPlayhead(") + trackIndex + ")"));
    if (!result.ok) throw new Error(result.error);
    $("currentFile").textContent = result.name + "  |  V" + (result.trackIndex + 1) + "  |  starts " + result.start.toFixed(3) + "s, ends " + result.end.toFixed(3) + "s";
    setStatus("Extended the " + (previous ? "previous" : "next") + " subtitle to the playhead" + (result.trimmed ? " and trimmed the subtitle under it." : "."), "good");
  } catch (error) { pendingCommands = []; setStatus(error.message || String(error), "bad"); }
  finally { busy = false; $("advance").disabled = false; if (active && pendingCommands.length > 0 && !draining) drainQueue(); }
}

async function editSubtitle(kind, side) {
  if (busy) return;
  busy = true;
  try {
    const trackIndex = currentTrackIndex();
    const script = kind === "trim" ? 'psnTrimAtPlayhead(' + trackIndex + ',"' + side + '")' :
      (kind === "redo" ? "psnRedoLastAdvance(" : "psnUndoLastAdvance(") + trackIndex + ")";
    const result = parseHost(await callHost(script));
    if (!result.ok) throw new Error(result.error);
    setStatus(kind === "trim" ? "Trimmed subtitle " + side + " edge to the playhead." :
      (kind === "redo" ? "Redid" : "Undid") + " the subtitle edit and verified its clip state.", "good");
    $("currentFile").textContent = kind === "trim" ? result.name + " | " + result.start.toFixed(3) + "s–" + result.end.toFixed(3) + "s" : result.label || "Subtitle edit restored.";
  } catch (error) { pendingCommands = []; setStatus(error.message || String(error), "bad"); }
  finally { busy = false; if (active && pendingCommands.length > 0 && !draining) drainQueue(); }
}
function undoLastAdvance() { return editSubtitle("undo"); }
function redoLastAdvance() { return editSubtitle("redo"); }
function trimSubtitle(side) { return editSubtitle("trim", side); }

// Button actions share the same FIFO as native shortcuts, including while an edit is running.
function requestEdit(command) {
  if (active) { pollQueue(); pendingCommands.push(command); drainQueue(); return; }
  if (busy) return;
  if (command === "undo") undoLastAdvance();
  else if (command === "redo") redoLastAdvance();
  else if (command === "left") advanceSubtitle();
  else if (command === "right") advanceSubtitle(true);
  else trimSubtitle(command.substring(5));
}

function selectToolTab(name) {
  const sequence = name === "sequence";
  $("extrasPanel").hidden = sequence;
  $("sequencePanel").hidden = !sequence;
  $("extrasTab").setAttribute("aria-selected", String(!sequence));
  $("sequenceTab").setAttribute("aria-selected", String(sequence));
  $("extrasTab").tabIndex = sequence ? -1 : 0;
  $("sequenceTab").tabIndex = sequence ? 0 : -1;
  localStorage.setItem("toolTab", sequence ? "sequence" : "extras");
}

function initialize() {
  selectToolTab(localStorage.getItem("toolTab"));
  ["extras", "sequence"].forEach(name => {
    const tab = $(name + "Tab");
    tab.addEventListener("click", () => selectToolTab(name));
    tab.addEventListener("keydown", event => {
      if (["ArrowLeft", "ArrowRight", "Home", "End"].indexOf(event.key) === -1) return;
      event.preventDefault();
      const next = event.key === "Home" ? "extras" : event.key === "End" ? "sequence" : name === "extras" ? "sequence" : "extras";
      selectToolTab(next);
      $(next + "Tab").focus();
    });
  });
  ensureStateFolder();
  safeUnlink(activePath);
  safeUnlink(heartbeatPath);
  $("folderPath").textContent = subtitleFolder || "No folder selected.";
  if (subtitleFolder) refreshIndex();
  $("chooseFolder").addEventListener("click", chooseFolder);
  $("refreshFiles").addEventListener("click", refreshIndex);
  $("refreshTracks").addEventListener("click", refreshTracks);
  $("refreshExtraTracks").addEventListener("click", refreshTracks);
  $("extraSourceTrackSelect").addEventListener("change", () => {
    selectedExtraSourceIndex = Number($("extraSourceTrackSelect").value);
    localStorage.setItem("extraSourceTrackIndex", String(selectedExtraSourceIndex));
  });
  $("trackSelect").addEventListener("change", () => {
    selectedTrackIndex = currentTrackIndex();
    localStorage.setItem("videoTrackIndex", String(selectedTrackIndex));
    if (active) { stopListener(); setStatus("Track changed. Activate Subtitle Shortcuts again.", "warn"); }
  });
  $("importExtras").addEventListener("click", importExtras);
  $("importAll").addEventListener("click", importAll);
  $("importTrackSelect").addEventListener("change", () => {
    selectedImportTrackIndex = Number($("importTrackSelect").value);
    localStorage.setItem("importTrackIndex", String(selectedImportTrackIndex));
  });
  $("activate").addEventListener("click", toggleActive);
  $("advance").addEventListener("click", () => requestEdit("left"));
  $("previous").addEventListener("click", () => requestEdit("right"));
  $("undo").addEventListener("click", () => requestEdit("undo"));
  $("redo").addEventListener("click", () => requestEdit("redo"));
  $("trimLeft").addEventListener("click", () => requestEdit("trim-left"));
  $("trimRight").addEventListener("click", () => requestEdit("trim-right"));
  window.addEventListener("beforeunload", stopListener);
  refreshTracks();
  if (typeof SubtitleUpdates !== "undefined") SubtitleUpdates.start(extensionRoot);
}

document.addEventListener("DOMContentLoaded", initialize);
