'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {Readable,PassThrough}=require('node:stream');
const {EventEmitter}=require('node:events');
const {probeMkv}=require('./mkv-codec-probe.cjs');
function mockProbe(streams) {
  const child=new EventEmitter();
  child.stdin=new PassThrough();
  child.stdout=new PassThrough();
  child.kill=()=>child.emit('close',null);
  child.stdin.on('finish',()=>{
    child.stdout.end(JSON.stringify({streams}));
    child.emit('close',0);
  });
  return {child,spawn:(_cmd,args,opts)=>{
    assert.equal(_cmd,'ffprobe');
    assert.equal(opts.shell,false);
    assert.equal(args[args.indexOf('-i')+1],'pipe:0');
    return child;
  }};
}
test('H264 AAC probe returns supported remux plan',async()=>{
  const {spawn}=mockProbe([{codec_type:'video',codec_name:'h264'},{codec_type:'audio',codec_name:'aac'}]);
  const plan=await probeMkv({source:Readable.from([Buffer.from('fake matroska')]),spawnProcess:spawn});
  assert.equal(plan.supported,true);
  assert.equal(plan.audio,'copy');
});
test('HEVC is rejected by policy',async()=>{
  const {spawn}=mockProbe([{codec_type:'video',codec_name:'hevc'}]);
  const plan=await probeMkv({source:Readable.from([Buffer.from('fake matroska')]),spawnProcess:spawn});
  assert.equal(plan.supported,false);
});
test('rejects invalid source and unbounded probe configuration',async()=>{
  await assert.rejects(probeMkv({source:null}),/Origen/);
  await assert.rejects(probeMkv({source:Readable.from([]),maxBytes:10}),/Límite/);
});
