'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {PassThrough}=require('node:stream');
const {openProviderStream}=require('./mkv-provider-stream.cjs');
function fakeRequest(status=200,headers={}) {
  let captured,req;
  function request(options,onResponse){
    captured=options;
    req=new EventEmitter();
    req.end=()=>{
      const response=new PassThrough();
      response.statusCode=status;
      response.headers=headers;
      response.destroy=response.destroy.bind(response);
      queueMicrotask(()=>onResponse(response));
    };
    req.destroy=()=>{};
    return req;
  }
  return {request,getOptions:()=>captured};
}
const dnsLookup=async()=>[{address:'8.8.8.8',family:4}];
test('pins a public DNS result and does not pass URL to decoder',async()=>{
  const fake=fakeRequest();
  const result=await openProviderStream({
    url:'https://media.example.com/movie.mkv',hosts:['media.example.com'],
    dnsLookup,httpsRequest:fake.request
  });
  assert.equal(fake.getOptions().hostname,'media.example.com');
  assert.equal(fake.getOptions().servername,'media.example.com');
  assert.equal(fake.getOptions().lookup('media.example.com',{},(err,ip,family)=>{
    assert.equal(ip,'8.8.8.8');assert.equal(family,4);
  }),undefined);
  assert.equal(typeof result.stream.pipe,'function');
  result.stream.destroy();
});
test('rejects private DNS addresses before connecting',async()=>{
  const fake=fakeRequest();
  await assert.rejects(openProviderStream({
    url:'https://media.example.com/movie.mkv',hosts:['media.example.com'],
    dnsLookup:async()=>[{address:'127.0.0.1',family:4}],
    httpsRequest:fake.request
  }),/Dirección/);
  assert.equal(fake.getOptions(),undefined);
});
test('rejects redirects and oversized responses',async()=>{
  for(const [status,headers] of [[302,{}],[200,{'content-length':String(13*1024*1024*1024)}]]){
    const fake=fakeRequest(status,headers);
    await assert.rejects(openProviderStream({
      url:'https://media.example.com/movie.mkv',hosts:['media.example.com'],
      dnsLookup,httpsRequest:fake.request
    }));
  }
});
test('rejects URL bypasses and unsafe headers',async()=>{
  const fake=fakeRequest();
  for(const url of ['http://127.0.0.1/file','https://other.example.com/file']){
    await assert.rejects(openProviderStream({url,hosts:['media.example.com'],dnsLookup,httpsRequest:fake.request}));
  }
  await assert.rejects(openProviderStream({
    url:'https://media.example.com/movie.mkv',hosts:['media.example.com'],
    headers:{Host:'127.0.0.1'},dnsLookup,httpsRequest:fake.request
  }),/Cabecera/);
});
