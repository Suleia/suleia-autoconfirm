import {REMINDER_JOB} from './order-reminder-policy.mjs';

// Register on the existing poll tick, not after the long order workflow.
// The shared queue still serializes/coalesces all jobs. No timer is created.
export function queueOrderReminderScan({enabled,schedule,scan,onCycle=()=>{}}){
 if(!enabled)return null;
 return schedule(REMINDER_JOB,async()=>{
  const report=await scan({natural:true});onCycle(report);return report;
 });
}
