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

// Read-only comparison; full paths keep identical names in different folders distinct.
function syncPathKey(value) { return String(value).replace(/\\/g, "/").toLowerCase(); }
function syncReadDir(folder) { return new Promise((resolve, reject) => fs.readdir(folder, (error, names) => error ? reject(error) : resolve(names))); }
function syncStat(file) { return new Promise((resolve, reject) => fs.stat(file, (error, info) => error ? reject(error) : resolve(info))); }
async function compareLocalSources(snapshot) {
  const seen = new Set(snapshot.sequencePaths.map(syncPathKey));
  const folders = new Map();
  snapshot.paths.forEach(file => {
    const folder = path.dirname(file), key = syncPathKey(folder);
    if (!folders.has(key)) folders.set(key, {path: folder, sources: new Map(), missingSequence: [], missingDisk: [], issues: []});
    folders.get(key).sources.set(syncPathKey(file), file);
  });
  for (const group of folders.values()) {
    let names;
    try { names = await syncReadDir(group.path); }
    catch (error) {
      group.issues.push("Cannot read folder (" + (error.code || "error") + "). Check the drive, folder path, or permissions; files have not been marked missing.");
      continue;
    }
    for (const name of names.filter(name => /\.png$/i.test(name))) {
      const file = path.join(group.path, name);
      if (seen.has(syncPathKey(file))) continue;
      try { if ((await syncStat(file)).isFile()) group.missingSequence.push(name); }
      catch (error) { group.issues.push("Could not check " + name + " (" + (error.code || "error") + ")."); }
    }
    for (const file of group.sources.values()) {
      try { if (!(await syncStat(file)).isFile()) group.missingDisk.push(path.basename(file)); }
      catch (error) {
        if (error.code === "ENOENT" || error.code === "ENOTDIR") group.missingDisk.push(path.basename(file));
        else group.issues.push("Could not check " + path.basename(file) + " (" + (error.code || "error") + ").");
      }
    }
    group.missingSequence.sort((a,b) => a.localeCompare(b, undefined, {numeric:true}));
    group.missingDisk.sort((a,b) => a.localeCompare(b, undefined, {numeric:true}));
  }
  return Array.from(folders.values());
}
function renderLocalSync(snapshot, groups) {
  const container = $("syncGroups");
  container.innerHTML = "";
  let absent = 0, missing = 0, issues = snapshot.unresolved.length;
  function add(parent, tag, text, className) {
    const node = document.createElement(tag); node.textContent = text;
    if (className) node.className = className;
    parent.appendChild(node); return node;
  }
  function list(parent, title, names) {
    if (!names.length) return;
    add(parent, "p", title + " (" + names.length + ")");
    const ul = document.createElement("ul"); parent.appendChild(ul);
    names.forEach(name => add(ul, "li", name));
  }
  groups.forEach(group => {
    const box = document.createElement("div"); box.className = "sync-group"; container.appendChild(box);
    add(box, "h4", group.path);
    list(box, "On disk, missing from this sequence", group.missingSequence);
    list(box, "Used on this track, missing from disk", group.missingDisk);
    group.issues.forEach(issue => add(box, "p", issue, "sync-warning"));
    if (!group.missingSequence.length && !group.missingDisk.length && !group.issues.length) add(box, "p", "All PNG files match.");
    absent += group.missingSequence.length; missing += group.missingDisk.length; issues += group.issues.length;
  });
  if (snapshot.unresolved.length) list(container, "Source path unavailable — check these clips in Premiere", snapshot.unresolved);
  $("syncSummary").textContent = snapshot.sequenceName + " · V" + (snapshot.trackIndex + 1) + " · " + snapshot.total + " PNG clips. " +
    absent + " files missing from sequence; " + missing + " missing from disk." + (issues ? " " + issues + " checks need attention." : "") +
    " Checks all PNGs in this track’s source folders against every video track in this sequence. No clips or files are changed.";
}
async function syncWithLocal() {
  if (busy) return;
  if (active) stopListener();
  if (!$("trackSelect").options.length && !(await refreshTracks())) return;
  busy = true; $("syncLocal").disabled = true;
  $("syncReport").hidden = false; $("syncGroups").innerHTML = "";
  $("syncSummary").textContent = "Checking subtitle source folders…";
  try {
    const snapshot = parseHost(await callHost("psnLocalSyncSources(" + currentTrackIndex() + ")"));
    if (!snapshot.ok) throw new Error(snapshot.error);
    renderLocalSync(snapshot, await compareLocalSources(snapshot));
    setStatus("Local subtitle check complete. See the report in Adjust/Add Sub.");
  } catch (error) {
    $("syncSummary").textContent = error.message || String(error);
    setStatus("Could not complete the local subtitle check.", "bad");
  } finally { busy = false; $("syncLocal").disabled = false; }
}

async function repairOverlaps() {
  if (busy) return;
  if (active) stopListener();
  if (!$("trackSelect").options.length && !(await refreshTracks())) return;
  busy = true;
  $("repairOverlaps").disabled = true;
  try {
    const preview = parseHost(await callHost("psnPrepareOverlapRepair(" + currentTrackIndex() + ")"));
    if (!preview.ok) throw new Error(preview.error);
    if (!preview.count) { setStatus("No overlapping subtitles on V" + (preview.trackIndex + 1) + ".", "good"); return; }
    $("overlapSummary").textContent = preview.count + " overlapping PNG(s) on V" + (preview.trackIndex + 1) + ". Review the proposed end times:";
    $("overlapDetails").textContent = preview.details;
    const dialog = $("overlapConfirm");
    const accepted = await new Promise(resolve => {
      const finish = value => {
        dialog.close();
        $("overlapCancel").onclick = $("overlapAccept").onclick = dialog.oncancel = null;
        resolve(value);
      };
      $("overlapCancel").onclick = () => finish(false);
      $("overlapAccept").onclick = () => finish(true);
      dialog.oncancel = event => { event.preventDefault(); finish(false); };
      dialog.showModal();
      $("overlapCancel").focus();
    });
    if (!accepted) { setStatus("Repair cancelled. No subtitles changed.", ""); return; }
    const result = parseHost(await callHost("psnApplyOverlapRepair()"));
    if (!result.ok) throw new Error(result.error);
    setStatus("Repaired " + result.count + " overlapping PNG(s). Use Undo Subtitle Edit to restore their previous timing.", "good");
    $("currentFile").textContent = "Scrub the repaired range to check the subtitles. Activate shortcuts again when ready.";
  } catch (error) { setStatus(error.message || String(error), "bad"); }
  finally { busy = false; $("repairOverlaps").disabled = false; }
}

function confirmExtraImport(trackIndex, count, issue, preview) {
  const dialog = $("extraConfirm");
  $("extraFoundResult").hidden = !preview;
  $("extraConfirmTitle").className = preview ? "visually-hidden" : "";
  dialog.setAttribute("data-result", preview ? (preview.count > 0 ? "found" : "empty") : "");
  $("extraConfirmTitle").textContent = issue ? "Confirm subtitle track" : "Confirm selected subtitle track";
  $("extraConfirmTrack").textContent = "V" + (trackIndex + 1);
  $("extraConfirmCount").textContent = issue ? "Selected subtitle track" : count + " total PNG clips on this track";
  $("extraConfirmIssue").textContent = issue || "";
  $("extraConfirmIssue").hidden = !issue;
  $("extraConfirmPlan").textContent = "If missing extras are found, a new V" + (trackIndex + 2) + " will be created directly above V" + (trackIndex + 1) + " to import and align them.";
  $("extraConfirmPlan").hidden = !!preview && preview.count === 0;
  $("extraConfirmAccept").disabled = false;
  $("extraConfirmAccept").hidden = preview && !preview.count;
  $("extraConfirmCancel").disabled = false;
  $("extraConfirmCancel").textContent = preview && !preview.count ? "Close" : "Cancel";
  if (preview) {
    if (preview.repeatedGroups) {
      $("extraConfirmIssue").textContent = "Note: " + preview.repeatedGroups + " repeated original(s). Touching pieces share one timing span. Separate occurrences each receive their own extras.";
      $("extraConfirmIssue").hidden = false;
    }
    if (preview.offlineNames) {
      const warning = "Subtitle media is offline: " + preview.offlineNames + ". You can still import available extras using the sequence timing.";
      $("extraConfirmIssue").textContent = [$("extraConfirmIssue").textContent, warning].filter(Boolean).join(" ");
      $("extraConfirmIssue").hidden = false;
    }
    $("extraFoundNumber").textContent = String(preview.count);
    $("extraConfirmTitle").textContent = preview.count ? preview.count + " extras found" : "0 extras found";
    $("extraConfirmPlan").textContent = preview.count ? "A new V" + (trackIndex + 2) + " will be created directly above V" + (trackIndex + 1) + " to import and align " + preview.count + " extras in equal time slots within the main clip or last existing extra. Existing clips stay unchanged. " + preview.green + " green: 1 second or longer. " + preview.red + " red: shorter than 1 second." : "There are no new extra subtitles to import for this track.";
    $("extraConfirmQuestion").textContent = preview.count ? "Import these extras?" : "Your sequence has not been changed.";
  }
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
    const selected = Number($("extraSourceTrackSelect").value);
    setStatus("Searching extras on V" + (selected + 1) + "…", "");
    $("extraFoundResult").hidden = true;
    $("extraConfirmTitle").className = "";
    $("extraConfirm").setAttribute("data-result", "");
    $("extraConfirmTitle").textContent = "Searching extras…";
    $("extraConfirmTrack").textContent = "V" + (selected + 1);
    $("extraConfirmCount").textContent = "Please wait";
    $("extraConfirmIssue").hidden = true;
    $("extraConfirmPlan").hidden = false;
    $("extraConfirmPlan").textContent = "Checking source folders and skipping PNGs already in this sequence. No track or clip is being added yet.";
    $("extraConfirmQuestion").textContent = "";
    $("extraConfirmAccept").hidden = false;
    $("extraConfirmAccept").disabled = true;
    $("extraConfirmCancel").disabled = true;
    $("extraConfirm").oncancel = event => event.preventDefault();
    $("extraConfirm").showModal();
    const detected = parseHost(await callHost("psnPrepareExtras(" + selected + ")"));
    $("extraConfirm").close();
    if (!detected.ok) throw new Error(detected.error);
    if (!(await confirmExtraImport(detected.sourceIndex, detected.totalPngClips, null, detected))) {
      setStatus(detected.count ? "Import cancelled. No tracks or clips changed." : "0 extras found. Nothing to import.", "");
      return;
    }
    const script = "psnImportDetectedExtras()";
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
      (result.shortened ? " " + result.shortened + " shorter extras kept aligned to their planned positions." : "") +
      (result.offlineNames ? " Subtitle media is offline: " + result.offlineNames + "." : "") +
      (result.repeatedGroups ? " Note: extras for " + result.repeatedGroups + " repeated original(s) were aligned separately at each occurrence." : ""), "good");
    $("currentFile").textContent = result.count ? result.groups + " groups aligned. New extras use equal slots within the main clip or last existing extra. Existing clips are unchanged; bring the extras down to cut manually. Use Undo Subtitle Edit to remove this batch." : "Existing subtitles were left unchanged.";
  } catch (error) { if ($("extraConfirm").open) $("extraConfirm").close(); setStatus(error.message || String(error), "bad"); }
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
    $("syncReport").hidden = true;
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
  $("syncLocal").addEventListener("click", syncWithLocal);
  $("repairOverlaps").addEventListener("click", repairOverlaps);
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
