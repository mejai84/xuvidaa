'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {rewriteLocalPlaylist}=require('./mkv-hls-manifest.cjs');
const id='a'.repeat(32),token='b'.repeat(40);
const sign=name=>'/api/mkv/'+id+'/'+name+'?token='+token;
test('rewrites only local TS segments',()=>{
  const input='#EXTM3U\n#EXT-X-VERSION:3\n#EXTINF:6.0,\nseg_00001.ts\n';
  const output=rewriteLocalPlaylist(input,sign);
  assert.ok(output.includes(sign('seg_00001.ts')));
  assert.ok(!output.includes('\nseg_00001.ts\n'));
});
test('rejects external and traversal references',()=>{
  for(const source of ['https://example.com/seg_00001.ts','../seg_00001.ts','/etc/passwd','seg_00001.ts?x=1']){
    assert.throws(()=>rewriteLocalPlaylist('#EXTM3U\n'+source+'\n',sign));
  }
});
test('rejects encryption keys and alternate stream URIs',()=>{
  for(const tag of ['#EXT-X-KEY:METHOD=AES-128,URI="key.bin"','#EXT-X-MAP:URI="init.mp4"','#EXT-X-STREAM-INF:BANDWIDTH=1000']){
    assert.throws(()=>rewriteLocalPlaylist('#EXTM3U\n'+tag+'\n',sign));
  }
});
test('rejects unsigned local URLs and oversized playlists',()=>{
  assert.throws(()=>rewriteLocalPlaylist('#EXTM3U\nseg_00001.ts\n',()=>'/api/mkv/'+id+'/seg_00001.ts'));
  assert.throws(()=>rewriteLocalPlaylist('#EXTM3U\n'+'#'.repeat(256*1024),sign));
});
