const assert=require('assert'), fs=require('fs'), path=require('path');
const root=path.join(__dirname,'..'), version=require('../package.json').version;
assert.strictEqual(require('../release.json').version,version);
for(const file of require('../release.json').files || []) {
  const data=fs.readFileSync(path.join(root,file.path));
  assert.strictEqual(data.length,file.size,file.path);
  assert.strictEqual(require('crypto').createHash('sha256').update(data).digest('hex'),file.sha256,file.path);
}
const manifest=fs.readFileSync(path.join(root,'CSXS/manifest.xml'),'utf8');
assert(manifest.includes('ExtensionBundleVersion="'+version+'"'));
assert(manifest.includes('Id="com.deepndense.premiere.subtitleNavigator.panel" Version="'+version+'"'));
assert(fs.readFileSync(path.join(root,'index.html'),'utf8').includes('v'+version));
assert(fs.readFileSync(path.join(root,'CHANGELOG.md'),'utf8').includes('## '+version));
console.log('release version consistency passed');
