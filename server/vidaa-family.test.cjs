'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const family=require('../web/js/family.js');

function storage() {
  const map=new Map();
  return {getItem:k=>map.has(k)?map.get(k):null,setItem:(k,v)=>map.set(k,v),
    dump:()=>JSON.stringify([...map.values()])};
}
test('family profiles isolate favorite channels movies and series',()=>{
  const db=storage(),api=family.create(db);
  assert.deepEqual(api.profiles(),['Principal','Familia','Invitados']);
  assert.equal(api.toggleFavorite('tv',{id:'CanalUno.co',name:'Canal Uno'}),true);
  assert.equal(api.toggleFavorite('movies',{id:'mov-12345',title:'Película'}),true);
  assert.equal(api.pickProfile('Familia'),true);
  assert.equal(api.isFavorite('tv','CanalUno.co'),false);
  api.toggleFavorite('series',{id:'series-111',title:'Serie'});
  assert.equal(api.pickProfile('Principal'),true);
  assert.equal(api.isFavorite('tv','CanalUno.co'),true);
  assert.equal(api.isFavorite('series','series-111'),false);
  assert.equal(api.pickProfile('Nonexistent'),false);
  const restored=family.create(db);
  assert.equal(restored.isFavorite('tv','CanalUno.co'),true);
});
test('last channel and playback recent only contain safe IDs and names',()=>{
  const db=storage(),api=family.create(db);
  api.watched('tv',{channelCode:'CanalUno.co',name:'Canal Uno',
    streamUrl:'https://stream.example/user/password/live.m3u8'});
  api.watched('movies',{id:'mov-abc123',title:'Demo',
    streamUrl:'https://private.example/secret.mp4'});
  assert.equal(api.lastChannel().id,'CanalUno.co');
  assert.equal(api.recent().length,2);
  assert.doesNotMatch(db.dump(),/streamUrl|private\.example|stream\.example|password/);
  api.clearRecent();
  assert.equal(api.lastChannel(),null);
  assert.equal(api.recent().length,0);
});
test('continue watching stores time, not URL credentials',()=>{
  const db=storage(),api=family.create(db);
  api.putProgress('series',{id:'ep-series-example-s1-e1-111',title:'Episodio 1',
    streamUrl:'https://private.example/secret.mp4'},162,1800);
  assert.equal(api.progress()[0].position,162);
  assert.doesNotMatch(db.dump(),/streamUrl|private\.example/);
  api.putProgress('series',{id:'ep-series-example-s1-e1-111',title:'Episodio 1'},1785,1800);
  assert.equal(api.progress().length,0);
});
test('malformed local storage never prevents launch',()=>{
  const db={getItem:()=>'{not JSON',setItem:()=>{throw Error('private mode')}};
  const api=family.create(db);
  assert.equal(api.active(),'Principal');
  api.toggleFavorite('tv',{id:'TV-1',name:'Test'});
  assert.equal(api.isFavorite('tv','TV-1'),true);
});
