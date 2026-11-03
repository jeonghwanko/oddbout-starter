/** One ticket's execution, payment evidence and creator fees. All authorization stays server-side. */
export function createExecutionPanel({api,getOwner,getJournal,onStatus=()=>{}}){
  const $=id=>document.getElementById(id),panel=$('execution-panel');let order=null,data=null,busy=false,revision=0;
  const usd=cents=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(cents/100);
  const messages={'campaign-settlement-required':'Check settlement again before paying.','broadcast-not-finished':'Finish the broadcast before settlement.','nothing-to-pay':'There are no unpaid, completed appearances.','wallet-frozen':'Payment needs review. Creator payouts are paused.'};
  function render(){
    if(!data)return;onStatus(data.order);const b=data.execution.broadcast,jobs=data.execution.jobs,done=jobs.filter(j=>j.status==='succeeded').length;
    const unknown=jobs.some(j=>j.status==='unknown'),failed=jobs.filter(j=>j.status==='failed').length,finished=b.status==='completed';
    $('execution-state').textContent=unknown?'Needs review':finished?(done?'Finished':'No completed cups'):b.status==='stopping'?'Finishing current cup':data.producer?.state==='finished'?'Agent finished · program continues':data.producer?.state==='running'?'Agent running':'Connecting agent';
    $('execution-results').textContent=`${done} completed ${done===1?'cup':'cups'}${failed?` · ${failed} not completed`:''}`;
    $('execution-stop').hidden=finished||b.status==='stopping';$('execution-stop').disabled=busy;
    $('execution-refresh').disabled=busy;$('execution-reconcile').disabled=busy||!finished;
    $('execution-reconcile').textContent=data.settlement?'Check settlement again':'Check settlement';
    $('execution-settlement').textContent=data.settlement?.status==='matched'?'PayPal payment matched':data.settlement?'Payment needs review':finished?'Ready to check':'Available when the broadcast finishes';
    const batch=data.payouts.find(p=>['proposed','submitting','submitted'].includes(p.status)),paid=data.payouts.filter(p=>p.status==='paid').reduce((sum,p)=>sum+p.totalCents,0);
    $('execution-fees').textContent=batch?`${usd(batch.totalCents)} · ${batch.status==='proposed'?'Ready for approval':batch.status==='submitting'?'Confirmation pending':'Processing at PayPal'}`:paid?`${usd(paid)} paid`:'Included in your ticket';
    const byFighter=new Map();for(const item of batch?.items??[])byFighter.set(item.fighterId,(byFighter.get(item.fighterId)??0)+item.cents);
    $('execution-payout-list').replaceChildren(...[...byFighter].map(([fighter,cents])=>{const li=document.createElement('li');li.textContent=`${fighter} · ${usd(cents)}`;return li;}));
    const needsApproval=batch&&['proposed','submitting'].includes(batch.status);
    $('execution-pay-row').hidden=!needsApproval;$('execution-pay').disabled=busy||!$('execution-consent').checked;
    $('execution-pay').textContent=batch?.status==='submitting'?'Retry same payout':`Pay ${usd(batch?.totalCents??0)} with PayPal`;
    const lastDecision=data.producer?.decisions?.at(-1);$('execution-agent-note').textContent=lastDecision?.episode??lastDecision?.reason??'';
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
    busy=true;$('execution-message').textContent=action==='reconcile'?'Checking PayPal records…':action==='pay'?'Confirming payout…':'Finishing broadcast…';render();
    try{
      const body={confirmed:true};if(action==='pay'){
        if(!$('execution-consent').checked)return;
        body.batchId=data.payouts.find(p=>['proposed','submitting'].includes(p.status))?.id;
      }
      let result=await api('/orders/'+id+'/'+action,{body});
      if(action==='reconcile'&&result.settlement?.status==='matched'&&result.execution.jobs.some(j=>j.status==='succeeded')&&!result.payouts.some(p=>['proposed','submitting','submitted'].includes(p.status))){
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
  $('execution-consent').addEventListener('change',render);
  $('execution-stop').addEventListener('click',()=>{$('execution-stop-confirm').hidden=false;});
  $('execution-keep').addEventListener('click',()=>{$('execution-stop-confirm').hidden=true;});
  $('execution-end').addEventListener('click',()=>act('stop'));
  return{update:next=>busy&&next?.id===order?.id?Promise.resolve():update(next)};
}
