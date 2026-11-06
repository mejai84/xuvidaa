'use strict';

const fs = require('node:fs');

// Apply these lifecycle changes only to the browser image's private copy.
// The repository's LG service stays byte-for-byte unchanged. Fail the build if
// a future upstream version no longer has the reviewed source patterns.
function prepareProxySource(source) {
  const replacements = [
    ["req.on('close', cleanup);", "req.on('close', function () { if (!req.complete) cleanup(); });"],
    ["up.on('close', function () { cleanup(); });", "up.on('close', function () { if (!up.complete) cleanup(); });"],
    ["up.on('end', function () { cleanup(); });", "/* Normal EOF is completed by pipe/res.finish before cleanup. */"]
  ];
  for (const [before, after] of replacements) {
    if (source.split(before).length !== 2) throw new Error('Upstream media proxy changed; review the Node lifecycle adapter.');
    source = source.replace(before, after);
  }
  return source;
}

function prepareMagisSource(source) {
  const marker = 'function tryFallbackSeed(origErr) {';
  if (source.split(marker).length !== 2) throw new Error('Upstream portal client changed; review the region error adapter.');
  return source.replace(marker, `${marker}\n    if (origErr && String(origErr.portalCode || '') === 'portal100024') return done(origErr);`);
}

if (require.main === module) {
  const proxyTarget = process.argv[2];
  const magisTarget = process.argv[3];
  if (!proxyTarget || !magisTarget) throw new Error('Usage: node prepare-upstream.js <copied-proxy.js> <copied-magis.js>');
  fs.writeFileSync(proxyTarget, prepareProxySource(fs.readFileSync(proxyTarget, 'utf8')));
  fs.writeFileSync(magisTarget, prepareMagisSource(fs.readFileSync(magisTarget, 'utf8')));
}

module.exports = { prepareProxySource, prepareMagisSource };
