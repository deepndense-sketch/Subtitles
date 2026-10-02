const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path'),child=require('child_process');
const updater=require('../lib/cep-updater');
const root=path.join(__dirname,'..'), manifest=require('../release.json');
assert.strictEqual(updater.validateManifest(manifest,manifest.version).length,updater.FILES.length);
const bad=JSON.parse(JSON.stringify(manifest));bad.files[0].path='../escape';
assert.throws(()=>updater.validateManifest(bad,manifest.version));
const duplicate=JSON.parse(JSON.stringify(manifest));duplicate.files[1]=duplicate.files[0];
assert.throws(()=>updater.validateManifest(duplicate,manifest.version));
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'subtitle-updater-test-'));
async function fetchFile(url) {
  const base='https://raw.githubusercontent.com/deepndense-sketch/Subtitles/v'+manifest.version+'/';
  assert(url.startsWith(base));return fs.readFileSync(path.join(root,url.substring(base.length)));
}
(async()=>{
  const EventEmitter=require('events');
  const readyJob=path.join(temp,'launch-ready');fs.mkdirSync(readyJob);
  await updater.launch(readyJob,()=>{
    const worker=new EventEmitter();worker.unref=()=>{};
    process.nextTick(()=>fs.writeFileSync(path.join(readyJob,'status.json'),JSON.stringify({state:'waiting'})));
    return worker; // No 'spawn' event: success requires the helper's acknowledgement.
  },1000);
  const failedJob=path.join(temp,'launch-failed');fs.mkdirSync(failedJob);
  await assert.rejects(updater.launch(failedJob,()=>{
    const worker=new EventEmitter();process.nextTick(()=>worker.emit('exit',1));return worker;
  },1000),/exited before/);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(failedJob,'status.json'),'utf8')).state,'failed');
  const timeoutJob=path.join(temp,'launch-timeout');fs.mkdirSync(timeoutJob);
  await assert.rejects(updater.launch(timeoutJob,()=>new EventEmitter(),30),/confirm startup/);
  assert(fs.existsSync(path.join(timeoutJob,'cancel')));
  const savedLocal=process.env.LOCALAPPDATA;process.env.LOCALAPPDATA=path.join(temp,'state-test');
  try {
    const dir=path.join(process.env.LOCALAPPDATA,'PremiereSubtitleNavigator/updates'),job=path.join(dir,'update-test'),target=path.join(temp,'installed');
    fs.mkdirSync(job,{recursive:true});fs.mkdirSync(target);
    fs.writeFileSync(path.join(target,'package.json'),JSON.stringify({version:'1.0.0'}));
    fs.writeFileSync(path.join(dir,'pending.json'),JSON.stringify({job,target,version:'2.0.0',started:Date.now()}));
    fs.writeFileSync(path.join(job,'status.json'),JSON.stringify({state:'waiting',message:'Close Premiere',pid:process.pid}));
    assert.strictEqual(updater.pending(target).state,'waiting');
    fs.writeFileSync(path.join(job,'status.json'),JSON.stringify({state:'waiting',pid:99999999}));
    assert.strictEqual(updater.pending(target).state,'failed');
    fs.writeFileSync(path.join(target,'package.json'),JSON.stringify({version:'2.0.0'}));
    assert.strictEqual(updater.pending(target),null);
  } finally {process.env.LOCALAPPDATA=savedLocal;}
  const payload=path.join(temp,'staged');
  const files=await updater.stage(manifest.version,payload,fetchFile);
  assert.strictEqual(files.length,updater.FILES.length+1);
  await assert.rejects(updater.stage(manifest.version,path.join(temp,'bad'),async(url)=>url.endsWith('/index.html') ? Buffer.from('corrupt') : fetchFile(url)),/verification failed/);
  if(process.platform==='win32') {
    const independent=path.join(temp,"independent helper's job");fs.mkdirSync(independent);
    fs.writeFileSync(path.join(independent,'install-update.ps1'),"[IO.File]::WriteAllText((Join-Path $PSScriptRoot 'status.json'), '{\"state\":\"waiting\"}'); Start-Sleep -Seconds 2; [IO.File]::WriteAllText((Join-Path $PSScriptRoot 'survived.txt'), 'yes')");
    child.execFileSync(process.execPath,['-e','require('+JSON.stringify(path.join(root,'lib/cep-updater.js'))+').launch('+JSON.stringify(independent)+').catch(e=>{console.error(e);process.exitCode=1})'],{timeout:10000,windowsHide:true});
    const survivalDeadline=Date.now()+5000;
    while(!fs.existsSync(path.join(independent,'survived.txt')) && Date.now()<survivalDeadline) await new Promise(resolve=>setTimeout(resolve,100));
    assert(fs.existsSync(path.join(independent,'survived.txt')),'installer must survive CEP/Node parent exit');
    for(const fail of [false,true]) {
      const job=path.join(temp,fail?'rollback':'success'),appdata=path.join(job,'roaming'),local=path.join(job,'local');
      const target=path.join(appdata,'Adobe/CEP/extensions/Subtitle');
      fs.mkdirSync(target,{recursive:true});fs.mkdirSync(path.join(local,'PremiereSubtitleNavigator'),{recursive:true});
      for(const file of files) {
        const dest=path.join(job,'payload',file.path);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(path.join(payload,file.path),dest);
        const current=path.join(target,file.path);fs.mkdirSync(path.dirname(current),{recursive:true});fs.writeFileSync(current,'old '+file.path);
      }
      fs.writeFileSync(path.join(job,'plan.json'),JSON.stringify({version:manifest.version,target,files}));
      fs.copyFileSync(path.join(root,'native/install-update.ps1'),path.join(job,'install-update.ps1'));
      const wrapper="function Get-Process {}\n"+(fail ? "function Copy-Item { param($LiteralPath,$Destination,[switch]$Force) if($LiteralPath -like '*payload*' -and $Destination -like '*js\\main.js') {throw 'Simulated copy failure'} Microsoft.PowerShell.Management\\Copy-Item @PSBoundParameters }\n" : '')+"& (Join-Path $PSScriptRoot 'install-update.ps1')\n";
      fs.writeFileSync(path.join(job,'test-worker.ps1'),wrapper);
      const launched=updater.launch(job,(exe,args,options)=>child.spawn(exe,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(job,'test-worker.ps1')],Object.assign({},options,{env:Object.assign({},options.env,{APPDATA:appdata,LOCALAPPDATA:local})})),15000);
      // The worker acknowledges readiness before installation, then exits with
      // either completion or rollback; poll its durable result below.
      await launched.catch(error=>{if(!fail) throw error;});
      const deadline=Date.now()+10000;
      while(Date.now()<deadline) {
        const state=JSON.parse(fs.readFileSync(path.join(job,'status.json'),'utf8')).state;
        if(state==='complete'||state==='failed') break;
        await new Promise(resolve=>setTimeout(resolve,100));
      }
      const status=JSON.parse(fs.readFileSync(path.join(job,'status.json'),'utf8'));
      assert.strictEqual(status.state,fail?'failed':'complete',status.message);
      for(const file of files) assert.strictEqual(fs.readFileSync(path.join(target,file.path)).toString('base64'),fail ? Buffer.from('old '+file.path).toString('base64') : fs.readFileSync(path.join(payload,file.path)).toString('base64'));
    }
  }
  console.log('direct CEP staging, installation, and rollback tests passed');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>fs.rmSync(temp,{recursive:true,force:true}));
