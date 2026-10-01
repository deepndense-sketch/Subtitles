const assert=require('assert');
const fs=require('fs');
const os=require('os');
const path=require('path');
const vm=require('vm');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'psn-extra-panel-'));
const pngFolder=path.join(root,'pngs');fs.mkdirSync(pngFolder);
for(const name of ['Full arbitrary name_1.png','Full arbitrary name_3.PNG','normal.png','not-a-png_2.txt']) fs.writeFileSync(path.join(pngFolder,name),'');
const elements={};
function element(id) {
  if(!elements[id]) elements[id]={options:[],value:'',events:{},textContent:'',
    set innerHTML(v){this.options=[];},appendChild(o){this.options.push(o);},addEventListener(k,f){this.events[k]=f;},setAttribute(k,v){this[k]=v;},focus(){},showModal(){this.open=true;},close(){this.open=false;}};
  return elements[id];
}
const stored={videoTrackIndex:'1'};
const ctx=vm.createContext({require,Buffer,process:{env:{LOCALAPPDATA:root}},console,setInterval,clearInterval,
  SubtitleIndex:require('../lib/subtitle-index'),
  localStorage:{getItem:k=>stored[k] || null,setItem:(k,v)=>{stored[k]=v;}},
  window:{location:{pathname:''},addEventListener(){},confirm(){return true;}},
  document:{getElementById:element,createElement:()=>({}),addEventListener(){}},__dirname:path.join(__dirname,'../js')});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/main.js'),'utf8'),ctx);
vm.runInContext(`var calls=[]; callHost=async function(script){calls.push(script); return JSON.stringify(script==='psnGetTrackInfo()' ? {ok:true,trackCount:4} : {ok:true,count:2,groups:1,skipped:3,unmatched:1,trackIndex:3,sourceIndex:2});};`,ctx);
(async()=>{
  async function importWithResponse(accept) {
    const pending=ctx.importExtras();
    await new Promise(r=>setTimeout(r,0));
    assert.strictEqual(element('extraConfirm').open,true);
    assert.strictEqual(element('extraConfirmTrack').textContent,'V3');
    assert(element('extraConfirmPlan').textContent.includes('new V4'));
    assert(element('extraConfirmPlan').textContent.includes('directly above V3'));
    element(accept ? 'extraConfirmAccept' : 'extraConfirmCancel').onclick();
    await pending;
    assert.strictEqual(element('extraConfirm').open,false);
  }
  ctx.initialize();await new Promise(r=>setTimeout(r,10));
  assert.strictEqual(element('extrasPanel').hidden,false);
  assert.strictEqual(element('sequencePanel').hidden,true);
  element('sequenceTab').events.click();
  assert.strictEqual(element('extrasPanel').hidden,true);
  assert.strictEqual(element('sequencePanel').hidden,false);
  assert.strictEqual(stored.toolTab,'sequence');
  assert.strictEqual(element('sequenceTab')['aria-selected'],'true');
  element('extrasTab').events.click();
  assert.strictEqual(element('extrasPanel').hidden,false);
  assert.strictEqual(element('trackSelect').value,'1');
  assert.deepStrictEqual(element('importTrackSelect').options.map(o=>o.value),['0','1','2','3']);
  assert.deepStrictEqual(element('extraSourceTrackSelect').options.map(o=>o.value),['0','1','2','3']);
  element('extraSourceTrackSelect').value='2';element('extraSourceTrackSelect').events.change();
  assert.strictEqual(stored.extraSourceTrackIndex,'2');
  await importWithResponse(false);
  assert.strictEqual(element('extraConfirmIssue').hidden,true);
  assert(!Array.from(ctx.calls).includes('psnImportDetectedExtras()'),'cancelling detection must not import');
  await importWithResponse(true);
  assert(Array.from(ctx.calls).includes('psnImportDetectedExtras()'),'imports the confirmed detected source');
  assert.strictEqual(element('trackSelect').value,'2','timing/undo selection follows detected source');
  assert.strictEqual(stored.videoTrackIndex,'2');
  assert.strictEqual(fs.existsSync(path.join(root,'PremiereSubtitleNavigator','extra-import-plan.txt')),false);
  assert(element('status').textContent.includes('Already in sequence: 3'));
  assert.strictEqual(element('importExtras').disabled,false);
  const detectingHost=ctx.callHost;
  ctx.callHost=async script=>script==='psnDetectExtraSource()' ? JSON.stringify({ok:false,error:'No clear track found.'}) : detectingHost(script);
  await importWithResponse(false);
  assert.strictEqual(element('extraConfirmIssue').hidden,false);
  assert.strictEqual(element('extraConfirmIssue').textContent,'No clear track found.');
  assert(!Array.from(ctx.calls).includes('psnImportExtras(2)'),'manual fallback also requires confirmation');
  await importWithResponse(true);
  assert(Array.from(ctx.calls).includes('psnImportExtras(2)'),'confirmed manual fallback remains available');
  ctx.callHost=detectingHost;
  const escapeConfirmation=ctx.confirmExtraImport(10,327);
  assert.strictEqual(element('extraConfirmTrack').textContent,'V11');
  assert(element('extraConfirmPlan').textContent.includes('new V12'));
  element('extraConfirm').oncancel({preventDefault(){}});
  assert.strictEqual(await escapeConfirmation,false);
  element('importTrackSelect').value='0';element('importTrackSelect').events.change();
  assert.strictEqual(stored.importTrackIndex,'0');
  await ctx.refreshTracks();assert.strictEqual(element('importTrackSelect').value,'0');
  vm.runInContext(`refreshIndex=()=>{pngIndex={entries:[{fileName:'FN 1234-0001.png'}]};return true;};
    callHost=async function(script){calls.push(script);return JSON.stringify({ok:true,count:1,trackIndex:0,start:0,end:1});};`,ctx);
  await ctx.importAll();
  assert(ctx.calls[ctx.calls.length-1].startsWith('psnImportAll('));
  assert(ctx.calls[ctx.calls.length-1].endsWith(',0)'),'bulk import uses its own destination');
  assert.strictEqual(element('trackSelect').value,'2','bulk destination does not change the shortcut track');
  const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
  assert(html.includes('id="extraSourceTrackSelect"'));
  const sections=html.match(/<section class="card"[^>]*>[\s\S]*?<\/section>/g);
  assert(sections[0].includes('Extra Sub') && sections[0].includes('id="importExtras"'));
  assert(!sections[0].includes('id="activate"'));
  assert(sections[1].includes('Adjust/Add Sub') && sections[1].includes('id="activate"') && sections[1].includes('id="importAll"'));
  assert(sections[1].includes('<details id="numberedImport" class="numbered-import">'),'numbered importer is collapsed by default');
  assert(html.includes('id="manualControls"'),'manual controls remain collapsed at the bottom');
  vm.runInContext('active=true; pendingCommands=["left"];',ctx);
  ctx.pollQueue();
  assert.strictEqual(vm.runInContext('active',ctx),false,'native release signal deactivates the panel even without a queue file');
  assert.strictEqual(vm.runInContext('pendingCommands.length',ctx),0);
  assert.strictEqual(element('activate').textContent,'Activate Subtitle Shortcuts');
  assert.strictEqual(element('stateBadge').textContent,'INACTIVE');
  assert(element('status').textContent.includes('another key'));
  console.log('extra subtitle panel tests passed');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>fs.rmSync(root,{recursive:true,force:true}));
