'use strict';

// TVVIDAA MKV remux policy. Pure, testable decisions; no network access.
// Never pass user-supplied URLs or shell strings to FFmpeg.
const MAX_SESSIONS = 1;
const MAX_THREADS = 1;
const MAX_SEGMENT_SECONDS = 6;
const VIDEO_COPY = new Set(['h264']);
const AUDIO_COPY = new Set(['aac']);

function selectMkvPlan(streams) {
  if (!Array.isArray(streams) || streams.length > 32) return { supported: false, reason: 'invalid_streams' };
  const video = streams.find(s => s && s.codec_type === 'video' && s.disposition?.attached_pic !== 1);
  if (!video) return { supported: false, reason: 'no_video' };
  const codec = String(video.codec_name || '').toLowerCase();
  if (!VIDEO_COPY.has(codec)) return { supported: false, reason: 'video_requires_transcode' };
  const audio = streams.find(s => s && s.codec_type === 'audio');
  const audioCodec = audio ? String(audio.codec_name || '').toLowerCase() : '';
  return {
    supported: true,
    mode: 'remux',
    video: 'copy',
    audio: audio ? (AUDIO_COPY.has(audioCodec) ? 'copy' : 'aac') : 'none',
    audioCodec,
    maxSessions: MAX_SESSIONS,
    threads: MAX_THREADS
  };
}

function ffmpegHlsArgs(plan, input, playlistPath) {
  if (!plan || !plan.supported || plan.mode !== 'remux') throw new Error('Plan inválido');
  // stdin is an internally supplied, validated stream; never accept remote URLs.
  if (input !== 'pipe:0' && (typeof input !== 'string' || !/^\/tmp\/tvvidaa-mkv\/[a-zA-Z0-9_-]+\.mkv$/.test(input))) throw new Error('Entrada inválida');
  if (typeof playlistPath !== 'string' || !/^\/tmp\/tvvidaa-hls\/[a-zA-Z0-9_-]+\/index\.m3u8$/.test(playlistPath)) throw new Error('Salida inválida');
  return [
    '-hide_banner', '-loglevel', 'error', '-nostdin', '-threads', String(MAX_THREADS),
    '-protocol_whitelist', 'file,pipe', '-i', input,
    '-map', '0:v:0', '-map', '0:a:0?', '-sn', '-dn',
    '-c:v', 'copy', '-c:a', plan.audio === 'none' ? 'copy' : plan.audio,
    '-f', 'hls', '-hls_time', String(MAX_SEGMENT_SECONDS),
    '-hls_list_size', '5', '-hls_delete_threshold', '1',
    '-hls_flags', 'delete_segments+temp_file+omit_endlist',
    '-hls_segment_filename', playlistPath.replace(/index\.m3u8$/, 'seg_%05d.ts'),
    playlistPath
  ];
}

module.exports = {selectMkvPlan,ffmpegHlsArgs,MAX_SESSIONS};
