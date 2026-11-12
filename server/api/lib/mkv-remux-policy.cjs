'use strict';

// Conservative codec policy for an eventual copy-only MKV -> fragmented MP4
// remux. The policy does not infer compatibility from a .mkv extension.
// Unknown or missing codec metadata must be rejected, never transcoded.
const VIDEO = new Set(['h264']);
const AUDIO = new Set(['aac', 'mp3']);
function decideCopyRemux(streams) {
  if (!Array.isArray(streams) || streams.length === 0) return {ok:false,reason:'NO_STREAMS'};
  const video = streams.filter(s=>s && s.codec_type==='video');
  const audio = streams.filter(s=>s && s.codec_type==='audio');
  if (video.length!==1 || !VIDEO.has(String(video[0].codec_name||'').toLowerCase()))
    return {ok:false,reason:'UNSUPPORTED_VIDEO_CODEC'};
  if (audio.length>1 || audio.some(s=>!AUDIO.has(String(s.codec_name||'').toLowerCase())))
    return {ok:false,reason:'UNSUPPORTED_AUDIO_CODEC'};
  if (streams.some(s=>s && !['video','audio','subtitle','attachment','data'].includes(s.codec_type)))
    return {ok:false,reason:'UNKNOWN_STREAM'};
  return {ok:true,videoCodec:video[0].codec_name,audioCodec:audio[0] ? audio[0].codec_name : null};
}
module.exports={decideCopyRemux};
