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
function updatesDirectory() {return path.join(process.env.LOCALAPPDATA, "PremiereSubtitleNavigator/updates");}
function readVersion(root) {return JSON.parse(fs.readFileSync(path.join(root,"package.json"),"utf8")).version;}
function writeStatus(job,state,message) {fs.writeFileSync(path.join(job,"status.json"),JSON.stringify({state,message}));}
function pending(root) {
  try {
    const info=JSON.parse(fs.readFileSync(path.join(updatesDirectory(),"pending.json"),"utf8"));
    if(path.resolve(info.target).toLowerCase()!==path.resolve(root).toLowerCase() || path.dirname(path.resolve(info.job)).toLowerCase()!==path.resolve(updatesDirectory()).toLowerCase()) return null;
    if(!require('./update-checker').isNewer(info.version,readVersion(root))) return null;
    const statusFile=path.join(info.job,"status.json");
    const status=fs.existsSync(statusFile) ? JSON.parse(fs.readFileSync(statusFile,"utf8")) : {state:"preparing",message:"Preparing update files."};
    if(status.state==="waiting" || status.state==="installing") {
      let alive=false;
      if(status.pid) {try {process.kill(status.pid,0);alive=true;} catch(error) {alive=error.code==="EPERM";}}
      if(!alive) {status.state="failed";status.message="The update helper stopped. Click Retry update.";}
    } else if(status.state==="preparing" && Date.now()-info.started>120000) {
      status.state="failed";status.message="Update preparation was interrupted. Click Retry update.";
    } else if(status.state==="complete") {status.state="failed";status.message="The installed version was not updated. Click Retry update.";}
    return Object.assign({},info,status);
  } catch(_) {return null;}
}
function launch(job, spawn, timeout) {
  const output=fs.openSync(path.join(job,"launcher.log"),"a");
  const env=Object.assign({},process.env);
  // Premiere can inherit a different PowerShell module search path.
  env.PSModulePath=path.join(env.SystemRoot,"System32/WindowsPowerShell/v1.0/Modules");
  let worker;
  try {
    // Match ExportBackup's two-stage launcher: Start-Process gives the installer
    // an independent lifetime, without DETACHED_PROCESS or requiring elevation.
    const quote=value=>"'"+String(value).replace(/'/g,"''")+"'";
    const encoded=Buffer.from("& "+quote(path.join(job,"install-update.ps1")),"utf16le").toString("base64");
    const executable=path.join(env.SystemRoot,"System32/WindowsPowerShell/v1.0/powershell.exe");
    const command="Start-Process -FilePath "+quote(executable)+" -WindowStyle Hidden -ArgumentList '-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand','"+encoded+"' -RedirectStandardOutput "+quote(path.join(job,"helper-output.log"))+" -RedirectStandardError "+quote(path.join(job,"helper.log"));
    worker=(spawn || child.spawn)(executable,["-NoProfile","-NonInteractive","-ExecutionPolicy","Bypass","-Command",command],{env,detached:false,windowsHide:true,stdio:["ignore",output,output]});
  } finally {fs.closeSync(output);}
  return new Promise((resolve,reject)=>{
    let finished=false,interval,deadline;
    function finish(error) {
      if(finished) return;finished=true;clearInterval(interval);clearTimeout(deadline);
      if(error) {
        fs.writeFileSync(path.join(job,"cancel"),"cancel");
        let detail="";["launcher.log","helper.log"].forEach(name=>{try {detail+=" "+fs.readFileSync(path.join(job,name),"utf8").trim().slice(-1500);} catch(_) {}});
        const message=error.message+(detail ? " "+detail : "");
        writeStatus(job,"failed",message);reject(Error(message));
      } else {worker.unref();resolve();}
    }
    function inspect() {
      try {
        const state=JSON.parse(fs.readFileSync(path.join(job,"status.json"),"utf8"));
        if(state.state==="waiting" || state.state==="installing" || state.state==="complete") finish();
        else if(state.state==="failed") finish(Error(state.message));
      } catch(_) {}
    }
    worker.once("error",finish);
    worker.once("exit",code=>{inspect();if(!finished && code!==0) finish(Error("Update launcher exited before the helper was ready ("+code+")."));});
    interval=setInterval(inspect,100);
    deadline=setTimeout(()=>finish(Error("Update helper did not confirm startup.")),timeout || 15000);
    inspect();
  });
}
async function prepare(root, version) {
  const expected = path.resolve(process.env.APPDATA, "Adobe/CEP/extensions/Subtitle");
  if (path.resolve(root).toLowerCase() !== expected.toLowerCase() || fs.lstatSync(root).isSymbolicLink()) throw Error("Update must run from the installed Subtitle CEP folder.");
  const prior=pending(root);
  if(prior && prior.state!=="failed") throw Error("An update is already pending. "+prior.message);
  const jobs = updatesDirectory();
  fs.mkdirSync(jobs, {recursive:true});
  const job = fs.mkdtempSync(path.join(jobs, "update-"));
  fs.writeFileSync(path.join(jobs,"pending.json"),JSON.stringify({job,version,target:expected,started:Date.now()}));
  try {
  const files = await stage(version, path.join(job, "payload"));
  fs.writeFileSync(path.join(job, "plan.json"), JSON.stringify({target:expected, version, files}));
  fs.copyFileSync(path.join(root, "native/install-update.ps1"), path.join(job, "install-update.ps1"));
  await launch(job);
  return {job, status:path.join(job,"status.json")};
  } catch(error) {writeStatus(job,"failed",error.message);throw error;}
}
module.exports = {FILES, hash, validateManifest, stage, prepare, launch, pending, readVersion};
