import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
export async function renderArtifact(model,{python=process.env.SULEIA_REPORT_PYTHON||'python3'}={}) {
 const input=JSON.stringify(model);if(Buffer.byteLength(input)>4*1024*1024)throw Error('REPORT_TOO_LARGE');
 return new Promise((resolve,reject)=>{
  const child=spawn(python,[fileURLToPath(new URL('./render-report.py',import.meta.url))],{stdio:['pipe','pipe','pipe'],windowsHide:true});
  const chunks=[];let size=0;const timer=setTimeout(()=>{child.kill();reject(Error('REPORT_RENDER_TIMEOUT'));},15000);
  child.stdout.on('data',part=>{size+=part.length;if(size>12*1024*1024){child.kill();reject(Error('REPORT_TOO_LARGE'));}else chunks.push(part);});
  child.stderr.resume();child.stdin.on('error',()=>{});
  child.on('error',()=>{clearTimeout(timer);reject(Error('REPORT_RENDER_FAILED'));});
  child.on('close',code=>{clearTimeout(timer);if(code!==0)return reject(Error('REPORT_RENDER_FAILED'));try{const data=JSON.parse(Buffer.concat(chunks));resolve({png:Buffer.from(data.png,'base64'),pdf:Buffer.from(data.pdf,'base64')});}catch{reject(Error('REPORT_RENDER_FAILED'));}});
  child.stdin.end(input);
 });
}
