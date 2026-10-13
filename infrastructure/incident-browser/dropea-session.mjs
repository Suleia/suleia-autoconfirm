import fs from 'node:fs/promises';
// Routine sign-in using only the owner's already-filled dedicated browser
// form. Never extract, log, copy or store the password value.
export async function ensureDropeaSession(page){
 await Promise.any([
  page.getByText('ID 17431',{exact:true}).waitFor({timeout:15000}),
  page.getByPlaceholder('example@gmail.com',{exact:true}).waitFor({timeout:15000})
 ]);
 const url=new URL(page.url());
 if(url.origin!=='https://v2.app.dropea.com')throw Error('DROPEA_ORIGIN_MISMATCH');
 if(url.pathname==='/login'){
  const {email}=JSON.parse(await fs.readFile('/state/dropea-login-identity.json','utf8'));
  const field=page.getByPlaceholder('example@gmail.com',{exact:true});
  await field.waitFor({timeout:15000});
  if(await field.inputValue()!==email)throw Error('DROPEA_LOGIN_OWNER_REQUIRED');
  const filled=await page.getByPlaceholder('Ingresa tu contraseña',{exact:true}).evaluate(e=>e.type==='password'&&e.value.length>0);
  if(!filled)throw Error('DROPEA_INTERACTIVE_LOGIN_REQUIRED');
  await page.getByRole('button',{name:'Iniciar sesión',exact:true}).click();
  await page.waitForURL(u=>u.origin===url.origin&&u.pathname!=='/login',{timeout:30000});
 }
 await page.getByText('ID 17431',{exact:true}).waitFor({timeout:15000});
 return true;
}
