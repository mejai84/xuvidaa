'use strict';

// Rewrite only locally generated HLS playlists. Never expose local paths or
// accept remote references, traversal, query strings or HLS key URIs.
const SEGMENT=/^seg_[0-9]{5}\.ts$/;
function rewriteLocalPlaylist(body, makeUrl) {
  if (typeof body!=='string' || Buffer.byteLength(body)>256*1024 ||
      typeof makeUrl!=='function') throw new Error('Manifiesto inválido');
  const lines=body.replace(/\r\n/g,'\n').split('\n');
  if (lines[0]!=='#EXTM3U') throw new Error('Cabecera HLS inválida');
  let segments=0;
  const output=lines.map(line=>{
    if (!line || line[0]==='#') {
      // FFmpeg's local HLS must not emit external key/map/variant references.
      if (/^#EXT-X-(?:KEY|SESSION-KEY|MAP|MEDIA|STREAM-INF|I-FRAME-STREAM-INF)/.test(line) ||
          /URI\s*=/i.test(line)) throw new Error('Referencia HLS no permitida');
      return line;
    }
    if (!SEGMENT.test(line)) throw new Error('Segmento HLS no permitido');
    if (++segments>12) throw new Error('Demasiados segmentos');
    const url=makeUrl(line);
    if (typeof url!=='string' || !/^\/api\/mkv\/[a-f0-9]{32}\/seg_[0-9]{5}\.ts\?token=[A-Za-z0-9_-]{32,}$/.test(url)) {
      throw new Error('URL local inválida');
    }
    return url;
  });
  return output.join('\n');
}
module.exports={rewriteLocalPlaylist};
