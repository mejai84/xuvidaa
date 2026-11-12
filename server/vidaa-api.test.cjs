'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

process.env.MEDIA_TOKEN_SECRET='ci-only-media-secret-0123456789-abcdef12345678';
const api=require('./api/vidaa-api.cjs');
const tokens=require('./api/lib/media-token.js');
const registry=require('./api/media-registry.cjs');

function invoke(method,body) {
  return new Promise((resolve,reject)=>{
    const req={method:'POST',query:{method},body:body||{},
      headers:{'x-forwarded-for':'198.51.100.36'},socket:{remoteAddress:'127.0.0.1'}};
    const res={code:0,headers:{},setHeader(k,v){this.headers[k]=v;return this;},
      status(n){this.code=n;return this;},
      json(x){resolve({status:this.code,body:x});return this;}};
    Promise.resolve(api(req,res)).catch(reject);
  });
}

test('web runtime does not import Luna or Magis',()=>{
  const server=fs.readFileSync(path.join(__dirname,'http-server.cjs'),'utf8');
  const catalog=fs.readFileSync(path.join(__dirname,'api/vidaa-api.cjs'),'utf8');
  const docker=fs.readFileSync(path.join(__dirname,'../deploy/hostinger/Dockerfile'),'utf8');
  assert.match(server,/root: path.join\(__dirname, '\.\.\/web'\)/);
  assert.match(server,/require\('\.\/api\/vidaa-api.cjs'\)/);
  assert.doesNotMatch(catalog,/PalmServiceBridge|luna:\/\/|require\(['"].*magis/i);
  assert.doesNotMatch(docker,/COPY .*webos\//);
  assert.match(docker,/COPY .*web\/ /);
});

test('protected scope returns only public TV channel fields',async()=>{
  const saved=api.live.getChannels;
  api.live.getChannels=async()=>({channels:[{
    id:'CanalUno.co',channelCode:'CanalUno.co',name:'Canal Uno',
    logo:'https://logos.example/logo.png',
    streamUrl:'https://private.example/tv.m3u8?token=top-secret',
    headers:{Authorization:'Bearer confidential'},
    hasStream:true
  }],total:1,hasMore:false});
  try {
    const r=await invoke('liveChannels',{search:'uno'});
    assert.equal(r.status,200);
    assert.equal(r.body.channels.length,1);
    const data=JSON.stringify(r.body);
    assert.doesNotMatch(data,/top-secret|Authorization|streamUrl|private\.example/);
    assert.match(data,/Canal Uno/);
  } finally {api.live.getChannels=saved;}
});

test('movies and series are separate and do not return source URLs',async()=>{
  const movie=api.vod.getMovies,series=api.vod.getSeries;
  api.vod.getMovies=async()=>({items:[{
    id:'mov-12345',title:'Película prueba',streamUrl:'https://provider/movie?username=secret',
    streamPath:'movie/username/password/123',poster:'https://posters.example/cover.jpg'
  }],total:1,hasMore:false});
  api.vod.getSeries=async()=>({items:[{
    id:'series-12345',title:'Serie prueba',seasons:[{episodes:[{streamUrl:'http://private'}]}],
    kind:'serie',seasonCount:1,episodeCount:2
  }],total:1,hasMore:false});
  try {
    const m=await invoke('m3uMovies',{search:'prueba'});
    const s=await invoke('m3uSeries',{search:'prueba'});
    assert.equal(m.body.items[0].kind,'película');
    assert.equal(s.body.items[0].kind,'serie');
    for(const payload of [m.body,s.body]){
      assert.doesNotMatch(JSON.stringify(payload),/streamUrl|streamPath|username\/password|http:\/\/private/);
    }
  } finally {api.vod.getMovies=movie;api.vod.getSeries=series;}
});

test('details allowlist episode fields and reject arbitrary IDs',async()=>{
  assert.equal((await invoke('m3uDetail',{id:'../../passwd'})).status,400);
  const saved=api.vod.getDetail;
  api.vod.getDetail=async()=>({
    returnValue:true,isSeries:true,
    item:{id:'series-12345',title:'Mi Serie',kind:'serie',
      poster:'https://poster.example/poster.jpg'},
    seasons:[{id:'season-01',number:1,episodes:[{
      id:'ep-12345',number:1,title:'Primer capítulo',
      streamUrl:'https://hidden.example/user/password/episode.m3u8'
    }]}]
  });
  try {
    const r=await invoke('m3uDetail',{id:'series-12345'});
    assert.equal(r.status,200);
    assert.equal(r.body.seasons[0].episodes[0].title,'Primer capítulo');
    assert.doesNotMatch(JSON.stringify(r.body),/streamUrl|hidden\.example|password/);
  } finally {api.vod.getDetail=saved;}
});

test('encrypted IPTV resolution returns only protected same-origin media URL',async()=>{
  const saved=api.live.getChannel;
  api.live.getChannel=async()=>({name:'Canal Uno',hasStream:true,streamUrl:'https://cdn.example/ch.m3u8',
    streams:[{url:'https://cdn.example/ch.m3u8'}]});
  try {
    const r=await invoke('resolveLive',{channelCode:'CanalUno.co'});
    assert.equal(r.status,200);
    assert.equal(r.body.isHls,true);
    assert.match(r.body.mediaUrl,/^\/api\/media\?token=v1\./);
    assert.doesNotMatch(JSON.stringify(r.body),/cdn\.example|https:\/\/cdn/);
    const t=new URL(r.body.mediaUrl,'https://tv.example.test').searchParams.get('token');
    const decoded=tokens.decode(t,process.env.MEDIA_TOKEN_SECRET);
    assert.deepEqual(Object.keys(decoded).sort(), ['exp','ref']);
    assert.doesNotMatch(JSON.stringify(decoded),/cdn|https|user|pass|url/);
    const privateEntry=registry.lookup(t);
    assert.equal(privateEntry.url,'https://cdn.example/ch.m3u8');
    assert.deepEqual(privateEntry.hosts,['cdn.example']);
  } finally {api.live.getChannel=saved;}
});

test('private movie playback resolves only a catalog ID into an opaque same-origin reference',async()=>{
  const saved=api.vod.resolveStream, configured=api.vod.isConfigured;
  api.vod.isConfigured=()=>true;
  api.vod.resolveStream=async(id)=>({
    found:true,streamUrl:'https://video.example/movie/user-secret/password-secret/123.mp4',
    item:{id,title:'Demo VOD'},mime:'video/mp4',type:'movie',isHls:false,duration:3800
  });
  try {
    const denied=await invoke('resolve',{contentId:'https://evil.example/video.mp4'});
    assert.equal(denied.status,400);
    const r=await invoke('resolve',{contentId:'mov-12345'});
    assert.equal(r.status,200);
    assert.equal(r.body.isHls,false);
    assert.match(r.body.mediaUrl,/^\/api\/media\?token=v1\./);
    const token=new URL(r.body.mediaUrl,'https://tv.example.test').searchParams.get('token');
    const decoded=tokens.decode(token,process.env.MEDIA_TOKEN_SECRET);
    assert.deepEqual(Object.keys(decoded).sort(),['exp','ref']);
    assert.doesNotMatch(JSON.stringify(r.body),/video\.example|user-secret|password-secret/);
    assert.equal(registry.lookup(token).url,'https://video.example/movie/user-secret/password-secret/123.mp4');
  } finally {api.vod.resolveStream=saved;api.vod.isConfigured=configured;}
});

test('private episode HLS resolution uses opaque token and denies unsupported formats',async()=>{
  const saved=api.vod.resolveStream,configured=api.vod.isConfigured;
  api.vod.isConfigured=()=>true;
  try {
    api.vod.resolveStream=async()=>({found:true,streamUrl:'https://cdn.example/series/u/p/12.m3u8',
      item:{title:'Episode 1'},mime:'application/vnd.apple.mpegurl',isHls:true});
    const result=await invoke('resolve',{contentId:'ep-series-12345-s1-e1-abcdef'});
    assert.equal(result.status,200);
    assert.match(result.body.mediaUrl,/&manifest=1$/);
    assert.doesNotMatch(JSON.stringify(result.body),/cdn\.example|series\/u\/p/);
    api.vod.resolveStream=async()=>({found:true,streamUrl:'https://cdn.example/movie.mkv',mime:'video/x-matroska'});
    const unsupported=await invoke('resolve',{contentId:'mov-12345'});
    assert.equal(unsupported.status,415);
  } finally {api.vod.resolveStream=saved;api.vod.isConfigured=configured;}
});

test('SSRF validation rejects local, numeric and single-label destinations',()=>{
  for(const name of ['localhost','127.0.0.1','10.0.0.5','169.254.169.254','[::1]','db.internal','thing.local','metadata']){
    assert.equal(api.isUnsafeHost(name),true,name);
  }
  assert.equal(api.isUnsafeHost('cdn.example.com'),false);
});
