import {REMINDER_JOB} from './order-reminder-policy.mjs';
import {createScheduledJobQueue} from '../scheduled-job-queue.mjs';

// Register on the existing poll tick, not after the long order workflow.
// The shared queue still serializes/coalesces all jobs. No timer is created.
export function queueOrderReminderScan({enabled,schedule,scan,onCycle=()=>{}}){
 if(!enabled)return null;
 return schedule(REMINDER_JOB,async()=>{
  const report=await scan({natural:true});onCycle(report);return report;
 });
}

// Reuse the scheduler's coalescing primitive, not its unrelated long-workflow
// tail. This is a job lane, with no timer or HTTP queue of its own. The Chatby
// client still serializes/paces every actual provider request for all workflows.
export function createOrderReminderJobScheduler({enabled,scan,onCycle,onError=()=>{}}){
 const jobs=createScheduledJobQueue();
 return ()=>{
  const scheduled=queueOrderReminderScan({enabled:typeof enabled==='function'?enabled():enabled,schedule:jobs.schedule,scan,onCycle});
  return scheduled?.catch(error=>{onError(error);return null;})||null;
 };
}
