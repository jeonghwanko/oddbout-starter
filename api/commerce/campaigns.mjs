// @ts-check
import {Problem,UUID} from '../http.mjs';
import {COMMERCE_CATALOG} from './catalog.mjs';
import {parseMediaLink} from './media-links.mjs';

export const SPOTLIGHT_HOUR=Object.freeze({id:'spotlight-hour',name:'Spotlight Hour',priceCredits:300,
  durationSeconds:3600,adSeconds:600,currency:'DON',fighterCount:4,fighterPoolTier:'SS',
  maxUploadBytes:52428800,allowedMimeTypes:Object.freeze(['video/mp4']),maxVideoSeconds:300,
  fighterTierMeaning:'Campaign merchandising tier; not game rank',fighterPool:COMMERCE_CATALOG.fighters,
  adSlots:Object.freeze([{startSeconds:0,durationSeconds:300},{startSeconds:1800,durationSeconds:300}])});
export const CAMPAIGN_PRODUCTS=Object.freeze([SPOTLIGHT_HOUR,...[2,3].map(hours=>Object.freeze({
  ...SPOTLIGHT_HOUR,id:`spotlight-${hours}h`,name:`Spotlight ${hours} Hours`,priceCredits:hours*300,
  durationSeconds:hours*3600,adSeconds:hours*600,
  adSlots:Object.freeze(Array.from({length:hours},(_,hour)=>[
    {startSeconds:hour*3600,durationSeconds:300},{startSeconds:hour*3600+1800,durationSeconds:300},
  ]).flat()),
}))]);
/** @param {unknown} value */
const key=value=>{if(typeof value!=='string'||!UUID.test(value))throw new Problem(422,'invalid-request-key');return value.toLowerCase();};
/** @param {unknown} value @param {string[]} fields */
function body(value,fields){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(field=>!fields.includes(field)))throw new Problem(422,'invalid-input');
  return /** @type {Record<string,any>} */(value);
}
/** @param {unknown} value */
function target(value){
  if(typeof value!=='string'||value.length>2048||/[\u0000-\u0020\u007f]/.test(value))throw new Problem(422,'invalid-target-url');
  try{const url=new URL(value);if(url.protocol!=='https:'||url.username||url.password)throw new Error();return url.href;}
  catch{throw new Problem(422,'invalid-target-url');}
}
/** @param {unknown} value @param {string} orderId */
function videoPath(value,orderId){
  if(typeof value!=='string'||value.length>512||!value.startsWith(`campaigns/${orderId}/`)
    ||!/^campaigns\/[a-f0-9-]+\/[a-zA-Z0-9._/-]+$/.test(value)||value.split('/').some(part=>!part||part==='.'||part==='..'))throw new Problem(422,'invalid-media-path');
  return value;
}
/** @typedef {{videoPath:string,targetUrl:string,durationSeconds:number,bytes:number,mimeType:string,aiIntro:string}} CampaignMedia */
/** Service-role persistence with explicit trusted media and playback readiness dependencies.
 * A purchased campaign is a flat charge. Its execution allowance never debits the wallet again.
 * @param {{db:{rpc:(name:string,args:any)=>PromiseLike<{data:any,error:any}>},store?:unknown,
 * verifyMedia?:(owner:string,orderId:string,input:{videoPath:string,targetUrl:string})=>Promise<CampaignMedia>,
 * verifyLink?:(owner:string,orderId:string,input:{source:import('./media-links.mjs').ExternalVideo,targetUrl:string})=>Promise<{aiIntro:string}>,
 * beforeStart?:(owner:string,order:any)=>Promise<boolean|void>,
 * execution?:ReturnType<typeof import('./campaign-execution.mjs').createCampaignExecution>,
 * signMedia?:(orderId:string,media:CampaignMedia)=>Promise<{videoUrl:string,expiresAt?:string}>}} options */
export function createCampaignService({db,verifyMedia,verifyLink,beforeStart,signMedia,execution}){
  /** Same-process media submits share verification. This is not a distributed provider-execution lease.
   * @type {Map<string,{signature:string,promise:Promise<any>}>} */
  const mediaInFlight=new Map();
  /** @param {string|null} owner @param {string} command @param {any} [input] */
  async function run(owner,command,input={}){
    const {data,error}=command==='save_link'
      ?await db.rpc('commerce_campaign_link',{p_owner:owner,p_order_id:input.orderId,p_request_key:input.requestKey,p_input:input.media})
      :['schedule','calendar','host_start'].includes(command)?await db.rpc('commerce_campaign_planning',{p_owner:owner,p_command:command==='host_start'?'start':command,p_input:input})
      :await db.rpc('commerce_campaign',{p_owner:owner,p_command:command,p_input:input});
    if(error){
      const code=String(error.message??'').match(/^commerce:([a-z_-]+)/)?.[1];
      throw new Problem(code==='not-found'?404:code==='insufficient-credits'?402:code==='owner-required'?401
        :['invalid-input','invalid-schedule'].includes(code??'')?422:code?409:503,code??'campaign-unavailable');
    }
    return data;
  }
  /** @param {string} owner @param {string} id */
  const get=(owner,id)=>run(owner,'get',{orderId:key(id)});
  return {
    catalog:()=>({products:CAMPAIGN_PRODUCTS,defaultProductId:SPOTLIGHT_HOUR.id}),
    get,
    /** @param {string} owner @param {string} id @param {'report'|'stop'|'reconcile'|'propose'|'pay'} action @param {any} [input] */
    async execution(owner,id,action,input={}){
      if(!execution)throw new Problem(503,'campaign-execution-unavailable');
      return execution[action](owner,key(id),input);
    },
    /** Save one immutable scheduling intent; retries neither spend nor start.
     * @param {string} owner @param {string} id @param {unknown} input */
    schedule(owner,id,input){
      const value=body(input,['requestKey','scheduledAt','timezone','expectedRevision']);
      if(typeof value.scheduledAt!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value.scheduledAt)||!Number.isFinite(Date.parse(value.scheduledAt))
        ||!Number.isInteger(value.expectedRevision)||value.expectedRevision<0||typeof value.timezone!=='string'||value.timezone.length>80)throw new Problem(422,'invalid-schedule');
      try{new Intl.DateTimeFormat('en',{timeZone:value.timezone});}catch{throw new Problem(422,'invalid-schedule');}
      return run(owner,'schedule',{orderId:key(id),requestKey:key(value.requestKey),scheduledAt:value.scheduledAt,timezone:value.timezone,expectedRevision:value.expectedRevision});
    },
    /** Private monthly planning, separate from the purchase-history cursor.
     * @param {string} owner @param {{from:string,to:string,cursor?:string}} input */
    async calendar(owner,input){
      const from=Date.parse(input.from),to=Date.parse(input.to);let cursor;
      if(!Number.isFinite(from)||!Number.isFinite(to)||to<=from||to-from>42*86400000)throw new Problem(422,'invalid-schedule');
      if(input.cursor){try{if(input.cursor.length>256||!/^[A-Za-z0-9_-]+$/.test(input.cursor))throw new Error();cursor=JSON.parse(Buffer.from(input.cursor,'base64url').toString('utf8'));if(!UUID.test(cursor.id)||!Number.isFinite(Date.parse(cursor.scheduledAt)))throw new Error();}catch{throw new Problem(422,'invalid-cursor');}}
      const page=await run(owner,'calendar',{from:new Date(from).toISOString(),to:new Date(to).toISOString(),...(cursor?{cursor}:{})});
      return {...page,nextCursor:page.nextCursor?Buffer.from(JSON.stringify(page.nextCursor),'utf8').toString('base64url'):null};
    },
    /** A saved UUID is the purchase intent. Failed insufficient-funds transactions create no purchased order.
     * @param {string} owner @param {unknown} input */
    purchase(owner,input){const value=body(input,['requestKey','productId']);
      if(!CAMPAIGN_PRODUCTS.some(product=>product.id===value.productId))throw new Problem(422,'unknown-product');
      return run(owner,'purchase',{requestKey:key(value.requestKey),productId:value.productId});},
    /** @param {string} owner @param {{limit?:number,cursor?:string}} [options] */
    async list(owner,options={}){
      const limit=options.limit??20;let cursor;
      if(!Number.isInteger(limit)||limit<1||limit>50)throw new Problem(422,'invalid-input');
      if(options.cursor){try{
        if(options.cursor.length>256||!/^[A-Za-z0-9_-]+$/.test(options.cursor))throw new Error();
        cursor=JSON.parse(Buffer.from(options.cursor,'base64url').toString('utf8'));
        if(!Number.isFinite(Date.parse(cursor.createdAt))||!UUID.test(cursor.id))throw new Error();
      }catch{throw new Problem(422,'invalid-cursor');}}
      const page=await run(owner,'list',{limit,...(cursor?{cursor}: {})});
      return {...page,nextCursor:page.nextCursor?Buffer.from(JSON.stringify(page.nextCursor)).toString('base64url'):null};
    },
    /** Only actual storage verification can make a purchased order ready. Client naming/intro/measurements are rejected.
     * @param {string} owner @param {string} id @param {unknown} input */
    async saveMedia(owner,id,input){
      const orderId=key(id),value=body(input,['requestKey','videoPath','targetUrl']),requestKey=key(value.requestKey);
      const order=await get(owner,orderId);
      const requested={videoPath:videoPath(value.videoPath,orderId),targetUrl:target(value.targetUrl)};
      const existing=await run(owner,'find_media',{orderId,requestKey});
      if(existing){
        if(existing.media.videoPath!==requested.videoPath||existing.media.targetUrl!==requested.targetUrl)throw new Problem(409,'idempotency-conflict');
        return existing.order;
      }
      const identity=`${owner}:${orderId}:${requestKey}`,signature=JSON.stringify(requested),pending=mediaInFlight.get(identity);
      if(pending){if(pending.signature!==signature)throw new Problem(409,'idempotency-conflict');return pending.promise;}
      const promise=(async()=>{
        if(order.status==='started')throw new Problem(409,'campaign-already-started');
        if(!verifyMedia)throw new Problem(503,'campaign-media-verification-unavailable');
        const verified=await verifyMedia(owner,orderId,requested);
        if(!verified||videoPath(verified.videoPath,orderId)!==requested.videoPath||target(verified.targetUrl)!==requested.targetUrl
          ||!Number.isFinite(verified.durationSeconds)||verified.durationSeconds<=0||verified.durationSeconds>300
          ||!Number.isSafeInteger(verified.bytes)||verified.bytes<=0||verified.bytes>SPOTLIGHT_HOUR.maxUploadBytes
          ||!SPOTLIGHT_HOUR.allowedMimeTypes.includes(verified.mimeType)
          ||typeof verified.aiIntro!=='string'||!verified.aiIntro.trim()||verified.aiIntro.length>1000)throw new Problem(422,'invalid-verified-media');
        return run(owner,'save_media',{orderId,requestKey,...verified});
      })();
      mediaInFlight.set(identity,{signature,promise});
      try{return await promise;}finally{if(mediaInFlight.get(identity)?.promise===promise)mediaInFlight.delete(identity);}
    },
    /** Linked videos retain provider identity; duration and embeddability are not claimed as verified.
     * @param {string} owner @param {string} id @param {unknown} input */
    async saveLink(owner,id,input){
      const orderId=key(id),value=body(input,['requestKey','mediaUrl','targetUrl']),requestKey=key(value.requestKey);
      let source;try{source=parseMediaLink(value.mediaUrl);}catch{throw new Problem(422,'unsupported-video-link');}
      const requested={source,targetUrl:target(value.targetUrl)},order=await get(owner,orderId);
      const existing=await run(owner,'find_media',{orderId,requestKey});
      if(existing){
        if(existing.media.source?.url!==source.url||existing.media.source?.kind!==source.kind||existing.media.source?.id!==source.id)throw new Problem(409,'idempotency-conflict');
        if(existing.media.targetUrl!==requested.targetUrl)throw new Problem(409,'idempotency-conflict');return existing.order;
      }
      const identity=`${owner}:${orderId}:${requestKey}`,signature=JSON.stringify(requested),pending=mediaInFlight.get(identity);
      if(pending){if(pending.signature!==signature)throw new Problem(409,'idempotency-conflict');return pending.promise;}
      const promise=(async()=>{
        if(order.status==='started')throw new Problem(409,'campaign-already-started');
        if(!verifyLink)throw new Problem(503,'campaign-links-unavailable');
        const verified=await verifyLink(owner,orderId,requested);
        if(typeof verified?.aiIntro!=='string'||!verified.aiIntro.trim()||verified.aiIntro.length>1000)throw new Problem(422,'invalid-verified-media');
        return run(owner,'save_link',{orderId,requestKey,media:{...requested,aiIntro:verified.aiIntro,verification:'link-format-only'}});
      })();
      mediaInFlight.set(identity,{signature,promise});
      try{return await promise;}finally{if(mediaInFlight.get(identity)?.promise===promise)mediaInFlight.delete(identity);}
    },
    /** Explicit final Start. Configuration verification precedes the immutable server start timestamp.
     * @param {string} owner @param {string} id @param {unknown} input */
    async start(owner,id,input){
      const orderId=key(id),value=body(input,['requestKey','expectedRevision','expectedMediaId']),requestKey=key(value.requestKey),order=await get(owner,orderId);
      if(order.status==='started')return execution&&order.broadcastId?execution.start(owner,orderId,{...value,requestKey},order):order;
      if(order.status!=='ready')throw new Problem(409,'campaign-media-required');
      if(!order.scheduledAt)throw new Problem(409,'campaign-schedule-required');
      const expectedRevision=value.expectedRevision??order.scheduleRevision;
      if(!Number.isInteger(expectedRevision)||expectedRevision!==order.scheduleRevision)throw new Problem(409,'schedule-changed');
      const expectedMediaId=value.expectedMediaId??order.mediaId;
      if(expectedMediaId!==order.mediaId)throw new Problem(409,'media-changed');
      if(!beforeStart||await beforeStart(owner,order)===false)throw new Problem(503,'campaign-playback-unavailable');
      if(execution)return execution.start(owner,orderId,{requestKey,expectedRevision,expectedMediaId},order);
      return run(owner,'host_start',{orderId,requestKey,expectedRevision,expectedMediaId});
    },
    /** Authenticated media preview after reload, including before the final Start.
     * @param {string} owner @param {string} id */
    async preview(owner,id){
      const order=await get(owner,id);
      if(!order.media)throw new Problem(409,'campaign-media-required');
      if(!signMedia)throw new Problem(503,'campaign-media-signing-unavailable');
      const signed=await signMedia(order.id,order.media);
      if(!signed||typeof signed.videoUrl!=='string'||!signed.videoUrl.startsWith('https://'))throw new Problem(503,'campaign-media-signing-unavailable');
      return {...signed,targetUrl:order.media.targetUrl,aiIntro:order.media.aiIntro,durationSeconds:order.media.durationSeconds};
    },
    /** Opaque watch capability, available only after Start. Private paths/account data never leave this public view.
     * @param {string} watchToken */
    async manifest(watchToken){
      if(!/^[a-f0-9]{64}$/.test(watchToken))throw new Problem(404,'not-found');
      const order=await run(null,'manifest',{watchToken});
      if(!signMedia)throw new Problem(503,'campaign-media-signing-unavailable');
      const signed=await signMedia(order.id,order.media);
      if(!signed||typeof signed.videoUrl!=='string'||!signed.videoUrl.startsWith('https://'))throw new Problem(503,'campaign-media-signing-unavailable');
      const produced=execution?await execution.playback(watchToken):null;
      return {id:order.id,productName:order.productName,durationSeconds:order.durationSeconds,startedAt:order.startedAt,execution:produced,
        serverNow:new Date().toISOString(),programSeed:parseInt(order.id.slice(0,8),16),
        fighterIds:order.fighterIds,fighterTier:order.fighterTier,playbackStatus:order.playbackStatus,
        media:{...signed,targetUrl:order.media.targetUrl,aiIntro:order.media.aiIntro,durationSeconds:order.media.durationSeconds},
        program:Array.from({length:order.durationSeconds/3600},(_,hour)=>[
          {type:'advertisement',startSeconds:hour*3600,durationSeconds:300},{type:'tournament',startSeconds:hour*3600+300,durationSeconds:1500},
          {type:'advertisement',startSeconds:hour*3600+1800,durationSeconds:300},{type:'tournament',startSeconds:hour*3600+2100,durationSeconds:1500},
        ]).flat()};
    },
  };
}
