// @ts-check
import { CLOUD_RESOURCE } from './resources.mjs';
import { CREATOR_PAGE } from './common.mjs';

export const LOOK_UI = 'ui://oddbout/hosted-looks-v1.html';
const mimeType = 'text/html;profile=mcp-app';
const storageOrigin = new URL(CLOUD_RESOURCE).origin;
const domain = 'https://hosted-looks.oddbout.com';
const csp = { connectDomains: [], resourceDomains: [storageOrigin] };
const meta = { ui: { domain, csp, prefersBorder: true }, 'openai/widgetDomain': domain,
  'openai/widgetCSP': { connect_domains: [], resource_domains: [storageOrigin] }, 'openai/widgetPrefersBorder': true };

// The resource is public and cacheable: it has no job or owner data. Only the invoking tool result supplies the pictures.
const text = `<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer"><title>ODDBOUT · Fighter looks</title>
<style>
:root{color-scheme:light dark;font:15px/1.4 system-ui,sans-serif}*{box-sizing:border-box}body{margin:0;padding:12px}
h2{margin:0 0 8px;font-size:1.05rem}p{margin:0}.looks{display:grid;grid-template-columns:1fr 1fr;gap:8px}
figure{margin:0;min-width:0}figcaption{font-weight:700;margin:0 0 4px}img{display:block;width:100%;max-height:330px;aspect-ratio:1;object-fit:contain;background:#f5f1e8;border-radius:8px}
</style><main aria-live="polite"><p>ODDBOUT</p></main>
<script>
const root=document.querySelector('main'), origin=${JSON.stringify(storageOrigin)};
const uploadPage=${JSON.stringify(CREATOR_PAGE + '#view=upload&ticket=')};
const ko=()=> (window.openai?.locale || document.documentElement.lang || navigator.language).startsWith('ko');
const say=(en,kr)=>ko()?kr:en;
const node=(tag,words)=>{const el=document.createElement(tag);if(words)el.textContent=words;return el};
const post=(message)=>parent.postMessage({jsonrpc:'2.0',...message},'*');
const snapshots=new Map();
function safeUrl(value,job,key,index){
  try{const u=new URL(value), prefix='/storage/v1/object/sign/af-generation/jobs/'+job.id+'/';
    return job.candidates?.[index]?.key===key && /^[0-9a-f-]{36}$/i.test(job.id) && u.origin===origin &&
      !u.username && !u.password && !u.hash && u.searchParams.has('token') && u.pathname.startsWith(prefix) &&
      /^[a-z0-9-]+[.]webp$/.test(u.pathname.slice(prefix.length)) ? u.href : null;
  }catch{return null}
}
function latest(result,partial=false){
  const output=result.structuredContent || {}, job=output.job;
  if(job?.id && output.statusSummary){
    const s=output.statusSummary, stamp=[Date.parse(s.updatedAt)||0,Date.parse(s.checkedAt)||0], previous=snapshots.get(job.id);
    if(previous){
      const before=previous.result.structuredContent, sameReceipt=!job.submission?.id || !before.job.submission?.id || job.submission.id===before.job.submission.id;
      // The job timestamp does not change when validation finishes, and checkedAt is a response-completion clock.
      // A submission's final receipt is immutable, so a slower pending read cannot undo it, in either arrival order.
      const final=j=>j.status==='submitted' && ['registered','rejected'].includes(j.submission?.stage);
      const settles=sameReceipt && final(job) && !final(before.job);
      if((sameReceipt && final(before.job) && !final(job)) || (!settles &&
        (stamp[0]<previous.stamp[0] || (stamp[0]===previous.stamp[0] && stamp[1]<previous.stamp[1]))))return previous.result;
      // A list updates status without discarding the pictures from a full read of the same job version.
      if(partial && sameReceipt && stamp[0]===previous.stamp[0] && job.status===before.job.status)
        result={...previous.result,structuredContent:{...before,...output,job:{...before.job,...job}}};
    }
    snapshots.delete(job.id);
    snapshots.set(job.id,{stamp,result});
    if(snapshots.size>5)snapshots.delete(snapshots.keys().next().value);
  }
  return result;
}
function decoded(result){
  if(result.structuredContent && typeof result.structuredContent==='object' && !Array.isArray(result.structuredContent))return result;
  // Non-ChatGPT clients get the same JSON in content[0], without structuredContent.
  try{const text=(result.content || []).find(b=>b.type==='text')?.text, output=JSON.parse(text);
    if(output && typeof output==='object' && !Array.isArray(output))return {...result,structuredContent:output};
  }catch{}
  return {...result,structuredContent:{}};
}
function render(result){
  if(!result)return;
  result=latest(decoded(result));
  const output=result.structuredContent || {}, job=output.job, blocks=(result.content || []).filter(b=>b.type==='image' && b.mimeType==='image/webp');
  const pair=job?.candidates?.length===2 && job.candidates[0].key==='a' && job.candidates[1].key==='b';
  const inline=output.previewPair===true && pair && blocks.length===2 &&
    blocks.every(b=>typeof b.data==='string' && b.data.length<=2666668 && /^[A-Za-z0-9+/]+=*$/.test(b.data));
  const urls=pair ? ['a','b'].map((k,i)=>safeUrl(job.candidates[i].url,job,k,i)) : [];
  if(!inline && !(urls.length===2 && urls.every(Boolean))){
    if(!result.structuredContent)return;
    if(output.statusSummary){renderStatus(output);
      if(job?.status==='appearance_ready')root.append(node('p',say('The two previews are unavailable. Check them on the website before choosing.','후보 그림을 불러오지 못했습니다. 사이트에서 확인한 뒤 선택하세요.')));
      return;}
    if(Array.isArray(output.jobs)){
      root.replaceChildren(node('h2',say('Recent requests','최근 제작 신청')));
      for(const request of output.jobs){const card=node('section');
        const current=latest({structuredContent:{job:request,statusSummary:request.statusSummary,siteUrl:request.siteUrl}},true).structuredContent;
        card.append(node('h2',current.job.name || current.job.profile?.name || request.name || say('Fighter','캐릭터')));
        statusNodes(current).forEach(n=>card.append(n));root.append(card);}
      return;
    }
    if(output.ok===true && (output.ticket || Array.isArray(output.tickets))){
      const tickets=output.ticket?[output.ticket]:output.tickets;
      root.replaceChildren(node('h2',say('Reference image uploads','참고 이미지 업로드')));
      if(!tickets.length)root.append(node('p',say('No image uploads yet.','업로드 내역이 없습니다.')));
      for(const ticket of tickets){const card=node('section');card.append(...ticketNodes(ticket));root.append(card)}
      root.append(node('p',say('Uploading images does not mean a fighter has been created or registered.','이미지 업로드는 캐릭터 생성·등록 완료를 뜻하지 않습니다.')));
      return;
    }
    if(output.ok===true && output.observed && output.fetched===false && output.kept===false){
      root.replaceChildren(node('h2',say('Image link check','이미지 주소 형식 확인')),
        node('p',say('Only the address format was checked. No image was fetched or uploaded.','주소 형식만 확인했습니다. 이미지를 가져오거나 업로드하지 않았습니다.')));
      return;
    }
    root.replaceChildren(node('p',say('Status unavailable. Check the request on ODDBOUT.','상태를 확인하지 못했습니다. ODDBOUT에서 신청 내역을 확인하세요.')));
    return;
  }
  const grid=node('div');grid.className='looks';
  ['A','B'].forEach((key,i)=>{
    const fig=node('figure'), label=say('Candidate ','후보 ')+key+(job.choice===key.toLowerCase()?say(' · Selected',' · 선택됨'):''), img=node('img');
    img.alt=label;img.referrerPolicy='no-referrer';
    const failure=()=>img.replaceWith(node('p',say('Image unavailable','그림을 표시할 수 없습니다')));
    img.onerror=()=>{if(inline && urls[i]){img.onerror=failure;img.src=urls[i]}else failure()};
    fig.append(node('figcaption',label),img);grid.append(fig);
    img.src=inline?'data:image/webp;base64,'+blocks[i].data:urls[i];
  });
  root.replaceChildren(node('h2',job.status==='appearance_ready'?say('Compare the two looks','두 외형 비교'):say('Existing looks','기존 외형 시안')),grid);
  statusNodes(output).forEach(n=>root.append(n));
}
function ticketNodes(ticket){
  const uploads=Array.isArray(ticket.uploads)?ticket.uploads:[], usable=uploads.filter(u=>u.usable===true).length;
  const items=[node('p',say('Uploaded images: ','업로드된 이미지: ')+uploads.length+say(' · Usable: ',' · 사용 가능: ')+usable)];
  const closed={full:['The upload slots are full.','업로드 칸이 가득 찼습니다.'],expired:['The upload link has expired.','업로드 링크가 만료되었습니다.'],
    'day-limit':['The daily upload limit has been reached.','오늘의 업로드 한도를 사용했습니다.']};
  if(closed[ticket.closed])items.push(node('p',say(...closed[ticket.closed])));
  if(usable)items.push(node('p',say('Review the images and confirm permission to use them before requesting creation.','이미지와 사용 권한을 확인한 뒤 제작을 요청하세요.')));
  else items.push(node('p',!uploads.length && ticket.open?say('No images uploaded yet.','아직 업로드된 이미지가 없습니다.'):
    say('No images are currently usable for a new request.','새 제작 요청에 사용할 수 있는 이미지가 없습니다.')));
  if(ticket.expiresAt)items.push(node('p',say('Upload link expiry: ','업로드 링크 만료 시각: ')+ticket.expiresAt));
  if(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ticket.id)){
    const a=node('a',say('Review images and upload status','이미지·업로드 상태 확인'));a.href=uploadPage+ticket.id;
    a.target='_blank';a.rel='noopener noreferrer';items.push(a);
  }
  return items;
}
function statusNodes(output){
  const s=output.statusSummary;
  if(!s)return [node('p',say('Status unavailable','상태 확인 필요'))];
  const names={queued:['Queued','제작 대기'],appearance:['Creating looks','외형 제작 중'],choose_look:['Choose a look','외형 선택 필요'],
    motions:['Creating motions','모션 제작 중'],registration_pending:['Motions finished · registration pending','모션 완료 · 등록 연결 대기'],
    submitting:['Packaging and registering','패키지 구성·등록 중'],validating:['Checking the package','등록 파일 검사 중'],
    registered:['Registered','등록 완료'],operator_review:['Operator attention needed','운영자 확인 필요'],stopped:['Stopped','작업 종료·중단']};
  const label=names[s.state] || ['Status unknown','상태 확인 필요'];
  const items=[node('h2',say(...label))];
  if(s.queue){
    items.push(node('p',say('Queue position: ','대기 순서: ')+s.queue.position));
    if(s.queue.reason==='usage')items.push(node('p',say('Waiting for generation capacity to recover.','생성 한도 회복을 기다리고 있습니다.')));
    if(s.queue.reason==='paused')items.push(node('p',say('Generation service is paused.','현재 제작 서비스가 일시 중지되어 있습니다.')));
    if(s.queue.resetsAt)items.push(node('p',say('Capacity reset: ','한도 회복 예정: ')+s.queue.resetsAt));
  }
  if(s.stageProgress!==null && !s.terminal && ['appearance','motions','submitting'].includes(s.state))
    items.push(node('p',say('Current stage: ','현재 단계 진행: ')+s.stageProgress+'%'+say(' (not overall completion)',' (전체 완료율 아님)')));
  const actions={enter_on_site:['Check entry status and motions on the website; enter there if needed.','사이트에서 출전 상태와 동작을 확인하고, 필요하면 출전하세요.'],
    choose_look:['Choose A or B in this chat.','채팅에서 A 또는 B를 선택하세요.'],
    agent_register:['No motion approval needed. The agent continues registration.','모션 승인은 필요 없습니다. 에이전트가 등록을 이어갑니다.'],
    operator:['No answer needed from you. An operator must check this step.','사용자 응답 대기가 아닙니다. 운영자의 확인이 필요합니다.'],
    inspect_error:['Check the error before requesting any new generation.','오류를 확인하세요. 새 생성은 자동으로 시작하지 않습니다.'],
    inspect_status:['The current state is unknown. Check the request on the website.','현재 상태를 해석할 수 없습니다. 사이트에서 신청 상태를 확인하세요.'],
    none:['No action needed. Follow the server job on the website.','지금 할 일은 없습니다. 사이트에서 진행 상황을 확인할 수 있습니다.']};
  items.push(node('p',say(...(actions[s.actionRequired] || ['Check status','상태를 확인하세요']))));
  if(s.error)items.push(node('p',say('Reason: ','사유: ')+s.error));
  if(s.updatedAt)items.push(node('p',say('Last job update: ','작업 갱신: ')+s.updatedAt));
  if(s.checkedAt)items.push(node('p',say('Snapshot checked: ','이 카드의 확인 시각: ')+s.checkedAt));
  items.push(node('p',say('This card is a snapshot, not a live notification.','이 카드는 확인 시점의 상태입니다. 자동 알림이 아닙니다.')));
  try{const u=new URL(output.siteUrl);if(u.protocol==='https:' && u.hostname==='oddbout.com' && !u.username && !u.password){
    const a=node('a',s.completed?say('Review and enter','동작 확인·출전하기'):say('View latest status','최신 진행 상황 보기'));
    a.href=u.href;a.target='_blank';a.rel='noopener noreferrer';items.push(a);}}
  catch{}
  return items;
}
function renderStatus(output){root.replaceChildren(...statusNodes(output));}
function fromGlobals(){
  const api=window.openai, m=api?.toolResponseMetadata, r=m?.mcp_tool_result || m?.call_tool_result;
  if(api?.toolOutput){
    // Globals can update separately. Never pair a current job with another result's images.
    const matching=r?.structuredContent && JSON.stringify(r.structuredContent)===JSON.stringify(api.toolOutput);
    render({structuredContent:api.toolOutput,content:matching?r.content:[]});
  }else if(r)render(r);
}
window.addEventListener('message',event=>{
  const m=event.data;if(event.source!==parent || m?.jsonrpc!=='2.0')return;
  if(m.id===1 && m.result){if(m.result.hostContext?.locale)document.documentElement.lang=m.result.hostContext.locale;
    post({method:'ui/notifications/initialized',params:{}})}
  if(m.method==='ui/notifications/tool-result')render(m.params);
});
window.addEventListener('openai:set_globals',fromGlobals);
new ResizeObserver(()=>post({method:'ui/notifications/size-changed',params:{height:document.body.scrollHeight}})).observe(document.body);
post({id:1,method:'ui/initialize',params:{appInfo:{name:'ODDBOUT fighter looks',version:'1.0.0'},appCapabilities:{},protocolVersion:'2026-01-26'}});
fromGlobals();
</script></html>`;

/** @param {import('@modelcontextprotocol/server').McpServer} server */
export function registerLookUi(server) {
  server.registerResource('oddbout-hosted-looks', LOOK_UI, { mimeType, _meta: meta }, () => ({
    contents: [{ uri: LOOK_UI, mimeType, text, _meta: meta }],
  }));
}
