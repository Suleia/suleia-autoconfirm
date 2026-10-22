// Deployment tool: provider validation only, using the existing monetary transport.
// Stdout is a private receipt (campaign/account IDs, never credentials).
import {createMetaAdsReadClient} from '../meta-ads-client.mjs';
import {createMetaBudgetTransport} from '../executor-transport.mjs';
const env=process.env,approved=JSON.parse(env.AUTOPILOT_APPROVED_POLICY_JSON||'{}');
if(env.AUTOPILOT_MODE!=='SHADOW'||env.ADS_INTELLIGENCE_WRITES_ENABLED!=='false'||approved.policyProfile!=='V5_1_FIXED_EUR'||approved.minimumBudgetCents!==1500||!approved.approvalReference)throw Error('MINIMUM_VALIDATION_NOT_AUTHORIZED');
const accountId=String(env.META_ADS_AD_ACCOUNT_ID||env.META_AD_ACCOUNT_ID||'').replace(/^act_/,'');
const options={accountId,accessToken:env.META_ADS_ACCESS_TOKEN||env.META_ACCESS_TOKEN,apiVersion:env.META_ADS_API_VERSION||env.META_API_VERSION||'v25.0'};
const reader=createMetaAdsReadClient(options);
const writer=createMetaBudgetTransport({...options,reader,allowedCampaignIds:[],accountBudgetsAuthorized:true,validationOnly:true,mode:'SHADOW',writesEnabled:false});
const campaigns=(await reader.readCampaigns()).filter(c=>c.status==='ACTIVE'&&c.effective_status==='ACTIVE'&&Number.isSafeInteger(Number(c.daily_budget))&&Number(c.daily_budget)>0&&Number(c.lifetime_budget||0)===0);
if(!campaigns.length)throw Error('NO_ELIGIBLE_CAMPAIGN_SCOPE');
const receipts=[];
for(const c of campaigns){
 await writer.validateDailyBudget(String(c.id),approved.minimumBudgetCents,{expectedBefore:Number(c.daily_budget)});
 const at=Date.now();receipts.push({accountId,campaignId:String(c.id),currency:'EUR',minimumCents:approved.minimumBudgetCents,reference:approved.approvalReference,verifiedAt:new Date(at).toISOString(),validUntil:new Date(at+86400000).toISOString()});
}
console.log(JSON.stringify({receipts,validatedCampaigns:receipts.length,externalWrites:0,unchangedBudgetsVerified:true}));
