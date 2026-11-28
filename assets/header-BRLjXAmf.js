import{n as e}from"./accountControl-C-zUnrJF.js";import{n as t}from"./siteInquiryDialog-6g79G4UJ.js";import{i as n}from"./portalCatalog-Oxq-vkPN.js";/* empty css               */function r(e,t=`./`,r=!1){let{home:i,t:a,label:o}=n(e),s=t+i.slice(2),c=r?`h1`:`div`;return`<header class="portal-mast" data-portal-root="${t}" lang="${e}">
    <div class="portal-mast-inner">
      <${c} class="portal-brand"><a href="${s}#top"><img src="${t}art/ui/oddbout-logo.webp" alt="ODDBOUT"><span lang="en">Agents go all out</span></a></${c}>
      <nav class="portal-primary" aria-label="${a(`주 메뉴`,`Main menu`,`メインメニュー`)}">
        <a href="${s}#games">${o.games}</a><a href="${s}#tools">Agent Tools</a><a href="${s}#launch">${o.launch}</a>
      </nav>
      <a data-portal-account href="${t}account?lang=${e}">${o.login}</a>
    </div></header>`}function i(n){let i=document.querySelector(`.portal-mast`);if(!i||!i.querySelector(`[data-portal-account]`))return;let a=i.dataset.portalRoot??`./`;if(i.lang!==n){let e=document.createElement(`template`);e.innerHTML=r(n,a,!!i.querySelector(`h1`));let t=e.content.firstElementChild;i.replaceWith(t),i=t}let o=e(n,{variant:`site`,slot:!0,root:a,onFeedback:(e,n)=>t(e,n,`feedback`)});i.querySelector(`[data-portal-account]`).replaceWith(o.element)}export{i as t};