'use strict';
// Stream a validated provider response into FFmpeg stdin. No MKV file on disk.
// Only invoke after codec probing has approved an H264 remux plan.
const {spawn}=require('node:child_process');
const {pipeline}=require('node:stream/promises');
const {ffmpegHlsArgs}=require('./mkv-remux-policy.cjs');
function startPipedRemux({plan,source,playlistPath,spawnProcess=spawn,timeoutMs=30*60*1000}) {
  if (!source||typeof source.pipe!=='function'||typeof source.destroy!=='function')
    throw new TypeError('Origen de streaming inválido');
  if (!Number.isSafeInteger(timeoutMs)||timeoutMs<1000||timeoutMs>2*60*60*1000)
    throw new RangeError('Timeout inválido');
  const args=ffmpegHlsArgs(plan,'pipe:0',playlistPath);
  let child;
  try {
    child=spawnProcess('ffmpeg',args,{shell:false,stdio:['pipe','ignore','ignore'],
      env:{PATH:'/usr/bin:/bin'},windowsHide:true});
  }catch(error){source.destroy();return {done:Promise.reject(error),stop:()=>{}};}
  if(!child||!child.stdin||typeof child.once!=='function'||typeof child.kill!=='function')
    throw new TypeError('Proceso inválido');
  let stopping=false,finished=false;
  let timer;
  function stop() {
    if(finished)return;
    stopping=true;
    source.destroy();
    child.stdin.destroy();
    try{child.kill('SIGKILL');}catch(_){}
  }
  const exit=new Promise((resolve,reject)=>{
    child.once('error',reject);
    child.once('close',code=>code===0&&!stopping?resolve():reject(new Error(stopping?'Conversión cancelada':'FFmpeg no pudo convertir el video')));
  });
  const feeding=pipeline(source,child.stdin);
  // Attach both rejection handlers before either can fail.
  const done=Promise.all([exit,feeding]).then(()=>{
    finished=true;clearTimeout(timer);return {exitCode:0};
  },error=>{
    stop();finished=true;clearTimeout(timer);throw error;
  });
  timer=setTimeout(()=>stop(),timeoutMs);
  timer.unref?.();
  return {done,stop};
}
module.exports={startPipedRemux};
