import {readFileSync} from 'node:fs';
const dist=readFileSync('dist/index.html','utf8');
console.log('dist',dist.match(/assets\/index-[^" ]+\.js/)?.[0]);
for(const host of ['http://localhost:4173','https://os.torneadorauniversal.com.br']) {const html=await (await fetch(host)).text(); console.log(host,html.match(/assets\/index-[^" ]+\.js/)?.[0]);}
