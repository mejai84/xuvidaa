'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {selectMkvPlan,ffmpegHlsArgs,MAX_SESSIONS} = require('./mkv-remux-policy.cjs');

test('H264/AAC can be remuxed without transcoding', () => {
  const plan=selectMkvPlan([{codec_type:'video',codec_name:'h264'},{codec_type:'audio',codec_name:'aac'}]);
  assert.equal(plan.supported,true);
  assert.equal(plan.video,'copy');
  assert.equal(plan.audio,'copy');
  assert.equal(MAX_SESSIONS,1);
});

test('H264/AC3 remuxes video and converts audio only', () => {
  const plan=selectMkvPlan([{codec_type:'video',codec_name:'h264'},{codec_type:'audio',codec_name:'ac3'}]);
  assert.equal(plan.supported,true);
  assert.equal(plan.audio,'aac');
});

test('HEVC is rejected without heavy video transcoding', () => {
  assert.equal(selectMkvPlan([{codec_type:'video',codec_name:'hevc'}]).reason,'video_requires_transcode');
});

test('Only internally controlled paths are accepted', () => {
  const plan=selectMkvPlan([{codec_type:'video',codec_name:'h264'}]);
  assert.throws(()=>ffmpegHlsArgs(plan,'https://example.com/movie.mkv','/tmp/tvvidaa-hls/abc/index.m3u8'));
  assert.throws(()=>ffmpegHlsArgs(plan,'/tmp/tvvidaa-mkv/abc.mkv','/etc/passwd'));
  const args=ffmpegHlsArgs(plan,'/tmp/tvvidaa-mkv/abc.mkv','/tmp/tvvidaa-hls/abc/index.m3u8');
  assert.ok(args.includes('-nostdin'));
  assert.ok(args.includes('file,pipe'));
  assert.ok(args.includes('copy'));
});
