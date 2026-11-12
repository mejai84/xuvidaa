'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {allowedSegment,readSegment,removeWorkspace}=require('./mkv-hls-workspace.cjs');

test('accepts only HLS playlist and numbered TS files',()=>{
  assert.equal(allowedSegment('index.m3u8'),true);
  assert.equal(allowedSegment('seg_00001.ts'),true);
  for(const name of ['../secret','seg_1.ts','seg_00001.ts/../secret','other.m3u8','.env','seg_00001.ts?token=x']){
    assert.equal(allowedSegment(name),false);
  }
});
test('rejects invalid workspace before file access',async()=>{
  await assert.rejects(readSegment({id:'../../etc'},'index.m3u8'));
  await assert.rejects(readSegment({id:'a'.repeat(32)},'../secret'));
});
test('cleanup rejects untrusted workspace identifiers',async()=>{
  assert.equal(await removeWorkspace({id:'../../etc'}),false);
  assert.equal(await removeWorkspace(null),false);
});
