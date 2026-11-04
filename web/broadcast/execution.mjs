/** One ticket's execution, payment evidence and creator fees. All authorization stays server-side. */
const IN_FLIGHT=['proposed','submitting','submitted'];
const plain=(value,max=400)=>typeof value==='string'?value.slice(0,max):'';
function el(tag,className='',text=''){const node=document.createElement(tag);if(className)node.className=className;if(text)node.textContent=text;return node;}

/** A ticket's progress. Every step is either done or not yet; PayPal steps fill PayPal yellow when done.
 * Callers pass only the steps their data actually knows.
 * @param {{label:string,done:boolean,paypal?:boolean}[]} steps @param {HTMLOListElement} [list] */
export function progressTrail(steps,list=document.createElement('ol')){
  list.classList.add('progress-trail');list.setAttribute('aria-label','Ticket progress');
  const current=steps.findIndex(step=>!step.done);
  list.replaceChildren(...steps.map((step,index)=>{
    const item=el('li',step.done?'is-done':'is-pending',step.label);if(step.paypal)item.classList.add('is-paypal');
    if(index===current)item.setAttribute('aria-current','step');
    item.append(el('span','visually-hidden',step.done?' (done)':' (not yet)'));return item;
  }));
  return list;
}

/** @param {{api:Function,getOwner:()=>string|undefined,getJournal:()=>any,onStatus?:(order:any)=>void,
 *  fighterName?:(id:string)=>string,fighterPhoto?:(id:string,size:number)=>HTMLImageElement|null}} options */
export function createExecutionPanel({api,getOwner,getJournal,onStatus=()=>{},fighterName=id=>String(id),fighterPhoto=()=>null}){
  const $=id=>document.getElementById(id),panel=$('execution-panel');let order=null,data=null,busy=false,revision=0;
  const usd=cents=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(cents/100);
  const clock=new Intl.DateTimeFormat(undefined,{hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  const stamp=new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'long'});
  const validDate=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));
  const messages={'campaign-settlement-required':'Check settlement again before paying.','broadcast-not-finished':'Finish the broadcast before settlement.','nothing-to-pay':'There are no unpaid, completed appearances.','wallet-frozen':'Payment needs review. Creator payouts are paused.'};
  function badge(node,text,tone=''){node.textContent=text;node.className='execution-badge'+(tone?' is-'+tone:'');node.hidden=!text;}
  /** The ticket's share of each top-up in USD, only when every share is exact from PayPal's recorded amount. */
  function fundingCents(rows){
    let total=0;
    for(const source of data.funding){
      const row=rows.find(item=>item?.intentId===source.intentId);
      if(!row||row.currency!=='USD'||!Number.isSafeInteger(row.amountCents)||!Number.isSafeInteger(row.credits)||row.credits<=0||!Number.isSafeInteger(source.credits))return null;
      const scaled=row.amountCents*source.credits;if(scaled%row.credits)return null;total+=scaled/row.credits;
    }
    return data.funding.length?total:null;
  }
  function faces(ids){
    const list=el('ul','decision-fighters');list.setAttribute('aria-label','Fighters');
    for(const id of Array.isArray(ids)?ids:[]){const photo=fighterPhoto(id,28);if(!photo)continue;photo.alt=fighterName(id);const item=el('li');item.append(photo);list.append(item);}
    return list.childElementCount?list:null;
  }
  function renderDecisions(){
    const decisions=(Array.isArray(data.producer?.decisions)?data.producer.decisions:[]).slice(-5);
    $('execution-decisions').replaceChildren(...decisions.map(decision=>{
      const item=el('li'),when=[Number.isSafeInteger(decision.sequence)?'#'+decision.sequence:'',validDate(decision.at)?clock.format(new Date(decision.at)):''].filter(Boolean).join(' · ');
      const what=el('div','decision-what');what.append(el('code','decision-action',plain(decision.action,40)||'decision'));
      const title=plain(decision.episode,200)||plain(decision.reason,400);if(title)what.append(el('p','decision-title',title));
      const lineup=faces(decision.fighterIds);if(lineup)what.append(lineup);
      item.append(el('span','decision-when',when),what);
      const outcome=plain(decision.outcome?.status,40);
      if(outcome){const tag=el('span');badge(tag,outcome,outcome==='succeeded'?'ok':['failed','unknown'].includes(outcome)?'warn':'');item.append(tag);}
      return item;
    }));
    $('execution-decisions-empty').hidden=decisions.length>0;
  }
  function renderSettlement(finished){
    const settlement=data.settlement,rows=Array.isArray(settlement?.rows)?settlement.rows:[];
    badge($('execution-settlement-badge'),settlement?.status==='matched'?'Matched':settlement?'Needs review':'',settlement?.status==='matched'?'ok':'warn');
    if(settlement){
      const line=[settlement.source==='paypal-mcp'?'Checked with the official PayPal MCP server':'Checked against PayPal records'];
      const tools=[...new Set((Array.isArray(settlement.toolCalls)?settlement.toolCalls:[]).filter(call=>call?.ok===true).map(call=>plain(call.name,40)).filter(Boolean))];
      $('execution-settlement').replaceChildren(...line,...tools.flatMap((name,index)=>[index?', ':' · ',el('code','',name)]));
    }else $('execution-settlement').textContent=finished?'Ready to check':'Available when the broadcast finishes';
    const facts=[];
    for(const source of data.funding){
      const result=plain(rows.find(row=>row?.intentId===source.intentId)?.result,40);
      facts.push(['PayPal order',(plain(source.orderId,64)||'Not recorded')+(result&&result!=='matched'?` · ${result}`:''),true],['Capture',plain(source.captureId,64)||'Not recorded',true]);
    }
    if(data.funding.length){
      const credits=data.funding.reduce((sum,source)=>sum+(Number.isSafeInteger(source.credits)?source.credits:0),0),cents=fundingCents(rows);
      facts.push(['Funding for this ticket',`${credits.toLocaleString()} DON${cents===null?'':` · ${usd(cents)}`}`]);
    }
    if(validDate(settlement?.checkedAt))facts.push(['Checked',stamp.format(new Date(settlement.checkedAt))]);
    $('execution-settlement-facts').replaceChildren(...facts.map(([label,value,id])=>{const row=el('div');row.append(el('dt','',label),el('dd',id?'is-id':'',value));return row;}));
    $('execution-settlement-facts').hidden=!facts.length;
    const summary=plain(settlement?.summary,1500).trim();$('execution-audit-text').textContent=summary;$('execution-audit').hidden=!summary;
  }
  function renderFees(batch,paidBatches,paid){
    const shown=batch?[batch]:paidBatches,lineup=Array.isArray(data.order.fighterIds)?data.order.fighterIds:[],byFighter=new Map();
    for(const source of shown)for(const item of Array.isArray(source.items)?source.items:[]){
      if(!Number.isSafeInteger(item?.cents))continue;const entry=byFighter.get(item.fighterId)??{cents:0,cups:0};
      entry.cents+=item.cents;entry.cups+=Number.isSafeInteger(item.cups)?item.cups:1;byFighter.set(item.fighterId,entry);
    }
    const rank=id=>{const index=lineup.indexOf(id);return index<0?lineup.length:index;};
    const rows=[...byFighter].sort(([a],[b])=>rank(a)-rank(b)).map(([fighter,entry])=>{
      const item=el('li'),photo=fighterPhoto(fighter,32),name=el('span','',fighterName(fighter));
      name.append(el('small','',` · ${entry.cups} ${entry.cups===1?'cup':'cups'}`));
      item.append(photo??el('span','fee-photo'),name,el('b','',usd(entry.cents)));return item;
    });
    if(rows.length){const total=el('li','fee-total');total.append(el('span'),el('span','','Total'),el('b','',usd(batch?batch.totalCents:paid)));rows.push(total);}
    $('execution-payout-list').replaceChildren(...rows);
    badge($('execution-fees-badge'),!batch&&paid?'Paid via PayPal Payouts':'','paypal');
    $('execution-payout-receipts').replaceChildren(...paidBatches.map(source=>{
      const line=el('p','execution-receipt',source.providerBatchId?'Paid · PayPal batch ':'Paid · PayPal Payouts');
      if(source.providerBatchId)line.append(el('code','',plain(source.providerBatchId,64)));
      // payouts.mjs/paypal.mjs mark a batch paid only after every recipient item reports SUCCESS.
      if(source.providerStatus==='SUCCESS')line.append(' · every recipient SUCCESS');
      return line;
    }));
  }
  function render(){
    if(!data)return;onStatus(data.order);const b=data.execution.broadcast,jobs=data.execution.jobs,done=jobs.filter(j=>j.status==='succeeded').length;
    const unknown=jobs.some(j=>j.status==='unknown'),failed=jobs.filter(j=>j.status==='failed').length,finished=b.status==='completed';
    $('execution-state').textContent=unknown?'Needs review':finished?(done?'Finished':'No completed cups'):b.status==='stopping'?'Finishing current cup':data.producer?.state==='finished'?'Agent finished · program continues':data.producer?.state==='running'?'Agent running':'Connecting agent';
    $('execution-results').textContent=`${done} completed ${done===1?'cup':'cups'}${failed?` · ${failed} not completed`:''}`;
    const retryable=data.producer?.canRetry&&!finished; $('execution-retry').hidden=!retryable;$('execution-retry').disabled=busy;
    if(retryable)$('execution-state').textContent='Agent needs a retry';
    else if(data.producer?.result?.status==='unknown')$('execution-state').textContent='Agent needs review';
    const state=$('execution-state').textContent;$('execution-state').className='execution-badge'+(['Finished','Agent running'].includes(state)?' is-ok':/review|retry|No completed/.test(state)?' is-warn':'');
    $('execution-stop').hidden=finished||b.status==='stopping';$('execution-stop').disabled=busy;
    $('execution-refresh').disabled=busy;$('execution-reconcile').disabled=busy||!finished;
    $('execution-reconcile').textContent=data.settlement?'Check settlement again':'Check settlement';
    const funded=data.funding.reduce((sum,source)=>sum+(Number.isSafeInteger(source.credits)?source.credits:0),0);
    progressTrail([{label:'Paid',done:data.funding.length>0&&funded>=data.order.priceCredits,paypal:true},
      {label:'Scheduled',done:Boolean(data.order.scheduledAt||data.order.startedAt)},
      {label:data.order.startedAt?`On air · ${done} ${done===1?'cup':'cups'}`:'On air',done:Boolean(data.order.startedAt)},
      {label:'Settled',done:data.settlement?.status==='matched',paypal:true},
      {label:'Creators paid',done:data.payouts.some(p=>p.status==='paid'),paypal:true}],$('execution-trail'));
    renderDecisions();renderSettlement(finished);
    const batch=data.payouts.find(p=>IN_FLIGHT.includes(p.status)),paidBatches=data.payouts.filter(p=>p.status==='paid'),paid=paidBatches.reduce((sum,p)=>sum+p.totalCents,0);
    $('execution-fees').textContent=batch?`${usd(batch.totalCents)} · ${batch.status==='proposed'?'Ready for approval':batch.status==='submitting'?'Confirmation pending':batch.providerStatus==='ITEMS_NEED_REVIEW'?'Recipient confirmation pending':'Processing at PayPal'}`:paid?`${usd(paid)} paid`:'Included in your ticket';
    renderFees(batch,paidBatches,paid);
    const needsApproval=batch&&['proposed','submitting'].includes(batch.status);
    $('execution-pay-row').hidden=!needsApproval;$('execution-pay').disabled=busy||!$('execution-consent').checked;
    $('execution-pay').textContent=batch?.status==='submitting'?'Retry same payout':`Pay ${usd(batch?.totalCents??0)} with PayPal`;
    $('execution-agent-note').textContent=retryable?'The last AI response was not usable. Retry continues this ticket without another DON charge.':'';
    $('execution-records').textContent=[`Ticket ${order.id}`,`Execution ${b.id}`,`Ticket price ${data.order.priceCredits} DON · additional charge 0 DON`,
      ...data.funding.map(f=>`PayPal order ${f.orderId} · capture ${f.captureId} · ${f.credits} DON`),
      ...data.payouts.map(p=>`Payout ${p.providerBatchId??p.id} · ${p.status}`)].join('\n');
  }
  async function update(next){
    const n=++revision;order=next;panel.hidden=!next?.broadcastId;if(panel.hidden){data=null;return;}
    const owner=getOwner(),id=next.id;
    try{const result=await api('/orders/'+id+'/execution');if(n!==revision||getOwner()!==owner)return;
      const before=data?.payouts.find(p=>['proposed','submitting'].includes(p.status))?.id;
      const after=result.payouts.find(p=>['proposed','submitting'].includes(p.status))?.id;if(before!==after)$('execution-consent').checked=false;
      data=result;render();
    }catch{if(n===revision){$('execution-message').textContent='Could not refresh this broadcast. Refresh status before continuing.';$('execution-pay').disabled=true;$('execution-consent').checked=false;}}
  }
  async function act(action){
    if(busy||!order||!data)return;const owner=getOwner(),id=order.id,epoch=++revision,journal=getJournal();
    busy=true;$('execution-message').textContent=action==='reconcile'?'Checking PayPal records…':action==='pay'?'Confirming payout…':action==='retry'?'Retrying Agent…':'Finishing broadcast…';render();
    try{
      const body={confirmed:true};if(action==='pay'){
        if(!$('execution-consent').checked)return;
        body.batchId=data.payouts.find(p=>['proposed','submitting'].includes(p.status))?.id;
      }
      let result=await api('/orders/'+id+'/'+action,{body});
      if(action==='reconcile'&&result.settlement?.status==='matched'&&result.execution.jobs.some(j=>j.status==='succeeded')&&!result.payouts.some(p=>IN_FLIGHT.includes(p.status))){
        const name='campaign-payout:'+id,op=journal.get(name)??journal.begin(name,{orderId:id});journal.markDispatched(name,op.requestKey);
        try{result=await api('/orders/'+id+'/propose',{body:{confirmed:true,requestKey:op.requestKey}});journal.complete(name,op.requestKey);}
        catch(error){if(error.code!=='nothing-to-pay')throw error;journal.complete(name,op.requestKey);}
      }
      if(epoch!==revision||getOwner()!==owner)return;data=result;$('execution-consent').checked=false;$('execution-message').textContent='';
    }catch(error){if(epoch===revision&&getOwner()===owner)$('execution-message').textContent=messages[error.code]??'Not confirmed. Refresh status and retry the same action.';}
    finally{busy=false;$('execution-stop-confirm').hidden=true;if(getOwner()===owner)render();}
  }
  $('execution-refresh').addEventListener('click',()=>update(order));
  $('execution-reconcile').addEventListener('click',()=>act('reconcile'));
  $('execution-pay').addEventListener('click',()=>act('pay'));
  $('execution-retry').addEventListener('click',()=>act('retry'));
  $('execution-consent').addEventListener('change',render);
  $('execution-stop').addEventListener('click',()=>{$('execution-stop-confirm').hidden=false;});
  $('execution-keep').addEventListener('click',()=>{$('execution-stop-confirm').hidden=true;});
  $('execution-end').addEventListener('click',()=>act('stop'));
  return{update:next=>busy&&next?.id===order?.id?Promise.resolve():update(next)};
}
