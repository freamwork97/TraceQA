import fs from 'node:fs';
let assets={};for(let [name,type] of [['index.html','text/html; charset=utf-8'],['app.js','text/javascript; charset=utf-8'],['style.css','text/css; charset=utf-8']])assets['/'+name]={type,body:fs.readFileSync(new URL('web/'+name,import.meta.url),'utf8')};
fs.rmSync(new URL('dist/',import.meta.url),{recursive:true,force:true});fs.mkdirSync(new URL('dist/server/',import.meta.url),{recursive:true});let gateway=fs.readFileSync(new URL('gateway/index.mjs',import.meta.url),'utf8');fs.writeFileSync(new URL('dist/server/index.js',import.meta.url),gateway+'\nexport default createGateway('+JSON.stringify(assets)+');\n');
console.log('Built embedded Sites Worker: UI + same-origin authenticated gateway.');
