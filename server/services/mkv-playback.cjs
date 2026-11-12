'use strict';
const fs=require('node:fs/promises');
const {openProviderStream}=require('./mkv-provider-stream.cjs');
const {probeMkv}=require('./mkv-codec-probe.cjs');
const {startPipedRemux}=require('./mkv-piped-remux.cjs');
const {manager}=require('../api/mkv-hls.cjs');
const {setTimeout:delay}=require('node:timers/promises');
const PROBE_TIMEOUT_MS=20000;
const START_TIMEOUT_MS=20000;
async function waitForManifest(path,job){
  const deadline=Date.now()+START_TIMEOUT_MS;
  let ended=false;
  job.done.then(()=>{ended=true;},()=>{ended=true;});
  while(Date.now()<deadline){
    if(ended)throw new Error('FFmpeg finalizó antes de generar HLS');
    try{
      const text=await fs.readFile(path,'utf8');
      if(text.startsWith('#EXTM3U')&&/^seg_[0-9]{5}\.ts$/m.test(text))return;
    }catch(error){if(error.code!=='ENOENT')throw error;}
    await delay(200);
  }
  throw new Error('FFmpeg no produjo el primer segmento a tiempo');
}
async function resolveMkv({url,hosts}){
  if(manager.isBusy())return {busy:true};
  // The probing stream is discarded. No provider URL is passed to FFprobe.
  const probing=await openProviderStream({url,hosts});
  let plan;
  try{
    plan=await Promise.race([
      probeMkv({source:probing.stream}),
      delay(PROBE_TIMEOUT_MS).then(()=>{probing.abort();throw new Error('Análisis MKV agotó tiempo');})
    ]);
  }finally{probing.abort();}
  if(!plan.supported)return {unsupported:true,reason:plan.reason||'Códec no compatible'};
  const session=await manager.start({startJob:async workspace=>{
    const playback=await openProviderStream({url,hosts});
    const job=startPipedRemux({plan,source:playback.stream,playlistPath:workspace.playlistPath});
    try{await waitForManifest(workspace.playlistPath,job);}
    catch(error){job.stop();job.done.catch(()=>{});throw error;}
    return job;
  }});
  if(!session)return {busy:true};
  return {mediaUrl:session.playlistUrl,expires:session.expires};
}
module.exports={resolveMkv,waitForManifest};
