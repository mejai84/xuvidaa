'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {Readable,Writable}=require('node:stream');
const registry=require('./api/media-registry.cjs');
const codec=require('./api/lib/media-token.js');
const relay=require('./api/media.cjs');
process.env.MEDIA_TOKEN_SECRET='test-vidaa-media-secret-0123456789-abcdef';
process.env.PUBLIC_BASE_URL='https://tv.example.test';

function token(url,mime) {
  const issued=registry.register({
    url,hosts:[new URL(url).hostname.toLowerCase()],mime:mime||'video/mp4',
    headers:{},duration:120
  },Date.now()+120000);
  assert.ok(issued && issued.token);
  return issued.token;
}
function mockResponse(status,headers,data) {
  const out=new Readable({read(){}});
  out.statusCode=status;
  out.headers=headers||{};
  process.nextTick(()=>{
    out.push(Buffer.from(data||''));
    out.push(null);
  });
  return out;
}
function mediaRequest(t,opts) {
  const o=opts||{};
  return new Promise((resolve,reject)=>{
    let captured,called=false;
    const res=new Writable({write(chunk,_encoding,cb){pieces.push(Buffer.from(chunk));cb();}});
    const pieces=[],headers={};res.headersSent=false;
    res.setHeader=function(k,v){headers[k.toLowerCase()]=v;return res;};
    res.status=function(c){res.statusCode=c;return res;};
    res.json=function(body){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(body));return res;};
    res.send=function(body){res.end(body||'');return res;};
    res.writeHead=function(c,out){res.statusCode=c;res.headersSent=true;Object.keys(out||{}).forEach(k=>headers[k.toLowerCase()]=out[k]);return res;};
    res.on('finish',()=>{
      if(called)return;called=true;
      resolve({status:res.statusCode||200,headers,body:Buffer.concat(pieces).toString('utf8'),upstream:captured});
    });
    const server=relay.createHandler({
      dnsLookup:(host,_options,cb)=>cb(null,o.addresses||[{address:'1.1.1.1',family:4}]),
      httpsRequest:(params,handler)=>{
        captured=params;
        const upstream=new EventEmitter();
        upstream.destroy=()=>{};
        upstream.end=()=>process.nextTick(()=>handler(mockResponse(o.status||200,o.headers||{'content-type':'video/mp4'},o.body||'testdata')));
        return upstream;
      }
    });
    const req=new EventEmitter();
    req.method=o.method||'GET';
    req.headers=Object.assign({host:'tv.example.test'},o.requestHeaders||{});
    req.query=Object.assign({token:t},o.query||{});
    try{server(req,res);}catch(e){reject(e);}
    setTimeout(()=>{if(!called)reject(new Error('relay timeout'))},1800).unref();
  });
}

test('rejects invalid, old-style and expired references',async()=>{
  assert.equal((await mediaRequest('bogus')).status,403);
  assert.equal(codec.encode({url:'https://cdn.example/v.m3u8',hosts:['cdn.example'],headers:{},exp:Date.now()+20000},process.env.MEDIA_TOKEN_SECRET),'');
  const expired=codec.encode({ref:'d'.repeat(40),exp:Date.now()-1000},process.env.MEDIA_TOKEN_SECRET);
  assert.equal((await mediaRequest(expired)).status,410);
});
test('rejects child URL query, foreign origins, HTTP and numeric hosts',async()=>{
  const t=token('https://cdn.example/video.mp4');
  assert.equal((await mediaRequest(t,{query:{child:'https://cdn.example/path'}})).status,400);
  assert.equal((await mediaRequest(t,{requestHeaders:{origin:'https://evil.example'}})).status,403);
  const bad=token('https://127.0.0.1/video.mp4');
  assert.equal((await mediaRequest(bad)).status,403);
  assert.equal(registry.register({url:'http://cdn.example/v.mp4',hosts:['cdn.example']}) ,null);
});
test('private and metadata DNS targets are blocked before any upstream call',async()=>{
  const t=token('https://cdn.example/video.mp4');
  const result=await mediaRequest(t,{addresses:[{address:'10.1.0.5',family:4}]});
  assert.equal(result.status,403);
  assert.equal(result.upstream,undefined);
  assert.equal(relay.publicIPv4('169.254.169.254'),false);
  assert.equal(relay.publicIPv4('1.1.1.1'),true);
});
test('Range 206 status and byte-range headers are preserved',async()=>{
  const t=token('https://cdn.example/movie/private-user/private-password/123.mp4');
  const r=await mediaRequest(t,{
    requestHeaders:{range:'bytes=200-399'},
    status:206,
    headers:{'content-type':'video/mp4','content-range':'bytes 200-399/5000',
      'accept-ranges':'bytes','content-length':'200'},
    body:'partial'
  });
  assert.equal(r.status,206);
  assert.equal(r.headers['content-range'],'bytes 200-399/5000');
  assert.equal(r.headers['accept-ranges'],'bytes');
  assert.equal(r.upstream.headers.Range,'bytes=200-399');
  assert.equal(r.body,'partial');
  assert.equal(r.upstream.hostname,'cdn.example');
  assert.doesNotMatch(JSON.stringify(r.headers),/private-user|private-password/);
  assert.equal((await mediaRequest(t,{requestHeaders:{range:'bytes=abc'}})).status,416);
});
test('rewrites HLS variants, segments, encryption key URIs without leaking origins',async()=>{
  const t=token('https://cdn.example/movie/user/pass/main.m3u8','application/vnd.apple.mpegurl');
  const body='#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-KEY:METHOD=AES-128,URI="keys/key.bin?user=secret"\n#EXTINF:5,\nseg01.ts?password=hidden\n';
  const r=await mediaRequest(t,{headers:{'content-type':'application/vnd.apple.mpegurl'},body});
  assert.equal(r.status,200);
  assert.match(r.body,/^#EXTM3U/);
  assert.match(r.body,/\/api\/media\?token=v1\./);
  assert.doesNotMatch(r.body,/cdn\.example|user=secret|password=hidden|keys\/key.bin|seg01\.ts/);
  assert.equal(r.body.split('\n').filter(x=>x.indexOf('/api/media?token=')!==-1).length,2);
  const keyToken=/URI="https:\/\/tv.example.test\/api\/media\?token=([^"]+)"/.exec(r.body);
  assert.ok(keyToken);
  const decoded=codec.decode(decodeURIComponent(keyToken[1]),process.env.MEDIA_TOKEN_SECRET);
  assert.deepEqual(Object.keys(decoded).sort(),['exp','ref']);
  assert.match(registry.lookup(decodeURIComponent(keyToken[1])).url,/keys\/key.bin/);
});
test('rejects HLS cross-host child and redirect safely',async()=>{
  const t=token('https://cdn.example/master.m3u8','application/vnd.apple.mpegurl');
  const m=await mediaRequest(t,{headers:{'content-type':'application/vnd.apple.mpegurl'},
    body:'#EXTM3U\nhttps://evil.example/file.ts\n'});
  assert.equal(m.status,502);
  const d=await mediaRequest(t,{status:302,headers:{location:'https://evil.example/video.mp4'}});
  assert.equal(d.status,502);
});
