'use strict';
// Probe only a bounded prefix of an already DNS-validated provider stream.
// Never let ffprobe access provider URLs or follow protocols.
const {spawn}=require('node:child_process');
const {pipeline}=require('node:stream/promises');
const {PassThrough}=require('node:stream');
const {selectMkvPlan}=require('./mkv-remux-policy.cjs');
const MAX_PROBE_BYTES=4*1024*1024;
const MAX_RESULT_BYTES=64*1024;
function probeMkv({source,spawnProcess=spawn,timeoutMs=12000,maxBytes=MAX_PROBE_BYTES}) {
  if (!source||typeof source.pipe!=='function'||typeof source.destroy!=='function') throw new TypeError('Origen inválido');
  if (!Number.isSafeInteger(timeoutMs)||timeoutMs<1000||timeoutMs>30000 ||
      !Number.isSafeInteger(maxBytes)||maxBytes<1024||maxBytes>MAX_PROBE_BYTES) throw new RangeError('Límite inválido');
  const args=['-v','error','-nostdin','-protocol_whitelist','pipe',
    '-probesize',String(maxBytes),'-analyzeduration','5000000',
    '-show_entries','stream=codec_type,codec_name:stream_disposition=attached_pic',
    '-of','json','-i','pipe:0'];
  let child;
  try {child=spawnProcess('ffprobe',args,{shell:false,stdio:['pipe','pipe','ignore'],env:{PATH:'/usr/bin:/bin'}});}
  catch(err){source.destroy();return Promise.reject(err);}
  if(!child||!child.stdin||!child.stdout||typeof child.kill!=='function')throw new TypeError('Proceso inválido');
  let bytes=0,output=0,parts=[],finished=false;
  const limiter=new PassThrough();
  const timer=setTimeout(()=>{child.kill('SIGKILL');source.destroy(new Error('Tiempo de análisis agotado'));},timeoutMs);
  timer.unref?.();
  source.on('data',chunk=>{
    bytes+=chunk.length;
    if(bytes>maxBytes){source.unpipe(limiter);source.destroy();limiter.end();}
  });
  child.stdout.on('data',chunk=>{
    output+=chunk.length;
    if(output>MAX_RESULT_BYTES){child.kill('SIGKILL');return;}
    parts.push(chunk);
  });
  const exit=new Promise((resolve,reject)=>{
    child.once('error',reject);
    child.once('close',code=>code===0?resolve():reject(new Error('No se pudieron analizar los códecs')));
  });
  const feeding=pipeline(source,limiter,child.stdin).catch(err=>{
    if(bytes>maxBytes)return;
    throw err;
  });
  return Promise.all([exit,feeding]).then(()=>{
    finished=true;
    const parsed=JSON.parse(Buffer.concat(parts).toString('utf8'));
    return selectMkvPlan(parsed.streams);
  }).finally(()=>{
    clearTimeout(timer);
    if(!finished)child.kill('SIGKILL');
    source.destroy();
  });
}
module.exports={probeMkv};
