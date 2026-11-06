// @ts-check
import { CLOUD_RESOURCE } from './resources.mjs';

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
const ko=()=> (window.openai?.locale || document.documentElement.lang || navigator.language).startsWith('ko');
const say=(en,kr)=>ko()?kr:en;
const node=(tag,words)=>{const el=document.createElement(tag);if(words)el.textContent=words;return el};
const post=(message)=>parent.postMessage({jsonrpc:'2.0',...message},'*');
function safeUrl(value,job,key,index){
  try{const u=new URL(value), prefix='/storage/v1/object/sign/af-generation/jobs/'+job.id+'/';
    return job.candidates?.[index]?.key===key && /^[0-9a-f-]{36}$/i.test(job.id) && u.origin===origin &&
      !u.username && !u.password && !u.hash && u.searchParams.has('token') && u.pathname.startsWith(prefix) &&
      /^[a-z0-9-]+[.]webp$/.test(u.pathname.slice(prefix.length)) ? u.href : null;
  }catch{return null}
}
function render(result){
  if(!result)return;
  const output=result.structuredContent || {}, job=output.job, blocks=(result.content || []).filter(b=>b.type==='image' && b.mimeType==='image/webp');
  const inline=blocks.length===2 && blocks.every(b=>typeof b.data==='string' && b.data.length<=2666668 && /^[A-Za-z0-9+/]+=*$/.test(b.data));
  const urls=output.previewPair===true && job?.status==='appearance_ready' && job.candidates?.length===2 ? ['a','b'].map((k,i)=>safeUrl(job.candidates[i].url,job,k,i)) : [];
  if(!inline && !(urls.length===2 && urls.every(Boolean))){
    if(!result.structuredContent)return;
    root.replaceChildren(node('p',job?.status==='appearance_ready' ? say('The two previews are unavailable.','후보 그림을 불러오지 못했습니다.') :
      Array.isArray(output.jobs) ? say('Recent requests: ','최근 신청: ')+output.jobs.length :
      job?.status ? 'ODDBOUT · '+job.status : say('ODDBOUT request details','ODDBOUT 신청 정보')));
    return;
  }
  const grid=node('div');grid.className='looks';
  ['A','B'].forEach((key,i)=>{
    const fig=node('figure'), label=say('Candidate ','후보 ')+key, img=node('img');
    img.alt=label;img.referrerPolicy='no-referrer';
    const failure=()=>img.replaceWith(node('p',say('Image unavailable','그림을 표시할 수 없습니다')));
    img.onerror=()=>{if(inline && urls[i]){img.onerror=failure;img.src=urls[i]}else failure()};
    fig.append(node('figcaption',label),img);grid.append(fig);
    img.src=inline?'data:image/webp;base64,'+blocks[i].data:urls[i];
  });
  root.replaceChildren(node('h2',say('Compare the two looks','두 외형 비교')),grid);
}
function fromGlobals(){
  const api=window.openai, m=api?.toolResponseMetadata, r=m?.mcp_tool_result || m?.call_tool_result;
  if(r || api?.toolOutput)render({...r,structuredContent:r?.structuredContent || api?.toolOutput});
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
