import fs from 'node:fs';
const topology=JSON.parse(fs.readFileSync(new URL('./provinces-source.json',import.meta.url)));
const project=([lon,lat])=>lon<-12?[(lon+18.3)*28+20,(29.6-lat)*27+267]:[(lon+9.5)*32+25,(44-lat)*34+8];
const arcs=topology.arcs.map(arc=>{let x=0,y=0;return arc.map(p=>{x+=p[0];y+=p[1];return project([x*topology.transform.scale[0]+topology.transform.translate[0],y*topology.transform.scale[1]+topology.transform.translate[1]]);});});
const ring=indices=>indices.flatMap((index,i)=>{const points=index>=0?arcs[index]:arcs[~index].slice().reverse();return i?points.slice(1):points;});
const path=rings=>rings.map(r=>ring(r).map(([x,y],i)=>(i?'L':'M')+x.toFixed(1)+','+y.toFixed(1)).join('')+'Z').join('');
const provinces=topology.objects.provinces.geometries.filter(g=>Number(g.id)>=1&&Number(g.id)<=52).map(g=>({id:g.id,label:g.properties.name,path:g.type==='Polygon'?path(g.arcs):g.arcs.map(path).join('')}));
if(provinces.length!==52)throw new Error('Expected 52 provinces');
fs.writeFileSync(new URL('../../apps/review-panel/assets/spain-provinces.json',import.meta.url),JSON.stringify({viewBox:'0 0 490 345',attribution:'© IGN / CNIG · CC BY 4.0. Adaptado de es-atlas 0.6.0.',source:'https://github.com/martgnz/es-atlas',provinces}));
