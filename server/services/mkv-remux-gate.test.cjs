'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {createRemuxGate,MAX_IDLE_MS,MAX_DURATION_MS} = require('./mkv-remux-gate.cjs');

test('only one remux lease can be active',()=>{
  let stopped=0;
  const gate=createRemuxGate();
  const first=gate.acquire(()=>stopped++);
  assert.match(first,/^[a-f0-9]{40}$/);
  assert.equal(gate.acquire(()=>{}),null);
  assert.equal(gate.release('invalid'),false);
  assert.equal(gate.release(first),true);
  assert.equal(stopped,1);
  assert.equal(gate.busy(),false);
});

test('idle sessions expire and stop',()=>{
  let t=1000,stopped=0;
  const gate=createRemuxGate({now:()=>t});
  const id=gate.acquire(()=>stopped++);
  t+=MAX_IDLE_MS-1;
  assert.equal(gate.touch(id),true);
  t+=MAX_IDLE_MS;
  assert.equal(gate.busy(),false);
  assert.equal(stopped,1);
});

test('hard duration expires despite heartbeats',()=>{
  let t=1000,stopped=0;
  const gate=createRemuxGate({now:()=>t});
  const id=gate.acquire(()=>stopped++);
  for(let i=0;i<MAX_DURATION_MS/MAX_IDLE_MS;i++){t+=MAX_IDLE_MS/2;assert.equal(gate.touch(id),true);}
  t=1000+MAX_DURATION_MS;
  assert.equal(gate.touch(id),false);
  assert.equal(stopped,1);
});

test('expired lease cannot release a new lease',()=>{
  let t=1000,stopped=0;
  const gate=createRemuxGate({now:()=>t});
  const old=gate.acquire(()=>stopped++);
  t+=MAX_IDLE_MS;
  const fresh=gate.acquire(()=>stopped++);
  assert.notEqual(fresh,old);
  assert.equal(gate.release(old),false);
  assert.equal(gate.release(fresh),true);
  assert.equal(stopped,2);
});
