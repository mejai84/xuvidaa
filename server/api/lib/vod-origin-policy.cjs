'use strict';
// Explicit, server-only exception for a trusted VOD origin. Disabled by default.
// Only host:port entries from the operator's allowlist can use HTTP.
const net = require('node:net');
function allowedHttpOrigin(uri) {
  if (!uri || uri.protocol !== 'http:' || process.env.VIDAA_HTTP_VOD_ACK !== 'yes') return false;
  const host = uri.hostname.toLowerCase();
  if (!host.includes('.') || host.endsWith('.') || net.isIP(host) || uri.username || uri.password) return false;
  const port = uri.port || '80';
  const allowed = String(process.env.VIDAA_HTTP_VOD_HOSTS || '').split(',')
    .map(s=>s.trim().toLowerCase()).filter(Boolean);
  return allowed.includes(host + ':' + port);
}
function permittedMediaOrigin(uri) {
  if (!uri || uri.username || uri.password) return false;
  if (uri.protocol === 'https:') return !uri.port || uri.port === '443';
  return allowedHttpOrigin(uri);
}
module.exports={allowedHttpOrigin,permittedMediaOrigin};
