const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const host = fs.readFileSync(path.join(__dirname, '../jsx/subtitle_navigator.jsx'), 'utf8');
let nextId = 0;
function setup(trackSpecs, files, options = {}) {
  const items = new Map(); let writes = 0, imports = 0;
  function item(name) {
    if (!items.has(name)) {
      let input = 2, output = 7, label = 3;
      items.set(name, { name: name.replace(/^.*[\\/]/,''), nodeId: 'item-' + name, getMediaPath: () => /[\\/]/.test(name) ? name : 'C:/subs/' + name,
        getInPoint: () => ({seconds: input}), getOutPoint: () => ({seconds: output}),
        getColorLabel: () => label, setColorLabel: n => { if(!options.failLabel) label=n; },
        setInPoint: n => { if(options.forbidSourceMarks) throw Error('Source PNG marks must not be changed'); input = n; },
        setOutPoint: n => { if(options.forbidSourceMarks) throw Error('Source PNG marks must not be changed'); output = n; }
      });
    }
    return items.get(name);
  }
  function makeTrack(specs) {
    const clips = [];
    const track = { id:'track-'+String(++nextId), get clips() { clips.numItems = clips.length; return clips; }, isLocked: () => false,
      overwriteClip(source, start) {
        writes++;
        if (options.failAt === writes) throw Error('Simulated insertion failure');
        const duration=options.insertedDuration || source.getOutPoint().seconds-source.getInPoint().seconds;
        assert(clips.every(c=>c.end.seconds<=start || c.start.seconds>=start+duration),'initial still insertion must not overlap existing destination clips');
        add(source, start, start + duration, true);
      }
    };
    function add(source, start, end, inserted) {
      const clip = {nodeId: String(++nextId), projectItem: source, start:{seconds:start}, end:{seconds:end},
        inPoint:{seconds:0},outPoint:{seconds:end-start},label:source.getColorLabel(),
        move(offset) {
          if(options.failMove) return false;
          const newStart=this.start.seconds+offset.seconds,newEnd=this.end.seconds+offset.seconds;
          assert(clips.every(c=>c===this || c.end.seconds<=newStart+1e-6 || c.start.seconds>=newEnd-1e-6),'final move must not overlap other clips');
          this.start.seconds=newStart;this.end.seconds=newEnd;
        },
        remove(ripple) { assert.strictEqual(ripple,false); clips.splice(clips.indexOf(clip),1); }
      };
      if(inserted && options.durationLimit!==undefined) {
        let endTime=clip.end;
        Object.defineProperty(clip,'end',{get(){return endTime;},set(time){
          if(options.throwOnExtend && time.seconds>clip.start.seconds+options.durationLimit) throw Error('Insufficient source duration');
          endTime={seconds:Math.min(time.seconds,clip.start.seconds+options.durationLimit)};
        }});
      }
      clips.push(clip); return clip;
    }
    specs.forEach(([name,start,end]) => add(item(name),start,end));
    return track;
  }
  const tracks=trackSpecs.map(makeTrack);
  tracks.numTracks=tracks.length;
  const root={get children(){const list=Array.from(items.values());list.numItems=list.length;return list;},createBin(){return root;}};
  const seq={sequenceID:'extras-sequence',timebase:String(254016000000/(options.fps || 25)),videoTracks:tracks};
  const disk=files.map(f=>/[\\/]/.test(f) ? f : 'C:/subs/'+f);
  const scans=[];
  function File(file) {
    this.fsName=file;
    this.exists=disk.some(p=>p.toLowerCase()===file.toLowerCase());
    const folder=file.substring(0,file.lastIndexOf('/'));
    this.parent={fsName:folder,exists:!options.offline,getFiles(){scans.push(folder);return disk.filter(p=>p.substring(0,p.lastIndexOf('/'))===folder).map(p=>new File(p));}};
  }
  let created=0;
  const context=vm.createContext({Time:function(){this.seconds=0;}, File,
    qe:{project:{getActiveSequence(){return {addTracks(n,position,audio){
      assert.strictEqual(n,1);assert.strictEqual(audio,0);created++;
      tracks.splice(options.wrongTrackPosition ? 0 : position+(options.afterIndex ? 1 : 0),0,makeTrack([]));tracks.numTracks=tracks.length;
    },removeVideoTrack(index){
      assert.strictEqual(tracks[index].clips.numItems,0,'correction must only remove the newly created empty track');
      tracks.splice(index,1);tracks.numTracks=tracks.length;
    }};}}},
    app:{properties:{getProperty(key){return (options.preferences || {})[key];}},enableQE(){},project:{path:'test.prproj',activeSequence:seq,rootItem:root,importFiles(paths){imports++;paths.forEach(p=>item(p.replace(/^C:\/subs\//,'')));return true;}}}});
  vm.runInContext(host,context);
  context.psnReadImportPlan=()=>files.map(f=>'C:/subs/'+f);
  return { context,tracks,items,seq,scans, writes:()=>writes,imports:()=>imports,created:()=>created,
    auto:()=>JSON.parse(context.psnImportExtras()),
    run:(source=0,dest=1)=>JSON.parse(context.psnImportExtras(source,dest)),
    undo:(source=0)=>JSON.parse(context.psnUndoLastAdvance(source)),redo:(source=0)=>JSON.parse(context.psnRedoLastAdvance(source)) };
}
function spans(track) { return Array.from(track.clips,c=>[c.projectItem.name,c.start.seconds,c.end.seconds]).sort((a,b)=>a[1]-b[1]); }

// Generic ordered filenames: prefer the largest qualifying track, allow gaps and descending order.
const detect=setup([
  [['Other 001.png',0,3],['Other 003.png',3,6],['Other 005.png',6,9]],
  [['My show 1025.png',0,3],['My show 990.png',3,6],['My show 803.png',6,9],['My show 701.png',9,12],['logo.png',12,15]],
  [['My show 1025_1.png',0,1],['My show 990_1.png',3,4],['My show 803_1.png',6,7]]
],['My show 701_1.png','logo_1.png']);
let detection=JSON.parse(detect.context.psnDetectExtraSource());
assert.strictEqual(detection.ok,true,detection.error);
assert.strictEqual(detection.sourceIndex,1);
assert.strictEqual(detection.count,4);
assert.strictEqual(detect.created(),0,'detection cannot modify the timeline');
assert.strictEqual(detect.imports(),0);
let detectedImport=JSON.parse(detect.context.psnImportDetectedExtras());
assert.strictEqual(detectedImport.ok,true,detectedImport.error);
assert.strictEqual(detectedImport.count,1,'unrelated logo on the detected track is not imported');
assert.deepStrictEqual(spans(detect.tracks[2]),[['My show 701_1.png',11,12]]);
const unordered=setup([[['A 001.png',0,3],['A 009.png',3,6],['A 003.png',6,9]]],[]);
assert.strictEqual(JSON.parse(unordered.context.psnDetectExtraSource()).ok,false);
const tiedDetection=setup([[['A 001.png',0,3],['A 005.png',3,6],['A 019.png',6,9]],[['B 101.png',0,3],['B 111.png',3,6],['B 190.png',6,9]]],[]);
assert.strictEqual(JSON.parse(tiedDetection.context.psnDetectExtraSource()).ok,false);
const stale=setup([[['A 001.png',0,3],['A 005.png',3,6],['A 019.png',6,9]]],['A 001_1.png']);
assert.strictEqual(JSON.parse(stale.context.psnDetectExtraSource()).ok,true);
stale.tracks[0].clips[0].end.seconds=2;
assert.strictEqual(JSON.parse(stale.context.psnImportDetectedExtras()).ok,false,'changed timeline requires confirmation again');
assert.strictEqual(stale.created(),0);

// V14 remains V14 and extras land on the newly inserted V15, under either QE convention.
for(const afterIndex of [false,true]) {
  const specs=Array.from({length:16},(_,i)=>[[i===13 ? 'FN 3289-0514.png' : 'keep-'+i+'.png',2,8]]);
  const v14=setup(specs,['FN 3289-0514_1.png'],{afterIndex});
  const originalTracks=Array.from(v14.tracks);
  const result=JSON.parse(v14.context.psnImportExtras(13));
  assert.strictEqual(result.ok,true,result.error);
  assert.strictEqual(result.sourceIndex,13);
  assert.strictEqual(result.trackIndex,14);
  assert.strictEqual(v14.tracks.length,17);
  for(let i=0;i<16;i++) assert.strictEqual(v14.tracks[i<14 ? i : i+1],originalTracks[i]);
  assert.deepStrictEqual(spans(v14.tracks[14]),[['FN 3289-0514_1.png',7,8]]);
  assert.strictEqual(v14.undo(13).ok,true);
  assert.strictEqual(v14.redo(13).ok,true);
  assert.strictEqual(JSON.parse(v14.context.psnImportExtras(13)).count,0);
  assert.strictEqual(v14.tracks.length,17);
}

// Explicit source selection creates a new track directly above that source,
// even when another track contains filenames that would match autodetection.
const chosen=setup([[['FN 1234-0001.png',0,4]],[['Custom subtitle.png',3,7]],[['keep.png',0,10]]],['Custom subtitle_1.png']);
const originalUpper=chosen.tracks[2];
const chosenResult=JSON.parse(chosen.context.psnImportExtras(1));
assert.strictEqual(chosenResult.ok,true,chosenResult.error);
assert.strictEqual(chosenResult.sourceIndex,1);
assert.strictEqual(chosenResult.trackIndex,2);
assert.strictEqual(chosen.created(),1);
assert.strictEqual(chosen.tracks[3],originalUpper);
assert.deepStrictEqual(spans(chosen.tracks[2]),[['Custom subtitle_1.png',6,7]]);
assert.strictEqual(chosen.undo(1).ok,true);
assert.strictEqual(chosen.redo(1).ok,true);
assert.strictEqual(JSON.parse(chosen.context.psnImportExtras(1)).count,0);
assert.strictEqual(chosen.created(),1,'no new track when no extras are missing');

// Extra labels are inherited at insertion and restored on redo; originals retain their label.
const red=setup([[['a.png',2,6]],[]],['a_1.png']);
assert.strictEqual(red.run().ok,true);
assert.strictEqual(red.tracks[1].clips[0].label,6);
assert.strictEqual(red.items.get('a.png').getColorLabel(),3);
assert.strictEqual(red.undo().ok,true);
assert.strictEqual(red.redo().ok,true);
assert.strictEqual(red.tracks[1].clips[0].label,6);
const customRed=setup([[['a.png',2,6]],[]],['a_1.png'],{preferences:{'BE.Prefs.LabelNames.9':'Red'}});
assert.strictEqual(customRed.run().ok,true);
assert.strictEqual(customRed.tracks[1].clips[0].label,9);
const rgbRed=setup([[['a.png',2,6]],[]],['a_1.png'],{preferences:{'BE.Prefs.LabelColors.4':255,'BE.Prefs.LabelColors.6':3474060}});
assert.strictEqual(rgbRed.run().ok,true);
assert.strictEqual(rgbRed.tracks[1].clips[0].label,4);
const badLabel=setup([[['a.png',2,6]],[]],['a_1.png'],{failLabel:true});
assert.strictEqual(badLabel.run().ok,false);
assert.strictEqual(badLabel.writes(),0);
assert.strictEqual(badLabel.tracks[1].clips.length,0);

// Full stems and numeric suffix order; _10 follows _2. Originals never change.
const a=setup([[['Exact full name.png',2,12]],[]],['Exact full name_10.png','Exact full name_2.png','Exact full name_1.png','Other name_1.png']);
let r=a.run(); assert.strictEqual(r.ok,true,r.error);assert.strictEqual(r.count,3);assert.strictEqual(r.unmatched,1);
assert.deepStrictEqual(spans(a.tracks[1]),[['Exact full name_1.png',9,10],['Exact full name_2.png',10,11],['Exact full name_10.png',11,12]]);
assert.deepStrictEqual(spans(a.tracks[0]),[['Exact full name.png',2,12]]);
for(const i of a.items.values()){assert.strictEqual(i.getInPoint().seconds,2);assert.strictEqual(i.getOutPoint().seconds,7);}
assert.strictEqual(a.run().count,0,'repeat import is idempotent'); assert.strictEqual(a.writes(),3);
assert.strictEqual(a.undo().ok,true);assert.strictEqual(a.tracks[1].clips.length,0);
assert.strictEqual(a.redo().ok,true);assert.strictEqual(a.tracks[1].clips.length,3);
assert.strictEqual(a.undo().ok,true);assert.strictEqual(a.tracks[1].clips.length,0);

// Existing variants anywhere in the sequence are skipped. A standalone _1 is normal.
const b=setup([[['Topic.png',0,10],['Orphan_1.png',20,25]],[],[['Topic_1.png',1,2]]],['Topic_1.png','Topic_3.png','Orphan_1.png','Orphan_2.png']);
r=b.run();assert.strictEqual(r.count,1);assert.strictEqual(r.skipped,2);assert.strictEqual(r.unmatched,1);
assert.deepStrictEqual(spans(b.tracks[1]),[['Topic_3.png',9,10]]);

// Case insensitive matching, exact prefixes, and existing project-bin item reuse.
const c=setup([[['Case.PNG',0,10]],[]],['CASE_1.PNG','Unrelated Case_2.png']);
assert.strictEqual(c.run().count,1);assert.strictEqual(c.undo().ok,true);
const importCount=c.imports();assert.strictEqual(c.run().count,1);assert.strictEqual(c.imports(),importCount);

// Destination conflict / group conflict / negative start / duplicate originals: no imports or writes.
for(const bad of [
  setup([[['a.png',0,10]],[['occupied.png',9,11]]],['a_1.png']),
  setup([[['a.png',0,10],['b.png',8.5,10.5]],[]],['a_1.png','b_1.png']),
  setup([[['a.png',-2,0.5]],[]],['a_1.png']),
  setup([[['a.png',0,10],['a.png',20,30]],[]],['a_1.png'])
]) { assert.strictEqual(bad.run().ok,false);assert.strictEqual(bad.writes(),0);assert.strictEqual(bad.imports(),0); }
const invalid=setup([[['a.png',0,10]],[]],['a_1.png']);
assert.strictEqual(invalid.run(0,0).ok,false);assert.strictEqual(invalid.run(1,0).ok,false);
invalid.tracks[1].isLocked=()=>true;assert.strictEqual(invalid.run().ok,false);

// Occupied clips outside the intended span are preserved; import failure rolls back newly placed clips.
const fail=setup([[['a.png',0,10]],[['safe.png',30,40]]],['a_1.png','a_2.png'],{failAt:2});
r=fail.run();assert.strictEqual(r.ok,false);assert.deepStrictEqual(spans(fail.tracks[1]),[['safe.png',30,40]]);
assert.strictEqual(fail.undo().ok,false);
for(const i of fail.items.values()){assert.strictEqual(i.getInPoint().seconds,2);assert.strictEqual(i.getOutPoint().seconds,7);}

// External edits block undo. Redo refuses duplicates introduced on another track.
const guard=setup([[['a.png',0,10]],[],[]],['a_1.png']);assert.strictEqual(guard.run().ok,true);
guard.tracks[1].clips[0].end.seconds=11;assert.strictEqual(guard.undo().ok,false);
guard.tracks[1].clips[0].end.seconds=10;assert.strictEqual(guard.undo().ok,true);
guard.tracks[2].overwriteClip(guard.items.get('a_1.png'),20);assert.strictEqual(guard.redo().ok,false);

// A recreated import remaps later timing history to new TrackItem identities.
const history=setup([[['a.png',0,10]],[]],['a_1.png']);assert.strictEqual(history.run().ok,true);
history.seq.getPlayerPosition=()=>({seconds:9.5});
assert.strictEqual(JSON.parse(history.context.psnTrimAtPlayhead(1,'right')).ok,true);
assert.strictEqual(history.undo(1).ok,true);assert.strictEqual(history.undo(0).ok,true);
assert.strictEqual(history.redo(0).ok,true);assert.strictEqual(history.redo(1).ok,true);
assert.strictEqual(history.tracks[1].clips[0].end.seconds,9.5);

// Non-integer frame rates round one second to whole frames, keeping the original end exact.
const fractional=setup([[['a.png',0,10.01]],[]],['a_1.png','a_2.png'],{fps:30000/1001});
r=fractional.run();assert.strictEqual(r.ok,true,r.error);assert(Math.abs(r.duration-1.001)<1e-8);
assert(Math.abs(fractional.tracks[1].clips[1].end.seconds-10.01)<1e-8);
// Each original discovers its own folder; identical basenames in different folders stay separate.
const multi=setup([[['D:/project A/Same.png',0,10],['E:/project B/Same.png',20,30],['D:/project A/Other.png',40,50]],[],[['D:/project A/Same_1.png',60,61]]],
  ['D:/project A/Same_1.png','E:/project B/Same_1.png','E:/project B/Same_2.png','D:/project A/Other_1.png','F:/unrelated/Other_2.png']);
r=multi.run();assert.strictEqual(r.ok,true,r.error);assert.strictEqual(r.count,3);assert.strictEqual(r.skipped,1);
assert.deepStrictEqual(multi.scans,['D:/project A','E:/project B'],'scan each original folder once');
assert.deepStrictEqual(Array.from(multi.tracks[1].clips,c=>[c.projectItem.getMediaPath(),c.start.seconds,c.end.seconds]),[
  ['E:/project B/Same_1.png',28,29],['E:/project B/Same_2.png',29,30],['D:/project A/Other_1.png',49,50]
]);
const offline=setup([[['a.png',0,10]],[]],['a_1.png'],{offline:true});
assert.strictEqual(offline.run().ok,false);assert.strictEqual(offline.writes(),0);
console.log('extra subtitle import tests passed');

// Regression: PNG source marks cannot be set exactly; a long default still must
// be resized in empty tail space before being moved into a one-second gap.
const longStill=setup([[['a.png',0,10]],[['safe.png',10,12]]],['a_1.png'],{forbidSourceMarks:true,insertedDuration:1800});
r=longStill.run();assert.strictEqual(r.ok,true,r.error);
assert.deepStrictEqual(spans(longStill.tracks[1]),[['a_1.png',9,10],['safe.png',10,12]]);
assert.strictEqual(longStill.undo().ok,true);assert.deepStrictEqual(spans(longStill.tracks[1]),[['safe.png',10,12]]);
assert.strictEqual(longStill.redo().ok,true);
const shortStill=setup([[['a.png',0,10]],[]],['a_1.png'],{forbidSourceMarks:true,insertedDuration:0.2});
assert.strictEqual(shortStill.run().ok,true);assert.deepStrictEqual(spans(shortStill.tracks[1]),[['a_1.png',9,10]]);
const refusedMove=setup([[['a.png',0,10]],[['safe.png',10,12]]],['a_1.png'],{failMove:true});
r=refusedMove.run();assert.strictEqual(r.ok,false);
assert.deepStrictEqual(spans(refusedMove.tracks[1]),[['safe.png',10,12]],'failed staging/move is removed without touching neighbors');
console.log('still-image duration regressions passed');

// A source-limited extra stays short but finishes at its planned right edge.
for(const throwOnExtend of [false,true]) {
  const limited=setup([[['a.png',0,10]],[]],['a_1.png','a_2.png'],{insertedDuration:0.2,durationLimit:0.2,throwOnExtend});
  r=limited.run();assert.strictEqual(r.ok,true,r.error);assert.strictEqual(r.shortened,2);
  const rows=spans(limited.tracks[1]);
  assert(Math.abs(rows[0][1]-8.8)<1e-6);assert.strictEqual(rows[0][2],9);
  assert(Math.abs(rows[1][1]-9.8)<1e-6);assert.strictEqual(rows[1][2],10);
  assert.strictEqual(limited.undo().ok,true);assert.strictEqual(limited.tracks[1].clips.length,0);
  assert.strictEqual(limited.redo().ok,true);assert.deepStrictEqual(spans(limited.tracks[1]),rows);
}
const zero=setup([[['a.png',0,10]],[]],['a_1.png'],{insertedDuration:0.2,durationLimit:0});
assert.strictEqual(zero.run().ok,false);assert.strictEqual(zero.tracks[1].clips.length,0);
const tooLong=setup([[['a.png',0,10]],[]],['a_1.png'],{insertedDuration:5,durationLimit:5,throwOnExtend:false});
assert.strictEqual(tooLong.run().ok,true);assert.deepStrictEqual(spans(tooLong.tracks[1]),[['a_1.png',9,10]]);
console.log('short available-duration fallback tests passed');

// Short originals get extras AFTER their end, even across later original clips
// on the lower track. Exactly two seconds retains the normal end alignment.
const shortOriginal=setup([[['brief.png',4,5],['next.png',5,9]],[]],['brief_1.png','brief_2.png']);
r=shortOriginal.run();assert.strictEqual(r.ok,true,r.error);
assert.deepStrictEqual(spans(shortOriginal.tracks[1]),[['brief_1.png',5,6],['brief_2.png',6,7]]);
assert.deepStrictEqual(spans(shortOriginal.tracks[0]),[['brief.png',4,5],['next.png',5,9]]);
assert.strictEqual(shortOriginal.undo().ok,true);assert.strictEqual(shortOriginal.redo().ok,true);
const twoSeconds=setup([[['a.png',4,6]],[]],['a_1.png']);
assert.strictEqual(twoSeconds.run().ok,true);assert.deepStrictEqual(spans(twoSeconds.tracks[1]),[['a_1.png',5,6]]);
const briefLimited=setup([[['a.png',4,5]],[]],['a_1.png'],{insertedDuration:0.2,durationLimit:0.2,throwOnExtend:true});
r=briefLimited.run();assert.strictEqual(r.ok,true,r.error);
assert.strictEqual(briefLimited.tracks[1].clips[0].start.seconds,5);
assert(Math.abs(briefLimited.tracks[1].clips[0].end.seconds-5.2)<1e-6);
assert.strictEqual(briefLimited.undo().ok,true);assert.strictEqual(briefLimited.redo().ok,true);
console.log('short original alignment tests passed');

// Automatic source detection and verified track insertion, including repeat import.
const auto=setup([[['FN 3289-0514.png',0,10],['FN TEASER 3290 -0045.png',20,30]],[['unrelated.png',0,40]]],
  ['FN 3289-0514_1.png','FN TEASER 3290 -0045_1.png']);
r=auto.auto();assert.strictEqual(r.ok,true,r.error);assert.strictEqual(r.sourceIndex,0);assert.strictEqual(r.trackIndex,1);
assert.strictEqual(auto.created(),1);assert.strictEqual(auto.tracks[2].clips[0].projectItem.name,'unrelated.png');
assert.strictEqual(auto.auto().count,0,'already imported extras do not become another original track');assert.strictEqual(auto.created(),1);
auto.context.psnCreateExtraTrack(auto.seq,0);
assert.strictEqual(auto.undo().ok,true,'older import history follows its destination after track insertion');
assert.strictEqual(auto.redo().ok,true);
const split=setup([[['FN 1111-0001.png',0,10]],[['FN TEASER 9999 -0045.png',0,10]]],['FN 1111-0001_1.png']);
r=split.auto();assert.strictEqual(r.ok,false);assert(r.error.includes('one track'));assert.strictEqual(split.created(),0);assert.strictEqual(split.imports(),0);
const standalone=setup([[['FN 3289-0514_1.png',0,10]],[]],['FN 3289-0514_2.png']);
r=standalone.auto();assert.strictEqual(r.ok,true);assert.strictEqual(r.count,0);assert.strictEqual(standalone.created(),0);
const noMatch=setup([[['not FN 3289-0514.png',0,10]],[]],[]);assert.strictEqual(noMatch.auto().ok,false);assert.strictEqual(noMatch.created(),0);
const wrongTrack=setup([[['FN 3289-0514.png',0,10]],[['safe.png',0,30]]],['FN 3289-0514_1.png'],{wrongTrackPosition:true});
r=wrongTrack.auto();assert.strictEqual(r.ok,false);assert.strictEqual(wrongTrack.writes(),0);assert.strictEqual(wrongTrack.imports(),0);
assert.strictEqual(wrongTrack.tracks.length,2,'failed correction removes only newly created empty tracks');
assert.deepStrictEqual(spans(wrongTrack.tracks[0]),[['FN 3289-0514.png',0,10]]);
assert.deepStrictEqual(spans(wrongTrack.tracks[1]),[['safe.png',0,30]]);
console.log('automatic subtitle track tests passed');
