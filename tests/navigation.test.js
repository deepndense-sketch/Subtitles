const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const host = fs.readFileSync(path.join(__dirname, '../jsx/subtitle_navigator.jsx'), 'utf8');
let nextId = 0;
function clip(file, start, end, name = 'User renamed graphic') {
  return { nodeId: String(++nextId), name,
    projectItem: { name, getMediaPath() { throw new Error('Navigation read the media path'); } },
    start: { seconds: start }, end: { seconds: end },
    move() { throw new Error('Navigation shifted the entire clip'); },
    remove() { throw new Error('Navigation removed another clip'); }
  };
}
function setup(tracks, playhead) {
  let indexedReads = 0;
  const videoTracks = tracks.map(items => ({ get clips() {
    const list = items.slice(); list.numItems = list.length;
    return new Proxy(list, { get(target, key) {
      if (/^\d+$/.test(String(key))) indexedReads += 1;
      return target[key];
    } });
  } }));
  videoTracks.numTracks = tracks.length;
  const context = vm.createContext({ Time: function () { this.seconds = 0; }, app: {
    project: { activeSequence: { sequenceID: 'test-sequence', videoTracks, getPlayerPosition: () => ({ seconds: playhead }) } }
  } });
  vm.runInContext(host, context);
  return { validate: i => JSON.parse(context.psnValidateSubtitleTrack(i)),
    advance: i => JSON.parse(context.psnAdvanceAtPlayhead(i)),
    previous: i => JSON.parse(context.psnPreviousAtPlayhead(i)),
    undo: i => JSON.parse(context.psnUndoLastAdvance(i)),
    redo: i => JSON.parse(context.psnRedoLastAdvance(i)),
    trim: (i, side) => JSON.parse(context.psnTrimAtPlayhead(i, side)),
    reads: () => indexedReads,
    setPlayhead: value => { playhead = value; } };
}
// Existing clips are navigable without reading their media paths or touching neighbors.
const current = clip('C:/old/subtitle.PNG', 0, 5);
const second = clip('W:/manual/another graphic.png', 12, 14);
const third = clip('D:/elsewhere/final.png', 20, 23);
const otherTrack = clip('D:/other.png', 7, 9);
const movie = clip('D:/movie.mp4', 30, 32, 'Unnumbered caption');
const nav = setup([[otherTrack], [third, movie, current, second]], 5);
assert.strictEqual(nav.validate(1).count, 4);
const readsAfterPrepare = nav.reads();
let result = nav.advance(1);
assert.strictEqual(result.ok, true);
assert.strictEqual(second.start.seconds, 5);
assert.strictEqual(second.end.seconds, 14);
assert.strictEqual(current.end.seconds, 5);
assert.strictEqual(otherTrack.start.seconds, 7);
assert.strictEqual(movie.start.seconds, 30);
assert(nav.reads() > readsAfterPrepare, 'advance must inspect live clips');
// The next press trims only the clip under the cursor and extends the next start.
nav.setPlayhead(8);
result = nav.advance(1);
assert.strictEqual(result.ok, true);
assert.strictEqual(third.start.seconds, 8);
assert.strictEqual(third.end.seconds, 23);
assert.strictEqual(second.start.seconds, 5);
assert.strictEqual(second.end.seconds, 8);
assert.strictEqual(current.end.seconds, 5);
assert.strictEqual(otherTrack.end.seconds, 9);
assert(nav.reads() > readsAfterPrepare, 'moving the playhead must inspect live clips');
assert.strictEqual(nav.undo(1).ok, true);
assert.strictEqual(third.start.seconds, 20);
assert.strictEqual(third.end.seconds, 23);
assert.strictEqual(second.end.seconds, 14);
assert.strictEqual(nav.undo(1).ok, true);
assert.strictEqual(second.start.seconds, 12);
assert.strictEqual(second.end.seconds, 14);
assert.strictEqual(nav.undo(1).ok, false);
// A reference clip to the left is no longer required.
const first = clip('D:/first.png', 20, 21);
assert.strictEqual(setup([[first]], 0).advance(0).ok, true);
assert.strictEqual(first.start.seconds, 0);
assert.strictEqual(first.end.seconds, 21);
// A subtitle under the cursor is shortened; the target's end stays fixed.
const atHead = clip('D:/current.png', 0, 10);
const future = clip('D:/future.png', 15, 16);
const later = setup([[atHead, future]], 5);
assert.strictEqual(later.advance(0).ok, true);
assert.strictEqual(atHead.end.seconds, 5);
assert.strictEqual(future.start.seconds, 5);
assert.strictEqual(future.end.seconds, 16);
future.start.seconds = 6;
assert.strictEqual(later.undo(0).ok, false);
assert.strictEqual(setup([[]], 0).validate(0).ok, false);
assert.strictEqual(setup([[]], 0).advance(3).ok, false);
// Both trims restore timeline and source boundaries, with redo and activation preserving history.
const tc = clip('', 10, 20); tc.inPoint = {seconds: 2}; tc.outPoint = {seconds: 12};
const tr = setup([[tc]], 15);
assert.strictEqual(tr.trim(0, 'left').ok, true);
assert.strictEqual(tc.start.seconds, 15);
assert.strictEqual(tr.validate(0).ok, true);
assert.strictEqual(tr.undo(0).ok, true);
assert.strictEqual(tc.start.seconds, 10);
assert.strictEqual(tr.redo(0).ok, true);
assert.strictEqual(tc.start.seconds, 15);
tr.setPlayhead(18);
assert.strictEqual(tr.trim(0, 'right').ok, true);
assert.strictEqual(tc.end.seconds, 18);
assert.strictEqual(tr.undo(0).ok, true);
assert.strictEqual(tc.end.seconds, 20);
assert.strictEqual(tr.undo(0).ok, true);
assert.strictEqual(tc.start.seconds, 10);
assert.strictEqual(tc.inPoint.seconds, 2);
assert.strictEqual(tc.outPoint.seconds, 12);
tr.setPlayhead(10);
assert.strictEqual(tr.trim(0, 'left').ok, false, 'zero duration/boundary trim refused');
tr.setPlayhead(30);
assert.strictEqual(tr.trim(0, 'right').ok, false, 'gap trim refused');
// Existing overlaps must never be compounded by an advance.
const oa=clip('',0,20), ob=clip('',10,30);
assert.strictEqual(setup([[oa,ob]],5).advance(0).ok,false);
assert.strictEqual(oa.end.seconds,20);
assert.strictEqual(ob.start.seconds,10);
// Same-count replacement and unrelated boundary edits invalidate undo.
const sa=clip('',0,5), sb=clip('',10,20), sc=clip('',30,40), live=[sa,sb,sc];
const sr=setup([live],3);
assert.strictEqual(sr.advance(0).ok,true);
sc.end.seconds=39;
assert.strictEqual(sr.undo(0).ok,false);
assert.strictEqual(sb.start.seconds,3);
sc.end.seconds=40;
live[1]=clip('',3,20);
assert.strictEqual(sr.undo(0).ok,false);
assert.strictEqual(sa.end.seconds,3);
// A stale future start changes target selection even when clip count stays unchanged.
const xa=clip('',0,5), xb=clip('',10,12), xc=clip('',20,22);
const xr=setup([[xa,xb,xc]],6); xr.validate(0);
xb.start.seconds=3; xb.end.seconds=4; xa.end.seconds=3;
assert.strictEqual(xr.advance(0).ok,true);
assert.strictEqual(xc.start.seconds,6);
// Simulate Premiere silently rejecting a setter after the left clip was already shortened.
const fa=clip('',0,10), fb=clip('',15,20);
Object.defineProperty(fb,'start',{get(){return {seconds:15};},set(_) {}});
const fr=setup([[fa,fb]],5);
assert.strictEqual(fr.advance(0).ok,false);
assert.strictEqual(fa.end.seconds,10,'failed advance rolls back its earlier trim');
assert.strictEqual(fr.undo(0).ok,false,'failed edits do not enter history');
// Undo failure rolls back the whole undo; retry can then succeed.
const ua=clip('',0,10), ub=clip('',15,20); let reject=false, uaEnd=10;
Object.defineProperty(ua,'end',{get(){return {seconds:uaEnd};},set(t){if(!reject)uaEnd=t.seconds;}});
const ur=setup([[ua,ub]],5); assert.strictEqual(ur.advance(0).ok,true);
reject=true; assert.strictEqual(ur.undo(0).ok,false);
assert.strictEqual(ub.start.seconds,5); assert.strictEqual(ua.end.seconds,5);
reject=false; assert.strictEqual(ur.undo(0).ok,true);
assert.strictEqual(ub.start.seconds,15); assert.strictEqual(ua.end.seconds,10);
// Source-point edits outside the tool also block restoration.
const so=clip('',0,10); so.inPoint={seconds:0}; so.outPoint={seconds:10};
const sor=setup([[so]],5); assert.strictEqual(sor.trim(0,'right').ok,true);
so.inPoint.seconds=1; assert.strictEqual(sor.undo(0).ok,false);
assert.strictEqual(so.end.seconds,5);
// Simulate a host start setter that shifts end as a side effect.
const coupled=clip('',10,20); let cs=10, ce=20;
Object.defineProperty(coupled,'start',{get(){return {seconds:cs};},set(t){ce+=t.seconds-cs;cs=t.seconds;}});
Object.defineProperty(coupled,'end',{get(){return {seconds:ce};},set(t){ce=t.seconds;}});
const cr=setup([[coupled]],5); assert.strictEqual(cr.advance(0).ok,true);
assert.strictEqual(ce,20); assert.strictEqual(cr.undo(0).ok,true);
assert.strictEqual(cs,10); assert.strictEqual(ce,20);
assert.strictEqual(cr.redo(0).ok,true); assert.strictEqual(cs,5); assert.strictEqual(ce,20);
// Right Arrow mirrors Left Arrow: extend the previous end, trim the covering start.
const pa=clip('',0,5), pb=clip('',10,20), pc=clip('',25,30), po=clip('',1,40);
const pn=setup([[pc,pa,pb],[po]],15);
assert.strictEqual(pn.previous(0).ok,true);
assert.strictEqual(pa.start.seconds,0); assert.strictEqual(pa.end.seconds,15);
assert.strictEqual(pb.start.seconds,15); assert.strictEqual(pb.end.seconds,20);
assert.strictEqual(pc.start.seconds,25); assert.strictEqual(po.end.seconds,40);
assert.strictEqual(pn.previous(0).ok,false,'repeat at the same boundary cannot consume another subtitle');
assert.strictEqual(pn.undo(0).ok,true);
assert.strictEqual(pa.end.seconds,5); assert.strictEqual(pb.start.seconds,10);
assert.strictEqual(pn.redo(0).ok,true);
assert.strictEqual(pa.end.seconds,15); assert.strictEqual(pb.start.seconds,15);
assert.strictEqual(pn.undo(0).ok,true);
pn.setPlayhead(8);
assert.strictEqual(pn.previous(0).ok,true,'previous subtitle can extend into a gap');
assert.strictEqual(pa.end.seconds,8); assert.strictEqual(pb.start.seconds,10);
assert.strictEqual(pn.undo(0).ok,true);
pn.setPlayhead(35);
assert.strictEqual(pn.previous(0).ok,true,'works after the last subtitle');
assert.strictEqual(pc.end.seconds,35); assert.strictEqual(pn.undo(0).ok,true);
pn.setPlayhead(0); assert.strictEqual(pn.previous(0).ok,false);
pn.setPlayhead(3); assert.strictEqual(pn.previous(0).ok,false,'no previous clip inside first subtitle');
pn.setPlayhead(20); assert.strictEqual(pn.previous(0).ok,false,'do not erase a clip at its end boundary');
// Failed previous extension restores the covering clip's already-trimmed start.
const pfa=clip('',0,5), pfb=clip('',10,20);
Object.defineProperty(pfa,'end',{get(){return {seconds:5};},set(_) {}});
const pfn=setup([[pfa,pfb]],15);
assert.strictEqual(pfn.previous(0).ok,false);
assert.strictEqual(pfb.start.seconds,10); assert.strictEqual(pfa.end.seconds,5);
assert.strictEqual(pfn.undo(0).ok,false);
// Navigation must not depend on folder scanning; exercise both panel entry points.
const elements = { trackSelect: { options: [1, 2], value: '1' }, advance: {}, undo: {}, currentFile: {}, activate: {}, stateBadge: {} };
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'psn-navigation-'));
const panel = vm.createContext({ require, Buffer, process: { env: { LOCALAPPDATA: tempRoot } }, console,
  localStorage: { getItem: () => null },
  window: { location: { pathname: '' } },
  document: { getElementById: id => elements[id], addEventListener() {} },
  setInterval, clearInterval, __dirname: path.join(__dirname, '../js')
});
vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/main.js'), 'utf8'), panel);
vm.runInContext(`
refreshIndex = function () { throw new Error('Navigation scanned the optional folder'); };
startListener = function () {};
setStatus = function () {};
var calls = [];
callHost = async function (script) {
  calls.push(script);
  return JSON.stringify({ok:true,name:'any.png',trackIndex:1,start:5,end:10,trimmed:0});
};
`, panel);
(async () => {
  await panel.toggleActive();
  await panel.advanceSubtitle();
  await panel.undoLastAdvance();
  assert.deepStrictEqual(Array.from(panel.calls), ['psnValidateSubtitleTrack(1)', 'psnAdvanceAtPlayhead(1)', 'psnUndoLastAdvance(1)']);
  const stateFolder = path.join(tempRoot, 'PremiereSubtitleNavigator');
  fs.mkdirSync(stateFolder);
  fs.writeFileSync(path.join(stateFolder,'active'),'active');
  const queueFile = path.join(stateFolder, 'commands.queue');
  fs.writeFileSync(queueFile, 'left|1\nleft|2\nleft|3\n');
  panel.pollQueue();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.strictEqual(panel.calls.filter(call => call === 'psnAdvanceAtPlayhead(1)').length, 4,
    'each captured key press must move one subtitle');
  fs.appendFileSync(queueFile, 'trim-left|4\nundo|5\ntrim-right|6\nundo|7\nredo|8\n');
  panel.pollQueue();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepStrictEqual(Array.from(panel.calls).slice(-5), [
    'psnTrimAtPlayhead(1,"left")','psnUndoLastAdvance(1)',
    'psnTrimAtPlayhead(1,"right")','psnUndoLastAdvance(1)','psnRedoLastAdvance(1)'
  ], 'mixed shortcuts preserve their order');
  fs.appendFileSync(queueFile, 'right|81\nundo|82\nleft|83\nright|84\n');
  panel.pollQueue();
  await new Promise(resolve => setTimeout(resolve,20));
  assert.deepStrictEqual(Array.from(panel.calls).slice(-4), [
    'psnPreviousAtPlayhead(1)','psnUndoLastAdvance(1)','psnAdvanceAtPlayhead(1)','psnPreviousAtPlayhead(1)'
  ], 'both arrows share the ordered undoable command queue');
  // Undo pressed while an earlier host call is running must not be dropped.
  vm.runInContext(`
    var releaseEdit;
    callHost = function(script) {
      calls.push(script);
      if (script === 'psnAdvanceAtPlayhead(1)') return new Promise(resolve => {
        releaseEdit = () => resolve(JSON.stringify({ok:true,name:'test.png',trackIndex:1,start:5,end:10}));
      });
      return Promise.resolve(JSON.stringify({ok:true,label:'Advance subtitle'}));
    };
  `, panel);
  panel.requestEdit('left');
  panel.requestEdit('undo');
  panel.releaseEdit();
  await new Promise(resolve => setTimeout(resolve,20));
  assert.deepStrictEqual(Array.from(panel.calls).slice(-2), ['psnAdvanceAtPlayhead(1)','psnUndoLastAdvance(1)']);
  await panel.toggleActive();
  const beforeInactive=panel.calls.length;
  fs.appendFileSync(queueFile,'trim-left|9\n'); panel.pollQueue();
  await new Promise(resolve => setTimeout(resolve,20));
  assert.strictEqual(panel.calls.length,beforeInactive,'deactivation releases queued shortcuts');
  fs.unlinkSync(queueFile);
  fs.rmSync(tempRoot,{recursive:true,force:true});
  console.log('navigation tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
