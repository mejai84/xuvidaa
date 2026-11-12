'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
process.env.MEDIA_TOKEN_SECRET='test-vidaa-media-secret-0123456789-abcdef';
const codec=require('./api/lib/media-token.js');
const handler=require('./api/media.cjs');

function signed(url, extra) {
  return codec.encode(Object.assign({
    url,hosts:[new URL(url).hostname.toLowerCase()],mime:'application/vnd.apple.mpegurl',
    exp:Date.now()+60000,headers:{},subtitles:[]
  },extra||{}),process.env.MEDIA_TOKEN_SECRET);
}
function request(token, query) {
  return new Promise((resolve,reject)=>{
    const req={method:'GET',
      headers:{host:'tv.example.test'},query:Object.assign({token},query||{})};
    let finished=false;
    const res={headersSent:false,writableEnded:false,destroyed:false,
      setHeader(){return this;},status(code){this.code=code;return this;},
      json(body){if(!finished){finished=true;resolve({code:this.code,body});}return this;},
      on(){return this;}};
    try{handler(req,res)}catch(err){reject(err);}
    setTimeout(()=>{if(!finished)reject(new Error('media handler did not reply'))},3000).unref();
  });
}
test('TVVIDAA media endpoint rejects expired encrypted references',async()=>{
  const token=signed('https://cdn.example/video.m3u8',{exp:Date.now()-1000});
  const r=await request(token);
  assert.equal(r.code,410);
});
test('TVVIDAA media endpoint cannot proxy hosts not bound to token',async()=>{
  const token=signed('https://cdn.example/live.m3u8');
  const r=await request(token,{child:'https://another.example/segment.ts'});
  assert.equal(r.code,403);
});
test('TVVIDAA media endpoint rejects plain HTTP sources',async()=>{
  const token=signed('http://cdn.example/live.m3u8');
  const r=await request(token);
  assert.equal(r.code,403);
});
test('TVVIDAA media endpoint blocks loopback IP via DNS before streaming',async()=>{
  const token=signed('https://127.0.0.1/media.m3u8');
  const r=await request(token);
  assert.equal(r.code,403);
});
test('invalid media tokens are rejected',async()=>{
  const r=await request('not-a-valid-token');
  assert.equal(r.code,403);
});
