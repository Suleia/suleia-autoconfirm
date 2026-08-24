# Meta Marketing API read contract

## Version and primary sources

The deployed Render integration is explicitly configured for Graph API `v25.0`. The official Meta Business SDK repository was also checked; its current package line is `26.0.0`. META-1 does not silently upgrade the live integration. API version is explicit configuration and must be revalidated before a later deployment.

Primary Meta-owned references:

- [Meta Business SDK for Node.js](https://github.com/facebook/facebook-nodejs-business-sdk)
- [AdAccount edges and fields](https://github.com/facebook/facebook-nodejs-business-sdk/blob/main/src/objects/ad-account.js)
- [Campaign budget/status fields](https://github.com/facebook/facebook-nodejs-business-sdk/blob/main/src/objects/campaign.js)
- [AdSet budget/status fields](https://github.com/facebook/facebook-nodejs-business-sdk/blob/main/src/objects/ad-set.js)
- [AdsInsights metrics and enums](https://github.com/facebook/facebook-nodejs-business-sdk/blob/main/src/objects/ads-insights.js)

Direct Meta documentation pages returned rate-limit responses during the audit. No endpoint was inferred from the screenshot; endpoint/field contracts were verified against Meta's official SDK sources and then against real GET responses.

## GET endpoints

All calls use `Authorization: Bearer ...`; tokens in URLs are rejected.

| Purpose | Endpoint | Important fields/parameters |
|---|---|---|
| Permissions | `GET /{version}/me/permissions` | `ads_read`, broader-scope audit |
| Account | `GET /{version}/act_{account_id}` | `account_status,currency,timezone_name,timezone_offset_hours_utc` |
| Active campaigns | `GET /{version}/act_{account_id}/campaigns` | exact `effective_status IN [ACTIVE]`; campaign budget/status fields |
| Active ad sets | `GET /{version}/{campaign_id}/adsets` | used only when campaign has no budget; active ad-set budgets |
| Today's insights | `GET /{version}/act_{account_id}/insights` | `level=campaign`, exact Madrid business date, `action_report_time=conversion`, account attribution setting |

The insights fields are `campaign_id,campaign_name,date_start,date_stop,spend,actions,action_values,purchase_roas,website_purchase_roas`.

## Purchase ROAS parsing

The parser never selects the first array element and never converts missing data into zero.

1. Prefer `website_purchase_roas` with exact action type `offsite_conversion.fb_pixel_purchase`.
2. If absent, inspect `purchase_roas` for the explicit purchase types `offsite_conversion.fb_pixel_purchase`, `omni_purchase`, then `purchase`.
3. Conflicting duplicate values become `AMBIGUOUS`; absent/invalid values become `NO_DATA` with `purchase_roas=null`.
4. `actions` and `action_values` are parsed with the same purchase-only action vocabulary.

Attribution uses the ad account's configured attribution setting (`use_account_attribution_setting=true`) and reports conversions by conversion time (`action_report_time=conversion`). The exact effective attribution window must be included in the later META-6 reconciliation evidence from the account configuration/Ads Manager; it is not invented in META-1.

## Real read-only findings

On 2026-08-22, authenticated GET checks found:

- account status active;
- currency EUR;
- account timezone `Europe/Madrid` with the expected summer offset;
- 4 dynamically discovered ACTIVE campaigns;
- all 4 budgets owned by campaigns (CBO/Advantage Campaign Budget), 0 requiring ad-set budget reads;
- `ads_read` granted;
- broader `ads_management` and `business_management` scopes also present on the historical credential.

The broader credential is acceptable only for this controlled read audit. A dedicated, inspectable `ads_read` credential is a deployment gate.
