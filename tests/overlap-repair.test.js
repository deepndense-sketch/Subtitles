const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const host = fs.readFileSync(path.join(__dirname, '../jsx/subtitle_navigator.jsx'), 'utf8');
function clip(id, start, end, png = true) {
  return { nodeId: id, projectItem: {nodeId: id, name: id + (png ? '.png' : '.mp4')},
    start: {seconds: start}, end: {seconds: end} };
}
function setup(clips) {
  const track = {get clips() { const rows = clips.slice(); rows.numItems = rows.length; return rows; }};
  const tracks = [track]; tracks.numTracks = 1;
  const sequence = {sequenceID: 'sequence', videoTracks: tracks, getPlayerPosition: () => ({seconds: 5})};
  const context = vm.createContext({Time: function(){}, app: {project: {path: 'test', activeSequence: sequence}}});
  vm.runInContext(host, context);
  return {context, track, sequence,
    prepare: () => JSON.parse(context.psnPrepareOverlapRepair(0)),
    apply: () => JSON.parse(context.psnApplyOverlapRepair()),
    undo: () => JSON.parse(context.psnUndoLastAdvance(0)),
    redo: () => JSON.parse(context.psnRedoLastAdvance(0))};
}
// One long PNG masks several later PNGs on the same track. Preview must not edit.
const a = clip('a', 49, 116), b = clip('b', 54, 56), c = clip('c', 56, 59);
const run = setup([c, a, b]);
assert.strictEqual(run.prepare().count, 1);
assert.strictEqual(a.end.seconds, 116);
assert.strictEqual(run.apply().ok, true);
assert.strictEqual(a.end.seconds, 54);
assert.strictEqual(a.start.seconds, 49);
assert.strictEqual(b.end.seconds, 56);
assert.strictEqual(c.end.seconds, 59);
assert.strictEqual(run.undo().ok, true);
assert.strictEqual(a.end.seconds, 116);
assert.strictEqual(run.redo().ok, true, 'redo accepts the overlapping pre-repair snapshot');
assert.strictEqual(a.end.seconds, 54);
assert.strictEqual(run.prepare().count, 0);
assert.strictEqual(run.apply().count, 0);
assert.strictEqual(run.undo().ok, true, 'empty repair must not add an undo entry');
// Changes while confirmation is open invalidate the preview, including source marks.
const stale = setup([clip('a', 0, 20), clip('b', 10, 30)]);
assert.strictEqual(stale.prepare().count, 1);
stale.track.clips[1].start.seconds = 11;
assert.strictEqual(stale.apply().ok, false);
assert.strictEqual(stale.track.clips[0].end.seconds, 20);
assert.strictEqual(stale.apply().ok, false, 'preview is one use');
stale.prepare(); stale.sequence.sequenceID = 'different';
assert.strictEqual(stale.apply().ok, false);
// Same-start clips cannot be repaired without deleting or moving a subtitle.
assert.strictEqual(setup([clip('a', 0, 20), clip('b', 0, 10)]).prepare().ok, false);
assert.strictEqual(setup([clip('a', 0, 20, false), clip('b', 10, 30)]).prepare().ok, false);
const locked = setup([clip('a', 0, 20), clip('b', 10, 30)]);
locked.track.isLocked = () => true;
assert.strictEqual(locked.prepare().ok, false);
// Restore all previous edits if a later repair is rejected by Premiere.
const x = clip('x', 0, 20), y = clip('y', 10, 30), z = clip('z', 25, 40);
Object.defineProperty(y, 'end', {get: () => ({seconds: 30}), set() {}});
const failed = setup([x, y, z]);
assert.strictEqual(failed.prepare().count, 2);
assert.strictEqual(failed.apply().ok, false);
assert.strictEqual(x.end.seconds, 20);
assert.strictEqual(failed.undo().ok, false);
// Source-point restoration can move timeline bounds, even after they were set.
const coupled = clip('coupled', 0, 10); let out = 10;
coupled.inPoint = {seconds: 0};
Object.defineProperty(coupled, 'outPoint', {
  get: () => ({seconds: out}),
  set(value) { coupled.end.seconds += value.seconds - out; out = value.seconds; }
});
const restore = setup([coupled]);
const desired = restore.context.psnSnapshot(restore.track);
coupled.end.seconds = 5; out = 5;
restore.context.psnRestore(restore.track, desired);
assert.strictEqual(coupled.end.seconds, 10, 'source setters must not leave a shifted timeline end');
assert.strictEqual(out, 10);
console.log('overlap repair and coupled restoration tests passed');

// Editing a PNG that already has stale source duration normalizes its source
// range, while retaining the requested timeline range and PNG identity.
const staleSource=clip('png',10,20); staleSource.inPoint={seconds:2}; staleSource.outPoint={seconds:3};
const sync=setup([staleSource]);
sync.context.psnBounds(sync.track,{id:'png',start:12,end:18});
assert.strictEqual(staleSource.start.seconds,12);
assert.strictEqual(staleSource.end.seconds,18);
assert.strictEqual(staleSource.inPoint.seconds,4);
assert.strictEqual(staleSource.outPoint.seconds,10);
// Left extension before the available still source uses its first frame.
sync.context.psnBounds(sync.track,{id:'png',start:0,end:18});
assert.strictEqual(staleSource.inPoint.seconds,0);
assert.strictEqual(staleSource.outPoint.seconds,18);

const oldPng=clip('old',0,10); oldPng.inPoint={seconds:0}; oldPng.outPoint={seconds:1};
const oldRun=setup([oldPng]);
assert.strictEqual(JSON.parse(oldRun.context.psnTrimAtPlayhead(0,'right')).ok,true);
assert.strictEqual(oldPng.outPoint.seconds,5);
assert.strictEqual(oldRun.undo().ok,true);
assert.strictEqual(oldPng.end.seconds,10);
assert.strictEqual(oldPng.outPoint.seconds,10,'undo must not recreate a stale one-second source extent');
assert.strictEqual(oldRun.redo().ok,true);
assert.strictEqual(oldPng.outPoint.seconds,5);
