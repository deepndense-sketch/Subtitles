(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.SubtitleIndex = api;
}(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function parsePngName(fileName) {
    var name = String(fileName || "");
    var match = name.match(/(?:^|[-\s])(\d+)(?:_(\d+))?\.png$/i);
    if (!match) return null;
    return {
      fileName: name,
      line: parseInt(match[1], 10),
      lineText: match[1],
      variant: match[2] ? parseInt(match[2], 10) : 0,
      variantText: match[2] || ""
    };
  }

  function compareEntries(a, b) {
    if (a.line !== b.line) return a.line - b.line;
    if (a.variant !== b.variant) return a.variant - b.variant;
    return String(a.fileName).localeCompare(String(b.fileName), undefined, { numeric: true, sensitivity: "base" });
  }

  function buildIndex(fileNames) {
    var entries = [];
    var ignored = [];
    var duplicateKeys = [];
    var seen = {};
    (fileNames || []).forEach(function (fileName) {
      var parsed = parsePngName(fileName);
      if (!parsed) {
        if (/\.png$/i.test(String(fileName))) ignored.push(String(fileName));
        return;
      }
      var key = parsed.line + ":" + parsed.variant;
      if (seen[key]) duplicateKeys.push([seen[key], parsed.fileName]);
      else seen[key] = parsed.fileName;
      entries.push(parsed);
    });
    entries.sort(compareEntries);
    return { entries: entries, ignored: ignored, duplicateKeys: duplicateKeys };
  }

  function findPosition(entries, fileName) {
    var parsed = parsePngName(fileName);
    if (!parsed) return -1;
    for (var i = 0; i < entries.length; i += 1) {
      if (entries[i].line === parsed.line && entries[i].variant === parsed.variant) return i;
    }
    return -1;
  }

  function adjacent(entries, fileName, direction) {
    var position = findPosition(entries, fileName);
    if (position < 0) return null;
    var next = position + (direction === "left" ? -1 : 1);
    return next >= 0 && next < entries.length ? entries[next] : null;
  }

  return {
    parsePngName: parsePngName,
    compareEntries: compareEntries,
    buildIndex: buildIndex,
    findPosition: findPosition,
    adjacent: adjacent
  };
}));
