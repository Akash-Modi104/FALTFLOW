import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve('public');
const mime={'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png'};
http.createServer(async(req,res)=>{try{const u=new URL(req.url,'http://localhost'),relative=decodeURIComponent(u.pathname).replace(/^\//,'');const file=path.resolve(root,relative||'index.html');if(!file.startsWith(root+path.sep)&&file!==root)throw Error('Invalid path');const stat=await fs.stat(file),body=await fs.readFile(stat.isDirectory()?path.join(file,'index.html'):file);res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(body);}catch{res.writeHead(404);res.end('Not found');}}).listen(4173,'127.0.0.1',()=>console.log('Local: http://127.0.0.1:4173'));
