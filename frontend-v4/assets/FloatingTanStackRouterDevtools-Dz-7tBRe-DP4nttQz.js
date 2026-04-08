import{c as ne,a as Ce,b as w,u as mt,d as St,o as tt,e as wt,f as W,s as it,m as Ve,i as u,g as _t,h as a,j as _,k as X,M as Xe,l as V,n as s,F as Ft,S as zt,p as xt,t as G,q as Mt,r as nt,D as Ut,v as Bt,w as Ot}from"./index-B92Iqh-j.js";import{o as He,t as ut,p as Dt}from"./router-vendor-DGOK2jvB.js";import"./query-vendor-BGL-JTA0.js";import"./ui-vendor-6khmut0P.js";let Tt={data:""},Et=e=>{if(typeof window=="object"){let t=(e?e.querySelector("#_goober"):window._goober)||Object.assign(document.createElement("style"),{innerHTML:" ",id:"_goober"});return t.nonce=window.__nonce__,t.parentNode||(e||document.head).appendChild(t),t.firstChild}return e||Tt},It=/(?:([\u0080-\uFFFF\w-%@]+) *:? *([^{;]+?);|([^;}{]*?) *{)|(}\s*)/g,Gt=/\/\*[^]*?\*\/|  +/g,gt=/\n+/g,Fe=(e,t)=>{let l="",r="",g="";for(let o in e){let d=e[o];o[0]=="@"?o[1]=="i"?l=o+" "+d+";":r+=o[1]=="f"?Fe(d,o):o+"{"+Fe(d,o[1]=="k"?"":t)+"}":typeof d=="object"?r+=Fe(d,t?t.replace(/([^,])+/g,c=>o.replace(/([^,]*:\S+\([^)]*\))|([^,])+/g,p=>/&/.test(p)?p.replace(/&/g,c):c?c+" "+p:p)):o):d!=null&&(o=/^--/.test(o)?o:o.replace(/[A-Z]/g,"-$&").toLowerCase(),g+=Fe.p?Fe.p(o,d):o+":"+d+";")}return l+(t&&g?t+"{"+g+"}":g)+r},be={},bt=e=>{if(typeof e=="object"){let t="";for(let l in e)t+=l+bt(e[l]);return t}return e},At=(e,t,l,r,g)=>{let o=bt(e),d=be[o]||(be[o]=(p=>{let n=0,i=11;for(;n<p.length;)i=101*i+p.charCodeAt(n++)>>>0;return"go"+i})(o));if(!be[d]){let p=o!==e?e:(n=>{let i,m,v=[{}];for(;i=It.exec(n.replace(Gt,""));)i[4]?v.shift():i[3]?(m=i[3].replace(gt," ").trim(),v.unshift(v[0][m]=v[0][m]||{})):v[0][i[1]]=i[2].replace(gt," ").trim();return v[0]})(e);be[d]=Fe(g?{["@keyframes "+d]:p}:p,l?"":"."+d)}let c=l&&be.g?be.g:null;return l&&(be.g=be[d]),((p,n,i,m)=>{m?n.data=n.data.replace(m,p):n.data.indexOf(p)===-1&&(n.data=i?p+n.data:n.data+p)})(be[d],t,r,c),d},Pt=(e,t,l)=>e.reduce((r,g,o)=>{let d=t[o];if(d&&d.call){let c=d(l),p=c&&c.props&&c.props.className||/^go/.test(c)&&c;d=p?"."+p:c&&typeof c=="object"?c.props?"":Fe(c,""):c===!1?"":c}return r+g+(d??"")},"");function Ue(e){let t=this||{},l=e.call?e(t.p):e;return At(l.unshift?l.raw?Pt(l,[].slice.call(arguments,1),t.p):l.reduce((r,g)=>Object.assign(r,g&&g.call?g(t.p):g),{}):l,Et(t.target),t.g,t.o,t.k)}Ue.bind({g:1});Ue.bind({k:1});var P={colors:{inherit:"inherit",current:"currentColor",transparent:"transparent",black:"#000000",white:"#ffffff",neutral:{50:"#f9fafb",100:"#f2f4f7",200:"#eaecf0",300:"#d0d5dd",400:"#98a2b3",500:"#667085",600:"#475467",700:"#344054",800:"#1d2939",900:"#101828"},darkGray:{50:"#525c7a",100:"#49536e",200:"#414962",300:"#394056",400:"#313749",500:"#292e3d",600:"#212530",700:"#191c24",800:"#111318",900:"#0b0d10"},gray:{50:"#f9fafb",100:"#f2f4f7",200:"#eaecf0",300:"#d0d5dd",400:"#98a2b3",500:"#667085",600:"#475467",700:"#344054",800:"#1d2939",900:"#101828"},blue:{25:"#F5FAFF",50:"#EFF8FF",100:"#D1E9FF",200:"#B2DDFF",300:"#84CAFF",400:"#53B1FD",500:"#2E90FA",600:"#1570EF",700:"#175CD3",800:"#1849A9",900:"#194185"},green:{25:"#F6FEF9",50:"#ECFDF3",100:"#D1FADF",200:"#A6F4C5",300:"#6CE9A6",400:"#32D583",500:"#12B76A",600:"#039855",700:"#027A48",800:"#05603A",900:"#054F31"},red:{50:"#fef2f2",100:"#fee2e2",200:"#fecaca",300:"#fca5a5",400:"#f87171",500:"#ef4444",600:"#dc2626",700:"#b91c1c",800:"#991b1b",900:"#7f1d1d",950:"#450a0a"},yellow:{25:"#FFFCF5",50:"#FFFAEB",100:"#FEF0C7",200:"#FEDF89",300:"#FEC84B",400:"#FDB022",500:"#F79009",600:"#DC6803",700:"#B54708",800:"#93370D",900:"#7A2E0E"},purple:{25:"#FAFAFF",50:"#F4F3FF",100:"#EBE9FE",200:"#D9D6FE",300:"#BDB4FE",400:"#9B8AFB",500:"#7A5AF8",600:"#6938EF",700:"#5925DC",800:"#4A1FB8",900:"#3E1C96"},teal:{25:"#F6FEFC",50:"#F0FDF9",100:"#CCFBEF",200:"#99F6E0",300:"#5FE9D0",400:"#2ED3B7",500:"#15B79E",600:"#0E9384",700:"#107569",800:"#125D56",900:"#134E48"},pink:{25:"#fdf2f8",50:"#fce7f3",100:"#fbcfe8",200:"#f9a8d4",300:"#f472b6",400:"#ec4899",500:"#db2777",600:"#be185d",700:"#9d174d",800:"#831843",900:"#500724"},cyan:{25:"#ecfeff",50:"#cffafe",100:"#a5f3fc",200:"#67e8f9",300:"#22d3ee",400:"#06b6d4",500:"#0891b2",600:"#0e7490",700:"#155e75",800:"#164e63",900:"#083344"}},alpha:{90:"e5",70:"b3",20:"33"},font:{size:{"2xs":"calc(var(--tsrd-font-size) * 0.625)",xs:"calc(var(--tsrd-font-size) * 0.75)",sm:"calc(var(--tsrd-font-size) * 0.875)",md:"var(--tsrd-font-size)"},lineHeight:{xs:"calc(var(--tsrd-font-size) * 1)",sm:"calc(var(--tsrd-font-size) * 1.25)"},weight:{normal:"400",medium:"500",semibold:"600",bold:"700"},fontFamily:{sans:"ui-sans-serif, Inter, system-ui, sans-serif, sans-serif",mono:"ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace"}},border:{radius:{xs:"calc(var(--tsrd-font-size) * 0.125)",sm:"calc(var(--tsrd-font-size) * 0.25)",md:"calc(var(--tsrd-font-size) * 0.375)",full:"9999px"}},size:{0:"0px",.5:"calc(var(--tsrd-font-size) * 0.125)",1:"calc(var(--tsrd-font-size) * 0.25)",1.5:"calc(var(--tsrd-font-size) * 0.375)",2:"calc(var(--tsrd-font-size) * 0.5)",2.5:"calc(var(--tsrd-font-size) * 0.625)",3:"calc(var(--tsrd-font-size) * 0.75)",3.5:"calc(var(--tsrd-font-size) * 0.875)",4:"calc(var(--tsrd-font-size) * 1)",5:"calc(var(--tsrd-font-size) * 1.25)",8:"calc(var(--tsrd-font-size) * 2)"}},Lt=e=>{const{colors:t,font:l,size:r,alpha:g,border:o}=P,{fontFamily:d,lineHeight:c,size:p}=l,n=e?Ue.bind({target:e}):Ue;return{devtoolsPanelContainer:n`
      direction: ltr;
      position: fixed;
      bottom: 0;
      right: 0;
      z-index: 99999;
      width: 100%;
      max-height: 90%;
      border-top: 1px solid ${t.gray[700]};
      transform-origin: top;
    `,devtoolsPanelContainerVisibility:i=>n`
        visibility: ${i?"visible":"hidden"};
      `,devtoolsPanelContainerResizing:i=>i()?n`
          transition: none;
        `:n`
        transition: all 0.4s ease;
      `,devtoolsPanelContainerAnimation:(i,m)=>i?n`
          pointer-events: auto;
          transform: translateY(0);
        `:n`
        pointer-events: none;
        transform: translateY(${m}px);
      `,logo:n`
      cursor: pointer;
      display: flex;
      flex-direction: column;
      background-color: transparent;
      border: none;
      font-family: ${d.sans};
      gap: ${P.size[.5]};
      padding: 0px;
      &:hover {
        opacity: 0.7;
      }
      &:focus-visible {
        outline-offset: 4px;
        border-radius: ${o.radius.xs};
        outline: 2px solid ${t.blue[800]};
      }
    `,tanstackLogo:n`
      font-size: ${l.size.md};
      font-weight: ${l.weight.bold};
      line-height: ${l.lineHeight.xs};
      white-space: nowrap;
      color: ${t.gray[300]};
    `,routerLogo:n`
      font-weight: ${l.weight.semibold};
      font-size: ${l.size.xs};
      background: linear-gradient(to right, #84cc16, #10b981);
      background-clip: text;
      -webkit-background-clip: text;
      line-height: 1;
      -webkit-text-fill-color: transparent;
      white-space: nowrap;
    `,devtoolsPanel:n`
      display: flex;
      font-size: ${p.sm};
      font-family: ${d.sans};
      background-color: ${t.darkGray[700]};
      color: ${t.gray[300]};

      @media (max-width: 700px) {
        flex-direction: column;
      }
      @media (max-width: 600px) {
        font-size: ${p.xs};
      }
    `,dragHandle:n`
      position: absolute;
      left: 0;
      top: 0;
      width: 100%;
      height: 4px;
      cursor: row-resize;
      z-index: 100000;
      &:hover {
        background-color: ${t.purple[400]}${g[90]};
      }
    `,firstContainer:n`
      flex: 1 1 500px;
      min-height: 40%;
      max-height: 100%;
      overflow: auto;
      border-right: 1px solid ${t.gray[700]};
      display: flex;
      flex-direction: column;
    `,routerExplorerContainer:n`
      overflow-y: auto;
      flex: 1;
    `,routerExplorer:n`
      padding: ${P.size[2]};
    `,row:n`
      display: flex;
      align-items: center;
      padding: ${P.size[2]} ${P.size[2.5]};
      gap: ${P.size[2.5]};
      border-bottom: ${t.darkGray[500]} 1px solid;
      align-items: center;
    `,detailsHeader:n`
      font-family: ui-sans-serif, Inter, system-ui, sans-serif, sans-serif;
      position: sticky;
      top: 0;
      z-index: 2;
      background-color: ${t.darkGray[600]};
      padding: 0px ${P.size[2]};
      font-weight: ${l.weight.medium};
      font-size: ${l.size.xs};
      min-height: ${P.size[8]};
      line-height: ${l.lineHeight.xs};
      text-align: left;
      display: flex;
      align-items: center;
    `,maskedBadge:n`
      background: ${t.yellow[900]}${g[70]};
      color: ${t.yellow[300]};
      display: inline-block;
      padding: ${P.size[0]} ${P.size[2.5]};
      border-radius: ${o.radius.full};
      font-size: ${l.size.xs};
      font-weight: ${l.weight.normal};
      border: 1px solid ${t.yellow[300]};
    `,maskedLocation:n`
      color: ${t.yellow[300]};
    `,detailsContent:n`
      padding: ${P.size[1.5]} ${P.size[2]};
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: ${l.size.xs};
    `,routeMatchesToggle:n`
      display: flex;
      align-items: center;
      border: 1px solid ${t.gray[500]};
      border-radius: ${o.radius.sm};
      overflow: hidden;
    `,routeMatchesToggleBtn:(i,m)=>{const v=[n`
        appearance: none;
        border: none;
        font-size: 12px;
        padding: 4px 8px;
        background: transparent;
        cursor: pointer;
        font-family: ${d.sans};
        font-weight: ${l.weight.medium};
      `];if(i){const D=n`
          background: ${t.darkGray[400]};
          color: ${t.gray[300]};
        `;v.push(D)}else{const D=n`
          color: ${t.gray[500]};
          background: ${t.darkGray[800]}${g[20]};
        `;v.push(D)}return m&&v.push(n`
          border-right: 1px solid ${P.colors.gray[500]};
        `),v},detailsHeaderInfo:n`
      flex: 1;
      justify-content: flex-end;
      display: flex;
      align-items: center;
      font-weight: ${l.weight.normal};
      color: ${t.gray[400]};
    `,matchRow:i=>{const m=[n`
        display: flex;
        border-bottom: 1px solid ${t.darkGray[400]};
        cursor: pointer;
        align-items: center;
        padding: ${r[1]} ${r[2]};
        gap: ${r[2]};
        font-size: ${p.xs};
        color: ${t.gray[300]};
      `];if(i){const v=n`
          background: ${t.darkGray[500]};
        `;m.push(v)}return m},matchIndicator:i=>{const m=[n`
        flex: 0 0 auto;
        width: ${r[3]};
        height: ${r[3]};
        background: ${t[i][900]};
        border: 1px solid ${t[i][500]};
        border-radius: ${o.radius.full};
        transition: all 0.25s ease-out;
        box-sizing: border-box;
      `];if(i==="gray"){const v=n`
          background: ${t.gray[700]};
          border-color: ${t.gray[400]};
        `;m.push(v)}return m},matchID:n`
      flex: 1;
      line-height: ${c.xs};
    `,ageTicker:i=>{const m=[n`
        display: flex;
        gap: ${r[1]};
        font-size: ${p.xs};
        color: ${t.gray[400]};
        font-variant-numeric: tabular-nums;
        line-height: ${c.xs};
      `];if(i){const v=n`
          color: ${t.yellow[400]};
        `;m.push(v)}return m},secondContainer:n`
      flex: 1 1 500px;
      min-height: 40%;
      max-height: 100%;
      overflow: auto;
      border-right: 1px solid ${t.gray[700]};
      display: flex;
      flex-direction: column;
    `,thirdContainer:n`
      flex: 1 1 500px;
      overflow: auto;
      display: flex;
      flex-direction: column;
      height: 100%;
      border-right: 1px solid ${t.gray[700]};

      @media (max-width: 700px) {
        border-top: 2px solid ${t.gray[700]};
      }
    `,fourthContainer:n`
      flex: 1 1 500px;
      min-height: 40%;
      max-height: 100%;
      overflow: auto;
      display: flex;
      flex-direction: column;
    `,routesContainer:n`
      overflow-x: auto;
      overflow-y: visible;
    `,routesRowContainer:(i,m)=>{const v=[n`
        display: flex;
        border-bottom: 1px solid ${t.darkGray[400]};
        align-items: center;
        padding: ${r[1]} ${r[2]};
        gap: ${r[2]};
        font-size: ${p.xs};
        color: ${t.gray[300]};
        cursor: ${m?"pointer":"default"};
        line-height: ${c.xs};
      `];if(i){const D=n`
          background: ${t.darkGray[500]};
        `;v.push(D)}return v},routesRow:i=>{const m=[n`
        flex: 1 0 auto;
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-size: ${p.xs};
        line-height: ${c.xs};
      `];if(!i){const v=n`
          color: ${t.gray[400]};
        `;m.push(v)}return m},routesRowInner:n`
      display: 'flex';
      align-items: 'center';
      flex-grow: 1;
      min-width: 0;
    `,routeParamInfo:n`
      color: ${t.gray[400]};
      font-size: ${p.xs};
      line-height: ${c.xs};
    `,nestedRouteRow:i=>n`
        margin-left: ${i?0:r[3.5]};
        border-left: ${i?"":`solid 1px ${t.gray[700]}`};
      `,code:n`
      font-size: ${p.xs};
      line-height: ${c.xs};
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    `,matchesContainer:n`
      flex: 1 1 auto;
      overflow-y: auto;
    `,cachedMatchesContainer:n`
      flex: 1 1 auto;
      overflow-y: auto;
      max-height: 50%;
    `,historyContainer:n`
      display: flex;
      flex: 1 1 auto;
      overflow-y: auto;
      max-height: 50%;
    `,historyOverflowContainer:n`
      padding: ${r[1]} ${r[2]};
      font-size: ${P.font.size.xs};
    `,maskedBadgeContainer:n`
      flex: 1;
      justify-content: flex-end;
      display: flex;
    `,matchDetails:n`
      display: flex;
      flex-direction: column;
      padding: ${P.size[2]};
      font-size: ${P.font.size.xs};
      color: ${P.colors.gray[300]};
      line-height: ${P.font.lineHeight.sm};
    `,matchStatus:(i,m)=>{const v=m&&i==="success"?m==="beforeLoad"?"purple":"blue":{pending:"yellow",success:"green",error:"red",notFound:"purple",redirected:"gray"}[i];return n`
        display: flex;
        justify-content: center;
        align-items: center;
        height: 40px;
        border-radius: ${P.border.radius.sm};
        font-weight: ${P.font.weight.normal};
        background-color: ${P.colors[v][900]}${P.alpha[90]};
        color: ${P.colors[v][300]};
        border: 1px solid ${P.colors[v][600]};
        margin-bottom: ${P.size[2]};
        transition: all 0.25s ease-out;
      `},matchDetailsInfo:n`
      display: flex;
      justify-content: flex-end;
      flex: 1;
    `,matchDetailsInfoLabel:n`
      display: flex;
    `,mainCloseBtn:n`
      background: ${t.darkGray[700]};
      padding: ${r[1]} ${r[2]} ${r[1]} ${r[1.5]};
      border-radius: ${o.radius.md};
      position: fixed;
      z-index: 99999;
      display: inline-flex;
      width: fit-content;
      cursor: pointer;
      appearance: none;
      border: 0;
      gap: 8px;
      align-items: center;
      border: 1px solid ${t.gray[500]};
      font-size: ${l.size.xs};
      cursor: pointer;
      transition: all 0.25s ease-out;

      &:hover {
        background: ${t.darkGray[500]};
      }
    `,mainCloseBtnPosition:i=>n`
        ${i==="top-left"?`top: ${r[2]}; left: ${r[2]};`:""}
        ${i==="top-right"?`top: ${r[2]}; right: ${r[2]};`:""}
        ${i==="bottom-left"?`bottom: ${r[2]}; left: ${r[2]};`:""}
        ${i==="bottom-right"?`bottom: ${r[2]}; right: ${r[2]};`:""}
      `,mainCloseBtnAnimation:i=>i?n`
        opacity: 0;
        pointer-events: none;
        visibility: hidden;
      `:n`
          opacity: 1;
          pointer-events: auto;
          visibility: visible;
        `,routerLogoCloseButton:n`
      font-weight: ${l.weight.semibold};
      font-size: ${l.size.xs};
      background: linear-gradient(to right, #98f30c, #00f4a3);
      background-clip: text;
      -webkit-background-clip: text;
      line-height: 1;
      -webkit-text-fill-color: transparent;
      white-space: nowrap;
    `,mainCloseBtnDivider:n`
      width: 1px;
      background: ${P.colors.gray[600]};
      height: 100%;
      border-radius: 999999px;
      color: transparent;
    `,mainCloseBtnIconContainer:n`
      position: relative;
      width: ${r[5]};
      height: ${r[5]};
      background: pink;
      border-radius: 999999px;
      overflow: hidden;
    `,mainCloseBtnIconOuter:n`
      width: ${r[5]};
      height: ${r[5]};
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      filter: blur(3px) saturate(1.8) contrast(2);
    `,mainCloseBtnIconInner:n`
      width: ${r[4]};
      height: ${r[4]};
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
    `,panelCloseBtn:n`
      position: absolute;
      cursor: pointer;
      z-index: 100001;
      display: flex;
      align-items: center;
      justify-content: center;
      outline: none;
      background-color: ${t.darkGray[700]};
      &:hover {
        background-color: ${t.darkGray[500]};
      }

      top: 0;
      right: ${r[2]};
      transform: translate(0, -100%);
      border-right: ${t.darkGray[300]} 1px solid;
      border-left: ${t.darkGray[300]} 1px solid;
      border-top: ${t.darkGray[300]} 1px solid;
      border-bottom: none;
      border-radius: ${o.radius.sm} ${o.radius.sm} 0px 0px;
      padding: ${r[1]} ${r[1.5]} ${r[.5]} ${r[1.5]};

      &::after {
        content: ' ';
        position: absolute;
        top: 100%;
        left: -${r[2.5]};
        height: ${r[1.5]};
        width: calc(100% + ${r[5]});
      }
    `,panelCloseBtnIcon:n`
      color: ${t.gray[400]};
      width: ${r[2]};
      height: ${r[2]};
    `,navigateButton:n`
      background: none;
      border: none;
      padding: 0 0 0 4px;
      margin: 0;
      color: ${t.gray[400]};
      font-size: ${p.md};
      cursor: pointer;
      line-height: 1;
      vertical-align: middle;
      margin-right: 0.5ch;
      flex-shrink: 0;
      &:hover {
        color: ${t.blue[300]};
      }
    `}};function Be(){const[e]=ne(Lt(mt(xt)));return e}var Rt=e=>{try{const t=localStorage.getItem(e);return typeof t=="string"?JSON.parse(t):void 0}catch{return}};function Qe(e,t){const[l,r]=ne();return Ce(()=>{const o=Rt(e);r(typeof o>"u"||o===null?typeof t=="function"?t():t:o)}),[l,o=>{r(d=>{let c=o;typeof o=="function"&&(c=o(d));try{localStorage.setItem(e,JSON.stringify(c))}catch{}return c})}]}var jt=typeof window>"u";function rt(e){return e.isFetching&&e.status==="success"?e.isFetching==="beforeLoad"?"purple":"blue":{pending:"yellow",success:"green",error:"red",notFound:"purple",redirected:"gray"}[e.status]}function Ht(e,t){const l=e.find(r=>r.routeId===t.id);return l?rt(l):"gray"}function Nt(){const[e,t]=ne(!1);return(jt?Ce:w)(()=>{t(!0)}),e}var Vt=e=>{const t=Object.getOwnPropertyNames(Object(e)),l=typeof e=="bigint"?`${e.toString()}n`:e;try{return JSON.stringify(l,t)}catch{return"unable to stringify"}};function Jt(e,t=[l=>l]){return e.map((l,r)=>[l,r]).sort(([l,r],[g,o])=>{for(const d of t){const c=d(l),p=d(g);if(typeof c>"u"){if(typeof p>"u")continue;return 1}if(c!==p)return c>p?1:-1}return r-o}).map(([l])=>l)}var Yt=G('<span><svg xmlns=http://www.w3.org/2000/svg width=12 height=12 fill=none viewBox="0 0 24 24"><path stroke=currentColor stroke-linecap=round stroke-linejoin=round stroke-width=2 d="M9 18l6-6-6-6">'),Ye=G("<div>"),qt=G("<button><span> "),Kt=G("<div><div><button> [<!> ... <!>]"),Wt=G("<button><span></span> 🔄 "),Zt=G("<span>:"),Qt=G("<span>"),pt=({expanded:e,style:t={}})=>{const l=yt();return(()=>{var r=Yt(),g=r.firstChild;return w(o=>{var d=l().expander,c=V(l().expanderIcon(e));return d!==o.e&&a(r,o.e=d),c!==o.t&&s(g,"class",o.t=c),o},{e:void 0,t:void 0}),r})()};function Xt(e,t){if(t<1)return[];let l=0;const r=[];for(;l<e.length;)r.push(e.slice(l,l+t)),l=l+t;return r}function er(e){return Symbol.iterator in e}function Me({value:e,defaultExpanded:t,pageSize:l=100,filterSubEntries:r,...g}){const[o,d]=ne(!!t),c=()=>d(L=>!L),p=W(()=>typeof e()),n=W(()=>{let L=[];const se=x=>{const y=t===!0?{[x.label]:!0}:t==null?void 0:t[x.label];return{...x,value:()=>x.value,defaultExpanded:y}};return Array.isArray(e())?L=e().map((x,y)=>se({label:y.toString(),value:x})):e()!==null&&typeof e()=="object"&&er(e())&&typeof e()[Symbol.iterator]=="function"?L=Array.from(e(),(x,y)=>se({label:y.toString(),value:x})):typeof e()=="object"&&e()!==null&&(L=Object.entries(e()).map(([x,y])=>se({label:x,value:y}))),r?r(L):L}),i=W(()=>Xt(n(),l)),[m,v]=ne([]),[D,R]=ne(void 0),b=yt(),B=()=>{R(e()())},Z=L=>_(Me,Ve({value:e,filterSubEntries:r},g,L));return(()=>{var L=Ye();return u(L,(()=>{var se=X(()=>!!i().length);return()=>se()?[(()=>{var x=qt(),y=x.firstChild,j=y.firstChild;return x.$$click=()=>c(),u(x,_(pt,{get expanded(){return o()??!1}}),y),u(x,()=>g.label,y),u(y,()=>String(p).toLowerCase()==="iterable"?"(Iterable) ":"",j),u(y,()=>n().length,j),u(y,()=>n().length>1?"items":"item",null),w(J=>{var T=b().expandButton,oe=b().info;return T!==J.e&&a(x,J.e=T),oe!==J.t&&a(y,J.t=oe),J},{e:void 0,t:void 0}),x})(),X(()=>X(()=>!!(o()??!1))()?X(()=>i().length===1)()?(()=>{var x=Ye();return u(x,()=>n().map((y,j)=>Z(y))),w(()=>a(x,b().subEntries)),x})():(()=>{var x=Ye();return u(x,()=>i().map((y,j)=>(()=>{var J=Kt(),T=J.firstChild,oe=T.firstChild,de=oe.firstChild,Se=de.nextSibling,ce=Se.nextSibling.nextSibling;return ce.nextSibling,oe.$$click=()=>v(q=>q.includes(j)?q.filter(le=>le!==j):[...q,j]),u(oe,_(pt,{get expanded(){return m().includes(j)}}),de),u(oe,j*l,Se),u(oe,j*l+l-1,ce),u(T,(()=>{var q=X(()=>!!m().includes(j));return()=>q()?(()=>{var le=Ye();return u(le,()=>y.map(C=>Z(C))),w(()=>a(le,b().subEntries)),le})():null})(),null),w(q=>{var le=b().entry,C=V(b().labelButton,"labelButton");return le!==q.e&&a(T,q.e=le),C!==q.t&&a(oe,q.t=C),q},{e:void 0,t:void 0}),J})())),w(()=>a(x,b().subEntries)),x})():null)]:X(()=>p()==="function")()?_(Me,{get label(){return(()=>{var x=Wt(),y=x.firstChild;return x.$$click=B,u(y,()=>g.label),w(()=>a(x,b().refreshValueBtn)),x})()},value:D,defaultExpanded:{}}):[(()=>{var x=Zt(),y=x.firstChild;return u(x,()=>g.label,y),x})()," ",(()=>{var x=Qt();return u(x,()=>Vt(e())),w(()=>a(x,b().value)),x})()]})()),w(()=>a(L,b().entry)),L})()}var tr=e=>{const{colors:t,font:l,size:r}=P,{fontFamily:g,lineHeight:o,size:d}=l,c=e?Ue.bind({target:e}):Ue;return{entry:c`
      font-family: ${g.mono};
      font-size: ${d.xs};
      line-height: ${o.sm};
      outline: none;
      word-break: break-word;
    `,labelButton:c`
      cursor: pointer;
      color: inherit;
      font: inherit;
      outline: inherit;
      background: transparent;
      border: none;
      padding: 0;
    `,expander:c`
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: ${r[3]};
      height: ${r[3]};
      padding-left: 3px;
      box-sizing: content-box;
    `,expanderIcon:p=>p?c`
          transform: rotate(90deg);
          transition: transform 0.1s ease;
        `:c`
        transform: rotate(0deg);
        transition: transform 0.1s ease;
      `,expandButton:c`
      display: flex;
      gap: ${r[1]};
      align-items: center;
      cursor: pointer;
      color: inherit;
      font: inherit;
      outline: inherit;
      background: transparent;
      border: none;
      padding: 0;
    `,value:c`
      color: ${t.purple[400]};
    `,subEntries:c`
      margin-left: ${r[2]};
      padding-left: ${r[2]};
      border-left: 2px solid ${t.darkGray[400]};
    `,info:c`
      color: ${t.gray[500]};
      font-size: ${d["2xs"]};
      padding-left: ${r[1]};
    `,refreshValueBtn:c`
      appearance: none;
      border: 0;
      cursor: pointer;
      background: transparent;
      color: inherit;
      padding: 0;
      font-family: ${g.mono};
      font-size: ${d.xs};
    `}};function yt(){const[e]=ne(tr(mt(xt)));return e}nt(["click"]);var rr=G("<div><div></div><div>/</div><div></div><div>/</div><div>");function et(e){const t=["s","min","h","d"],l=[e/1e3,e/6e4,e/36e5,e/864e5];let r=0;for(let g=1;g<l.length&&!(l[g]<1);g++)r=g;return new Intl.NumberFormat(navigator.language,{compactDisplay:"short",notation:"compact",maximumFractionDigits:0}).format(l[r])+t[r]}function qe({match:e,router:t}){const l=Be();if(!e)return null;const r=t().looseRoutesById[e.routeId];if(!r.options.loader)return null;const g=Date.now()-e.updatedAt,o=r.options.staleTime??t().options.defaultStaleTime??0,d=r.options.gcTime??t().options.defaultGcTime??1800*1e3;return(()=>{var c=rr(),p=c.firstChild,n=p.nextSibling.nextSibling,i=n.nextSibling.nextSibling;return u(p,()=>et(g)),u(n,()=>et(o)),u(i,()=>et(d)),w(()=>a(c,V(l().ageTicker(g>o)))),c})()}var ir=G("<button type=button>➔");function Ke({to:e,params:t,search:l,router:r}){const g=Be();return(()=>{var o=ir();return o.$$click=d=>{d.stopPropagation(),r().navigate({to:e,params:t,search:l})},s(o,"title",`Navigate to ${e}`),w(()=>a(o,g().navigateButton)),o})()}nt(["click"]);var nr=G("<button><div>TANSTACK</div><div>TanStack Router v1"),or=G("<div style=display:flex;align-items:center;width:100%><div style=flex-grow:1;min-width:0>"),lr=G("<code> "),Ne=G("<code>"),sr=G("<div><div role=button><div>"),We=G("<div>"),ar=G("<div><ul>"),dr=G('<div><button><svg xmlns=http://www.w3.org/2000/svg width=10 height=6 fill=none viewBox="0 0 10 6"><path stroke=currentColor stroke-linecap=round stroke-linejoin=round stroke-width=1.667 d="M1 1l4 4 4-4"></path></svg></button><div><div></div><div><div></div></div></div><div><div><div><span>Pathname</span></div><div><code></code></div><div><div><button type=button>Routes</button><button type=button>Matches</button><button type=button>History</button></div><div><div>age / staleTime / gcTime</div></div></div><div>'),cr=G("<div><span>masked"),ht=G("<div role=button><div>"),fr=G("<li><div>"),ur=G("<li>This panel displays the most recent 15 navigations."),gr=G("<div><div><div>Cached Matches</div><div>age / staleTime / gcTime</div></div><div>"),pr=G("<div><div>Match Details</div><div><div><div><div></div></div><div><div>ID:</div><div><code></code></div></div><div><div>State:</div><div></div></div><div><div>Last Updated:</div><div></div></div></div></div><div>Explorer</div><div>"),hr=G("<div>Loader Data"),vr=G("<div><div><span>Search Params</span></div><div>"),$r=G("<span style=margin-left:0.5rem>"),mr=G('<button type=button aria-label="Copy value to clipboard"style=cursor:pointer>'),vt=15;function xr(e){const{className:t,...l}=e,r=Be();return(()=>{var g=nr(),o=g.firstChild,d=o.nextSibling;return it(g,Ve(l,{get class(){return V(r().logo,t?t():"")}}),!1,!0),w(c=>{var p=r().tanstackLogo,n=r().routerLogo;return p!==c.e&&a(o,c.e=p),n!==c.t&&a(d,c.t=n),c},{e:void 0,t:void 0}),g})()}function Ze(e){return(()=>{var t=or(),l=t.firstChild;return u(t,()=>e.left,l),u(l,()=>e.children),u(t,()=>e.right,null),w(()=>a(t,e.class)),t})()}function kt({routerState:e,pendingMatches:t,router:l,route:r,isRoot:g,activeId:o,setActiveId:d}){const c=Be(),p=W(()=>t().length?t():e().matches),n=W(()=>e().matches.find(v=>v.routeId===r.id)),i=W(()=>{var v,D;try{if((v=n())!=null&&v.params){const R=(D=n())==null?void 0:D.params,b=r.path||ut(r.id);if(b.startsWith("$")){const B=b.slice(1);if(R[B])return`(${R[B]})`}}return""}catch{return""}}),m=W(()=>{if(g||!r.path)return;const v=Object.assign({},...p().map(R=>R.params)),D=Dt({path:r.fullPath,params:v,decoder:l().pathParamsDecoder});return D.isMissingParams?void 0:D.interpolatedPath});return(()=>{var v=sr(),D=v.firstChild,R=D.firstChild;return D.$$click=()=>{n()&&d(o()===r.id?"":r.id)},u(D,_(Ze,{get class(){return V(c().routesRow(!!n()))},get left(){return _(Mt,{get when(){return m()},children:b=>_(Ke,{get to(){return b()},router:l})})},get right(){return _(qe,{get match(){return n()},router:l})},get children(){return[(()=>{var b=lr(),B=b.firstChild;return u(b,()=>g?He:r.path||ut(r.id),B),w(()=>a(b,c().code)),b})(),(()=>{var b=Ne();return u(b,i),w(()=>a(b,c().routeParamInfo)),b})()]}}),null),u(v,(()=>{var b=X(()=>{var B;return!!((B=r.children)!=null&&B.length)});return()=>b()?(()=>{var B=We();return u(B,()=>[...r.children].sort((Z,L)=>Z.rank-L.rank).map(Z=>_(kt,{routerState:e,pendingMatches:t,router:l,route:Z,activeId:o,setActiveId:d}))),w(()=>a(B,c().nestedRouteRow(!!g))),B})():null})(),null),w(b=>{var B=`Open match details for ${r.id}`,Z=V(c().routesRowContainer(r.id===o(),!!n())),L=V(c().matchIndicator(Ht(p(),r)));return B!==b.e&&s(D,"aria-label",b.e=B),Z!==b.t&&a(D,b.t=Z),L!==b.a&&a(R,b.a=L),b},{e:void 0,t:void 0,a:void 0}),v})()}var br=function({...t}){const{isOpen:l=!0,setIsOpen:r,handleDragStart:g,router:o,routerState:d,shadowDOMTarget:c,...p}=t,{onCloseClick:n}=St(),i=Be(),{className:m,style:v,...D}=p,[R,b]=Qe("tanstackRouterDevtoolsActiveTab","routes"),[B,Z]=Qe("tanstackRouterDevtoolsActiveRouteId",""),[L,se]=ne([]),[x,y]=ne(!1);let j,J;if("subscribe"in o().stores.pendingMatchesSnapshot){const[C,Y]=ne([]);j=C;const[fe,ee]=ne([]);J=fe,Ce(()=>{const S=o().stores.pendingMatchesSnapshot;Y(S.state);const A=S.subscribe(()=>{Y(S.state)});tt(()=>A.unsubscribe())}),Ce(()=>{const S=o().stores.cachedMatchesSnapshot;ee(S.state);const A=S.subscribe(()=>{ee(S.state)});tt(()=>A.unsubscribe())})}else j=()=>o().stores.pendingMatchesSnapshot.state,J=()=>o().stores.cachedMatchesSnapshot.state;Ce(()=>{const C=d().matches,Y=C[C.length-1];if(!Y)return;const fe=wt(()=>L()),ee=fe[0],S=ee&&ee.pathname===Y.pathname&&JSON.stringify(ee.search??{})===JSON.stringify(Y.search??{});(!ee||!S)&&(fe.length>=vt&&y(!0),se(A=>{const Q=[Y,...A];return Q.splice(vt),Q}))});const T=W(()=>[...j(),...d().matches,...J()].find(C=>C.routeId===B()||C.id===B())),oe=W(()=>Object.keys(d().location.search).length),de=W(()=>({...o(),state:d()})),Se=W(()=>Object.fromEntries(Jt(Object.keys(de()),["state","routesById","routesByPath","options","manifest"].map(C=>Y=>Y!==C)).map(C=>[C,de()[C]]).filter(C=>typeof C[1]!="function"&&!["stores","basepath","injectedHtml","subscribers","latestLoadPromise","navigateTimeout","resetNextScroll","tempLocationKey","latestLocation","routeTree","history"].includes(C[0])))),ce=W(()=>{var C;return(C=T())==null?void 0:C.loaderData}),q=W(()=>T()),le=W(()=>d().location.search);return(()=>{var C=dr(),Y=C.firstChild,fe=Y.firstChild,ee=Y.nextSibling,S=ee.firstChild,A=S.nextSibling,Q=A.firstChild,N=ee.nextSibling,te=N.firstChild,re=te.firstChild;re.firstChild;var E=re.nextSibling,ie=E.firstChild,ge=E.nextSibling,ye=ge.firstChild,ue=ye.firstChild,pe=ue.nextSibling,ze=pe.nextSibling,Je=ye.nextSibling,Oe=ge.nextSibling;return it(C,Ve({get class(){return V(i().devtoolsPanel,"TanStackRouterDevtoolsPanel",m?m():"")},get style(){return v?v():""}},D),!1,!0),u(C,g?(()=>{var f=We();return _t(f,"mousedown",g,!0),w(()=>a(f,i().dragHandle)),f})():null,Y),Y.$$click=f=>{r&&r(!1),n(f)},u(S,_(xr,{"aria-hidden":!0,onClick:f=>{r&&r(!1),n(f)}})),u(Q,_(Me,{label:"Router",value:Se,defaultExpanded:{state:{},context:{},options:{}},filterSubEntries:f=>f.filter($=>typeof $.value()!="function")})),u(re,(()=>{var f=X(()=>!!d().location.maskedLocation);return()=>f()?(()=>{var $=cr(),z=$.firstChild;return w(U=>{var F=i().maskedBadgeContainer,h=i().maskedBadge;return F!==U.e&&a($,U.e=F),h!==U.t&&a(z,U.t=h),U},{e:void 0,t:void 0}),$})():null})(),null),u(ie,()=>d().location.pathname),u(E,(()=>{var f=X(()=>!!d().location.maskedLocation);return()=>f()?(()=>{var $=Ne();return u($,()=>{var z;return(z=d().location.maskedLocation)==null?void 0:z.pathname}),w(()=>a($,i().maskedLocation)),$})():null})(),null),ue.$$click=()=>{b("routes")},pe.$$click=()=>{b("matches")},ze.$$click=()=>{b("history")},u(Oe,_(zt,{get children(){return[_(Xe,{get when(){return R()==="routes"},get children(){return _(kt,{routerState:d,pendingMatches:j,router:o,get route(){return o().routeTree},isRoot:!0,activeId:B,setActiveId:Z})}}),_(Xe,{get when(){return R()==="matches"},get children(){var f=We();return u(f,()=>(j().length?j():d().matches).map(($,z)=>(()=>{var U=ht(),F=U.firstChild;return U.$$click=()=>Z(B()===$.id?"":$.id),u(U,_(Ze,{get left(){return _(Ke,{get to(){return $.pathname},get params(){return $.params},get search(){return $.search},router:o})},get right(){return _(qe,{match:$,router:o})},get children(){var h=Ne();return u(h,()=>`${$.routeId===He?He:$.pathname}`),w(()=>a(h,i().matchID)),h}}),null),w(h=>{var M=`Open match details for ${$.id}`,H=V(i().matchRow($===T())),I=V(i().matchIndicator(rt($)));return M!==h.e&&s(U,"aria-label",h.e=M),H!==h.t&&a(U,h.t=H),I!==h.a&&a(F,h.a=I),h},{e:void 0,t:void 0,a:void 0}),U})())),f}}),_(Xe,{get when(){return R()==="history"},get children(){var f=ar(),$=f.firstChild;return u($,_(Ft,{get each(){return L()},children:(z,U)=>(()=>{var F=fr(),h=F.firstChild;return u(F,_(Ze,{get left(){return _(Ke,{get to(){return z.pathname},get params(){return z.params},get search(){return z.search},router:o})},get right(){return _(qe,{match:z,router:o})},get children(){var M=Ne();return u(M,()=>`${z.routeId===He?He:z.pathname}`),w(()=>a(M,i().matchID)),M}}),null),w(M=>{var H=V(i().matchRow(z===T())),I=V(i().matchIndicator(U()===0?"green":"gray"));return H!==M.e&&a(F,M.e=H),I!==M.t&&a(h,M.t=I),M},{e:void 0,t:void 0}),F})()}),null),u($,(()=>{var z=X(()=>!!x());return()=>z()?(()=>{var U=ur();return w(()=>a(U,i().historyOverflowContainer)),U})():null})(),null),f}})]}})),u(N,(()=>{var f=X(()=>!!J().length);return()=>f()?(()=>{var $=gr(),z=$.firstChild,U=z.firstChild.nextSibling,F=z.nextSibling;return u(F,()=>J().map(h=>(()=>{var M=ht(),H=M.firstChild;return M.$$click=()=>Z(B()===h.id?"":h.id),u(M,_(Ze,{get left(){return _(Ke,{get to(){return h.pathname},get params(){return h.params},get search(){return h.search},router:o})},get right(){return _(qe,{match:h,router:o})},get children(){var I=Ne();return u(I,()=>`${h.id}`),w(()=>a(I,i().matchID)),I}}),null),w(I=>{var ve=`Open match details for ${h.id}`,ae=V(i().matchRow(h===T())),he=V(i().matchIndicator(rt(h)));return ve!==I.e&&s(M,"aria-label",I.e=ve),ae!==I.t&&a(M,I.t=ae),he!==I.a&&a(H,I.a=he),I},{e:void 0,t:void 0,a:void 0}),M})())),w(h=>{var M=i().cachedMatchesContainer,H=i().detailsHeader,I=i().detailsHeaderInfo;return M!==h.e&&a($,h.e=M),H!==h.t&&a(z,h.t=H),I!==h.a&&a(U,h.a=I),h},{e:void 0,t:void 0,a:void 0}),$})():null})(),null),u(C,(()=>{var f=X(()=>{var $;return!!(T()&&(($=T())!=null&&$.status))});return()=>f()?(()=>{var $=pr(),z=$.firstChild,U=z.nextSibling,F=U.firstChild,h=F.firstChild,M=h.firstChild,H=h.nextSibling,I=H.firstChild.nextSibling,ve=I.firstChild,ae=H.nextSibling,he=ae.firstChild.nextSibling,$e=ae.nextSibling,we=$e.firstChild.nextSibling,me=U.nextSibling,xe=me.nextSibling;return u(M,(()=>{var k=X(()=>{var O,K;return!!(((O=T())==null?void 0:O.status)==="success"&&((K=T())!=null&&K.isFetching))});return()=>{var O;return k()?"fetching":(O=T())==null?void 0:O.status}})()),u(ve,()=>{var k;return(k=T())==null?void 0:k.id}),u(he,(()=>{var k=X(()=>!!j().find(O=>{var K;return O.id===((K=T())==null?void 0:K.id)}));return()=>k()?"Pending":d().matches.find(O=>{var K;return O.id===((K=T())==null?void 0:K.id)})?"Active":"Cached"})()),u(we,(()=>{var k=X(()=>{var O;return!!((O=T())!=null&&O.updatedAt)});return()=>{var O;return k()?new Date((O=T())==null?void 0:O.updatedAt).toLocaleTimeString():"N/A"}})()),u($,(()=>{var k=X(()=>!!ce());return()=>k()?[(()=>{var O=hr();return w(()=>a(O,i().detailsHeader)),O})(),(()=>{var O=We();return u(O,_(Me,{label:"loaderData",value:ce,defaultExpanded:{}})),w(()=>a(O,i().detailsContent)),O})()]:null})(),me),u(xe,_(Me,{label:"Match",value:q,defaultExpanded:{}})),w(k=>{var Re,je;var O=i().thirdContainer,K=i().detailsHeader,_e=i().matchDetails,ke=i().matchStatus((Re=T())==null?void 0:Re.status,(je=T())==null?void 0:je.isFetching),De=i().matchDetailsInfoLabel,Te=i().matchDetailsInfo,Ee=i().matchDetailsInfoLabel,Ie=i().matchDetailsInfo,Ge=i().matchDetailsInfoLabel,Ae=i().matchDetailsInfo,Pe=i().detailsHeader,Le=i().detailsContent;return O!==k.e&&a($,k.e=O),K!==k.t&&a(z,k.t=K),_e!==k.a&&a(F,k.a=_e),ke!==k.o&&a(h,k.o=ke),De!==k.i&&a(H,k.i=De),Te!==k.n&&a(I,k.n=Te),Ee!==k.s&&a(ae,k.s=Ee),Ie!==k.h&&a(he,k.h=Ie),Ge!==k.r&&a($e,k.r=Ge),Ae!==k.d&&a(we,k.d=Ae),Pe!==k.l&&a(me,k.l=Pe),Le!==k.u&&a(xe,k.u=Le),k},{e:void 0,t:void 0,a:void 0,o:void 0,i:void 0,n:void 0,s:void 0,h:void 0,r:void 0,d:void 0,l:void 0,u:void 0}),$})():null})(),null),u(C,(()=>{var f=X(()=>!!oe());return()=>f()?(()=>{var $=vr(),z=$.firstChild;z.firstChild;var U=z.nextSibling;return u(z,typeof navigator<"u"?(()=>{var F=$r();return u(F,_(yr,{getValue:()=>{const h=d().location.search;return JSON.stringify(h)}})),F})():null,null),u(U,_(Me,{value:le,get defaultExpanded(){return Object.keys(d().location.search).reduce((F,h)=>(F[h]={},F),{})}})),w(F=>{var h=i().fourthContainer,M=i().detailsHeader,H=i().detailsContent;return h!==F.e&&a($,F.e=h),M!==F.t&&a(z,F.t=M),H!==F.a&&a(U,F.a=H),F},{e:void 0,t:void 0,a:void 0}),$})():null})(),null),w(f=>{var $=i().panelCloseBtn,z=i().panelCloseBtnIcon,U=i().firstContainer,F=i().row,h=i().routerExplorerContainer,M=i().routerExplorer,H=i().secondContainer,I=i().matchesContainer,ve=i().detailsHeader,ae=i().detailsContent,he=i().detailsHeader,$e=i().routeMatchesToggle,we=R()==="routes",me=V(i().routeMatchesToggleBtn(R()==="routes",!0)),xe=R()==="matches",k=V(i().routeMatchesToggleBtn(R()==="matches",!0)),O=R()==="history",K=V(i().routeMatchesToggleBtn(R()==="history",!1)),_e=i().detailsHeaderInfo,ke=V(i().routesContainer);return $!==f.e&&a(Y,f.e=$),z!==f.t&&s(fe,"class",f.t=z),U!==f.a&&a(ee,f.a=U),F!==f.o&&a(S,f.o=F),h!==f.i&&a(A,f.i=h),M!==f.n&&a(Q,f.n=M),H!==f.s&&a(N,f.s=H),I!==f.h&&a(te,f.h=I),ve!==f.r&&a(re,f.r=ve),ae!==f.d&&a(E,f.d=ae),he!==f.l&&a(ge,f.l=he),$e!==f.u&&a(ye,f.u=$e),we!==f.c&&(ue.disabled=f.c=we),me!==f.w&&a(ue,f.w=me),xe!==f.m&&(pe.disabled=f.m=xe),k!==f.f&&a(pe,f.f=k),O!==f.y&&(ze.disabled=f.y=O),K!==f.g&&a(ze,f.g=K),_e!==f.p&&a(Je,f.p=_e),ke!==f.b&&a(Oe,f.b=ke),f},{e:void 0,t:void 0,a:void 0,o:void 0,i:void 0,n:void 0,s:void 0,h:void 0,r:void 0,d:void 0,l:void 0,u:void 0,c:void 0,w:void 0,m:void 0,f:void 0,y:void 0,g:void 0,p:void 0,b:void 0}),C})()};function yr({getValue:e}){const[t,l]=ne(!1);let r=null;const g=async()=>{var o;if(typeof navigator>"u"||!((o=navigator.clipboard)!=null&&o.writeText)){console.warn("TanStack Router Devtools: Clipboard API unavailable");return}try{const d=e();await navigator.clipboard.writeText(d),l(!0),r&&clearTimeout(r),r=setTimeout(()=>l(!1),2500)}catch(d){console.error("TanStack Router Devtools: Failed to copy",d)}};return tt(()=>{r&&clearTimeout(r)}),(()=>{var o=mr();return o.$$click=g,u(o,()=>t()?"✅":"📋"),w(()=>s(o,"title",t()?"Copied!":"Copy")),o})()}nt(["click","mousedown"]);var kr=G('<svg xmlns=http://www.w3.org/2000/svg enable-background="new 0 0 634 633"viewBox="0 0 634 633"><g transform=translate(1)><linearGradient x1=-641.486 x2=-641.486 y1=856.648 y2=855.931 gradientTransform="matrix(633 0 0 -633 406377 542258)"gradientUnits=userSpaceOnUse><stop offset=0 stop-color=#6bdaff></stop><stop offset=0.319 stop-color=#f9ffb5></stop><stop offset=0.706 stop-color=#ffa770></stop><stop offset=1 stop-color=#ff7373></stop></linearGradient><circle cx=316.5 cy=316.5 r=316.5 fill-rule=evenodd clip-rule=evenodd></circle><defs><filter width=454 height=396.9 x=-137.5 y=412 filterUnits=userSpaceOnUse><feColorMatrix values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 1 0"></feColorMatrix></filter></defs><mask width=454 height=396.9 x=-137.5 y=412 maskUnits=userSpaceOnUse><g><circle cx=316.5 cy=316.5 r=316.5 fill=#FFF fill-rule=evenodd clip-rule=evenodd></circle></g></mask><ellipse cx=89.5 cy=610.5 fill=#015064 fill-rule=evenodd stroke=#00CFE2 stroke-width=25 clip-rule=evenodd rx=214.5 ry=186></ellipse><defs><filter width=454 height=396.9 x=316.5 y=412 filterUnits=userSpaceOnUse><feColorMatrix values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 1 0"></feColorMatrix></filter></defs><mask width=454 height=396.9 x=316.5 y=412 maskUnits=userSpaceOnUse><g><circle cx=316.5 cy=316.5 r=316.5 fill=#FFF fill-rule=evenodd clip-rule=evenodd></circle></g></mask><ellipse cx=543.5 cy=610.5 fill=#015064 fill-rule=evenodd stroke=#00CFE2 stroke-width=25 clip-rule=evenodd rx=214.5 ry=186></ellipse><defs><filter width=454 height=396.9 x=-137.5 y=450 filterUnits=userSpaceOnUse><feColorMatrix values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 1 0"></feColorMatrix></filter></defs><mask width=454 height=396.9 x=-137.5 y=450 maskUnits=userSpaceOnUse><g><circle cx=316.5 cy=316.5 r=316.5 fill=#FFF fill-rule=evenodd clip-rule=evenodd></circle></g></mask><ellipse cx=89.5 cy=648.5 fill=#015064 fill-rule=evenodd stroke=#00A8B8 stroke-width=25 clip-rule=evenodd rx=214.5 ry=186></ellipse><defs><filter width=454 height=396.9 x=316.5 y=450 filterUnits=userSpaceOnUse><feColorMatrix values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 1 0"></feColorMatrix></filter></defs><mask width=454 height=396.9 x=316.5 y=450 maskUnits=userSpaceOnUse><g><circle cx=316.5 cy=316.5 r=316.5 fill=#FFF fill-rule=evenodd clip-rule=evenodd></circle></g></mask><ellipse cx=543.5 cy=648.5 fill=#015064 fill-rule=evenodd stroke=#00A8B8 stroke-width=25 clip-rule=evenodd rx=214.5 ry=186></ellipse><defs><filter width=454 height=396.9 x=-137.5 y=486 filterUnits=userSpaceOnUse><feColorMatrix values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 1 0"></feColorMatrix></filter></defs><mask width=454 height=396.9 x=-137.5 y=486 maskUnits=userSpaceOnUse><g><circle cx=316.5 cy=316.5 r=316.5 fill=#FFF fill-rule=evenodd clip-rule=evenodd></circle></g></mask><ellipse cx=89.5 cy=684.5 fill=#015064 fill-rule=evenodd stroke=#007782 stroke-width=25 clip-rule=evenodd rx=214.5 ry=186></ellipse><defs><filter width=454 height=396.9 x=316.5 y=486 filterUnits=userSpaceOnUse><feColorMatrix values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 1 0"></feColorMatrix></filter></defs><mask width=454 height=396.9 x=316.5 y=486 maskUnits=userSpaceOnUse><g><circle cx=316.5 cy=316.5 r=316.5 fill=#FFF fill-rule=evenodd clip-rule=evenodd></circle></g></mask><ellipse cx=543.5 cy=684.5 fill=#015064 fill-rule=evenodd stroke=#007782 stroke-width=25 clip-rule=evenodd rx=214.5 ry=186></ellipse><defs><filter width=176.9 height=129.3 x=272.2 y=308 filterUnits=userSpaceOnUse><feColorMatrix values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 1 0"></feColorMatrix></filter></defs><mask width=176.9 height=129.3 x=272.2 y=308 maskUnits=userSpaceOnUse><g><circle cx=316.5 cy=316.5 r=316.5 fill=#FFF fill-rule=evenodd clip-rule=evenodd></circle></g></mask><g><path fill=none stroke=#000 stroke-linecap=round stroke-linejoin=bevel stroke-width=11 d="M436 403.2l-5 28.6m-140-90.3l-10.9 62m52.8-19.4l-4.3 27.1"></path><linearGradient x1=-645.656 x2=-646.499 y1=854.878 y2=854.788 gradientTransform="matrix(-184.159 -32.4722 11.4608 -64.9973 -128419.844 34938.836)"gradientUnits=userSpaceOnUse><stop offset=0 stop-color=#ee2700></stop><stop offset=1 stop-color=#ff008e></stop></linearGradient><path fill-rule=evenodd d="M344.1 363l97.7 17.2c5.8 2.1 8.2 6.2 7.1 12.1-1 5.9-4.7 9.2-11 9.9l-106-18.7-57.5-59.2c-3.2-4.8-2.9-9.1.8-12.8 3.7-3.7 8.3-4.4 13.7-2.1l55.2 53.6z"clip-rule=evenodd></path><path fill=#D8D8D8 fill-rule=evenodd stroke=#FFF stroke-linecap=round stroke-linejoin=bevel stroke-width=7 d="M428.3 384.5l.9-6.5m-33.9 1.5l.9-6.5m-34 .5l.9-6.1m-38.9-16.1l4.2-3.9m-25.2-16.1l4.2-3.9"clip-rule=evenodd></path></g><defs><filter width=280.6 height=317.4 x=73.2 y=113.9 filterUnits=userSpaceOnUse><feColorMatrix values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 1 0"></feColorMatrix></filter></defs><mask width=280.6 height=317.4 x=73.2 y=113.9 maskUnits=userSpaceOnUse><g><circle cx=316.5 cy=316.5 r=316.5 fill=#FFF fill-rule=evenodd clip-rule=evenodd></circle></g></mask><g><linearGradient x1=-646.8 x2=-646.8 y1=854.844 y2=853.844 gradientTransform="matrix(-100.1751 48.8587 -97.9753 -200.879 19124.773 203538.61)"gradientUnits=userSpaceOnUse><stop offset=0 stop-color=#a17500></stop><stop offset=1 stop-color=#5d2100></stop></linearGradient><path fill-rule=evenodd d="M192.3 203c8.1 37.3 14 73.6 17.8 109.1 3.8 35.4 2.8 75.2-2.9 119.2l61.2-16.7c-15.6-59-25.2-97.9-28.6-116.6-3.4-18.7-10.8-51.8-22.2-99.6l-25.3 4.6"clip-rule=evenodd></path><linearGradient x1=-635.467 x2=-635.467 y1=852.115 y2=851.115 gradientTransform="matrix(92.6873 4.8575 2.0257 -38.6535 57323.695 36176.047)"gradientUnits=userSpaceOnUse><stop offset=0 stop-color=#2f8a00></stop><stop offset=1 stop-color=#90ff57></stop></linearGradient><path fill-rule=evenodd stroke=#2F8A00 stroke-width=13 d="M195 183.9s-12.6-22.1-36.5-29.9c-15.9-5.2-34.4-1.5-55.5 11.1 15.9 14.3 29.5 22.6 40.7 24.9 16.8 3.6 51.3-6.1 51.3-6.1z"clip-rule=evenodd></path><linearGradient x1=-636.573 x2=-636.573 y1=855.444 y2=854.444 gradientTransform="matrix(109.9945 5.7646 6.3597 -121.3507 64719.133 107659.336)"gradientUnits=userSpaceOnUse><stop offset=0 stop-color=#2f8a00></stop><stop offset=1 stop-color=#90ff57></stop></linearGradient><path fill-rule=evenodd stroke=#2F8A00 stroke-width=13 d="M194.9 184.5s-47.5-8.5-83.2 15.7c-23.8 16.2-34.3 49.3-31.6 99.3 30.3-27.8 52.1-48.5 65.2-61.9 19.8-20 49.6-53.1 49.6-53.1z"clip-rule=evenodd></path><linearGradient x1=-632.145 x2=-632.145 y1=854.174 y2=853.174 gradientTransform="matrix(62.9558 3.2994 3.5021 -66.8246 37035.367 59284.227)"gradientUnits=userSpaceOnUse><stop offset=0 stop-color=#2f8a00></stop><stop offset=1 stop-color=#90ff57></stop></linearGradient><path fill-rule=evenodd stroke=#2F8A00 stroke-width=13 d="M195 183.9c-.8-21.9 6-38 20.6-48.2 14.6-10.2 29.8-15.3 45.5-15.3-6.1 21.4-14.5 35.8-25.2 43.4-10.7 7.5-24.4 14.2-40.9 20.1z"clip-rule=evenodd></path><linearGradient x1=-638.224 x2=-638.224 y1=853.801 y2=852.801 gradientTransform="matrix(152.4666 7.9904 3.0934 -59.0251 94939.86 55646.855)"gradientUnits=userSpaceOnUse><stop offset=0 stop-color=#2f8a00></stop><stop offset=1 stop-color=#90ff57></stop></linearGradient><path fill-rule=evenodd stroke=#2F8A00 stroke-width=13 d="M194.9 184.5c31.9-30 64.1-39.7 96.7-29 32.6 10.7 50.8 30.4 54.6 59.1-35.2-5.5-60.4-9.6-75.8-12.1-15.3-2.6-40.5-8.6-75.5-18z"clip-rule=evenodd></path><linearGradient x1=-637.723 x2=-637.723 y1=855.103 y2=854.103 gradientTransform="matrix(136.467 7.1519 5.2165 -99.5377 82830.875 89859.578)"gradientUnits=userSpaceOnUse><stop offset=0 stop-color=#2f8a00></stop><stop offset=1 stop-color=#90ff57></stop></linearGradient><path fill-rule=evenodd stroke=#2F8A00 stroke-width=13 d="M194.9 184.5c35.8-7.6 65.6-.2 89.2 22 23.6 22.2 37.7 49 42.3 80.3-39.8-9.7-68.3-23.8-85.5-42.4-17.2-18.5-32.5-38.5-46-59.9z"clip-rule=evenodd></path><linearGradient x1=-631.79 x2=-631.79 y1=855.872 y2=854.872 gradientTransform="matrix(60.8683 3.19 8.7771 -167.4773 31110.818 145537.61)"gradientUnits=userSpaceOnUse><stop offset=0 stop-color=#2f8a00></stop><stop offset=1 stop-color=#90ff57></stop></linearGradient><path fill-rule=evenodd stroke=#2F8A00 stroke-width=13 d="M194.9 184.5c-33.6 13.8-53.6 35.7-60.1 65.6-6.5 29.9-3.6 63.1 8.7 99.6 27.4-40.3 43.2-69.6 47.4-88 4.2-18.3 5.5-44.1 4-77.2z"clip-rule=evenodd></path><path fill=none stroke=#2F8A00 stroke-linecap=round stroke-width=8 d="M196.5 182.3c-14.8 21.6-25.1 41.4-30.8 59.4-5.7 18-9.4 33-11.1 45.1"></path><path fill=none stroke=#2F8A00 stroke-linecap=round stroke-width=8 d="M194.8 185.7c-24.4 1.7-43.8 9-58.1 21.8-14.3 12.8-24.7 25.4-31.3 37.8m99.1-68.9c29.7-6.7 52-8.4 67-5 15 3.4 26.9 8.7 35.8 15.9m-110.8-5.9c20.3 9.9 38.2 20.5 53.9 31.9 15.7 11.4 27.4 22.1 35.1 32"></path></g><defs><filter width=532 height=633 x=50.5 y=399 filterUnits=userSpaceOnUse><feColorMatrix values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 1 0"></feColorMatrix></filter></defs><mask width=532 height=633 x=50.5 y=399 maskUnits=userSpaceOnUse><g><circle cx=316.5 cy=316.5 r=316.5 fill=#FFF fill-rule=evenodd clip-rule=evenodd></circle></g></mask><linearGradient x1=-641.104 x2=-641.278 y1=856.577 y2=856.183 gradientTransform="matrix(532 0 0 -633 341484.5 542657)"gradientUnits=userSpaceOnUse><stop offset=0 stop-color=#fff400></stop><stop offset=1 stop-color=#3c8700></stop></linearGradient><ellipse cx=316.5 cy=715.5 fill-rule=evenodd clip-rule=evenodd rx=266 ry=316.5></ellipse><defs><filter width=288 height=283 x=391 y=-24 filterUnits=userSpaceOnUse><feColorMatrix values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 1 0"></feColorMatrix></filter></defs><mask width=288 height=283 x=391 y=-24 maskUnits=userSpaceOnUse><g><circle cx=316.5 cy=316.5 r=316.5 fill=#FFF fill-rule=evenodd clip-rule=evenodd></circle></g></mask><g><g transform="translate(397 -24)"><linearGradient x1=-1036.672 x2=-1036.672 y1=880.018 y2=879.018 gradientTransform="matrix(227 0 0 -227 235493 199764)"gradientUnits=userSpaceOnUse><stop offset=0 stop-color=#ffdf00></stop><stop offset=1 stop-color=#ff9d00></stop></linearGradient><circle cx=168.5 cy=113.5 r=113.5 fill-rule=evenodd clip-rule=evenodd></circle><linearGradient x1=-1017.329 x2=-1018.602 y1=658.003 y2=657.998 gradientTransform="matrix(30 0 0 -1 30558 771)"gradientUnits=userSpaceOnUse><stop offset=0 stop-color=#ffa400></stop><stop offset=1 stop-color=#ff5e00></stop></linearGradient><path fill=none stroke-linecap=round stroke-linejoin=bevel stroke-width=12 d="M30 113H0"></path><linearGradient x1=-1014.501 x2=-1015.774 y1=839.985 y2=839.935 gradientTransform="matrix(26.5 0 0 -5.5 26925 4696.5)"gradientUnits=userSpaceOnUse><stop offset=0 stop-color=#ffa400></stop><stop offset=1 stop-color=#ff5e00></stop></linearGradient><path fill=none stroke-linecap=round stroke-linejoin=bevel stroke-width=12 d="M33.5 79.5L7 74"></path><linearGradient x1=-1016.59 x2=-1017.862 y1=852.671 y2=852.595 gradientTransform="matrix(29 0 0 -8 29523 6971)"gradientUnits=userSpaceOnUse><stop offset=0 stop-color=#ffa400></stop><stop offset=1 stop-color=#ff5e00></stop></linearGradient><path fill=none stroke-linecap=round stroke-linejoin=bevel stroke-width=12 d="M34 146l-29 8"></path><linearGradient x1=-1011.984 x2=-1013.257 y1=863.523 y2=863.229 gradientTransform="matrix(24 0 0 -13 24339 11407)"gradientUnits=userSpaceOnUse><stop offset=0 stop-color=#ffa400></stop><stop offset=1 stop-color=#ff5e00></stop></linearGradient><path fill=none stroke-linecap=round stroke-linejoin=bevel stroke-width=12 d="M45 177l-24 13"></path><linearGradient x1=-1006.673 x2=-1007.946 y1=869.279 y2=868.376 gradientTransform="matrix(20 0 0 -19 20205 16720)"gradientUnits=userSpaceOnUse><stop offset=0 stop-color=#ffa400></stop><stop offset=1 stop-color=#ff5e00></stop></linearGradient><path fill=none stroke-linecap=round stroke-linejoin=bevel stroke-width=12 d="M67 204l-20 19"></path><linearGradient x1=-992.85 x2=-993.317 y1=871.258 y2=870.258 gradientTransform="matrix(13.8339 0 0 -22.8467 13825.796 20131.938)"gradientUnits=userSpaceOnUse><stop offset=0 stop-color=#ffa400></stop><stop offset=1 stop-color=#ff5e00></stop></linearGradient><path fill=none stroke-linecap=round stroke-linejoin=bevel stroke-width=12 d="M94.4 227l-13.8 22.8"></path><linearGradient x1=-953.835 x2=-953.965 y1=871.9 y2=870.9 gradientTransform="matrix(7.5 0 0 -24.5 7278 21605)"gradientUnits=userSpaceOnUse><stop offset=0 stop-color=#ffa400></stop><stop offset=1 stop-color=#ff5e00></stop></linearGradient><path fill=none stroke-linecap=round stroke-linejoin=bevel stroke-width=12 d="M127.5 243.5L120 268"></path><linearGradient x1=244.504 x2=244.496 y1=871.898 y2=870.898 gradientTransform="matrix(.5 0 0 -24.5 45.5 21614)"gradientUnits=userSpaceOnUse><stop offset=0 stop-color=#ffa400></stop><stop offset=1 stop-color=#ff5e00></stop></linearGradient><path fill=none stroke-linecap=round stroke-linejoin=bevel stroke-width=12 d="M167.5 252.5l.5 24.5">');function $t(){const e=Ot();return(()=>{var t=kr(),l=t.firstChild.firstChild,r=l.nextSibling,g=r.nextSibling,o=g.firstChild,d=g.nextSibling,c=d.firstChild,p=d.nextSibling,n=p.nextSibling,i=n.firstChild,m=n.nextSibling,v=m.firstChild,D=m.nextSibling,R=D.nextSibling,b=R.firstChild,B=R.nextSibling,Z=B.firstChild,L=B.nextSibling,se=L.nextSibling,x=se.firstChild,y=se.nextSibling,j=y.firstChild,J=y.nextSibling,T=J.nextSibling,oe=T.firstChild,de=T.nextSibling,Se=de.firstChild,ce=de.nextSibling,q=ce.nextSibling,le=q.firstChild,C=q.nextSibling,Y=C.firstChild,fe=C.nextSibling,ee=fe.nextSibling,S=ee.firstChild,A=ee.nextSibling,Q=A.firstChild,N=A.nextSibling,te=N.firstChild.nextSibling,re=te.nextSibling,E=N.nextSibling,ie=E.firstChild,ge=E.nextSibling,ye=ge.firstChild,ue=ge.nextSibling,pe=ue.firstChild,ze=pe.nextSibling,Je=ze.nextSibling,Oe=Je.nextSibling,f=Oe.nextSibling,$=f.nextSibling,z=$.nextSibling,U=z.nextSibling,F=U.nextSibling,h=F.nextSibling,M=h.nextSibling,H=M.nextSibling,I=H.nextSibling,ve=I.nextSibling,ae=ue.nextSibling,he=ae.firstChild,$e=ae.nextSibling,we=$e.firstChild,me=$e.nextSibling,xe=me.nextSibling,k=xe.nextSibling,O=k.firstChild,K=k.nextSibling,_e=K.firstChild,ke=K.nextSibling,De=ke.firstChild.firstChild,Te=De.nextSibling,Ee=Te.nextSibling,Ie=Ee.nextSibling,Ge=Ie.nextSibling,Ae=Ge.nextSibling,Pe=Ae.nextSibling,Le=Pe.nextSibling,Re=Le.nextSibling,je=Re.nextSibling,ot=je.nextSibling,lt=ot.nextSibling,st=lt.nextSibling,at=st.nextSibling,dt=at.nextSibling,ct=dt.nextSibling,ft=ct.nextSibling,Ct=ft.nextSibling;return s(l,"id",`a-${e}`),s(r,"fill",`url(#a-${e})`),s(o,"id",`b-${e}`),s(d,"id",`c-${e}`),s(c,"filter",`url(#b-${e})`),s(p,"mask",`url(#c-${e})`),s(i,"id",`d-${e}`),s(m,"id",`e-${e}`),s(v,"filter",`url(#d-${e})`),s(D,"mask",`url(#e-${e})`),s(b,"id",`f-${e}`),s(B,"id",`g-${e}`),s(Z,"filter",`url(#f-${e})`),s(L,"mask",`url(#g-${e})`),s(x,"id",`h-${e}`),s(y,"id",`i-${e}`),s(j,"filter",`url(#h-${e})`),s(J,"mask",`url(#i-${e})`),s(oe,"id",`j-${e}`),s(de,"id",`k-${e}`),s(Se,"filter",`url(#j-${e})`),s(ce,"mask",`url(#k-${e})`),s(le,"id",`l-${e}`),s(C,"id",`m-${e}`),s(Y,"filter",`url(#l-${e})`),s(fe,"mask",`url(#m-${e})`),s(S,"id",`n-${e}`),s(A,"id",`o-${e}`),s(Q,"filter",`url(#n-${e})`),s(N,"mask",`url(#o-${e})`),s(te,"id",`p-${e}`),s(re,"fill",`url(#p-${e})`),s(ie,"id",`q-${e}`),s(ge,"id",`r-${e}`),s(ye,"filter",`url(#q-${e})`),s(ue,"mask",`url(#r-${e})`),s(pe,"id",`s-${e}`),s(ze,"fill",`url(#s-${e})`),s(Je,"id",`t-${e}`),s(Oe,"fill",`url(#t-${e})`),s(f,"id",`u-${e}`),s($,"fill",`url(#u-${e})`),s(z,"id",`v-${e}`),s(U,"fill",`url(#v-${e})`),s(F,"id",`w-${e}`),s(h,"fill",`url(#w-${e})`),s(M,"id",`x-${e}`),s(H,"fill",`url(#x-${e})`),s(I,"id",`y-${e}`),s(ve,"fill",`url(#y-${e})`),s(he,"id",`z-${e}`),s($e,"id",`A-${e}`),s(we,"filter",`url(#z-${e})`),s(me,"id",`B-${e}`),s(xe,"fill",`url(#B-${e})`),s(xe,"mask",`url(#A-${e})`),s(O,"id",`C-${e}`),s(K,"id",`D-${e}`),s(_e,"filter",`url(#C-${e})`),s(ke,"mask",`url(#D-${e})`),s(De,"id",`E-${e}`),s(Te,"fill",`url(#E-${e})`),s(Ee,"id",`F-${e}`),s(Ie,"stroke",`url(#F-${e})`),s(Ge,"id",`G-${e}`),s(Ae,"stroke",`url(#G-${e})`),s(Pe,"id",`H-${e}`),s(Le,"stroke",`url(#H-${e})`),s(Re,"id",`I-${e}`),s(je,"stroke",`url(#I-${e})`),s(ot,"id",`J-${e}`),s(lt,"stroke",`url(#J-${e})`),s(st,"id",`K-${e}`),s(at,"stroke",`url(#K-${e})`),s(dt,"id",`L-${e}`),s(ct,"stroke",`url(#L-${e})`),s(ft,"id",`M-${e}`),s(Ct,"stroke",`url(#M-${e})`),t})()}var Cr=G("<button type=button><div><div></div><div></div></div><div>-</div><div>TanStack Router");function zr({initialIsOpen:e,panelProps:t={},closeButtonProps:l={},toggleButtonProps:r={},position:g="bottom-left",containerElement:o="footer",router:d,routerState:c,shadowDOMTarget:p}){const[n,i]=ne();let m;const[v,D]=Qe("tanstackRouterDevtoolsOpen",e),[R,b]=Qe("tanstackRouterDevtoolsHeight",null),[B,Z]=ne(!1),[L,se]=ne(!1),x=Nt(),y=Be(),j=(S,A)=>{if(A.button!==0)return;se(!0);const Q={originalHeight:(S==null?void 0:S.getBoundingClientRect().height)??0,pageY:A.pageY},N=re=>{const E=Q.pageY-re.pageY,ie=Q.originalHeight+E;b(ie),ie<70?D(!1):D(!0)},te=()=>{se(!1),document.removeEventListener("mousemove",N),document.removeEventListener("mouseUp",te)};document.addEventListener("mousemove",N),document.addEventListener("mouseup",te)};v(),Ce(()=>{Z(v()??!1)}),Ce(()=>{var S,A,Q;if(B()){const N=(A=(S=n())==null?void 0:S.parentElement)==null?void 0:A.style.paddingBottom,te=()=>{var E;const re=m.getBoundingClientRect().height;(E=n())!=null&&E.parentElement&&i(ie=>(ie!=null&&ie.parentElement&&(ie.parentElement.style.paddingBottom=`${re}px`),ie))};if(te(),typeof window<"u")return window.addEventListener("resize",te),()=>{var re;window.removeEventListener("resize",te),(re=n())!=null&&re.parentElement&&typeof N=="string"&&i(E=>(E.parentElement.style.paddingBottom=N,E))}}else(Q=n())!=null&&Q.parentElement&&i(N=>(N!=null&&N.parentElement&&N.parentElement.removeAttribute("style"),N))}),Ce(()=>{if(n()){const S=n(),A=getComputedStyle(S).fontSize;S==null||S.style.setProperty("--tsrd-font-size",A)}});const{style:J={},...T}=t,{style:oe={},onClick:de,...Se}=l,{onClick:ce,class:q,...le}=r;if(!x())return null;const C=W(()=>R()??500),Y=W(()=>V(y().devtoolsPanelContainer,y().devtoolsPanelContainerVisibility(!!v()),y().devtoolsPanelContainerResizing(L),y().devtoolsPanelContainerAnimation(B(),C()+16))),fe=W(()=>({height:`${C()}px`,...J||{}})),ee=W(()=>V(y().mainCloseBtn,y().mainCloseBtnPosition(g),y().mainCloseBtnAnimation(!!v()),q));return _(Bt,{component:o,ref:i,class:"TanStackRouterDevtools",get children(){return[_(Ut.Provider,{value:{onCloseClick:de??(()=>{})},get children(){return _(br,Ve({ref(S){var A=m;typeof A=="function"?A(S):m=S}},T,{router:d,routerState:c,className:Y,style:fe,get isOpen(){return B()},setIsOpen:D,handleDragStart:S=>j(m,S),shadowDOMTarget:p}))}}),(()=>{var S=Cr(),A=S.firstChild,Q=A.firstChild,N=Q.nextSibling,te=A.nextSibling,re=te.nextSibling;return it(S,Ve(le,{"aria-label":"Open TanStack Router Devtools",onClick:E=>{D(!0),ce&&ce(E)},get class(){return ee()}}),!1,!0),u(Q,_($t,{})),u(N,_($t,{})),w(E=>{var ie=y().mainCloseBtnIconContainer,ge=y().mainCloseBtnIconOuter,ye=y().mainCloseBtnIconInner,ue=y().mainCloseBtnDivider,pe=y().routerLogoCloseButton;return ie!==E.e&&a(A,E.e=ie),ge!==E.t&&a(Q,E.t=ge),ye!==E.a&&a(N,E.a=ye),ue!==E.o&&a(te,E.o=ue),pe!==E.i&&a(re,E.i=pe),E},{e:void 0,t:void 0,a:void 0,o:void 0,i:void 0}),S})()]}})}export{zr as FloatingTanStackRouterDevtools,zr as default};
