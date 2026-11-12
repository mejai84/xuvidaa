'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {startRemux}=require('./mkv-remux-runner.cjs');
const {selectMkvPlan}=require('./mkv-remux-policy.cjs');
const plan=selectMkvPlan([{codec_type:'video',codec_name:'h264'}]);
const input='/tmp/tvvidaa-mkv/abc.mkv';
const playlistPath='/tmp/tvvidaa-hls/abc/index.m3u8';

test('spawns ffmpeg without shell and restricts environment',async()=>{
  let called,child=new EventEmitter();
  child.kill=()=>{};
  const run=startRemux({plan,input,playlistPath,spawnProcess:(...args)=>{called=args;return child;}});
  assert.equal(called[0],'ffmpeg');
  assert.equal(called[2].shell,false);
  assert.equal(called[2].stdio[0],'ignore');
  assert.equal(called[2].env.PATH,'/usr/bin:/bin');
  child.emit('close',0);
  assert.deepEqual(await run.done,{exitCode:0});
});

test('nonzero FFmpeg exit is an error',async()=>{
  const child=new EventEmitter();child.kill=()=>{};
  const run=startRemux({plan,input,playlistPath,spawnProcess:()=>child});
  child.emit('close',1);
  await assert.rejects(run.done,/sin completar/);
});

test('cancellation sends SIGKILL',async()=>{
  const child=new EventEmitter();let signal;
  child.kill=s=>{signal=s;child.emit('close',null);};
  const run=startRemux({plan,input,playlistPath,spawnProcess:()=>child});
  run.stop();
  assert.equal(signal,'SIGKILL');
  await assert.rejects(run.done);
});

test('invalid path is rejected before spawning',()=>{
  assert.throws(()=>startRemux({plan,input:'https://example.com/movie.mkv',playlistPath,spawnProcess:()=>{throw Error('must not spawn');}}));
});
