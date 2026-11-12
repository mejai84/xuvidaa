'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createMkvSessionManager}=require('./mkv-session-manager.cjs');
function fixture(){
  let stopped=0,removed=0,resolveDone;
  const done=new Promise(resolve=>{resolveDone=resolve;});
  const workspace={id:'a'.repeat(32),playlistPath:'/tmp/tvvidaa-hls/'+ 'a'.repeat(32)+'/index.m3u8'};
  const manager=createMkvSessionManager({
    workspaceFactory:async()=>workspace,
    workspaceRemover:async()=>{removed++;},
    segmentReader:async(_ws,name)=>Buffer.from(name==='index.m3u8'?'#EXTM3U\n#EXTINF:6,\nseg_00001.ts\n':'segment')
  });
  return {manager,run:()=>manager.start({startJob:async()=>({done,stop:()=>{stopped++;}})}),
    resolveDone,counts:()=>({stopped,removed})};
}
test('returns opaque URL and rewrites local segments',async()=>{
  const f=fixture(),session=await f.run();
  assert.match(session.playlistUrl,/^\/api\/mkv\/[a-f0-9]{32}\/index\.m3u8\?token=[a-f0-9]{64}$/);
  const item=await f.manager.read(session.id,session.token,'index.m3u8');
  assert.equal(item.mime,'application/vnd.apple.mpegurl');
  assert.ok(item.data.toString().includes('/api/mkv/'+session.id+'/seg_00001.ts?token='+session.token));
  await f.manager.stop();
});
test('denies invalid capability and filenames',async()=>{
  const f=fixture(),session=await f.run();
  assert.equal(await f.manager.read(session.id,'0'.repeat(64),'index.m3u8'),null);
  assert.equal(await f.manager.read(session.id,session.token,'../index.m3u8'),null);
  assert.equal(await f.manager.read('b'.repeat(32),session.token,'index.m3u8'),null);
  await f.manager.stop();
});
test('one concurrent job and stop cleans workspace',async()=>{
  const f=fixture(),session=await f.run();
  assert.ok(session);
  assert.equal(await f.run(),null);
  await f.manager.stop();
  assert.equal(f.counts().removed,1);
  assert.equal(f.counts().stopped,1);
});
