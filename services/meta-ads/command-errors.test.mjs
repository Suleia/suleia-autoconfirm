import test from 'node:test';
import assert from 'node:assert/strict';
import {adsCommandErrorCode} from './command-errors.mjs';
test('safe bridge diagnostics identify provider/auth/busy errors without leaking raw values',()=>{
 for(const code of ['ACTOR_UNAUTHORIZED','ACCOUNT_BUDGET_BUSY','META_HTTP_429','META_REPORT_PREPARING_OR_UNAVAILABLE'])assert.equal(adsCommandErrorCode(Error(code)),code);
 assert.equal(adsCommandErrorCode({code:'META_HTTP_401',message:'secret response'}),'META_HTTP_401');
 assert.equal(adsCommandErrorCode(Error('https://private/?token=secret')),'ADS_COMMAND_FAILED');
});
