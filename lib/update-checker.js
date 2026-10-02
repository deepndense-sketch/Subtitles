"use strict";
const https = require("https");
const REPOSITORY = "https://github.com/deepndense-sketch/Subtitles";
const MANIFEST = "https://raw.githubusercontent.com/deepndense-sketch/Subtitles/main/release.json";
function parts(version) {
  return typeof version === "string" && /^\d+\.\d+\.\d+$/.test(version) ? version.split(".").map(Number) : null;
}
function isNewer(candidate, installed) {
  const a = parts(candidate), b = parts(installed);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) { if (a[i] !== b[i]) return a[i] > b[i]; }
  return false;
}
function validate(manifest, installed) {
  if (!manifest || !isNewer(manifest.version, installed)) return null;
  // Construct the destination ourselves; remote metadata cannot redirect users elsewhere.
  return {version: manifest.version, url: REPOSITORY + "/archive/refs/tags/v" + manifest.version + ".zip"};
}
function check(installed, transport) {
  return new Promise((resolve, reject) => {
    const request = (transport || https).get(MANIFEST + "?check=" + Date.now(), {headers: {"User-Agent": "Subtitle-CEP/" + installed, "Cache-Control": "no-cache"}}, response => {
      if (response.statusCode !== 200) { response.resume(); reject(new Error("Update server returned " + response.statusCode)); return; }
      let body = "";
      response.setEncoding("utf8");
      response.on("data", chunk => {
        body += chunk;
        if (body.length > 32768) request.destroy(new Error("Update response is too large"));
      });
      response.on("error", reject);
      response.on("end", () => { try { resolve(validate(JSON.parse(body), installed)); } catch (error) { reject(error); } });
    });
    request.setTimeout(10000, () => request.destroy(new Error("Update check timed out")));
    request.on("error", reject);
  });
}
module.exports = {isNewer, validate, check};
