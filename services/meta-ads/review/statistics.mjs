export function wilson(successes,trials,{independent=false,binary=false,z=1.959963984540054}={}){
 if(!independent||!binary||!Number.isInteger(successes)||!Number.isInteger(trials)||trials<=0||successes<0||successes>trials)return null;
 const p=successes/trials,d=1+z*z/trials,c=(p+z*z/(2*trials))/d,h=z*Math.sqrt(p*(1-p)/trials+z*z/(4*trials*trials))/d;
 return {low:Math.max(0,c-h),high:Math.min(1,c+h),method:'WILSON_95',assumptions:'Independent binary trials supplied by the caller'};
}
export function adjustedDiscoveries(tests,{alpha=.05,independent=false}={}){
 const valid=tests.filter(t=>Number.isFinite(t.p)&&t.p>=0&&t.p<=1).sort((a,b)=>a.p-b.p),m=valid.length;
 const harmonic=independent?1:Array.from({length:m},(_,i)=>1/(i+1)).reduce((a,b)=>a+b,0);
 let q=1;const result=[];
 for(let i=m-1;i>=0;i--){q=Math.min(q,valid[i].p*m*harmonic/(i+1));result.unshift({...valid[i],q:Math.min(1,q),discovery:q<=alpha,method:independent?'BH':'BY'});}
 return result;
}
const median=xs=>{const s=xs.toSorted((a,b)=>a-b);return s.length?s.length%2?s[(s.length-1)/2]:(s[s.length/2-1]+s[s.length/2])/2:null;};
export function robustOutliers(values){
 const valid=values.filter(Number.isFinite);if(valid.length<7)return [];
 const med=median(valid),mad=median(valid.map(x=>Math.abs(x-med)));if(!mad)return [];
 return values.flatMap((value,index)=>Number.isFinite(value)&&Math.abs(.67449*(value-med)/mad)>3.5?[{index,value,method:'MAD_EXPLORATORY'}]:[]);
}
export function binarySamplePlan({baselineRate,minimumDetectableAbsolute,independentBinary=false}){
 if(!independentBinary||!(baselineRate>0&&baselineRate<1)||!(minimumDetectableAbsolute>0&&minimumDetectableAbsolute<Math.min(baselineRate,1-baselineRate)))return {perArm:null,status:'TRIAL_DEFINITION_AND_MDE_REQUIRED'};
 // Normal approximation, two-sided alpha .05 and power .80; planning only.
 return {perArm:Math.ceil(2*(1.959964+.841621)**2*baselineRate*(1-baselineRate)/minimumDetectableAbsolute**2),status:'APPROXIMATE_PLANNING_ONLY',alpha:.05,power:.8,assumptions:'Independent randomized binary outcomes; fixed horizon, balanced arms; validate design before execution.'};
}
