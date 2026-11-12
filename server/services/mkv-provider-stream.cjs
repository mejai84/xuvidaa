'use strict';

// Validated, DNS-pinned provider stream for FFmpeg. No redirects, shell or URL
// is ever passed to the decoder. Caller must consume/destroy the response.
const dns=require('node:dns');
const http=require('node:http');
const https=require('node:https');
const {validateUrl,publicIPv4}=require('../api/media.cjs');
const MAX_BYTES=12*1024*1024*1024;

async function openProviderStream({url,hosts,source,headers={},dnsLookup=dns.promises.lookup,httpRequest=http.request,httpsRequest=https.request,signal,timeoutMs=25000}) {
  const uri=validateUrl(url,hosts,source);
  if (!uri) throw new Error('Origen no permitido');
  if (!Number.isSafeInteger(timeoutMs)||timeoutMs<1000||timeoutMs>60000) throw new Error('Timeout inválido');
  if (signal?.aborted) throw new Error('Cancelado');
  const addresses=await dnsLookup(uri.hostname,{all:true,verbatim:true});
  if (!Array.isArray(addresses)||!addresses.length) throw new Error('DNS no disponible');
  const ipv4=addresses.filter(a=>a.family===4);
  if (!ipv4.length||ipv4.some(a=>!publicIPv4(a.address))) throw new Error('Dirección de red no permitida');
  const pinned=ipv4[0].address;
  const safeHeaders={'Accept-Encoding':'identity','Connection':'close'};
  // Only internal, explicitly approved header names are supported.
  for (const [name,value] of Object.entries(headers)) {
    if (!/^(?:user-agent|referer|accept)$/i.test(name)||typeof value!=='string'||value.length>1024||/[\r\n]/.test(value)) {
      throw new Error('Cabecera no permitida');
    }
    safeHeaders[name]=value;
  }
  return new Promise((resolve,reject)=>{
    let settled=false;
    const secure=uri.protocol==='https:';
    const options={
      protocol:uri.protocol,hostname:uri.hostname,
      port:secure?443:Number(uri.port||80),
      path:uri.pathname+uri.search,method:'GET',headers:safeHeaders,
      timeout:timeoutMs,
      lookup:(_host,opts,callback)=>opts&&opts.all
        ?callback(null,[{address:pinned,family:4}])
        :callback(null,pinned,4)
    };
    if(secure)options.servername=uri.hostname;
    let request;
    function fail(err){if(settled)return;settled=true;reject(err);}
    try {
      request=(secure?httpsRequest:httpRequest)(options,response=>{
        if(settled){response.destroy();return;}
        const status=response.statusCode||0;
        if(status!==200){response.destroy();return fail(new Error('Respuesta del proveedor no válida'));}
        const length=Number(response.headers['content-length']||0);
        if(!Number.isFinite(length)||length<0||length>MAX_BYTES){
          response.destroy();return fail(new Error('Tamaño no permitido'));
        }
        settled=true;
        resolve({stream:response,abort:()=>request.destroy(),contentLength:length||null});
      });
    }catch(err){return fail(err);}
    request.on('timeout',()=>request.destroy(new Error('Tiempo agotado')));
    request.on('error',fail);
    if(signal)signal.addEventListener('abort',()=>request.destroy(new Error('Cancelado')),{once:true});
    request.end();
  });
}
module.exports={openProviderStream};
