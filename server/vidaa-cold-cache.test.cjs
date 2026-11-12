'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {M3uProvider}=require('./providers/m3uProvider.cjs');
const m3u=[
'#EXTM3U',
'#EXTINF:-1 tvg-name="La Aventura 2024" group-title="Cine",La Aventura 2024',
'https://provider.example/movie/demoUser/demoPassword/1001.mp4',
'#EXTINF:-1 tvg-name="Serie Ejemplo S01E01" group-title="SERIES",Serie Ejemplo S01E01',
'https://provider.example/series/demoUser/demoPassword/2001.mp4'
].join('\n');

test('M3U cold cache resolves Xtream movies and episodes without network download',async(t)=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vidaa-m3u-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const cfg={cacheDir:dir,baseUrl:'https://provider.example',
    username:'demoUser',password:'demoPassword'};
  const writer=new M3uProvider({...cfg,fetchM3uContent:async()=>m3u});
  const movies=await writer.getMovies({pageNum:1,pageSize:5});
  const series=await writer.getSeries({pageNum:1,pageSize:5});
  assert.equal(movies.items.length,1);
  assert.equal(series.items.length,1);
  const d=await writer.getDetail(series.items[0].id);
  assert.equal(d.returnValue,true);
  const ep=d.seasons[0].episodes[0];
  assert.match(ep.id,/^ep-/);
  const json=fs.readFileSync(path.join(dir,'m3u-catalog.json'),'utf8');
  assert.doesNotMatch(json,/demoUser|demoPassword|\/movie\/demoUser|\/series\/demoUser/);
  assert.match(json,/"streamPath": "\/movie\/1001\.mp4"/);
  assert.match(json,/"streamPath": "\/series\/2001\.mp4"/);
  let fetches=0;
  const cold=new M3uProvider({...cfg,fetchM3uContent:async()=>{fetches++;throw Error('network must not be used');}});
  const movie=await cold.resolveStream(movies.items[0].id);
  const episode=await cold.resolveStream(ep.id);
  assert.equal(fetches,0,'cold cache should not download M3U again');
  assert.equal(movie.found,true);
  assert.equal(episode.found,true);
  assert.equal(movie.streamUrl,'https://provider.example/movie/demoUser/demoPassword/1001.mp4');
  assert.equal(episode.streamUrl,'https://provider.example/series/demoUser/demoPassword/2001.mp4');
  assert.doesNotMatch(fs.readFileSync(path.join(dir,'m3u-catalog.json'),'utf8'),/demoUser|demoPassword/);
});
test('cold cache refuses arbitrary or tampered paths and private credentials on disk',async(t)=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vidaa-m3u-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const p=new M3uProvider({cacheDir:dir,baseUrl:'https://provider.example',
    username:'demoUser',password:'demoPassword'});
  assert.equal(p.reconstructXtreamUrl('/movie/123.mp4'),'https://provider.example/movie/demoUser/demoPassword/123.mp4');
  for(const attack of ['/movie/demoUser/demoPassword/123.mp4',
    '/../internal','/series/../../private','/series/%2e%2e/123.mp4','http://evil.example/movie/123.mp4']){
    assert.equal(p.reconstructXtreamUrl(attack),'',attack);
  }
  assert.equal(p.reconstructXtreamUrl('/live/123.ts'),'');
});
