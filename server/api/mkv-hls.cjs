'use strict';
const {createMkvSessionManager}=require('../services/mkv-session-manager.cjs');
const manager=createMkvSessionManager();
async function handler(req,res,{id,filename,token}){
  res.setHeader('Cache-Control','private, no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  if(req.method!=='GET'&&req.method!=='HEAD'){
    res.statusCode=405;return res.end();
  }
  let item;
  try{item=await manager.read(id,token,filename);}
  catch(_){
    res.statusCode=404;return res.end();
  }
  if(!item){
    res.statusCode=404;return res.end();
  }
  res.statusCode=200;
  res.setHeader('Content-Type',item.mime);
  res.setHeader('Content-Length',String(item.data.length));
  return res.end(req.method==='HEAD'?undefined:item.data);
}
module.exports={handler,manager};
