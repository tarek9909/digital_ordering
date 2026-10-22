import {readdir,readFile,stat,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {join,relative} from 'node:path';
const repo=fileURLToPath(new URL('../../../',import.meta.url));
const skip=new Set(['node_modules','dist','.git','.storage','test-results','.auth']);
const files=[];
async function walk(dir){for(const ent of await readdir(dir,{withFileTypes:true})){if(skip.has(ent.name)||ent.name.startsWith('.env'))continue;const path=join(dir,ent.name);if(ent.isDirectory())await walk(path);else if(/\.(?:ts|tsx|mjs|js|json|sql|html|css)$/.test(ent.name)){const body=await readFile(path);files.push({path:relative(repo,path).replaceAll('\\','/'),sha256:createHash('sha256').update(body).digest('hex'),size:body.length,modifiedAt:(await stat(path)).mtime.toISOString()});}}}
await walk(join(repo,'backend'));await walk(join(repo,'frontend'));files.sort((a,b)=>a.path.localeCompare(b.path));
const phase=process.argv[2]??'final';
await writeFile(new URL(`source-snapshot-${phase}.json`,import.meta.url),JSON.stringify({generatedAt:new Date().toISOString(),files},null,2)+'\n');
const before=await readFile(new URL('source-snapshot-before.json',import.meta.url),'utf8').then(JSON.parse).catch(()=>null);
const previous=new Map(before?.files.map(f=>[f.path,f.sha256])??[]);
console.log(JSON.stringify({phase,files:files.length,...(phase!=='before'&&before?{changedSinceBefore:files.filter(f=>previous.get(f.path)!==f.sha256).map(f=>f.path)}:{})}));
