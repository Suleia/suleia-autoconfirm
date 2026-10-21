import fs from 'node:fs';
import path from 'node:path';
import { identifyCandidate, planAddition } from './admin-link.mjs';

// Verification only, inside the existing sole polling consumer. No permissions,
// configuration, provider mutations or Telegram queue reads are available here.
export function createAdminLinkObserver({config, api, store, now=()=>Date.now()}) {
  function request() {
    const file=path.join(config.stateDir,'admin-link-request.json');
    if(!fs.existsSync(file))return null;
    const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
    try {
      const stat=fs.fstatSync(fd);
      if(!stat.isFile()||(stat.mode&0o077)||stat.size>16384||
        (typeof process.getuid==='function'&&![0,process.getuid()].includes(stat.uid)))throw Error('ADMIN_LINK_FILE_INVALID');
      return JSON.parse(fs.readFileSync(fd,'utf8'));
    } finally { fs.closeSync(fd); }
  }
  async function once(state,key,chat,text){
    if(state.acknowledgements.includes(key))return;
    // Claim before send. An uncertain reply is never sent a second time.
    state.acknowledgements.push(key);store.save();
    await api.send(chat,text);
  }
  return {async handle(update){
    const m=update?.message;
    if(!m||!Number.isSafeInteger(update.update_id)||!Number.isSafeInteger(m.message_id)||
      !Number.isSafeInteger(m.from?.id)||m.from.is_bot!==false||m.chat?.type!=='private'||
      m.chat.id!==m.from.id||m.forward_origin||m.forward_date||m.edit_date||m.via_bot||m.sender_chat||
      m.is_automatic_forward||!Number.isSafeInteger(m.date)||Math.abs(now()-m.date*1000)>300000)return null;
    const ownerCommand=/^\/vincular_admin(?:\s|$)/.test(m.text||'');
    const candidateCommand=/^\/start link_[A-Za-z0-9_-]{32}$/.test(m.text||'');
    if(!ownerCommand&&!candidateCommand)return null;
    const isAdmin=config.allowedUserIds.includes(String(m.from.id));
    const r=request();
    if(!r||now()>=r.expiresAt){
      if(!ownerCommand||!isAdmin)return null;
      const key=`expired:${r?.requestId||'none'}`;
      store.state.adminLinkExpiredAcks||=[];
      if(!store.state.adminLinkExpiredAcks.includes(key)){
        store.state.adminLinkExpiredAcks=store.state.adminLinkExpiredAcks.slice(-4).concat(key);store.save();
        await api.send(m.chat.id,'La solicitud de identificación ha caducado o todavía no está preparada. Pide un enlace de verificación nuevo; no se ha concedido acceso.');
      }
      return {authorized:true,replied:true};
    }
    // Validate unchanged owner/list/policy even before recording partial evidence.
    await identifyCandidate({request:r,config,updates:[],api,now:now()});
    const ownerMatch=new RegExp(`^/vincular_admin ${r.nonce} @${r.expectedUsername}$`,'i').test(m.text||'')&&
      String(m.from.id)===r.ownerId&&m.text.split(' ')[1]===r.nonce;
    const candidateMatch=m.text===`/start link_${r.nonce}`&&
      m.from.username?.toLowerCase()===r.expectedUsername&&!isAdmin;
    if(!ownerMatch&&!candidateMatch)return null;
    let state=store.state.adminLink;
    if(state?.requestId!==r.requestId){state={requestId:r.requestId,updates:[],acknowledgements:[]};store.state.adminLink=state;}
    if(!state.updates.some(u=>u.update_id===update.update_id)){
      const copy={update_id:update.update_id,message:{message_id:m.message_id,date:m.date,
        text:ownerMatch?`/vincular_admin ${r.nonce} @${r.expectedUsername}`:m.text,
        from:{id:m.from.id,is_bot:false,username:m.from.username},chat:{id:m.chat.id,type:'private'}}};
      if(state.updates.filter(u=>String(u.message.from.id)===String(m.from.id)).length<2)state.updates.push(copy);
      store.record({event:'ADMIN_LINK_IDENTITY_MESSAGE',requestId:r.requestId,userId:String(m.from.id),role:ownerMatch?'owner':'candidate'});
    }
    const proof=await identifyCandidate({request:r,config,updates:state.updates,api,now:now()});
    if(proof.status==='IDENTIFIED_AWAITING_ACTIVATION_APPROVAL'){
      if(state.proofReady!==true){
        store.atomic('admin-link-proof.json',{proof,plan:planAddition(config,proof,now())});
        state.proofReady=true;store.record({event:'ADMIN_LINK_IDENTIFIED',requestId:r.requestId,userId:proof.candidate.userId,accessGranted:false});
      }
      await once(state,'owner-proof',r.ownerId,'Identidad verificada. El alta sigue pendiente de aprobación del administrador; todavía no se ha concedido acceso.');
      await once(state,'candidate-proof',proof.candidate.chatId,'Tu identidad se ha verificado. El administrador debe aprobar tu acceso antes de que puedas utilizar las funciones del bot.');
    }else{
      await once(state,ownerMatch?'owner-received':'candidate-received',m.chat.id,
        ownerMatch?'Solicitud reconocida. Falta que la otra cuenta abra su enlace y pulse Iniciar. Todavía no se ha concedido acceso.':
        'Verificación recibida. Falta completar la aprobación del administrador. Todavía no tienes acceso a las funciones del bot.');
    }
    return {authorized:isAdmin,replied:true};
  }};
}
