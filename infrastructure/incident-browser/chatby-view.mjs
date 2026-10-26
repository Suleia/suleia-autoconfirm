const origin='https://app.chatby.io';
const accountPath='/settings/accounts/298087';

// Only the worker's existing account view, while the caller holds its idle
// probe guard. No login, composer interaction, URL change or credential read.
export async function ensureChatbyView(page){
 const assertAccount=()=>{
  const url=new URL(page.url());
  if(url.origin!==origin||url.pathname.replace(/\/$/,'')!==accountPath)throw Error('CHATBY_ACCOUNT_VIEW_REQUIRED');
 };
 assertAccount();
 const search=page.getByPlaceholder('Buscar',{exact:true}).filter({visible:true});
 try{await search.waitFor({timeout:15000});return {ready:true,reloaded:false};}catch{}
 assertAccount();
 await page.reload({waitUntil:'domcontentloaded',timeout:60000});
 assertAccount();
 try{await search.waitFor({timeout:30000});}catch{throw Error('CHATBY_SESSION_OR_VIEW_REQUIRED');}
 return {ready:true,reloaded:true};
}
