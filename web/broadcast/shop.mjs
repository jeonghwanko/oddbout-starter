import { createOperationJournal } from './operations.mjs';

const $ = id => document.getElementById(id);
const AUTH_KEY = 'oddbout-paid-auth';
const CREDIT_PRODUCT_IDS = new Set(['sandbox-1000','studio-series-5000']);
const FIGHTER_NAMES = { kuma:'Kuma', yume:'Yume', bravow:'Bravow', beotim:'Beotim', quickcat:'Quickcat', kungjjak:'Kungjjak', sikeundung:'Sikeundung', duldul:'Duldul', eoridung:'Eoridung' };
const ORDER_STATES = { awaiting_media:'Add sponsor media', ready:'Ready to publish', started:'Published', needs_attention:'Needs attention' };
let config, session, client, journal, campaignProduct, campaignProducts=[], selectedProductId='', commerceCatalog;
let orders = [], selectedOrder = null, nextCursor = null, orderRevision = 0, selectionRevision = 0, accountEpoch = 0, orderTimer;
let selectedFile = null, selectedFileDuration = null, previewObjectUrl = '', fileRevision = 0, busy = false, topupBusy = false;
const returnedIntent = new URLSearchParams(location.search).get('intent') ?? '';

function message(text,error=false) { $('shop-status').textContent = text; $('shop-status').classList.toggle('is-error',error); }
function walletMessage(text,error=false) { $('wallet-status').textContent = text; $('wallet-status').classList.toggle('is-error',error); }
function campaignState(order) { return order?.status ?? order?.state ?? 'unknown'; }
function plain(value,max=400) { return typeof value === 'string' ? value.slice(0,max) : ''; }
function fighterName(id) { return FIGHTER_NAMES[id] ?? plain(id,64).replace(/([a-z])([A-Z])/g,'$1 $2').replace(/^./,letter=>letter.toUpperCase()); }
function money(cents,currency='USD') {
  if (!Number.isSafeInteger(cents) || cents < 0) return 'Price unavailable';
  try { return new Intl.NumberFormat(undefined,{style:'currency',currency:plain(currency,3).toUpperCase() || 'USD'}).format(cents/100); }
  catch { return '$'+(cents/100).toFixed(2); }
}
function updateControls() {
  $('google-signin').disabled = !client || busy || topupBusy;
  $('spotlight-purchase').disabled = !campaignProduct || busy || !config?.commerceEnabled;
  const pendingCampaign=journal?.get('campaignOrder');
  if(pendingCampaign?.result?.id)$('spotlight-purchase').textContent='Open saved Spotlight purchase';
  else if(pendingCampaign)$('spotlight-purchase').textContent=`Continue purchase · ${Number(campaignProduct?.priceCredits??300).toLocaleString()} ${creditName()}`;
  else if(campaignProduct){const name=plain(campaignProduct.name,80),cost=`${Number(campaignProduct.priceCredits).toLocaleString()} ${creditName()}`;$('spotlight-purchase').textContent=orders.length?`Buy another ${name} broadcast · ${cost}`:`Purchase ${name} · ${cost}`;}
  for(const button of $('duration-options').querySelectorAll('button'))button.disabled=busy||Boolean(journal?.get('campaignOrder'));
  $('broadcasts-refresh').disabled = !session || busy;
  $('media-upload').disabled = !session || busy || !selectedOrder || campaignState(selectedOrder)!=='awaiting_media' || !selectedFile || !validDestination($('destination-url').value);
  $('publish-broadcast').disabled = !session || busy || !selectedOrder || campaignState(selectedOrder)!=='ready' || !$('publish-consent').checked;
  const mediaLocked=Boolean(selectedOrder&&campaignState(selectedOrder)!=='awaiting_media');
  $('media-file').disabled=mediaLocked;$('destination-url').readOnly=mediaLocked;
  for(const button of $('credit-packs').querySelectorAll('button'))button.disabled=!session||busy||topupBusy;
  $('signout').disabled = busy || topupBusy;
}
function validDestination(value) {
  try { const url=new URL(value.trim()); return url.protocol==='https:' && !url.username && !url.password && value.trim().length<=2048; }
  catch { return false; }
}
async function readResponse(response) {
  const result = await response.json();
  if (!response.ok || !result?.ok) throw Object.assign(new Error(result?.code ?? 'request-failed'),{code:result?.code,status:response.status,responseOk:result?.ok===false});
  return result.data;
}
async function api(path,{body,base='/campaigns'}={}) {
  if (!session) throw Object.assign(new Error('Sign in to continue.'),{code:'authentication-required'});
  const owner=session.user.id, epoch=accountEpoch, currentJournal=journal;
  const response=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{authorization:'Bearer '+session.access_token,...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const data=await readResponse(response);
  if (session?.user.id!==owner || accountEpoch!==epoch || journal!==currentJournal) throw new Error('Your account changed. Sign in to the original account to continue.');
  return data;
}
async function publicData(path) { return readResponse(await fetch(path)); }
function creditName() { return plain(commerceCatalog?.service?.creditName,40) || 'Studio Credits'; }
function renderProduct() {
  const pending=journal?.get('campaignOrder');
  if(pending?.input?.productId)selectedProductId=pending.input.productId;
  campaignProduct=campaignProducts.find(product=>product.id===selectedProductId)??campaignProducts[0]??null;
  if (!campaignProduct) { $('spotlight-price').textContent='Price unavailable'; $('spotlight-purchase').disabled=true; $('duration-options').replaceChildren(); return; }
  selectedProductId=campaignProduct.id;
  $('duration-options').replaceChildren(...[...campaignProducts].sort((a,b)=>a.durationSeconds-b.durationSeconds).map(product=>{
    const button=document.createElement('button');button.type='button';button.className='duration-option';button.dataset.campaignProductId=product.id;
    button.setAttribute('aria-pressed',String(product.id===selectedProductId));
    const hours=Math.round(product.durationSeconds/3600),durationLabel=`${hours} ${hours===1?'hour':'hours'}`;
    const name=document.createElement('strong');name.textContent=durationLabel;
    const productName=document.createElement('span');productName.className='duration-product';productName.textContent=plain(product.name,80);
    const adMinutes=Math.round(product.adSeconds/60),slotMinutes=Math.round((product.adSlots?.[0]?.durationSeconds??300)/60);
    const specs=document.createElement('span');specs.textContent=`${adMinutes} min sponsor time · ${slotMinutes} min every 30 min`;
    const tier=plain(product.fighterPoolTier,16)||'SS',poolSize=Number.isSafeInteger(product.fighterPool?.length)?product.fighterPool.length:null;
    const format=document.createElement('span');format.textContent=`${product.fighterCount} ${tier} fighters picked at random${poolSize?` from ${poolSize}`:''} · AI intro + tournament`;
    const cost=document.createElement('span');cost.className='duration-price';cost.textContent=`${Number(product.priceCredits).toLocaleString()} ${creditName()}`;
    button.append(name,productName,specs,format,cost);
    button.addEventListener('click',()=>{if(journal?.get('campaignOrder'))return;selectedProductId=product.id;renderProduct();});
    return button;
  }));
  $('spotlight-title').textContent=plain(campaignProduct.name,80)||'Spotlight';
  $('purchase-title').textContent=plain(campaignProduct.name,80)||'Spotlight';
  const hours=Math.round(campaignProduct.durationSeconds/3600);
  $('spotlight-price').textContent=`${hours} ${hours===1?'hour':'hours'} · ${Number(campaignProduct.priceCredits).toLocaleString()} ${plain(campaignProduct.currency,40)||creditName()}`;
  $('spotlight-purchase').textContent=orders.length?`Buy another ${plain(campaignProduct.name,80)||'Spotlight'} broadcast · ${Number(campaignProduct.priceCredits).toLocaleString()} ${creditName()}`:`Purchase ${plain(campaignProduct.name,80)||'Spotlight'} · ${Number(campaignProduct.priceCredits).toLocaleString()} ${creditName()}`;
  if(pending?.result?.id) $('spotlight-purchase').textContent='Open saved Spotlight purchase';
  else if(pending) $('spotlight-purchase').textContent=`Continue purchase · ${Number(campaignProduct.priceCredits).toLocaleString()} ${creditName()}`;
  updateControls();
}
function renderCreditPacks() {
  const packs=(commerceCatalog?.products??[]).filter(item=>CREDIT_PRODUCT_IDS.has(item.id)&&item.operatorOnly!==true);
  const pending=journal?.get('topup');
  $('credit-packs').replaceChildren(...packs.map(product=>{
    const box=document.createElement('div');box.className='credit-pack';
    const summary=document.createElement('span');summary.textContent=`${plain(product.name,64)} · ${Number(product.credits).toLocaleString()} ${creditName()} · ${money(product.amountCents,commerceCatalog.currency)}`;
    const button=document.createElement('button');button.className='button button-secondary button-small';button.type='button';button.textContent=pending?.input?.productId===product.id?'Continue checkout':'Add credits';button.disabled=!session||!config?.commerceEnabled||!commerceCatalog?.paypalConfigured||busy||topupBusy||Boolean(pending&&pending.input.productId!==product.id);
    button.addEventListener('click',()=>purchaseCreditPack(product.id,button));box.append(summary,button);return box;
  }));
}
async function loadWallet() {
  const wallet=await api('/wallet',{base:'/commerce'});
  $('wallet-available').textContent=Number(wallet.availableCredits??0).toLocaleString();
  $('wallet-reserved').textContent=Number(wallet.reservedCredits??0).toLocaleString();
  $('wallet-total').textContent=Number(wallet.balanceCredits??0).toLocaleString();
  if(wallet.spendingBlocked) walletMessage('Spending is temporarily blocked while a payment adjustment is reviewed.',true);
}
function checkoutLink(result) {
  const anchor=$('credit-paypal');
  if(!result?.approvalUrl) { anchor.hidden=true;anchor.removeAttribute('href');return; }
  try { const url=new URL(result.approvalUrl);if(url.origin!=='https://www.sandbox.paypal.com')throw new Error();anchor.href=url.href;anchor.hidden=false; }
  catch { anchor.hidden=true;anchor.removeAttribute('href');message('PayPal returned an invalid approval address.',true); }
}
async function purchaseCreditPack(productId,button) {
  if(topupBusy||!session)return;
  const owner=session.user.id,epoch=accountEpoch;
  topupBusy=true;button.disabled=true;updateControls();
  try {
    const saved=journal, existing=saved.get('topup'), input=existing?.input??{productId};
    if(existing&&existing.input.productId!==productId) throw new Error('Continue the saved credit-pack request before choosing another pack.');
    let op=existing??saved.begin('topup',input);saved.markDispatched('topup',op.requestKey);
    const result=await api('/checkout',{base:'/commerce',body:{...input,requestKey:op.requestKey}});
    if(result.status==='credited') {saved.complete('topup',op.requestKey);walletMessage(`${Number(result.credits??0).toLocaleString()} ${creditName()} added. Your balance is ready.`,false);checkoutLink(null);await loadWallet();}
    else {saved.acknowledge('topup',op.requestKey,result);checkoutLink(result);walletMessage('Continue the same PayPal checkout. Credits are added only after PayPal confirms payment.');}
  } catch(error) {if(session?.user.id===owner&&accountEpoch===epoch)walletMessage(error.code==='insufficient-credits'?'This account needs more Studio Credits. Your pack request is saved.': 'The credit-pack request is saved. Retry to continue the same checkout.',true);}
  finally {topupBusy=false;renderCreditPacks();updateControls();}
}
function normalizedOrder(value) { return value?.order??value?.campaign??value; }
function displayName(order) { return plain(order?.productName,80)||plain(campaignProduct?.name,80)||'Spotlight'; }
function safeWatchUrl(value) {
  try {
    const url=new URL(value,location.origin),sameOrigin=url.origin===location.origin;
    const localHttp=location.protocol==='http:'&&url.protocol==='http:'&&sameOrigin&&['localhost','127.0.0.1','[::1]','::1'].includes(url.hostname);
    return sameOrigin&&(url.protocol==='https:'||localHttp)?url.href:null;
  }
  catch{return null;}
}
function safeVideoUrl(value) {
  try {const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password?url.href:null;}
  catch{return null;}
}
function renderOrder(order) {
  const previousId=selectedOrder?.id,previousState=campaignState(selectedOrder);
  selectedOrder=order;const state=campaignState(order);
  $('purchase-panel').hidden=!order;
  if(!order){
    fileRevision++;$('broadcast-setup').hidden=true;selectedFile=null;selectedFileDuration=null;$('destination-url').value='';$('media-file').value='';
    if(previewObjectUrl)URL.revokeObjectURL(previewObjectUrl);previewObjectUrl='';$('media-preview').removeAttribute('src');$('media-preview').hidden=true;
    updateControls();return;
  }
  if(previousId!==order.id){fileRevision++;selectedFile=null;selectedFileDuration=null;$('media-file').value='';if(previewObjectUrl)URL.revokeObjectURL(previewObjectUrl);previewObjectUrl='';$('media-preview').removeAttribute('src');$('media-preview').hidden=true;$('destination-url').value='';}
  if(previousId!==order.id||previousState!==state)$('publish-consent').checked=false;
  $('purchase-state').textContent=ORDER_STATES[state]??'Status needs review';
  const items=[['Cost',`${Number(order.priceCredits??campaignProduct?.priceCredits??300).toLocaleString()} ${creditName()}`],['Duration',`${Math.round((order.durationSeconds??3600)/60)} minutes`],['Fighters',(order.fighterIds??[]).map(fighterName).join(' · ')||'Assigned after purchase'],['Purchased',order.createdAt?new Date(order.createdAt).toLocaleString():'Saved to your account']];
  $('purchase-receipt').replaceChildren(...items.map(([label,value])=>{const item=document.createElement('div');item.className='receipt-item';const key=document.createElement('span');key.textContent=label;const val=document.createElement('strong');val.textContent=value;item.append(key,val);return item;}));
  $('purchase-recover').hidden=state!=='needs_attention';
  $('broadcast-setup').hidden=!['awaiting_media','ready'].includes(state);
  $('media-upload').hidden=state!=='awaiting_media';
  $('publish-broadcast').hidden=state!=='ready';
  if(order.media){$('media-file-name').textContent='Sponsor clip verified';const duration=Number.isFinite(order.media.durationSeconds)?` · ${Math.ceil(order.media.durationSeconds)} sec`:'';$('media-file-meta').textContent=`Ready to publish${duration}`;}
  if(order.media?.targetUrl && !previousId)$('destination-url').value=order.media.targetUrl;
  if(order.media?.aiIntro||order.aiIntro) $('intro-text').textContent=plain(order.media?.aiIntro??order.aiIntro,1000);
  if(order.media?.targetUrl)$('destination-url').value=order.media.targetUrl;
  else {const pendingMedia=journal?.get('campaign-media:'+order.id);if(pendingMedia?.input?.targetUrl)$('destination-url').value=pendingMedia.input.targetUrl;}
  if(!order.media){const pendingUpload=journal?.get('campaign-upload:'+order.id);if(pendingUpload?.input?.fileName){$('media-file-name').textContent='Re-select '+plain(pendingUpload.input.fileName,120)+' to continue';$('media-file-meta').textContent='The saved upload request will continue with this file.';}}
  if(state==='started') message('Your broadcast is published on ODDBOUT. Playback status is supplied by the broadcast service.');
  else if(state==='needs_attention') message('This broadcast needs attention. Its purchase and current status are saved; no replacement was created.',true);
  else if(state==='ready') message('Your sponsor clip and intro are saved. Review the preview, then publish when ready.');
  else message(`${displayName(order)} is purchased. Add its sponsor clip and HTTPS destination when you’re ready.`);
  updateControls();
}
function renderOrders() {
  const host=$('broadcast-list');
  host.replaceChildren(...orders.map(order=>{
    const card=document.createElement('article');card.className='broadcast-card';
    const body=document.createElement('div'),title=document.createElement('h3'),meta=document.createElement('p');
    title.textContent=displayName(order);meta.textContent=[order.startedAt?`Started ${new Date(order.startedAt).toLocaleString()}`:order.createdAt?`Purchased ${new Date(order.createdAt).toLocaleString()}`:'',Number.isSafeInteger(order.priceCredits)?`${order.priceCredits} ${creditName()}`:''].filter(Boolean).join(' · ');body.append(title,meta);
    const state=document.createElement('span');state.className='broadcast-status';state.textContent=ORDER_STATES[campaignState(order)]??'Status needs review';card.append(body,state);
    const watch=safeWatchUrl(order.watchUrl??(order.watchToken?'/broadcast/watch/?show='+encodeURIComponent(order.watchToken):''));
    if(campaignState(order)==='started'&&watch){const link=document.createElement('a');link.href=watch;link.target='_blank';link.rel='noopener noreferrer';link.textContent='Watch broadcast';card.append(link);}
    else if(['awaiting_media','ready','needs_attention'].includes(campaignState(order))){const button=document.createElement('button');button.type='button';button.className='button button-secondary button-small';button.textContent=campaignState(order)==='awaiting_media'?'Add sponsor media':campaignState(order)==='ready'?'Review and publish':'Check status';button.addEventListener('click',()=>selectOrder(order.id));card.append(button);}
    return card;
  }));
  if(!orders.length&&session){const empty=document.createElement('p');empty.className='section-status';empty.textContent='No broadcasts yet. Choose a Spotlight length to get started.';host.append(empty);}
  $('broadcasts-more').hidden=!nextCursor;
}
async function selectOrder(id) {
  const revision=++selectionRevision,owner=session?.user.id,epoch=accountEpoch;
  try {
    const result=await api('/orders/'+encodeURIComponent(id));if(revision!==selectionRevision||session?.user.id!==owner||accountEpoch!==epoch)return;
    const order=normalizedOrder(result);renderOrder(order);
    if(campaignState(order)==='ready'&&!selectedFile){
      const preview=await api('/orders/'+encodeURIComponent(id)+'/preview');
      if(revision!==selectionRevision||session?.user.id!==owner||accountEpoch!==epoch)return;
      const videoUrl=safeVideoUrl(preview.videoUrl);
      if(videoUrl){$('media-preview').src=videoUrl;$('media-preview').hidden=false;}
      if(typeof preview.aiIntro==='string')$('intro-text').textContent=plain(preview.aiIntro,1000);
      if(validDestination(preview.targetUrl))$('destination-url').value=preview.targetUrl;
      updateControls();
    }
  }
  catch(error){if(revision===selectionRevision&&session?.user.id===owner&&accountEpoch===epoch)message('Could not load that broadcast. Refresh My broadcasts to try again.',true);}
}
async function loadOrders({more=false}={}) {
  if(!session)return;
  const revision=++orderRevision,epoch=accountEpoch,owner=session.user.id;
  const query=new URLSearchParams({limit:'20',...(more&&nextCursor?{cursor:nextCursor}:{})});
  const page=await api('/orders?'+query);
  if(revision!==orderRevision||epoch!==accountEpoch||session?.user.id!==owner)return;
  const incoming=Array.isArray(page.items)?page.items:[];
  if(more){const known=new Set(orders.map(item=>item.id));orders.push(...incoming.filter(item=>!known.has(item.id)));}else orders=incoming;
  nextCursor=page.nextCursor??null;renderOrders();
  if(!selectedOrder){const resume=orders.find(order=>['awaiting_media','ready','needs_attention'].includes(campaignState(order)));if(resume)await selectOrder(resume.id);}
  else {const latest=orders.find(order=>order.id===selectedOrder.id);if(latest&&campaignState(latest)!==campaignState(selectedOrder))await selectOrder(latest.id);}
  $('broadcasts-status').textContent=orders.length?'Your latest broadcast statuses are saved to this account.':'';
  updateControls();
}
async function purchaseSpotlight() {
  if(busy)return;if(!session){message(`Sign in with Google to purchase ${plain(campaignProduct?.name,80)||'Spotlight'}.`);return;}
  const owner=session.user.id,epoch=accountEpoch;
  busy=true;updateControls();let purchaseOp=null,previouslyDispatched=true;
  try {
    const saved=journal;let op=saved.get('campaignOrder');
    if(!op)op=saved.begin('campaignOrder',{productId:selectedProductId});
    purchaseOp=op;previouslyDispatched=op.dispatched!==false;
    if(op.result?.id){const data=await api('/orders/'+encodeURIComponent(op.result.id));const order=normalizedOrder(data);saved.complete('campaignOrder',op.requestKey);renderOrder(order);await loadOrders();return;}
    saved.markDispatched('campaignOrder',op.requestKey);
    const order=normalizedOrder(await api('/orders',{body:{requestKey:op.requestKey,productId:op.input.productId,confirmed:true}}));
    if(!order?.id)throw new Error('Purchase receipt is not available yet. Retry to recover the same purchase.');
    saved.acknowledge('campaignOrder',op.requestKey,order);saved.complete('campaignOrder',op.requestKey);
    renderOrder(order);await loadWallet();await loadOrders();
  }catch(error){
    if(session?.user.id===owner&&accountEpoch===epoch){
      if(error.code==='insufficient-credits'&&error.status===402&&error.responseOk===false){
        const canRelease=!previouslyDispatched&&purchaseOp;
        if(canRelease&&journal?.get('campaignOrder')?.requestKey===purchaseOp.requestKey)journal.complete('campaignOrder',purchaseOp.requestKey);
        $('wallet').scrollIntoView({block:'center'});$('wallet').querySelector('details').open=true;
        message(canRelease?'Not enough Studio Credits for this length. Add credits or choose a shorter broadcast. No order was created.':'Not enough Studio Credits on this attempt. An earlier request may have reached the server, so its key is retained. Add credits or retry the same length.');
        if(canRelease)renderProduct();
      }
      else message(error.code==='campaign-playback-unavailable'?'The ODDBOUT broadcast service is not ready right now. Your purchase is saved; no broadcast has started.':'The purchase result is not confirmed. Click again to recover this same purchase; no replacement order was created.',true);
    }
  }finally{busy=false;updateControls();}
}
async function uploadMedia() {
  if(!selectedOrder||!selectedFile||!validDestination($('destination-url').value))return;
  const orderId=selectedOrder.id,owner=session?.user.id,epoch=accountEpoch,file=selectedFile,targetUrl=$('destination-url').value.trim();
  busy=true;updateControls();message('Uploading and verifying your sponsor clip…');
  try {
    const uploadName='campaign-upload:'+orderId,uploadInput={orderId,fileName:file.name,size:file.size,contentType:file.type};
    let uploadOp=journal.get(uploadName);if(!uploadOp)uploadOp=journal.begin(uploadName,uploadInput);
    if(JSON.stringify(uploadOp.input)!==JSON.stringify(uploadInput))throw new Error('A previous upload request is still saved. Choose the same file to continue it.');
    const mediaName='campaign-media:'+orderId,pendingMedia=journal.get(mediaName),knownPath=uploadOp.result?.path??pendingMedia?.input?.videoPath;
    let mediaOp=knownPath?pendingMedia:null;
    if(knownPath&&!mediaOp)mediaOp=journal.begin(mediaName,{orderId,videoPath:knownPath,targetUrl});
    if(mediaOp&&JSON.stringify(mediaOp.input)!==JSON.stringify({orderId,videoPath:knownPath,targetUrl}))throw new Error('The saved media update has different details. Restore its destination and retry.');
    const saveMedia=async(path,operation)=>normalizedOrder(await api('/orders/'+encodeURIComponent(orderId)+'/media',{body:{requestKey:operation.requestKey,videoPath:path,targetUrl,confirmed:true}}));
    if(uploadOp.result?.uploaded===true&&mediaOp){
      journal.markDispatched(mediaName,mediaOp.requestKey);
      try {const recovered=await saveMedia(knownPath,mediaOp);journal.complete(mediaName,mediaOp.requestKey);journal.complete(uploadName,uploadOp.requestKey);renderOrder(recovered);await loadOrders();return;} catch { /* Retry verification after refreshing the signed upload for this same path. */ }
    }
    journal.markDispatched(uploadName,uploadOp.requestKey);
    const signed=await api('/orders/'+encodeURIComponent(orderId)+'/upload',{body:{fileName:file.name,size:file.size,contentType:file.type,...(knownPath?{videoPath:knownPath}:{}),confirmed:true}});
    if(!signed?.path||!signed?.token||signed.bucket!=='campaign-media'||file.size>Math.min(50*1024*1024,signed.maxBytes??50*1024*1024))throw new Error('The secure upload could not be prepared. Retry with the same file.');
    if(knownPath&&knownPath!==signed.path)throw new Error('The saved upload path changed. Keep this file and retry the saved setup.');
    journal.acknowledge(uploadName,uploadOp.requestKey,{path:signed.path,...(uploadOp.result?.uploaded===true?{uploaded:true}:{})});
    const mediaInput={orderId,videoPath:signed.path,targetUrl};
    if(!mediaOp)mediaOp=journal.begin(mediaName,mediaInput);
    if(JSON.stringify(mediaOp.input)!==JSON.stringify(mediaInput))throw new Error('The saved media update has different details. Restore its destination and retry.');
    journal.markDispatched(mediaName,mediaOp.requestKey);
    if(uploadOp.result?.uploaded!==true){
      try {
        const storage=client.storage.from(signed.bucket),uploaded=await storage.uploadToSignedUrl(signed.path,signed.token,file,{contentType:file.type,upsert:false});
        if(uploaded.error)throw uploaded.error;
        journal.acknowledge(uploadName,uploadOp.requestKey,{path:signed.path,uploaded:true});
      } catch(uploadError) {
        try { const recovered=await saveMedia(signed.path,mediaOp);journal.complete(mediaName,mediaOp.requestKey);journal.complete(uploadName,uploadOp.requestKey);renderOrder(recovered);await loadOrders();return; }
        catch { throw uploadError; }
      }
    }
    if(session?.user.id!==owner||accountEpoch!==epoch)return;
    const updated=await saveMedia(signed.path,mediaOp);
    journal.complete(mediaName,mediaOp.requestKey);journal.complete(uploadName,uploadOp.requestKey);
    renderOrder(updated);await loadOrders();
  }catch(error){if(session?.user.id===owner&&accountEpoch===epoch)message(error.code==='invalid-target-url'?'Enter a valid HTTPS destination without a username or password.':error.code==='campaign-media-verification-unavailable'?'The clip could not be verified yet. Your purchase is saved; retry setup with the same file.':'The clip upload or verification did not finish. Your purchase is saved; retry setup with the same file.',true);}
  finally{busy=false;updateControls();}
}
async function publishBroadcast() {
  if(!selectedOrder||!$('publish-consent').checked||campaignState(selectedOrder)!=='ready')return;
  const orderId=selectedOrder.id,owner=session?.user.id,epoch=accountEpoch,name='campaign-start:'+orderId,input={orderId};busy=true;updateControls();message('Requesting publication on ODDBOUT…');
  try{
    let op=journal.get(name);if(!op)op=journal.begin(name,input);
    if(JSON.stringify(op.input)!==JSON.stringify(input))throw new Error('A saved publish request needs review.');
    journal.markDispatched(name,op.requestKey);
    const started=normalizedOrder(await api('/orders/'+encodeURIComponent(orderId)+'/start',{body:{requestKey:op.requestKey,confirmed:true}}));
    if(campaignState(started)==='started')journal.complete(name,op.requestKey);
    renderOrder(started);await loadOrders();
  }catch(error){if(session?.user.id===owner&&accountEpoch===epoch)message(error.code==='campaign-playback-unavailable'?'ODDBOUT could not verify the broadcast setup right now. Your purchased broadcast is unchanged; try publishing again later.':'Publication status is not confirmed. Retry to check the same request; no second broadcast was created.',true);}
  finally{busy=false;updateControls();}
}
async function captureReturnedPayment() {
  if(!returnedIntent||!session)return;
  const owner=session.user.id,epoch=accountEpoch;
  try{
    const result=await api('/topups/'+encodeURIComponent(returnedIntent)+'/capture',{base:'/commerce',body:{}});
    if(session?.user.id!==owner||accountEpoch!==epoch)return;
    if(result.status==='credited'){
      const pending=journal.get('topup');if(pending?.result?.intentId===returnedIntent)journal.complete('topup',pending.requestKey);
      checkoutLink(null);walletMessage(`${Number(result.credits??0).toLocaleString()} ${creditName()} added. Your balance is ready.`);await loadWallet();
    }else walletMessage('PayPal has not confirmed this top-up yet. Your balance is unchanged.');
  }catch(error){if(session?.user.id===owner&&accountEpoch===epoch)walletMessage(error.code==='paypal-approval-required'?'PayPal has not confirmed this top-up yet. Your balance is unchanged.':'The top-up status is not confirmed. The original checkout is saved.',error.code!=='paypal-approval-required');}
}
function renderAccount(value) {
  const previous=session?.user.id;session=value;
  if(previous!==value?.user.id){accountEpoch++;orderRevision++;selectionRevision++;clearTimeout(orderTimer);orders=[];selectedOrder=null;nextCursor=null;checkoutLink(null);walletMessage('');renderOrders();renderOrder(null);}
  $('google-signin').hidden=Boolean(value);$('account-identity').hidden=!value;$('signout').hidden=!value;
  const accountName=value?.user.user_metadata?.full_name||value?.user.email||'';
  $('account-name').textContent=accountName;$('account-avatar').textContent=accountName?Array.from(accountName)[0].toUpperCase():'';
  $('broadcasts-refresh').disabled=!value;
  if(previous!==value?.user.id){journal=value?createOperationJournal(localStorage,value.user.id):null;message(value?'Account connected. Loading your Studio Credits and broadcasts.':'Sign in to purchase and manage broadcasts.');
    if(value){
      const owner=value.user.id,epoch=accountEpoch;
      const walletLoad=loadWallet().catch(()=>{if(session?.user.id===owner&&accountEpoch===epoch)walletMessage('Studio Credits could not be loaded. Refresh the page to retry.',true);throw new Error('wallet-load-failed');});
      const ordersLoad=loadOrders().catch(()=>{if(session?.user.id===owner&&accountEpoch===epoch)$('broadcasts-status').textContent='Broadcasts could not be loaded. Refresh to try again.';throw new Error('broadcast-load-failed');});
      Promise.allSettled([walletLoad,ordersLoad]).then(results=>{
        if(session?.user.id!==owner||accountEpoch!==epoch)return;
        if($('shop-status').textContent==='Account connected. Loading your Studio Credits and broadcasts.')message(results.every(result=>result.status==='fulfilled')?'Your Studio Credits and broadcasts are up to date.':'Some account details could not be loaded. Check their status below.',results.some(result=>result.status==='rejected'));
        scheduleOrders();
      });
      if(returnedIntent)setTimeout(()=>captureReturnedPayment(),0);
    }
    else{$('wallet-available').textContent='—';$('wallet-reserved').textContent='—';$('wallet-total').textContent='—';$('broadcasts-status').textContent='Sign in to see your broadcasts.';}}
  renderProduct();renderCreditPacks();updateControls();
}
function scheduleOrders() {
  clearTimeout(orderTimer);if(!session)return;
  const owner=session.user.id,epoch=accountEpoch;
  orderTimer=setTimeout(async()=>{try{if(!document.hidden)await loadOrders();}catch{if(session?.user.id===owner&&accountEpoch===epoch)$('broadcasts-status').textContent='Status refresh failed. Your saved broadcasts are unchanged.';}finally{if(session?.user.id===owner&&accountEpoch===epoch)scheduleOrders();}},30_000);
}
async function initialize() {
  config=await fetch('/broadcast/config').then(response=>response.json());
  const [campaign,commerceResponse]=await Promise.all([publicData('/campaigns/catalog'),fetch('/commerce/catalog').then(response=>response.json())]);
  campaignProducts=Array.isArray(campaign.products)?campaign.products:[campaign];selectedProductId=campaign.defaultProductId??campaignProducts[0]?.id??'';
  commerceCatalog=commerceResponse.catalog??commerceResponse.data?.catalog;renderProduct();renderCreditPacks();
  if(!config.commerceEnabled)message('Broadcast purchases are unavailable on this server.');
  if(!commerceCatalog?.paypalConfigured)walletMessage('PayPal Sandbox top-ups are not configured. Existing Studio Credits remain available.');
  if(!config.authConfigured||!config.supabaseUrl||!config.publishableKey){$('google-signin').disabled=true;message('Account sign-in is not configured on this server.');return;}
  client=globalThis.supabase.createClient(config.supabaseUrl,config.publishableKey,{auth:{persistSession:true,storage:sessionStorage,storageKey:AUTH_KEY,flowType:'pkce',autoRefreshToken:true,detectSessionInUrl:true}});
  client.auth.onAuthStateChange((_event,value)=>renderAccount(value));
  renderAccount((await client.auth.getSession()).data.session);
}
$('google-signin').addEventListener('click',async()=>{
  if(!client)return;
  const {error}=await client.auth.signInWithOAuth({provider:'google',options:{redirectTo:location.origin+'/broadcast/'}});
  if(error)message(error.message,true);
});
$('signout').addEventListener('click',async()=>{const {error}=await client.auth.signOut();if(error)message(error.message,true);});
$('spotlight-purchase').addEventListener('click',purchaseSpotlight);
$('media-file').addEventListener('change',async event=>{
  const revision=++fileRevision,owner=session?.user.id,epoch=accountEpoch,orderId=selectedOrder?.id,file=event.currentTarget.files?.[0]??null;selectedFile=null;selectedFileDuration=null;
  if(previewObjectUrl)URL.revokeObjectURL(previewObjectUrl);previewObjectUrl='';
  if(!file){$('media-preview').hidden=true;$('media-file-name').textContent='Choose an MP4 video';$('media-file-meta').textContent='Video details appear here after selection';updateControls();return;}
  $('media-file-name').textContent=file.name;$('media-file-meta').textContent=`${(file.size/1024/1024).toFixed(1)} MB · Checking video…`;
  if(file.size>50*1024*1024||file.type!=='video/mp4'){message('Choose an MP4 video no larger than 50 MB.',true);updateControls();return;}
  previewObjectUrl=URL.createObjectURL(file);$('media-preview').src=previewObjectUrl;$('media-preview').hidden=false;
  try{await new Promise((resolve,reject)=>{const video=$('media-preview');video.onloadedmetadata=()=>resolve();video.onerror=()=>reject(new Error('Video metadata could not be read.'));});
    if(revision!==fileRevision||session?.user.id!==owner||accountEpoch!==epoch||selectedOrder?.id!==orderId||$('media-file').files?.[0]!==file)return;
    const duration=$('media-preview').duration;if(!Number.isFinite(duration)||duration<=0||duration>300)throw new Error('Choose a video that is no longer than five minutes.');
    selectedFile=file;selectedFileDuration=duration;$('media-file-meta').textContent=`${(file.size/1024/1024).toFixed(1)} MB · ${Math.ceil(duration)} sec`;message('Clip preview ready. Add the sponsor destination, then upload.');
  }catch(error){if(revision===fileRevision&&session?.user.id===owner&&accountEpoch===epoch&&selectedOrder?.id===orderId)message(error.message,true);}
  updateControls();
});
$('destination-url').addEventListener('input',updateControls);
$('media-upload').addEventListener('click',uploadMedia);
$('publish-consent').addEventListener('change',updateControls);
$('publish-broadcast').addEventListener('click',publishBroadcast);
$('purchase-recover').addEventListener('click',()=>{if(selectedOrder?.id)selectOrder(selectedOrder.id);});
$('broadcasts-refresh').addEventListener('click',()=>loadOrders().catch(()=>message('Broadcast status could not be refreshed.',true)));
$('broadcasts-more').addEventListener('click',()=>loadOrders({more:true}).catch(()=>message('Older broadcasts could not be loaded.',true)));
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&session)loadOrders().catch(()=>{});});
initialize().catch(error=>{message(error.message||'Showrunner could not load.',true);$('spotlight-purchase').disabled=true;});
