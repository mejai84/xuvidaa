'use strict';

// Spawn FFmpeg without a shell. Input/output must be private, server-created paths.
// This module deliberately does not fetch provider URLs or expose HLS publicly.
const {spawn} = require('node:child_process');
const {ffmpegHlsArgs} = require('./mkv-remux-policy.cjs');

function startRemux({plan,input,playlistPath,spawnProcess=spawn,timeoutMs=30*60*1000}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs<1000 || timeoutMs>2*60*60*1000) throw new RangeError('Timeout inválido');
  const args=ffmpegHlsArgs(plan,input,playlistPath);
  let child;
  try {
    child=spawnProcess('ffmpeg',args,{
      shell:false,stdio:['ignore','ignore','ignore'],
      env:{PATH:'/usr/bin:/bin'},
      windowsHide:true
    });
  } catch (err) { return {done:Promise.reject(err),stop:()=>{}}; }
  if (!child || typeof child.once!=='function' || typeof child.kill!=='function') throw new TypeError('Proceso inválido');
  let settled=false;
  let timer;
  const done=new Promise((resolve,reject)=>{
    function finish(err,code) {
      if(settled)return;
      settled=true;
      clearTimeout(timer);
      if(err)reject(err);
      else if(code===0)resolve({exitCode:0});
      else reject(new Error('FFmpeg finalizó sin completar la conversión'));
    }
    child.once('error',err=>finish(err));
    child.once('close',code=>finish(null,code));
    timer=setTimeout(()=>{try{child.kill('SIGKILL');}catch(_){};finish(new Error('Tiempo de conversión agotado'));},timeoutMs);
    timer.unref?.();
  });
  function stop(){if(!settled){try{child.kill('SIGKILL');}catch(_){};}}
  return {done,stop};
}
module.exports={startRemux};
