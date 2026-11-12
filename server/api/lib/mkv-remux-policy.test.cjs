'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {decideCopyRemux}=require('./mkv-remux-policy.cjs');
test('permits copy-only H264 + AAC',()=>{
  assert.equal(decideCopyRemux([{codec_type:'video',codec_name:'h264'},{codec_type:'audio',codec_name:'aac'}]).ok,true);
});
test('permits video-only H264',()=>{
  assert.equal(decideCopyRemux([{codec_type:'video',codec_name:'h264'}]).ok,true);
});
test('rejects HEVC and DTS without transcoding',()=>{
  assert.equal(decideCopyRemux([{codec_type:'video',codec_name:'hevc'},{codec_type:'audio',codec_name:'aac'}]).reason,'UNSUPPORTED_VIDEO_CODEC');
  assert.equal(decideCopyRemux([{codec_type:'video',codec_name:'h264'},{codec_type:'audio',codec_name:'dts'}]).reason,'UNSUPPORTED_AUDIO_CODEC');
});
test('rejects unknown, missing and multiple video tracks',()=>{
  assert.equal(decideCopyRemux([]).ok,false);
  assert.equal(decideCopyRemux([{codec_type:'video'}]).ok,false);
  assert.equal(decideCopyRemux([{codec_type:'video',codec_name:'h264'},{codec_type:'video',codec_name:'h264'}]).ok,false);
});
