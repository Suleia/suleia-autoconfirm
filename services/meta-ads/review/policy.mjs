import {DIAGNOSTIC_SAMPLE} from '../report.mjs';

export const REVIEW_VERSION='suleia-review-v6.0';
// Internal review safeguards, never instructions to the budget executor.
export const REVIEW_POLICY=Object.freeze({version:REVIEW_VERSION,...DIAGNOSTIC_SAMPLE,maxCampaigns:5,maxDays:90,materialChangePercent:20,minTrendDays:3,matureAfterDays:7,conversionLagDays:7,alertCooldownMs:86400000,maxAlerts:10});
const sources=[
 ['insights','https://developers.facebook.com/docs/marketing-api/insights/','ACCESS_LIMITED_429','Official reference unavailable to this extraction; fields cross-checked with the pinned SDK.'],
 ['postman','https://www.postman.com/meta/facebook-marketing-api/folder/zzd6d5p/insights-api','SHELL_ONLY','Official collection landing page; operation bodies were not accessible.'],
 ['sdk','https://github.com/facebook/facebook-python-business-sdk/tree/39ca02c3b492222c26ba2fd08d5414af51d4f781','AVAILABLE','v25.0.0 pinned SDK; field availability is not a guarantee of compatible breakdown combinations.'],
 ['attribution-2026','https://about.fb.com/ltam/news/2026/03/simplificando-la-medicion-de-anuncios-para-un-mundo-social-first/','AVAILABLE','Rollout announcement. Account-specific effective date is unknown.'],
 ['experiments','https://formedia.facebookblueprint.com/student/path/219763-ab-test-conversion-brand-lift-course','OUTLINE_ONLY','A/B, creative and lift study outline; no claim of access to complete lessons.'],
 ['creative-formats','https://www.facebookblueprint.com/student/activity/707402','OUTLINE_ONLY','Diversification guidance; no universal frequency or fatigue threshold.'],
 ['creative-diversity','https://www.facebookblueprint.com/student/path/253130-increase-campaign-performance-with-diversified-creative','OUTLINE_ONLY','Concepts, motivations and formats; hypotheses need a test.'],
 ['lift','https://certifications.facebookblueprint.com/student/page/674272-measure-channel-impact-with-meta-conversion-lift','OUTLINE_ONLY','Lift study outline. Attributed ROAS is not incremental lift.'],
 ['wilson','https://www.itl.nist.gov/div898/handbook/prc/section2/prc241.htm','AVAILABLE','Binomial intervals require a justified trial definition and independence.'],
 ['fdr','https://academic.oup.com/jrsssb/article/57/1/289/7035855','ABSTRACT','BH controls FDR under assumptions; arbitrary dependence uses the conservative BY harmonic correction.']
];
export const KNOWLEDGE={version:'meta-knowledge-2026-10-23-v7',reviewedAt:'2026-10-23',apiVersion:'v25.0',sources:sources.map(([id,url,access,note])=>({id,url,access,note})),
 official:['Attributed outcomes depend on reporting windows and event scope.','Creative diversification and controlled experiments can inform decisions.','Incrementality requires an appropriate causal study.'],
 internal:['Sample, maturity, materiality and cooldown values are Suleia review criteria, not Meta algorithm rules.','The V5.1 monetary policy remains solely in the existing budget executor.'],
 formulas:{roas:'sum(purchaseValue) / sum(spend)',cpa:'sum(spend) / sum(purchases)',ctr:'100 * sum(linkClicks) / sum(impressions)',cpc:'sum(spend) / sum(linkClicks)',cpm:'1000 * sum(spend) / sum(impressions)',aov:'sum(purchaseValue) / sum(purchases)'}};
export const AUDIT_PROFILES=Object.freeze([{id:'daily',period:'ayer'},{id:'weekly',period:'7d'},{id:'monthly',period:'30d'}].map(x=>({...x,status:'PREPARED_ONLY',scheduled:false,notifications:false,externalWrites:0})));
