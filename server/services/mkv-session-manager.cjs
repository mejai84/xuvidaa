'use strict';
// Single active session with short-lived, unguessable HLS access capability.
// Access also requires the normal TVVIDAA session cookie at the HTTP router.
const crypto=require('node:crypto');
const {createRemuxGate}=require('./mkv-remux-gate.cjs');
const {createWorkspace,readSegment,removeWorkspace}=require('./mkv-hls-workspace.cjs');
const {rewriteLocalPlaylist}=require('./mkv-hls-manifest.cjs');
const TTL_MS=2*60*60*1000;
function createMkvSessionManager({gate=createRemuxGate(),workspaceFactory=createWorkspace,
  segmentReader=readSegment,workspaceRemover=removeWorkspace,now=Date.now}={}) {
  let current=null;
  function valid(id,token){
    if(!current||typeof id!=='string'||typeof token!=='string'||
       !/^[a-f0-9]{32}$/.test(id)||!/^[a-f0-9]{64}$/.test(token))return false;
    if(current.workspace.id!==id||now()>current.expires)return false;
    return crypto.timingSafeEqual(Buffer.from(token,'hex'),Buffer.from(current.token,'hex'));
  }
  async function stop(){
    const old=current;
    current=null;
    if(!old)return;
    gate.release(old.lease);
    await workspaceRemover(old.workspace);
  }
  async function start({startJob}){
    if(typeof startJob!=='function')throw new TypeError('Se requiere iniciar trabajo');
    if(current||gate.busy())return null;
    // Reserve the gate before asynchronous directory creation.
    const lease=gate.acquire(()=>{if(current?.job)current.job.stop();});
    if(!lease)return null;
    let workspace;
    try {
      workspace=await workspaceFactory();
      const token=crypto.randomBytes(32).toString('hex');
      const expires=now()+TTL_MS;
      const job=await startJob(workspace);
      if(!job||typeof job.stop!=='function'||!job.done||typeof job.done.then!=='function')
        throw new Error('Trabajo inválido');
      current={workspace,token,lease,expires,job};
      job.done.catch(()=>{}).finally(()=>{if(current?.lease===lease)stop().catch(()=>{});});
      return {id:workspace.id,token,expires,playlistUrl:'/api/mkv/'+workspace.id+'/index.m3u8?token='+token};
    }catch(err){
      gate.release(lease);
      if(workspace)await workspaceRemover(workspace);
      throw err;
    }
  }
  async function read(id,token,filename){
    if(!valid(id,token)||!gate.touch(current.lease))return null;
    if(!/^(?:index\.m3u8|seg_[0-9]{5}\.ts)$/.test(filename))return null;
    const data=await segmentReader(current.workspace,filename);
    if(filename!=='index.m3u8')return {mime:'video/mp2t',data};
    const playlist=rewriteLocalPlaylist(data.toString('utf8'),name=>
      '/api/mkv/'+id+'/'+name+'?token='+token);
    return {mime:'application/vnd.apple.mpegurl',data:Buffer.from(playlist)};
  }
  return {start,read,stop,isBusy:()=>!!current||gate.busy()};
}
module.exports={createMkvSessionManager};
