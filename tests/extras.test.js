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
          const newStart=this.start.seconds+offset.seconds,newEnd=options.moveUsesSourceDuration ? newStart+this.outPoint.seconds-this.inPoint.seconds : this.end.seconds+offset.seconds;
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
function spans(track) { return Array.from(track.clips,c=>[c.projectItem.name,+c.start.seconds.toFixed(6),+c.end.seconds.toFixed(6)]).sort((a,b)=>a[1]-b[1]); }

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
assert.strictEqual(detection.totalPngClips,5,'total includes PNGs outside the detector score');
assert.strictEqual(detect.created(),0,'detection cannot modify the timeline');
assert.strictEqual(detect.imports(),0);
let detectedImport=JSON.parse(detect.context.psnImportDetectedExtras());
assert.strictEqual(detectedImport.ok,true,detectedImport.error);
assert.strictEqual(detectedImport.count,1,'unrelated logo on the detected track is not imported');
assert.deepStrictEqual(spans(detect.tracks[2]),[['My show 701_1.png',10.48,12]]);
const repeatedTotal=setup([[['Main 001.png',0,3],['Main 001.png',3,6],['Main 002.png',6,9],['Other 001.png',9,12],['Other 002.png',12,15],['Other 003.png',15,18],['blank.png',18,21],['video.mov',21,24]]],[]);
const totalResult=JSON.parse(repeatedTotal.context.psnDetectExtraSource());
assert.strictEqual(totalResult.count,3);
assert.strictEqual(totalResult.totalPngClips,7,'count all PNG instances, including repeated and unnumbered clips, excluding video');
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
  assert.deepStrictEqual(spans(v14.tracks[14]),[['FN 3289-0514_1.png',5,8]]);
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
assert.deepStrictEqual(spans(chosen.tracks[2]),[['Custom subtitle_1.png',5,7]]);
assert.strictEqual(chosen.undo(1).ok,true);
assert.strictEqual(chosen.redo(1).ok,true);
assert.strictEqual(JSON.parse(chosen.context.psnImportExtras(1)).count,0);
assert.strictEqual(chosen.created(),1,'no new track when no extras are missing');

// Extra labels are inherited at insertion and restored on redo; originals retain their label.
const red=setup([[['a.png',2,6]],[]],['a_1.png']);
assert.strictEqual(red.run().ok,true);
assert.strictEqual(red.tracks[1].clips[0].label,9);
assert.strictEqual(red.items.get('a.png').getColorLabel(),3);
assert.strictEqual(red.undo().ok,true);
assert.strictEqual(red.redo().ok,true);
assert.strictEqual(red.tracks[1].clips[0].label,9);
const customRed=setup([[['a.png',2,3]],[]],['a_1.png'],{preferences:{'BE.Prefs.LabelNames.9':'Red'}});
assert.strictEqual(customRed.run().ok,true);
assert.strictEqual(customRed.tracks[1].clips[0].label,9);
const rgbRed=setup([[['a.png',2,3]],[]],['a_1.png'],{preferences:{'BE.Prefs.LabelColors.4':255,'BE.Prefs.LabelColors.6':3474060}});
assert.strictEqual(rgbRed.run().ok,true);
assert.strictEqual(rgbRed.tracks[1].clips[0].label,4);
const badLabel=setup([[['a.png',2,6]],[]],['a_1.png'],{failLabel:true});
assert.strictEqual(badLabel.run().ok,false);
assert.strictEqual(badLabel.writes(),0);
assert.strictEqual(badLabel.tracks[1].clips.length,0);

// Full stems and numeric suffix order; _10 follows _2. Originals never change.
const a=setup([[['Exact full name.png',2,12]],[]],['Exact full name_10.png','Exact full name_2.png','Exact full name_1.png','Other name_1.png']);
let r=a.run(); assert.strictEqual(r.ok,true,r.error);assert.strictEqual(r.count,3);assert.strictEqual(r.unmatched,1);
assert.deepStrictEqual(spans(a.tracks[1]),[['Exact full name_1.png',4.48,7],['Exact full name_2.png',7,9.48],['Exact full name_10.png',9.48,12]]);
assert.deepStrictEqual(spans(a.tracks[0]),[['Exact full name.png',2,12]]);
for(const i of a.items.values()){assert.strictEqual(i.getInPoint().seconds,2);assert.strictEqual(i.getOutPoint().seconds,7);}
assert.strictEqual(a.run().count,0,'repeat import is idempotent'); assert.strictEqual(a.writes(),3);
assert.strictEqual(a.undo().ok,true);assert.strictEqual(a.tracks[1].clips.length,0);
assert.strictEqual(a.redo().ok,true);assert.strictEqual(a.tracks[1].clips.length,3);
assert.strictEqual(a.undo().ok,true);assert.strictEqual(a.tracks[1].clips.length,0);

// Existing variants anywhere in the sequence are skipped. A standalone _1 is normal.
const b=setup([[['Topic.png',0,10],['Orphan_1.png',20,25]],[],[['Topic_1.png',1,2]]],['Topic_1.png','Topic_3.png','Orphan_1.png','Orphan_2.png']);
r=b.run();assert.strictEqual(r.count,1);assert.strictEqual(r.skipped,2);assert.strictEqual(r.unmatched,1);
assert.deepStrictEqual(spans(b.tracks[1]),[['Topic_3.png',1.48,2]]);

// Case insensitive matching, exact prefixes, and existing project-bin item reuse.
const c=setup([[['Case.PNG',0,10]],[]],['CASE_1.PNG','Unrelated Case_2.png']);
assert.strictEqual(c.run().count,1);assert.strictEqual(c.undo().ok,true);
const importCount=c.imports();assert.strictEqual(c.run().count,1);assert.strictEqual(c.imports(),importCount);

// Destination conflict / group conflict / negative start: no imports or writes.
for(const bad of [
  setup([[['a.png',0,10]],[['occupied.png',9,11]]],['a_1.png']),
  setup([[['a.png',0,10],['b.png',8.5,10.5]],[]],['a_1.png','b_1.png']),
  setup([[['a.png',-2,0.5]],[]],['a_1.png'])
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
guard.tracks[2].overwriteClip(guard.items.get('a_1.png'),5);assert.strictEqual(guard.redo().ok,false);

// A recreated import remaps later timing history to new TrackItem identities.
const history=setup([[['a.png',0,10]],[]],['a_1.png']);assert.strictEqual(history.run().ok,true);
history.seq.getPlayerPosition=()=>({seconds:9.5});
assert.strictEqual(JSON.parse(history.context.psnTrimAtPlayhead(1,'right')).ok,true);
assert.strictEqual(history.undo(1).ok,true);assert.strictEqual(history.undo(0).ok,true);
assert.strictEqual(history.redo(0).ok,true);assert.strictEqual(history.redo(1).ok,true);
assert.strictEqual(history.tracks[1].clips[0].end.seconds,9.5);

// Equal portions use whole frames at fractional frame rates; the final end stays exact.
const fractional=setup([[['a.png',0,10.01]],[]],['a_1.png','a_2.png'],{fps:30000/1001});
r=fractional.run();assert.strictEqual(r.ok,true,r.error);assert(Math.abs((fractional.tracks[1].clips[0].end.seconds-fractional.tracks[1].clips[0].start.seconds)-100*1001/30000)<1e-8);
assert(Math.abs(fractional.tracks[1].clips[1].end.seconds-10.01)<1e-8);
// Each original discovers its own folder; identical basenames in different folders stay separate.
const multi=setup([[['D:/project A/Same.png',0,10],['E:/project B/Same.png',20,30],['D:/project A/Other.png',40,50]],[],[['D:/project A/Same_1.png',60,61]]],
  ['D:/project A/Same_1.png','E:/project B/Same_1.png','E:/project B/Same_2.png','D:/project A/Other_1.png','F:/unrelated/Other_2.png']);
r=multi.run();assert.strictEqual(r.ok,true,r.error);assert.strictEqual(r.count,4);assert.strictEqual(r.skipped,0);
assert.deepStrictEqual(multi.scans,['D:/project A','E:/project B'],'scan each original folder once');
assert.deepStrictEqual(Array.from(multi.tracks[1].clips,c=>[c.projectItem.getMediaPath(),c.start.seconds,c.end.seconds]),[
  ['D:/project A/Same_1.png',5,10],['E:/project B/Same_1.png',23.32,26.68],['E:/project B/Same_2.png',26.68,30],['D:/project A/Other_1.png',45,50]
]);
const offline=setup([[['a.png',0,10]],[]],['a_1.png'],{offline:true});
assert.strictEqual(offline.run().ok,false);assert.strictEqual(offline.writes(),0);
console.log('extra subtitle import tests passed');

// Regression: PNG source marks cannot be set exactly; a long default still must
// be resized in empty tail space before being moved into a one-second gap.
const longStill=setup([[['a.png',0,10]],[['safe.png',10,12]]],['a_1.png'],{forbidSourceMarks:true,insertedDuration:1800});
r=longStill.run();assert.strictEqual(r.ok,true,r.error);
assert.deepStrictEqual(spans(longStill.tracks[1]),[['a_1.png',5,10],['safe.png',10,12]]);
assert.strictEqual(longStill.undo().ok,true);assert.deepStrictEqual(spans(longStill.tracks[1]),[['safe.png',10,12]]);
assert.strictEqual(longStill.redo().ok,true);
const shortStill=setup([[['a.png',0,10]],[]],['a_1.png'],{forbidSourceMarks:true,insertedDuration:0.2});
assert.strictEqual(shortStill.run().ok,true);assert.deepStrictEqual(spans(shortStill.tracks[1]),[['a_1.png',5,10]]);
const refusedMove=setup([[['a.png',0,10]],[['safe.png',10,12]]],['a_1.png'],{failMove:true});
r=refusedMove.run();assert.strictEqual(r.ok,false);
assert.deepStrictEqual(spans(refusedMove.tracks[1]),[['safe.png',10,12]],'failed staging/move is removed without touching neighbors');
console.log('still-image duration regressions passed');

// A source-limited extra stays short but finishes at its planned right edge.
for(const throwOnExtend of [false,true]) {
  const limited=setup([[['a.png',0,10]],[]],['a_1.png','a_2.png'],{insertedDuration:0.2,durationLimit:0.2,throwOnExtend});
  r=limited.run();assert.strictEqual(r.ok,true,r.error);assert.strictEqual(r.shortened,2);
  const rows=spans(limited.tracks[1]);
  assert(Math.abs(rows[0][1]-6.48)<1e-6);assert.strictEqual(rows[0][2],6.68);
  assert(Math.abs(rows[1][1]-9.8)<1e-6);assert.strictEqual(rows[1][2],10);
  assert.strictEqual(limited.undo().ok,true);assert.strictEqual(limited.tracks[1].clips.length,0);
  assert.strictEqual(limited.redo().ok,true);assert.deepStrictEqual(spans(limited.tracks[1]),rows);
}
const zero=setup([[['a.png',0,10]],[]],['a_1.png'],{insertedDuration:0.2,durationLimit:0});
assert.strictEqual(zero.run().ok,false);assert.strictEqual(zero.tracks[1].clips.length,0);
const tooLong=setup([[['a.png',0,10]],[]],['a_1.png'],{insertedDuration:5,durationLimit:5,throwOnExtend:false});
assert.strictEqual(tooLong.run().ok,true);assert.deepStrictEqual(spans(tooLong.tracks[1]),[['a_1.png',5,10]]);
console.log('short available-duration fallback tests passed');

// Short originals get extras AFTER their end, even across later original clips
// on the lower track. Exactly two seconds retains the normal end alignment.
const shortOriginal=setup([[['brief.png',4,5],['next.png',5,9]],[]],['brief_1.png','brief_2.png']);
r=shortOriginal.run();assert.strictEqual(r.ok,true,r.error);
assert.deepStrictEqual(spans(shortOriginal.tracks[1]),[['brief_1.png',4.32,4.68],['brief_2.png',4.68,5]]);
assert.deepStrictEqual(spans(shortOriginal.tracks[0]),[['brief.png',4,5],['next.png',5,9]]);
assert.strictEqual(shortOriginal.undo().ok,true);assert.strictEqual(shortOriginal.redo().ok,true);
const twoSeconds=setup([[['a.png',4,6]],[]],['a_1.png']);
assert.strictEqual(twoSeconds.run().ok,true);assert.deepStrictEqual(spans(twoSeconds.tracks[1]),[['a_1.png',5,6]]);
const briefLimited=setup([[['a.png',4,5]],[]],['a_1.png'],{insertedDuration:0.2,durationLimit:0.2,throwOnExtend:true});
r=briefLimited.run();assert.strictEqual(r.ok,true,r.error);
assert(Math.abs(briefLimited.tracks[1].clips[0].start.seconds-4.8)<1e-6);
assert(Math.abs(briefLimited.tracks[1].clips[0].end.seconds-5)<1e-6);
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

// Local sync reads all selected PNGs and sequence-wide usage without edits.
const syncSources=JSON.parse(detect.context.psnLocalSyncSources(1));
assert.strictEqual(syncSources.ok,true);
assert.strictEqual(syncSources.total,5);
assert.strictEqual(syncSources.paths.length,5);
assert(syncSources.sequencePaths.length>syncSources.paths.length);
assert.strictEqual(JSON.parse(detect.context.psnLocalSyncSources(100)).ok,false);

const preferred=setup([[['A 001.png',0,3],['A 002.png',3,6],['A 003.png',6,9]], [['B 001.png',0,3],['B 001.png',3,6],['B 009.png',6,9],['B 003.png',9,12]]],[]);
const selectedResult=JSON.parse(preferred.context.psnDetectExtraSource(1));
assert.strictEqual(selectedResult.sourceIndex,1,'explicit selection wins over another ordered track');
assert.strictEqual(selectedResult.totalPngClips,4);
assert.strictEqual(JSON.parse(preferred.context.psnImportDetectedExtras()).ok,true);
assert.strictEqual(JSON.parse(preferred.context.psnDetectExtraSource(20)).ok,false,'invalid choice cannot silently select another track');

const preview=setup([[['base.png',2,8]],[]],['base_1.png']);
let found=JSON.parse(preview.context.psnPrepareExtras(0));
assert.strictEqual(found.count,1);assert.strictEqual(found.green,1);assert.strictEqual(found.red,0);
assert.strictEqual(preview.created(),0);assert.strictEqual(preview.writes(),0);assert.strictEqual(preview.imports(),0);
assert.strictEqual(JSON.parse(preview.context.psnImportDetectedExtras()).count,1);
const overflow=setup([[['base.png',2,3]],[]],['base_1.png']);
found=JSON.parse(overflow.context.psnPrepareExtras(0));assert.strictEqual(found.red,1);
assert.strictEqual(JSON.parse(overflow.context.psnImportDetectedExtras()).count,1);
assert.strictEqual(overflow.tracks[1].clips[0].label,6);
const noExtras=setup([[['base.png',2,8]],[]],[]);
assert.strictEqual(JSON.parse(noExtras.context.psnPrepareExtras(0)).count,0);
assert.strictEqual(noExtras.created(),0);
const changedPreview=setup([[['base.png',2,8]],[]],['base_1.png']);
assert.strictEqual(JSON.parse(changedPreview.context.psnPrepareExtras(0)).count,1);
changedPreview.context.psnFindExtraPaths=()=>[];
assert.strictEqual(JSON.parse(changedPreview.context.psnImportDetectedExtras()).ok,false);
assert.strictEqual(changedPreview.created(),0);

// Reused originals anchor each extra once at the last occurrence, regardless of collection order.
const reused=setup([[['a.png',20,30],['a.png',0,10]],[]],['a_1.png','a_2.png']);
const reuseBefore=spans(reused.tracks[0]);
let reusePreview=JSON.parse(reused.context.psnPrepareExtras(0));
assert.strictEqual(reusePreview.repeatedGroups,1);assert.strictEqual(reusePreview.count,4);assert.strictEqual(reused.writes(),0);
let reuseImport=JSON.parse(reused.context.psnImportDetectedExtras());
assert.strictEqual(reuseImport.ok,true,reuseImport.error);
assert.deepStrictEqual(spans(reused.tracks[1]),[['a_1.png',3.32,6.68],['a_2.png',6.68,10],['a_1.png',23.32,26.68],['a_2.png',26.68,30]]);
assert.deepStrictEqual(spans(reused.tracks[0]),[['a.png',0,10],['a.png',20,30]]);
assert.strictEqual(reused.run().count,0,'repeated import does not duplicate extras');
assert.strictEqual(reused.undo().ok,true);assert.strictEqual(reused.redo().ok,true);
assert.deepStrictEqual(spans(reused.tracks[1]),[['a_1.png',3.32,6.68],['a_2.png',6.68,10],['a_1.png',23.32,26.68],['a_2.png',26.68,30]]);
// Short touching pieces form a long parent; extras end with its combined tail.
const splitParent=setup([[['a.png',2,3],['a.png',3,4],['a.png',4,5]],[]],['a_1.png']);
assert.strictEqual(splitParent.run().ok,true);
assert.deepStrictEqual(spans(splitParent.tracks[1]),[['a_1.png',3.48,5]]);
assert.strictEqual(splitParent.tracks[1].clips[0].label,9);
// A separate short final occurrence uses half its duration, end-aligned.
const shortRepeat=setup([[['a.png',0,10],['a.png',20,21]],[]],['a_1.png']);
assert.strictEqual(shortRepeat.run().ok,true);
assert.deepStrictEqual(spans(shortRepeat.tracks[1]),[['a_1.png',5,10],['a_1.png',20.48,21]]);
assert.strictEqual(shortRepeat.tracks[1].clips[1].label,6);

// Premiere source and timeline ranges are independent. A still must be trimmed
// at BOTH layers before moving it from staging; otherwise its original 5s
// source range can be re-used when Premiere rebuilds the clip during a move.
const sourceExtent=setup([[['duration.png',0,10]],[]],['duration_1.png','duration_2.png'],{moveUsesSourceDuration:true});
const extentResult=sourceExtent.run();
assert.strictEqual(extentResult.ok,true,extentResult.error);
assert.deepStrictEqual(spans(sourceExtent.tracks[1]),[['duration_1.png',3.32,6.68],['duration_2.png',6.68,10]]);
for (const c of sourceExtent.tracks[1].clips) {
  assert(Math.abs(c.outPoint.seconds-c.inPoint.seconds-(c.end.seconds-c.start.seconds))<1e-6);
}
assert.strictEqual(sourceExtent.undo().ok,true);
assert.strictEqual(sourceExtent.redo().ok,true);
assert.deepStrictEqual(spans(sourceExtent.tracks[1]),[['duration_1.png',3.32,6.68],['duration_2.png',6.68,10]]);
console.log('extra source/timeline duration consistency passed');

// Adjacent short parents no longer create overlapping after-parent groups.
const adjacent=setup([[['a.png',0,1],['b.png',1,2]],[]],['a_1.png','b_1.png']);
assert.strictEqual(adjacent.run().ok,true);
assert.deepStrictEqual(spans(adjacent.tracks[1]),[['a_1.png',0.48,1],['b_1.png',1.48,2]]);
assert(adjacent.tracks[1].clips.every(c=>c.label===6));
// Threshold: 24 frames is red; exactly 25 frames is green at 25fps.
for(const [end,label] of [[1.92,6],[2,9],[2.08,9]]) {
 const sample=setup([[['a.png',0,end]],[]],['a_1.png']);
 const preview=JSON.parse(sample.context.psnPrepareExtras(0));
 assert.strictEqual(preview.green,label===9?1:0);
 assert.strictEqual(sample.run().ok,true);
 assert.strictEqual(sample.tracks[1].clips[0].label,label);
 assert.strictEqual(+sample.tracks[1].clips[0].end.seconds.toFixed(6),end);
}
const thirds=setup([[['a.png',0,6]],[]],['a_1.png','a_2.png']);
assert.strictEqual(thirds.run().ok,true);
assert.deepStrictEqual(spans(thirds.tracks[1]),[['a_1.png',2,4],['a_2.png',4,6]]);
const limitedColor=setup([[['a.png',0,6]],[]],['a_1.png'],{durationLimit:0.2,insertedDuration:0.2});
assert.strictEqual(limitedColor.run().ok,true);
assert.strictEqual(limitedColor.tracks[1].clips[0].label,6);
assert.strictEqual(limitedColor.undo().ok,true);
assert.strictEqual(limitedColor.redo().ok,true);
assert.strictEqual(limitedColor.tracks[1].clips[0].label,6);

// Already imported higher suffixes must reserve their slots: _1 is never last.
const partial=setup([[['base.png',0,8]],[],[['base_2.png',4,6],['base_3.png',6,8]]],['base_3.png','base_1.png','base_2.png']);
assert.strictEqual(partial.run().ok,false);
assert.deepStrictEqual(spans(partial.tracks[1]),[]);
assert.deepStrictEqual(spans(partial.tracks[2]),[['base_2.png',4,6],['base_3.png',6,8]]);
const numeric=setup([[['base.png',0,8]],[]],['base_3.png','base_1.png','base_2.png']);
assert.strictEqual(numeric.run().ok,true);
assert.deepStrictEqual(spans(numeric.tracks[1]),[['base_1.png',2,4],['base_2.png',4,6],['base_3.png',6,8]]);

// Incremental additions split only the last existing extra, including when it
// sits on the destination track or is absent from the current disk listing.
for(const sameTrack of [false]) {
 const seq=setup([[['base.png',0,4]],[['base_1.png',4,8]],[]],['base_2.png','base_3.png','base_4.png']);
 const result=seq.run(0,sameTrack?1:2);assert.strictEqual(result.ok,true,result.error);
 assert.deepStrictEqual(spans(seq.tracks[0]),[['base.png',0,4]]);
 assert.deepStrictEqual(spans(seq.tracks[1]).filter(c=>c[0]==='base_1.png'),[['base_1.png',4,8]]);
 assert.deepStrictEqual(spans(seq.tracks[sameTrack?1:2]).filter(c=>c[0]!=='base_1.png'),[['base_2.png',5,6],['base_3.png',6,7],['base_4.png',7,8]]);
 assert.strictEqual(seq.undo().ok,true);
 assert.deepStrictEqual(spans(seq.tracks[1]),[['base_1.png',4,8]]);
 assert.strictEqual(seq.redo().ok,true);
}
const failure=setup([[['base.png',0,4]],[['base_1.png',4,8]]],['base_2.png','base_3.png'],{failAt:2});
assert.strictEqual(failure.run().ok,false);
assert.deepStrictEqual(spans(failure.tracks[1]),[['base_1.png',4,8]]);
const freshFailure=setup([[['base.png',0,8]],[]],['base_1.png','base_2.png'],{failAt:2});
assert.strictEqual(freshFailure.run().ok,false);
assert.deepStrictEqual(spans(freshFailure.tracks[0]),[['base.png',0,8]]);
const staleExtra=setup([[['base.png',0,4]],[['base_1.png',4,8]]],['base_2.png']);
assert.strictEqual(JSON.parse(staleExtra.context.psnPrepareExtras(0)).ok,true);
staleExtra.tracks[1].clips[0].end.seconds=7;
assert.strictEqual(JSON.parse(staleExtra.context.psnImportDetectedExtras()).ok,false);
assert.strictEqual(staleExtra.writes(),0);
const externalEdit=setup([[['base.png',0,4]],[['base_1.png',4,8]],[]],['base_2.png']);
assert.strictEqual(externalEdit.run(0,2).ok,true);
externalEdit.tracks[1].clips[0].end.seconds=5;
assert.strictEqual(externalEdit.undo().ok,true);
assert.strictEqual(externalEdit.tracks[2].clips.length,0);
assert.strictEqual(externalEdit.tracks[1].clips[0].end.seconds,5);
console.log('incremental extra split, rollback and stale-preview tests passed');

const stages=setup([[['base.png',0,8]],[]],['base_1.png','base_2.png']);
stages.context.psnFindExtraPaths=()=>['C:/subs/base_1.png'];
assert.strictEqual(stages.auto().ok,false); // Generic name needs the explicit selected track.
assert.strictEqual(JSON.parse(stages.context.psnImportExtras(0)).ok,true);
stages.context.psnFindExtraPaths=()=>['C:/subs/base_1.png','C:/subs/base_2.png'];
assert.strictEqual(JSON.parse(stages.context.psnImportExtras(0)).ok,true);
assert.deepStrictEqual(spans(stages.tracks[0]),[['base.png',0,8]]);
assert.deepStrictEqual(spans(stages.tracks[2]),[['base_1.png',4,8]]);
assert.deepStrictEqual(spans(stages.tracks[1]),[['base_2.png',6,8]]);
assert.strictEqual(stages.undo().ok,true);
assert.strictEqual(stages.undo().ok,true);
assert.deepStrictEqual(spans(stages.tracks[0]),[['base.png',0,8]]);
assert.strictEqual(stages.redo().ok,true);
const secondRedo=stages.redo();assert.strictEqual(secondRedo.ok,true,secondRedo.error);
assert.deepStrictEqual(spans(stages.tracks[2]),[['base_1.png',4,8]]);

// Existing clips are not written at all, even temporarily, during import/undo/redo.
const untouched=setup([[['base.png',0,8]],[['base_1.png',4,8]],[]],['base_2.png','base_3.png']);
for(const track of untouched.tracks.slice(0,2)) for(const clip of track.clips) {
 for(const field of ['start','end','inPoint','outPoint']) {
  const value=Object.freeze(clip[field]);
  Object.defineProperty(clip,field,{get:()=>value,set:()=>{throw Error('Existing clip must not be edited');}});
 }
}
assert.strictEqual(untouched.run(0,2).ok,true);
assert.strictEqual(untouched.undo().ok,true);
assert.strictEqual(untouched.redo().ok,true);
assert.deepStrictEqual(spans(untouched.tracks[0]),[['base.png',0,8]]);
assert.deepStrictEqual(spans(untouched.tracks[1]),[['base_1.png',4,8]]);
const occupiedParent=setup([[['base.png',0,4]],[['base_1.png',4,8]]],['base_2.png']);
assert.strictEqual(occupiedParent.run().ok,false,'existing destination clip must not be trimmed to make space');
assert.strictEqual(occupiedParent.writes(),0);

// Touching cuts share one span; an intervening subtitle starts another occurrence.
const occurrences=setup([[['main.png',0,2],['main.png',2,6],['other.png',6,10],['main.png',10,13],['main.png',13,16]],[]],['main_2.png','main_1.png']);
const originalSpans=spans(occurrences.tracks[0]);
assert.strictEqual(occurrences.run().count,4);
assert.deepStrictEqual(spans(occurrences.tracks[1]),[['main_1.png',2,4],['main_2.png',4,6],['main_1.png',12,14],['main_2.png',14,16]]);
assert.deepStrictEqual(spans(occurrences.tracks[0]),originalSpans);
assert.strictEqual(occurrences.run().count,0);
assert.strictEqual(occurrences.undo().ok,true);
assert.strictEqual(occurrences.redo().ok,true);
assert.deepStrictEqual(spans(occurrences.tracks[0]),originalSpans);
// An existing extra belongs only to its location. A later location imports the
// full group while the first location uses its existing _1 as timing reference.
const localExtras=setup([[['main.png',0,8],['other.png',8,10],['main.png',10,18]],[],[['main_1.png',4,8]]],['main_1.png','main_2.png']);
assert.strictEqual(localExtras.run().count,3);
assert.deepStrictEqual(spans(localExtras.tracks[1]),[['main_2.png',6,8],['main_1.png',12.68,15.32],['main_2.png',15.32,18]]);
assert.strictEqual(localExtras.run().count,0);
assert.strictEqual(localExtras.undo().ok,true);
assert.strictEqual(localExtras.redo().ok,true,'same media at another occurrence must not block redo');
// A cut existing extra is also merged before calculating the next extra slot.
const cutExtra=setup([[['main.png',0,8]],[],[['main_1.png',4,6],['main_1.png',6,8]]],['main_1.png','main_2.png']);
assert.strictEqual(cutExtra.run().count,1);
assert.deepStrictEqual(spans(cutExtra.tracks[1]),[['main_2.png',6,8]]);
// A positive gap separates occurrences even without another subtitle.
const gap=setup([[['main.png',0,4],['main.png',5,9]],[]],['main_1.png']);
assert.strictEqual(gap.run().count,2);
assert.deepStrictEqual(spans(gap.tracks[1]),[['main_1.png',2,4],['main_1.png',7,9]]);
// Failure at a later occurrence removes this batch, without cutting the originals.
const failedOccurrences=setup([[['main.png',0,4],['main.png',6,10]],[]],['main_1.png'],{failAt:2});
assert.strictEqual(failedOccurrences.run().ok,false);
assert.deepStrictEqual(spans(failedOccurrences.tracks[0]),[['main.png',0,4],['main.png',6,10]]);
assert.strictEqual(failedOccurrences.tracks[1].clips.length,0);
console.log('continuous and separate occurrence regression tests passed');
