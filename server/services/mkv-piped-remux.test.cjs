'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {Readable,PassThrough}=require('node:stream');
const {startPipedRemux}=require('./mkv-piped-remux.cjs');
const {selectMkvPlan}=require('./mkv-remux-policy.cjs');
const plan=selectMkvPlan([{codec_type:'video',codec_name:'h264'},{codec_type:'audio',codec_name:'aac'}]);
const playlistPath='/tmp/tvvidaa-hls/abc/index.m3u8';
function mock(){
  const child=new EventEmitter();
  child.stdin=new PassThrough();
  child.kill=()=>child.emit('close',null);
  return child;
}
test('feeds a source into FFmpeg stdin without using URL or shell',async()=>{
  const child=mock(),bytes=[];
  child.stdin.on('data',chunk=>bytes.push(chunk));
  let options,args;
  const run=startPipedRemux({plan,source:Readable.from([Buffer.from('mkv-data')]),playlistPath,
    spawnProcess:(_cmd,a,o)=>{args=a;options=o;return child;}});
  child.stdin.on('finish',()=>child.emit('close',0));
  assert.equal(options.shell,false);
  assert.equal(options.stdio[0],'pipe');
  assert.equal(args[args.indexOf('-i')+1],'pipe:0');
  assert.equal(args.includes('https://example.com/movie.mkv'),false);
  assert.deepEqual(await run.done,{exitCode:0});
  assert.equal(Buffer.concat(bytes).toString(),'mkv-data');
});
test('cancel destroys source and rejects completion',async()=>{
  const child=mock(),source=new PassThrough();
  const run=startPipedRemux({plan,source,playlistPath,spawnProcess:()=>child});
  run.stop();
  assert.equal(source.destroyed,true);
  await assert.rejects(run.done);
});
test('rejects arbitrary URL and invalid source before starting',()=>{
  assert.throws(()=>startPipedRemux({plan,source:null,playlistPath}),/Origen/);
  const {ffmpegHlsArgs}=require('./mkv-remux-policy.cjs');
  assert.throws(()=>ffmpegHlsArgs(plan,'https://example.com/a.mkv',playlistPath));
});
