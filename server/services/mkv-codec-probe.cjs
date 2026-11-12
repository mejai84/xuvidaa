'use strict';
// Probe a strictly bounded prefix. Provider URL never reaches ffprobe.
// 4 MiB maximum in memory; probing uses a separate upstream connection from playback.
const {spawn}=require('node:child_process');
const {selectMkvPlan}=require('./mkv-remux-policy.cjs');
const MAX_PROBE_BYTES=4*1024*1024;
const MAX_RESULT_BYTES=64*1024;

async function readPrefix(source,maxBytes) {
  const chunks=[];let length=0;
  try {
    for await(const chunk of source) {
      const remaining=maxBytes-length;
      if(remaining<=0)break;
      const part=chunk.subarray(0,remaining);
      chunks.push(part);length+=part.length;
      if(length>=maxBytes)break;
    }
    return Buffer.concat(chunks,length);
  } finally {source.destroy();}
}
async function probeMkv({source,spawnProcess=spawn,timeoutMs=12000,maxBytes=MAX_PROBE_BYTES}) {
  if(!source||typeof source[Symbol.asyncIterator]!=='function'||typeof source.destroy!=='function')
    throw new TypeError('Origen inválido');
  if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1000||timeoutMs>30000||
     !Number.isSafeInteger(maxBytes)||maxBytes<1024||maxBytes>MAX_PROBE_BYTES)
    throw new RangeError('Límite inválido');
  let child,timer;
  try {
    const prefix=await readPrefix(source,maxBytes);
    if(!prefix.length)throw new Error('Archivo vacío');
    const args=['-v','error','-protocol_whitelist','pipe',
      '-probesize',String(maxBytes),'-analyzeduration','5000000',
      '-show_entries','stream=codec_type,codec_name:stream_disposition=attached_pic',
      '-of','json','-i','pipe:0'];
    child=spawnProcess('ffprobe',args,{shell:false,stdio:['pipe','pipe','ignore'],env:{PATH:'/usr/bin:/bin'}});
    if(!child||!child.stdin||!child.stdout||typeof child.kill!=='function')
      throw new TypeError('Proceso inválido');
    let result='',size=0,failed=false;
    const exit=new Promise((resolve,reject)=>{
      child.once('error',reject);
      child.once('close',code=>code===0&&!failed?resolve():reject(new Error('Análisis de códecs fallido')));
    });
    child.stdout.on('data',chunk=>{
      size+=chunk.length;
      if(size>MAX_RESULT_BYTES){failed=true;child.kill('SIGKILL');return;}
      result+=chunk.toString('utf8');
    });
    // Keep a rejection handler attached before writing to the subprocess.
    const writing=new Promise((resolve,reject)=>{
      child.stdin.once('error',reject);
      child.stdin.end(prefix,resolve);
    });
    timer=setTimeout(()=>{failed=true;child.kill('SIGKILL');},timeoutMs);
    timer.unref?.();
    await Promise.all([exit,writing]);
    const parsed=JSON.parse(result);
    return selectMkvPlan(parsed.streams);
  } finally {
    if(timer)clearTimeout(timer);
    if(child)try{child.kill('SIGKILL');}catch(_){}
    source.destroy();
  }
}
module.exports={probeMkv,readPrefix};
