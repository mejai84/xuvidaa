'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const path=require('node:path');
const codec=require('./api/lib/media-token.js');
const secret=crypto.randomBytes(48).toString('hex');
const payload={ref:crypto.randomBytes(20).toString('hex'),exp:Date.now()+60000};

test('AES-GCM signs an opaque reference and expiry only',()=>{
  const t=codec.encode(payload,secret);
  assert.match(t,/^v1\./);
  assert.deepEqual(codec.decode(t,secret),payload);
  assert.doesNotMatch(t,/https|movie|username|password|token=/);
});
test('old-style URL tokens, credential-bearing and extraneous fields are rejected',()=>{
  assert.equal(codec.encode({url:'https://provider.example/movie/user/pass/123.mp4',
    hosts:['provider.example'],headers:{},exp:payload.exp},secret),'');
  assert.equal(codec.encode({ref:payload.ref,exp:payload.exp,url:'https://secret.example'},secret),'');
  assert.equal(codec.encode({ref:'not-a-reference',exp:payload.exp},secret),'');
  assert.equal(codec.encode(payload,'weak'),'');
});
test('token integrity, secret and version must match',()=>{
  const t=codec.encode(payload,secret);
  assert.equal(codec.decode(t,'different-secret'.repeat(5)),null);
  assert.equal(codec.decode(t.replace(/^v1/,'v2'),secret),null);
  const parts=t.split('.');
  parts[3]=(parts[3][0]==='A'?'B':'A')+parts[3].slice(1);
  assert.equal(codec.decode(parts.join('.'),secret),null);
});
test('opaque token verifies in separate Node process without provider secrets',()=>{
  const token=codec.encode(payload,secret);
  const modulePath=path.resolve(__dirname,'api/lib/media-token.js');
  const p=spawnSync(process.execPath,['-e',
    'const m=require(process.argv[1]);process.stdout.write(JSON.stringify(m.decode(process.argv[2],process.env.MEDIA_TOKEN_SECRET)));',
    modulePath,token],{encoding:'utf8',env:{...process.env,MEDIA_TOKEN_SECRET:secret},timeout:5000});
  assert.equal(p.status,0,p.stderr);
  assert.deepEqual(JSON.parse(p.stdout),payload);
});
