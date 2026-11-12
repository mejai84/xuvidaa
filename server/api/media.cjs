'use strict';

// Standalone TVVIDAA HTTPS media relay. Zero upstream URLs/credentials leave
// the server: only opaque AES-GCM references are sent to web/VIDAA clients.
const https = require('node:https');
const http = require('node:http');
const {permittedMediaOrigin,permittedLiveOrigin} = require('./lib/vod-origin-policy.cjs');
const dns = require('node:dns');
const net = require('node:net');
const tokenCodec = require('./lib/media-token.js');
const registry = require('./media-registry.cjs');
const MANIFEST_LIMIT = 2 * 1024 * 1024;
const RANGE = /^bytes=(?:\d+-\d*|-\d+)$/;

// Deliberately log only fixed labels, numeric status and elapsed time.
// Never log signed media URLs, tokens, headers, upstream hosts or credentials.
function mediaFailure(kind, reason, upstreamStatus, started) {
  const status = Number.isInteger(upstreamStatus) ? upstreamStatus : 0;
  const elapsedMs = Math.max(0, Date.now() - started);
  console.warn('[TVVIDAA media] kind=%s reason=%s upstream_status=%d elapsed_ms=%d',
    kind, reason, status, elapsedMs);
}

function error(res, code, message) {
  if (res.headersSent) { res.destroy(); return; }
  res.setHeader('Cache-Control', 'private, no-store');
  return res.status(code).json({error: message});
}
function publicIPv4(address) {
  if (net.isIP(address) !== 4) return false;
  const x = address.split('.').map(Number);
  const a=x[0], b=x[1], c=x[2];
  if (a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 192 && b === 0 && c === 2) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113)) return false;
  return true;
}
function validateUrl(raw, hosts, source) {
  try {
    const uri = new URL(raw);
    const host = uri.hostname.toLowerCase();
    if (!(source === 'live' ? permittedLiveOrigin(uri) : permittedMediaOrigin(uri)) || net.isIP(host) || !host.includes('.') ||
        host.endsWith('.') || !Array.isArray(hosts) || !hosts.includes(host)) return null;
    return uri;
  } catch (_) { return null; }
}
function createHandler(deps) {
  const modules = deps || {};
  const resolveDns = modules.dnsLookup || dns.lookup;
  const makeHttpsRequest = modules.httpsRequest || https.request;
  const makeHttpRequest = modules.httpRequest || http.request;
  return function handler(req, res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    const secret = process.env.MEDIA_TOKEN_SECRET || '';
    if (!secret) return error(res, 503, 'Servidor de medios no configurado');
    if (req.method !== 'GET' && req.method !== 'HEAD') return error(res, 405, 'Método no permitido');
    const origin = req.headers.origin;
    if (origin) {
      try {
        const actual = new URL(origin), allowed = new URL(process.env.PUBLIC_BASE_URL || '');
        if (actual.protocol !== 'https:' || actual.origin !== origin || actual.origin !== allowed.origin) {
          return error(res, 403, 'Origen no permitido');
        }
      } catch (_) { return error(res, 403, 'Origen no permitido'); }
    }
    if (req.query.child !== undefined || req.query.subtitle !== undefined) {
      return error(res, 400, 'Referencias directas no permitidas');
    }
    const token = String(req.query.token || '');
    const signed = tokenCodec.decode(token, secret);
    if (!signed || !/^[0-9a-f]{40}$/.test(String(signed.ref || ''))) {
      return error(res, 403, 'Referencia multimedia inválida');
    }
    if (!Number.isFinite(signed.exp) || signed.exp < Date.now()) {
      return error(res, 410, 'Referencia multimedia vencida');
    }
    const entry = registry.lookup(token);
    if (!entry) return error(res, 410, 'Referencia multimedia no disponible');
    const url = validateUrl(entry.url, entry.hosts, entry.source);
    if (!url) return error(res, 403, 'Origen multimedia no permitido');
    if (req.headers.range && !RANGE.test(String(req.headers.range))) {
      return error(res, 416, 'Rango inválido');
    }
    let publicBase;
    try {
      const conf = new URL(process.env.PUBLIC_BASE_URL || '');
      if (conf.protocol !== 'https:' || conf.username || conf.password || conf.pathname !== '/' || conf.search || conf.hash) throw new Error('origin');
      publicBase = conf.origin;
    } catch (_) { return error(res, 503, 'Dominio público no configurado'); }

    function reference(source) {
      const child = validateUrl(new URL(source, url).toString(), entry.hosts, entry.source);
      if (!child) throw new Error('Host de segmento no permitido');
      const mimetype = /\.m3u8$/i.test(child.pathname) ? 'application/vnd.apple.mpegurl' : 'application/octet-stream';
      const next = registry.register({
        url:child.toString(),hosts:entry.hosts,source:entry.source,
        mime:mimetype,headers:entry.headers||{},duration:entry.duration||0
      },entry.exp);
      if (!next) throw new Error('No se pudo registrar segmento');
      return publicBase + '/api/media?token=' + encodeURIComponent(next.token);
    }

    const isHls = /mpegurl/i.test(entry.mime || '') || /\.m3u8$/i.test(url.pathname);
    // IPTV .ts as a synthetic single-segment HLS playlist, not an open proxy.
    if (!isHls && req.query.manifest === '1' &&
      (/video\/mp2t/.test(entry.mime || '') || /\.ts$/i.test(url.pathname))) {
      let child;
      try { child=reference(url.toString()); }
      catch (_) { return error(res, 403, 'Segmento no permitido'); }
      const duration=Number.isFinite(entry.duration) && entry.duration>0 ? entry.duration : 86400;
      const manifest='#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:'+
        Math.ceil(duration)+'\n#EXT-X-MEDIA-SEQUENCE:0\n#EXTINF:'+duration+',\n'+child+'\n#EXT-X-ENDLIST\n';
      res.setHeader('Content-Type','application/vnd.apple.mpegurl');
      res.status(200).send(req.method === 'HEAD' ? '' : manifest);
      return;
    }
    // Explicitly disallow off-host redirects and other schemes.
    const headers = Object.assign({}, entry.headers || {});
    delete headers.Host;
    delete headers.host;
    delete headers.Connection;
    if (req.headers.range) headers.Range=String(req.headers.range);
    if (req.headers['if-range']) headers['If-Range']=String(req.headers['if-range']).slice(0,150);
    headers.Connection='close';
    // Request uncompressed HLS text: the relay rewrites manifests, but does not
    // implement Content-Encoding decompression for upstream responses.
    headers['Accept-Encoding']='identity';

    const started = Date.now();
    const kind = isHls ? 'manifest' : 'segment';
    const failLog = (reason, status) => mediaFailure(kind, reason, status, started);

    function requestUpstream(address) {
      const isHttp = url.protocol === 'http:';
      const port = isHttp ? Number(url.port || 80) : 443;
      const options={
        protocol:url.protocol,method:req.method,hostname:url.hostname,
        port,path:url.pathname+url.search,headers,timeout:25000,
        lookup:(_hostname,options,callback)=>{
          // Node 22's family auto-selection requests the dns.lookup(all:true)
          // result shape. Both forms remain pinned to the validated IPv4.
          if(options && options.all)return callback(null,[{address,family:4}]);
          callback(null,address,4);
        }
      };
      if (!isHttp) options.servername=url.hostname;
      const makeRequest = isHttp ? makeHttpRequest : makeHttpsRequest;
      const upstream=makeRequest(options,(remote)=>{
        const status=remote.statusCode||502;
        if ([301,302,303,307,308].includes(status)) {
          failLog('upstream_redirect',status);
          remote.resume();return error(res,502,'El proveedor redirigió la señal');
        }
        // Do not pass provider error pages to the video demuxer as media bytes.
        // A 2xx response alone is not proof that a segment is decodable.
        if (status < 200 || status >= 300) {
          if (status !== 416) {
            failLog('upstream_http_error',status);
            remote.resume();
            return error(res,502,'El proveedor no entregó un segmento multimedia válido');
          }
        }
        const out={
          'Cache-Control':'private, no-store',
          'Content-Type':String(remote.headers['content-type']||'application/octet-stream'),
          'X-Content-Type-Options':'nosniff'
        };
        if (remote.headers['content-length']) out['Content-Length']=remote.headers['content-length'];
        if (remote.headers['content-range']) out['Content-Range']=remote.headers['content-range'];
        if (remote.headers['accept-ranges']) out['Accept-Ranges']=remote.headers['accept-ranges'];
        if (req.method==='HEAD') {
          res.writeHead(status,out);remote.resume();res.end();return;
        }
        const manifest=/mpegurl/i.test(out['Content-Type']) || /\.m3u8$/i.test(url.pathname);
        if (manifest) {
          if (status<200 || status>=300) {
            remote.resume();return error(res,502,'Manifiesto no disponible');
          }
          const chunks=[];let size=0,failed=false;
          function fail(message, reason) {
            if(failed)return;failed=true;
            failLog(reason, status);
            upstream.destroy();
            error(res,502,message);
          }
          remote.on('data',(chunk)=>{
            size+=chunk.length;
            if(size>MANIFEST_LIMIT)return fail('Manifiesto demasiado grande','manifest_too_large');
            chunks.push(chunk);
          });
          remote.on('error',()=>fail('Fallo leyendo manifiesto','manifest_read_error'));
          remote.on('aborted',()=>fail('Proveedor interrumpió manifiesto','manifest_aborted'));
          remote.on('end',()=>{
            if(failed)return;
            try {
              const body=Buffer.concat(chunks).toString('utf8');
              if(!/^\s*#EXTM3U(?:\s|$)/.test(body))throw new Error('not m3u8');
              const playlist=body.split(/\r?\n/).map(line=>{
                if (!line) return line;
                if(line.charAt(0)==='#')return line.replace(/URI=("|')([^"']+)\1/g,(_full,q,relative)=>{
                  return 'URI='+q+reference(relative)+q;
                });
                return reference(line.trim());
              }).join('\n');
              delete out['Content-Length'];delete out['Content-Range'];delete out['Accept-Ranges'];
              out['Content-Type']='application/vnd.apple.mpegurl';
              res.writeHead(200,out);res.end(playlist);
            } catch (_) {
              failLog('manifest_invalid_or_rewrite_rejected',status);
              error(res,502,'El manifiesto contiene recursos no permitidos');
            }
          });
          return;
        }
        // Range 206 / Content-Range and 416 are forwarded unchanged. Do not
        // advertise Accept-Ranges if the provider did not actually supply it.
        res.writeHead(status,out);
        remote.on('error',()=>res.destroy());
        remote.on('aborted',()=>res.destroy());
        remote.pipe(res);
      });
      upstream.on('timeout',()=>{
        failLog('upstream_timeout',0);
        upstream.destroy(new Error('Timeout upstream'));
      });
      upstream.on('error',()=>{
        failLog('upstream_request_error',0);
        error(res,502,'No se pudo conectar con el video');
      });
      res.on('close',()=>{if(!res.writableEnded)upstream.destroy();});
      upstream.end();
    }
    resolveDns(url.hostname,{all:true,verbatim:true},(err,addresses)=>{
      if(err || !Array.isArray(addresses) || !addresses.length) {
        failLog('dns_resolution_failed',0);
        return error(res,502,'No se pudo resolver el origen multimedia');
      }
      const v4=addresses.filter(x=>x.family===4);
      if(!v4.length){
        failLog('dns_no_ipv4',0);
        return error(res,502,'Origen sin IPv4 compatible');
      }
      if(v4.some(x=>!publicIPv4(x.address)))return error(res,403,'Origen de red restringido');
      requestUpstream(v4[0].address);
    });
  };
}
const handler=createHandler();
module.exports=handler;
module.exports.createHandler=createHandler;
module.exports.publicIPv4=publicIPv4;
module.exports.validateUrl=validateUrl;
