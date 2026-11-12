'use strict';
// Private HLS workspace for a single remux job. This is not an HTTP endpoint.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const ROOT = '/tmp/tvvidaa-hls';
const FILE = /^(?:index\.m3u8|seg_[0-9]{5}\.ts)$/;

async function createWorkspace() {
  const id=crypto.randomBytes(16).toString('hex');
  await fs.mkdir(ROOT,{recursive:true,mode:0o700});
  const directory=path.join(ROOT,id);
  await fs.mkdir(directory,{mode:0o700});
  return {id,directory,playlistPath:path.join(directory,'index.m3u8')};
}
function allowedSegment(name) {
  return typeof name==='string' && FILE.test(name);
}
async function readSegment(workspace,name) {
  if (!workspace || !/^[0-9a-f]{32}$/.test(workspace.id) || !allowedSegment(name)) {
    throw new Error('Segmento inválido');
  }
  const file=path.join(ROOT,workspace.id,name);
  const handle=await fs.open(file,fs.constants.O_RDONLY | (require('node:fs').constants.O_NOFOLLOW || 0));
  try {
    const stat=await handle.stat();
    if(!stat.isFile() || stat.size>16*1024*1024)throw new Error('Segmento demasiado grande');
    return await handle.readFile();
  } finally {await handle.close();}
}
async function removeWorkspace(workspace) {
  if(!workspace || !/^[0-9a-f]{32}$/.test(workspace.id))return false;
  await fs.rm(path.join(ROOT,workspace.id),{recursive:true,force:true,maxRetries:2});
  return true;
}
module.exports={createWorkspace,readSegment,removeWorkspace,allowedSegment,ROOT};
