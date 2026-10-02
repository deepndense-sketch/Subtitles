const fs=require('fs'),path=require('path'),updater=require('../lib/cep-updater');
const root=path.join(__dirname,'..'),version=require('../package.json').version;
const files=updater.FILES.map(file=>{const data=fs.readFileSync(path.join(root,file));return {path:file,size:data.length,sha256:updater.hash(data)};});
fs.writeFileSync(path.join(root,'release.json'),JSON.stringify({version,repository:'https://github.com/deepndense-sketch/Subtitles',files},null,2)+'\n');
console.log('Built verified update manifest for '+version);
