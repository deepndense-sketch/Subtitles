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
  const payload=path.join(temp,'staged');
  const files=await updater.stage(manifest.version,payload,fetchFile);
  assert.strictEqual(files.length,updater.FILES.length+1);
  await assert.rejects(updater.stage(manifest.version,path.join(temp,'bad'),async(url)=>url.endsWith('/index.html') ? Buffer.from('corrupt') : fetchFile(url)),/verification failed/);
  if(process.platform==='win32') {
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
      const result=child.spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(job,'test-worker.ps1')],{env:Object.assign({},process.env,{APPDATA:appdata,LOCALAPPDATA:local}),encoding:'utf8',timeout:15000,windowsHide:true});
      assert(!result.error,String(result.error));
      const status=JSON.parse(fs.readFileSync(path.join(job,'status.json'),'utf8'));
      assert.strictEqual(status.state,fail?'failed':'complete',status.message+' '+result.stderr);
      for(const file of files) assert.strictEqual(fs.readFileSync(path.join(target,file.path)).toString('base64'),fail ? Buffer.from('old '+file.path).toString('base64') : fs.readFileSync(path.join(payload,file.path)).toString('base64'));
    }
  }
  console.log('direct CEP staging, installation, and rollback tests passed');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>fs.rmSync(temp,{recursive:true,force:true}));
