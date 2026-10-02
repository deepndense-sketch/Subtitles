"use strict";
const fs = require("fs"), path = require("path"), https = require("https"), crypto = require("crypto"), child = require("child_process");
const FILES = ["CSXS/manifest.xml", "css/style.css", "index.html", "js/main.js", "js/updates.js", "jsx/subtitle_navigator.jsx", "lib/subtitle-index.js", "lib/update-checker.js", "lib/cep-updater.js", "native/KeyListener.exe", "native/install-update.ps1", "package.json"];
const hash = data => crypto.createHash("sha256").update(data).digest("hex");
function validateManifest(manifest, version) {
  if (!/^\d+\.\d+\.\d+$/.test(version) || !manifest || manifest.version !== version || !Array.isArray(manifest.files)) throw Error("Invalid update version or file list.");
  if (manifest.files.length !== FILES.length) throw Error("Incomplete update package.");
  const seen = {};
  manifest.files.forEach(file => {
    if (!file || FILES.indexOf(file.path) < 0 || seen[file.path] || !/^[a-f0-9]{64}$/.test(file.sha256) || !Number.isInteger(file.size) || file.size < 1 || file.size > 10 * 1024 * 1024) throw Error("Invalid update file.");
    seen[file.path] = true;
  });
  return manifest.files;
}
function download(url, limit) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, {headers: {"User-Agent": "Subtitle-CEP-Updater", "Cache-Control": "no-cache"}}, response => {
      if (response.statusCode !== 200) {response.resume();reject(Error("Update download failed (" + response.statusCode + ")."));return;}
      let size = 0; const chunks = [];
      response.on("data", chunk => {size += chunk.length;if(size > limit) request.destroy(Error("Update file is too large."));else chunks.push(chunk);});
      response.on("error", reject);
      response.on("end", () => resolve(Buffer.concat(chunks)));
    });
    request.setTimeout(15000, () => request.destroy(Error("Update download timed out.")));
    request.on("error", reject);
  });
}
async function stage(version, directory, fetchFile) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw Error("Invalid version.");
  const fetch = fetchFile || download;
  const base = "https://raw.githubusercontent.com/deepndense-sketch/Subtitles/v" + version + "/";
  const bytes = await fetch(base + "release.json", 32768);
  const manifest = JSON.parse(bytes.toString("utf8"));
  const files = validateManifest(manifest, version);
  for (const file of files) {
    const data = await fetch(base + file.path, file.size + 1);
    if (data.length !== file.size || hash(data) !== file.sha256) throw Error("Update verification failed: " + file.path);
    const destination = path.join(directory, file.path);
    fs.mkdirSync(path.dirname(destination), {recursive: true});fs.writeFileSync(destination, data);
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(directory, "package.json"), "utf8"));
  const xml = fs.readFileSync(path.join(directory, "CSXS/manifest.xml"), "utf8");
  if(pkg.version !== version || xml.indexOf('ExtensionBundleVersion="' + version + '"') < 0 || xml.indexOf('ExtensionBundleId="com.deepndense.premiere.subtitleNavigator"') < 0) throw Error("Update identity does not match Subtitle.");
  fs.writeFileSync(path.join(directory, "release.json"), bytes);
  return files.concat([{path:"release.json", size:bytes.length, sha256:hash(bytes)}]);
}
async function prepare(root, version) {
  const expected = path.resolve(process.env.APPDATA, "Adobe/CEP/extensions/Subtitle");
  if (path.resolve(root).toLowerCase() !== expected.toLowerCase() || fs.lstatSync(root).isSymbolicLink()) throw Error("Update must run from the installed Subtitle CEP folder.");
  const jobs = path.join(process.env.LOCALAPPDATA, "PremiereSubtitleNavigator/updates");
  fs.mkdirSync(jobs, {recursive:true});
  const job = fs.mkdtempSync(path.join(jobs, "update-"));
  const files = await stage(version, path.join(job, "payload"));
  fs.writeFileSync(path.join(job, "plan.json"), JSON.stringify({target:expected, version, files}));
  fs.copyFileSync(path.join(root, "native/install-update.ps1"), path.join(job, "install-update.ps1"));
  const script = path.join(job, "install-update.ps1");
  await new Promise((resolve, reject) => {
    const worker = child.spawn(path.join(process.env.SystemRoot, "System32/WindowsPowerShell/v1.0/powershell.exe"), ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script], {detached:true, windowsHide:true, stdio:"ignore"});
    worker.once("error", reject);worker.once("spawn", () => {worker.unref();resolve();});
  });
  return {job, status:path.join(job,"status.json")};
}
module.exports = {FILES, hash, validateManifest, stage, prepare};
