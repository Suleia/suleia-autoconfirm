// Read-only report inventory sharing. The budget engine keeps the original
// reader and therefore always performs its required fresh financial reads.
export function reportReader(reader,{now=()=>Date.now(),ttlMs=60000}={}){
 const cache=new Map(),jobs=new Map(),methods=new Set(['readAccount','readEntities','readCreatives','readRules']);
 return new Proxy(Object.create(null),{get(target,key){const value=reader[key];if(typeof value!=='function')return value;
  if(!methods.has(key))return value.bind(reader);
  return async(...args)=>{
   const id=key+':'+JSON.stringify(args),entry=cache.get(id);if(entry&&now()-entry.at<ttlMs)return entry.value;
   if(!jobs.has(id))jobs.set(id,Promise.resolve().then(()=>value.apply(reader,args)).then(result=>{cache.set(id,{at:now(),value:result});return result;}).finally(()=>jobs.delete(id)));
   return jobs.get(id);
  };
 }});
}
