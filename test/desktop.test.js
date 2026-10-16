import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {createClientState}=require('../electron/client-state.cjs');
const {createRendererServer}=require('../electron/renderer-server.cjs');
const build=require('../electron-builder.cjs');
const plain={isEncryptionAvailable:()=>false};

test('desktop client state survives renderer-port changes and supports sign-out',()=>{
  const directory=mkdtempSync(path.join(tmpdir(),'driskord-client-'));
  try{
    const first=createClientState(directory,plain);
    assert.equal(first.get('connection'),null);
    assert.equal(first.set('connection',JSON.stringify({url:'https://chat.example.com',token:'test-session'})),true);
    assert.equal(first.set('preferences',JSON.stringify({quality:'720'})),true);
    const second=createClientState(directory,plain);
    assert.equal(JSON.parse(second.get('connection')).token,'test-session');
    second.set('connection',null);
    const third=createClientState(directory,plain);
    assert.equal(third.get('connection'),null);
    assert.equal(JSON.parse(third.get('preferences')).quality,'720');
    assert.equal(third.set('../arbitrary-file','{}'),false);
    assert.equal(third.set('preferences','not-json'),false);
    assert.equal(third.set('preferences','x'.repeat(16385)),false);
  }finally{rmSync(directory,{recursive:true,force:true});}
});
test('client state uses supplied OS encryption and recovers from unreadable files',()=>{
  const directory=mkdtempSync(path.join(tmpdir(),'driskord-client-'));
  // Stub the OS service; this tests storage integration, not Windows DPAPI itself.
  const encryption={isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s).reverse(),decryptString:b=>Buffer.from(b).reverse().toString()};
  try{
    const state=createClientState(directory,encryption);
    state.set('connection',JSON.stringify({token:'private-token'}));
    const saved=readFileSync(path.join(directory,'client-state.dat'));
    assert.equal(saved[0],69);assert.equal(saved.includes('private-token'),false);
    assert.equal(JSON.parse(createClientState(directory,encryption).get('connection')).token,'private-token');
    writeFileSync(path.join(directory,'client-state.dat'),'corrupt');
    assert.equal(createClientState(directory,encryption).get('connection'),null);
  }finally{rmSync(directory,{recursive:true,force:true});}
});
test('desktop asset host serves UI with CSP and has no community API',async()=>{
  const directory=mkdtempSync(path.join(tmpdir(),'driskord-assets-'));
  writeFileSync(path.join(directory,'index.html'),'<h1>Driskord</h1>');
  const server=createRendererServer(directory);
  server.address=()=>({port:40509});
  const request=(url,host='127.0.0.1:40509',method='GET')=>new Promise(resolve=>{
    const headers={};const response={status:200,body:undefined,setHeader(k,v){headers[k]=v;},writeHead(status,more={}){this.status=status;Object.assign(headers,more);return this;},end(body){this.body=body;resolve({...this,headers});}};
    server.emit('request',{url,method,headers:{host}},response);
  });
  try{
    const page=await request('/');assert.equal(page.status,200);assert.match(page.body.toString(),/Driskord/);assert.match(page.headers['Content-Security-Policy'],/script-src 'self'/);
    assert.equal((await request('/api/state')).status,404);
    assert.equal((await request('/','attacker.example')).status,403);
    assert.equal((await request('/','127.0.0.1:40509','POST')).status,405);
    assert.equal((await request('/..%2F..%2Fsecret.html')).status,404);
    assert.equal((await request('/bad%encoding')).status,404);
    assert.equal((await request('/','127.0.0.1:40509','HEAD')).body,undefined);
  }finally{server.close();rmSync(directory,{recursive:true,force:true});}
});
test('Windows portable build is x64 and includes UI and desktop runtime',()=>{
  assert.equal(build.appId,'org.driskord.desktop');assert.equal(build.win.target[0].target,'portable');assert.deepEqual(build.win.target[0].arch,['x64']);
  assert.equal(build.nsis,undefined);assert.match(build.win.artifactName,/-Portable\.\$\{ext\}$/);
  assert.ok(build.files.includes('dist/**/*'));assert.ok(build.files.includes('electron/**/*'));assert.equal(build.files.some(f=>f.startsWith('data/')),false);
});
