'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
let running = 0;

function available(env = process.env) {
  if (env.MEDIA_COMPAT_ENABLED !== 'true' || !path.isAbsolute(env.FFMPEG_PATH || '')) return false;
  try { return fs.statSync(env.FFMPEG_PATH).isFile(); } catch { return false; }
}

function isMatroska(entry) {
  try { return entry.source === 'vod' && (/\.mkv$/i.test(new URL(entry.url).pathname) ||
    /^(?:video|application)\/(?:x-)?matroska$/i.test(entry.mime)); } catch { return false; }
}

// Only a stream that already passed the media relay's DNS, host and HTTP checks
// reaches this process. FFmpeg receives media bytes through stdin, never a URL.
function convert(input, res, options = {}) {
  const env = options.env || process.env;
  const fail = (status, message) => {
    if (res.headersSent) res.destroy();
    else {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' });
      res.end(JSON.stringify({ error: message }));
    }
  };
  if (!available(env)) { input.destroy(); return fail(503, 'Conversión multimedia no configurada'); }
  if (running >= 1) { input.destroy(); return fail(503, 'El conversor está ocupado. Reintenta en un momento.'); }
  running++;
  let child, timer, released = false;
  function cleanup() {
    if (released) return;
    released = true;
    clearTimeout(timer);
    running--;
    input.destroy();
    if (child && child.exitCode === null) child.kill('SIGKILL');
  }
  function abort() {
    if (released) return;
    cleanup();
    fail(502, 'No se pudo convertir el vídeo para este navegador');
  }
  function deadline() {
    clearTimeout(timer);
    timer = setTimeout(abort, 30000);
    timer.unref();
  }
  try {
    child = spawn(env.FFMPEG_PATH, [
      '-hide_banner', '-loglevel', 'error', '-nostdin',
      '-protocol_whitelist', 'pipe', '-threads', '2', '-f', 'matroska', '-i', 'pipe:0',
      '-map', '0:v:0', '-map', '0:a:0?', '-sn', '-dn',
      '-vf', "scale=w='min(1280,iw)':h='min(720,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2",
      '-c:v', 'libx264', '-threads', '2', '-preset', 'veryfast', '-crf', '23',
      '-pix_fmt', 'yuv420p', '-g', '48', '-c:a', 'aac', '-b:a', '128k',
      '-movflags', 'frag_keyframe+empty_moov+default_base_moof', '-f', 'mp4', 'pipe:1'
    ], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, shell: false });
  } catch { return abort(); }
  child.stderr.resume();
  child.stdin.on('error', abort);
  child.on('error', abort);
  input.on('error', abort);
  input.on('aborted', abort);
  child.stdout.on('error', abort);
  child.stdout.on('data', () => {
    if (released) return;
    if (!res.headersSent) res.writeHead(200, {
      'Content-Type': 'video/mp4', 'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff', 'Accept-Ranges': 'none'
    });
    deadline();
  });
  child.on('close', code => {
    if (code !== 0 || !res.headersSent) abort();
    else cleanup();
  });
  res.on('close', cleanup);
  deadline();
  input.pipe(child.stdin);
  child.stdout.pipe(res);
}

module.exports = { available, isMatroska, convert };
