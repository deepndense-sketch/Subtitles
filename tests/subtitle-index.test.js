const assert = require("assert");
const index = require("../lib/subtitle-index");

assert.deepStrictEqual(index.parsePngName("FN 3262-0623.png"), {
  fileName: "FN 3262-0623.png", line: 623, lineText: "0623", variant: 0, variantText: ""
});
assert.strictEqual(index.parsePngName("unrelated.png"), null);

const built = index.buildIndex([
  "FN 3262-0624.png",
  "FN 3262-0623_2.png",
  "FN 3262-0621.png",
  "FN 3262-0623.png",
  "FN 3262-0623_1.png"
]);
assert.deepStrictEqual(built.entries.map((x) => `${x.line}:${x.variant}`), ["621:0", "623:0", "623:1", "623:2", "624:0"]);
assert.strictEqual(index.adjacent(built.entries, "anything-0623.png", "right").fileName, "FN 3262-0623_1.png");
assert.strictEqual(index.adjacent(built.entries, "anything-0623.png", "left").fileName, "FN 3262-0621.png");
assert.strictEqual(index.adjacent(built.entries, "anything-0624.png", "right"), null);

const duplicates = index.buildIndex(["A-0007.png", "B-0007.png"]);
assert.strictEqual(duplicates.duplicateKeys.length, 1);

console.log("subtitle-index tests passed");
