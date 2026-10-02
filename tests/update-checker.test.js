const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const EventEmitter = require('events');
const checker = require('../lib/update-checker');
assert(checker.isNewer('1.10.0', '1.9.9'));
assert(!checker.isNewer('1.6.0', '1.6.0'));
assert(!checker.isNewer('1.5.9', '1.6.0'));
assert(!checker.isNewer('1.7.0-beta', '1.6.0'));
assert.strictEqual(checker.validate({version:'1.7.0',url:'https://untrusted.example'},'1.6.0').url,
  'https://github.com/deepndense-sketch/Subtitles/archive/refs/tags/v1.7.0.zip');
function transport(status, body) {
  return {get(url,options,callback) {
    assert(url.startsWith('https://raw.githubusercontent.com/deepndense-sketch/Subtitles/'));
    const request = new EventEmitter(); request.setTimeout=()=>{}; request.destroy=error=>request.emit('error',error);
    process.nextTick(()=>{
      const response = new EventEmitter();response.statusCode=status;response.setEncoding=()=>{};response.resume=()=>{};
      callback(response);response.emit('data',body);response.emit('end');
    });
    return request;
  }};
}
(async()=>{
  assert.strictEqual((await checker.check('1.6.0',transport(200,'{"version":"1.7.0"}'))).version,'1.7.0');
  assert.strictEqual(await checker.check('1.6.0',transport(200,'{"version":"1.5.0"}')),null);
  await assert.rejects(checker.check('1.6.0',transport(404,'')));
  await assert.rejects(checker.check('1.6.0',transport(200,'bad JSON')));
  const elements={}, intervals=[], opened=[];
  function element(id) {return elements[id]||(elements[id]={hidden:true,events:{},addEventListener(k,f){this.events[k]=f;},showModal(){this.open=true;},close(){this.open=false;}});}
  let installedVersion='1.6.0', pendingState=null;const stored={};
  const fakeUpdater={readVersion:()=>installedVersion,pending:()=>pendingState,prepare:async(root,version)=>{opened.push({root,version});pendingState={version,state:'waiting',message:'Save and close Premiere to finish installing.'};return {};}};
  const context=vm.createContext({active:true,busy:false,localStorage:{getItem:k=>stored[k],setItem:(k,v)=>stored[k]=v},document:{getElementById:element,querySelector:()=>null},
    window:{addEventListener(){},cep:{util:{openURLInDefaultBrowser:url=>opened.push(url)}}},
    setInterval:f=>intervals.push(f),clearInterval(){},require:name=>name==='path' ? path : name.endsWith('cep-updater.js') ? fakeUpdater : {isNewer:checker.isNewer,check:async()=>checker.isNewer('1.7.0',installedVersion)?{version:'1.7.0'}:null}});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/updates.js'),'utf8'),context);
  vm.runInContext('SubtitleUpdates.start("/extension")',context);
  await new Promise(resolve=>setImmediate(resolve));
  assert.strictEqual(element('updateNotice').hidden,false);
  assert(!element('updateDialog').open,'do not interrupt active subtitle editing');
  context.active=false;intervals[0]();
  assert(element('updateDialog').open,'prompt after editing is inactive');
  await element('updateDialogDownload').events.click();assert.strictEqual(opened.length,1);
  assert.strictEqual(opened[0].version,'1.7.0');
  assert(element('updateInstallSteps').textContent.includes('close Premiere'));
  element('updateLater').events.click();intervals[0]();assert(!element('updateDialog').open,'pending update must not prompt');
  vm.runInContext('SubtitleUpdates.start("/extension")',context);
  await new Promise(resolve=>setImmediate(resolve));
  assert(!element('updateDialog').open,'reopening while pending must not prompt');
  assert(element('updateDownload').disabled,'prevent duplicate update attempt');
  pendingState={version:'1.7.0',state:'failed',message:'Helper failed to start'};intervals[0]();
  assert.strictEqual(element('updateDownload').textContent,'Retry update');
  assert(!element('updateDialog').open,'failed update shows status rather than popup');
  installedVersion='1.7.0';pendingState=null;intervals[0]();
  assert.strictEqual(element('updateNotice').hidden,true,'fresh installed version clears the banner');
  console.log('update checking and prompt tests passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
