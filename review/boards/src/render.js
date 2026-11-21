/* ---------- ワイヤーフレーム ---------- */
const MCOL = id => methods(A[id].route)[0];
function pinsOf(el){ return el.filter(x=>x&&typeof x==="object"&&!Array.isArray(x)&&x.a).map(x=>x.a); }
function wf(sid, o={}){
  const els = WF[sid]||[]; const s=S[sid];
  const num = id => s.apis.indexOf(id)+1;
  const pin = el => o.pins===false?"":pinsOf(el).filter(a=>s.apis.includes(a)).map(a=>`<span class="pin m ${MCOL(a)}" title="${esc(A[a].name)}">${num(a)}</span>`).join("");
  const hl = el => o.hl && pinsOf(el).includes(o.hl) ? " hl" : "";
  const T = x => typeof x==="string"?esc(x):"";
  const part = el => {
    const [k,a,b,c,d,e]=el; const P=pin(el), H=hl(el);
    switch(k){
      case "logo": return `<div class="w-logo${H}">${T(a)}</div>`;
      case "title": return `<div class="w-title${H}">${T(a)}${P}</div>`;
      case "back": return `<div class="w-back${H}"><span>‹</span>${T(a)}${typeof b==="string"?`<em>${T(b)}</em>`:""}${P}</div>`;
      case "bar": return `<div class="w-back${H}"><b>${T(a)}</b><em>${T(b)}</em>${P}</div>`;
      case "hero": return `<div class="w-hero${H}"><b>${T(a)}</b><span>${T(b)}</span>${P}</div>`;
      case "input": return `<div class="w-in${H}"><label>${T(a)}</label><div>${T(b)}</div>${P}</div>`;
      case "area": return `<div class="w-in${H}"><label>${T(a)}</label><div style="min-height:3.2em">${T(b)}</div>${P}</div>`;
      case "select": return `<div class="w-in${H}"><label>${T(a)}</label><div class="sel">${T(b)}<i>▾</i></div>${P}</div>`;
      case "btn": return `<div class="w-btn${b===1?" pri":""}${H}">${T(a)}${P}</div>`;
      case "btns": return `<div class="w-btns${H}"><div class="w-btn">${T(a)}</div><div class="w-btn pri">${T(b)}</div>${P}</div>`;
      case "danger": return `<div class="w-btn dng${H}">${T(a)}${P}</div>`;
      case "link": return `<div class="w-link${H}">${T(a)}${P}</div>`;
      case "note": return `<div class="w-note${H}">${T(a)}${P}</div>`;
      case "warn": return `<div class="w-warn${H}">${T(a)}${P}</div>`;
      case "sec": return `<div class="w-sec${H}">${T(a)}${P}</div>`;
      case "row": return `<div class="w-row${H}"><div><b>${T(a)}</b><span>${T(b)}</span></div><em>${T(c)}</em>${P}</div>`;
      case "todo": return `<div class="w-row todo${H}"><i>${T(a)}</i><div><b>${T(b)}</b></div><em>${T(c)}</em>${P}</div>`;
      case "tabs": case "seg": return `<div class="w-tabs${H}">${a.map((t,i)=>`<span class="${i===b?"on":""}">${esc(t)}</span>`).join("")}${P}</div>`;
      case "kv": return `<div class="w-kv${H}">${a.map(([x,y])=>`<span>${esc(x)}</span><b>${esc(y)}</b>`).join("")}${P}</div>`;
      case "avatars": return `<div class="w-av${H}">${a.map(x=>`<i>${esc(x)}</i>`).join("")}<span>3人が行く</span>${P}</div>`;
      case "chips": return `<div class="w-chips${H}"><label>同行者</label>${a.map(x=>`<i>${esc(x)}</i>`).join("")}${P}</div>`;
      case "chips2": return `<div class="w-pills${H}">${a.map((t,i)=>`<i class="${i===b?"on":""}">${esc(t)}</i>`).join("")}${P}</div>`;
      case "grid": return `<div class="w-grid${H}">${a.map(x=>`<span>${esc(x)}</span>`).join("")}${P}</div>`;
      case "step": return `<div class="w-step${H}"><i>${T(a)}</i><div><b>${T(b)}</b><span>${T(c)}</span></div>${P}</div>`;
      case "song": return `<div class="w-song${H}"><i>${T(a)}</i><div><b>${T(b)}</b><span>${T(c)}</span></div><em>≡</em>${P}</div>`;
      case "app": return `<div class="w-row${H}"><div><b>${T(a)}</b><span>${T(b)}</span></div><em class="st ${{"当選":"won","落選":"lost"}[c]||""}">${T(c)}</em>${P}</div>`;
      case "status": return `<div class="w-status${H}">${a.map((t,i)=>`<span class="${i<b?"done":i===b?"on":""}">${esc(t)}</span>`).join("")}${P}</div>`;
      case "photo": return `<div class="w-photo${H}"><svg width="28" height="22" viewBox="0 0 28 22" aria-hidden="true"><rect x="1" y="1" width="26" height="20" rx="3" fill="none" stroke="currentColor"/><circle cx="9" cy="8" r="3" fill="none" stroke="currentColor"/><path d="M3 19l7-7 5 5 4-4 7 6" fill="none" stroke="currentColor"/></svg>${T(a)}${P}</div>`;
      case "item": return `<div class="w-item${H}"><div class="ph"></div><div><b>${T(a)}</b><span>${T(b)}・${T(c)}</span><span class="req">欲しい数：${T(d)}　<u>＋1</u></span></div>${P}</div>`;
      case "buy": return `<div class="w-row${H}"><div><b>${T(a)}</b><span>${T(b)}</span></div><em>${T(c)}${d?`<br><small class="st ${d==="買えた"?"won":"lost"}">${T(d)}</small>`:""}</em>${P}</div>`;
      case "total": return `<div class="w-total${H}"><span>${T(a)}</span><b>${T(b)}</b>${P}</div>`;
      case "bars": return `<div class="w-bars${H}">${a.map(([n,v])=>`<span>${esc(n)}</span><div><i style="width:${v/7*100}%"></i></div><b>${v}</b>`).join("")}${P}</div>`;
      case "preview": return `<div class="w-prev${H}"><b>${T(a)}</b><span>${T(b)}</span>${P}</div>`;
      case "copy": return `<div class="w-in${H}"><div class="sel">${T(a)}<i>コピー</i></div>${P}</div>`;
      case "dev": return `<div class="w-row${H}"><div><b>${T(a)}</b><span>${T(b)}</span></div><em>${typeof c==="string"&&c?`<small class="st lost">${T(c)}</small><br>`:""}<u>外す</u></em>${P}</div>`;
      case "fab": return `<div class="w-fab${H}">${T(a)}</div>`;
      case "nav": return `<div class="w-nav${H}"><span class="on">ホーム</span><span>公演</span><span>自分</span><span>設定</span></div>`;
    }
    return "";
  };
  return `<div class="phone wf${o.sm?" sm":""}" style="${cc(SCTX[sid])}"><div class="notch"></div><div class="scr">${els.map(part).join("")}</div></div>`;
}

/* ---------- JSONの色づけ ---------- */
function jsonHL(v){
  if(v===null) return '<span class="j-n">（本文なし）</span>';
  return esc(JSON.stringify(v,null,2)).replace(/(&quot;[^&]*?&quot;)(\s*:)?|\b(-?\d+(?:\.\d+)?)\b|\b(true|false|null)\b/g,(m,s,colon,n,lit)=>{
    if(s) return colon?`<span class="j-k">${s}</span>${colon}`:`<span class="j-s">${s}</span>`;
    if(n) return `<span class="j-num">${n}</span>`;
    return `<span class="j-n">${lit}</span>`;
  });
}

/* ---------- APIの通り道 ---------- */
const ROWLOCK = {"group-04":"招待リンクの行","catalog-13":"下書きの行","catalog-14":"下書きの行","merch-02":"下書きの行","merch-04":"下書きの行","ticket-04":"申込の行","ticket-05":"申込の行","ticket-06":"申込の行","catalog-16":"セトリの版を比べて書く"};
const OTHER_LOCK = {"attendance-04":"同行者に選んだ人","ticket-07":"分配先の人","merch-08":"購入担当にする人"};
const ASYNC = ["group-10","group-12","group-14"];
const SCHED = ["ticket-02","ticket-04","ticket-05","ticket-06"];
const S3 = {"merch-01":"アップロード用URLを作る","merch-02":"一時置き場からコピー","merch-04":"items/へコピー","merch-05":"コピーと消す予定","merch-06":"取得用URL（5分）"};
function flags(id){
  const a=A[id], ms=methods(a.route), write=ms.some(m=>m!=="GET"), inv=id==="group-03"||id==="group-04";
  const inGroup=/\/groups\/\{g\}/.test(a.route), me=/`(GET|POST|PUT|PATCH|DELETE)[^`]*\/me/.test(a.route)||id==="group-05";
  return {write, inv, lock: write&&!ASYNC.includes(id) ? (inGroup?"groups・自分の users・members の行を FOR SHARE"+(OTHER_LOCK[id]?"。"+OTHER_LOCK[id]+"の行も":""):(me||id==="group-05")?"自分の users の行を FOR SHARE":null):null,
    row: ROWLOCK[id]||null, async: ASYNC.includes(id), sched: SCHED.includes(id), s3: S3[id]||null};
}
function pipeline(id){
  const f=flags(id), ex=EX[id]||{}, code=ex.res?ex.res[0]:200;
  const steps=[
    ["画面","hono/client で呼ぶ",true],
    ["API Gateway",f.inv?"JWT を確かめる（users の行が無くてもよい）":"Cognito の JWT を確かめる。無ければ 401",true],
    ["Lambda api",f.inv?"招待の2本だけ users の行を問わない":"users の行が active か。無ければ not_registered",true],
    ["ロック",[f.lock,f.row&&(f.row.includes("比べ")?f.row:f.row+"を FOR UPDATE")].filter(Boolean).join("、")||(f.async?"終わっていないジョブがあれば先に 202":"読むだけ"),!!(f.lock||f.row||f.async)],
    ["Neon",f.write?"1つのトランザクションで書く":"読む",true],
  ];
  const side = f.async?["erasure-worker","受け付けたあと、消す処理を続きから最後まで進める"]:f.sched?["EventBridge Scheduler","リマインドの予約を作る・直すのはコミットの前、消すのはあと"]:f.s3?["S3",f.s3]:null;
  // 説明の行数から枠の高さを決める。全角1字を1、半角を0.55として、1行に9字ほど入る。
  const cols=t=>[...String(t||"")].reduce((a,ch)=>a+(ch.charCodeAt(0)<128?0.55:1),0);
  const maxLines=Math.max(...steps.map(s=>Math.ceil(cols(s[1])/8.5)),side?Math.ceil(cols(side[1])/8.5):1,1);
  const W=114,G=18,P=6, H=Math.max(84,Math.ceil(30+maxLines*14.7+10)), n=steps.length+(side?1:0)+1;
  const width=P*2+n*W+(n-1)*G, height=H+P*2;
  let x=P, h="";
  const node=(t,sub,on,cls="")=>{const r=`<g class="pn ${on?"on":"off"} ${cls}" transform="translate(${x},${P})"><rect width="${W}" height="${H}" rx="10"/><text class="pt" x="10" y="20">${esc(t)}</text><foreignObject x="6" y="26" width="${W-12}" height="${H-30}"><div xmlns="http://www.w3.org/1999/xhtml" class="ps">${esc(sub)}</div></foreignObject></g>`; x+=W+G; return r;};
  const arrow=()=>`<path class="pa" d="M${x-G+2} ${P+H/2}h${G-6}" marker-end="url(#pa)"/>`;
  steps.forEach((s,i)=>{ if(i) h+=arrow(); h+=node(...s); });
  if(side){ h+=arrow(); h+=node(side[0],side[1],true,"side"); }
  h+=arrow(); h+=node(`応答 ${code}`, code===202?"続きは裏で進む":code===204?"行がもう無くても 204":code===201?"2回目は同じ中身で 200":"", true, "resp s"+code);
  return `<div class="pipe"><svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="要求が通る順番"><defs><marker id="pa" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L8 4L0 8z" fill="var(--muted)"/></marker></defs>${h}</svg></div>`;
}
function exampleBlock(id){
  const a=A[id], ex=EX[id]; if(!ex) return "";
  const ms=methods(a.route), ps=paths(a.route);
  const m = ex.req? (ms.find(x=>x!=="GET"&&x!=="DELETE")||ms[0]) : (ms.includes("GET")?"GET":ms[ms.length-1]);
  const p = (ps.length>1 && m!==ms[0] ? ps[ps.length-1] : ps[0]).replace(/\?.*$/,"")+(ex.q||"");
  const errRow = ex.err && ERR[ex.err] ? `<div class="exerr"><span class="err">${ex.err}<i>${ERR[ex.err][1]}</i></span><span>${inl(ERR[ex.err][2])}</span></div>`:"";
  return `<div class="ex">
    <div class="exh"><span class="m ${m}">${m}</span><code>${esc(p)}</code></div>
    <div class="excols">
      <div><div class="exl">要求の本文</div><pre class="json">${ex.req?jsonHL(ex.req):'<span class="j-n">（本文なし）</span>'}</pre></div>
      <div><div class="exl">応答 <span class="code c${ex.res[0]}">${ex.res[0]}</span></div><pre class="json">${jsonHL(ex.res[1])}</pre></div>
    </div>${errRow}
    <p class="exnote">設計資料の「中身と決まり」から組み立てた例。値は架空で、欄の名前の一部（<code>merchSalesInfo</code>など）は資料に無く、このボードで仮に付けた。</p>
  </div>`;
}

/* ---------- 進み具合 ---------- */
const STAGES=[["ストーリー","2026-11-07に書き、11-21にMVP1を37本にした","done"],["画面とAPI","工程5。PR #17でレビュー中","now"],["要件と設計書","最初の1本の設計で書く","todo"],["実装","Devinに渡す","todo"],["E2E","2人をブラウザ2つで動かす","todo"]];
function progress(){
  return `<ol class="prog">${STAGES.map(([t,s,k])=>`<li class="${k}"><i>${k==="done"?"✓":k==="now"?"●":""}</i><b>${t}</b><span>${s}</span></li>`).join("")}</ol>`;
}

/* ---------- タブの中身 ---------- */
function renderScreen(id){
  const s=S[id], c=SCTX[id];
  const from=s.from, to=s.to;
  return `<div class="pane" style="${cc(c)}">
  <div class="head"><span class="bid">${id}</span><h2>${esc(s.title)}</h2></div>
  <p class="lead">${inl(s.body)}。</p>
  <div class="grid2">
    <div>${wf(id)}<p class="cap2">ワイヤーフレームはイメージ。見た目と配置は最初の1本の設計で決める。番号の印は、下のAPIを呼ぶ場所。</p></div>
    <div style="min-width:0">
      <section class="blk" style="margin-top:0"><h4>呼ぶAPI <span class="n">${s.apis.length}件</span></h4>
        ${s.apis.length?`<div class="apis">${s.apis.map((a,i)=>apiCard(a,false,i+1)).join("")}</div>`:`<p class="empty">APIは呼ばない（${inl(s.calls)}）。</p>`}
      </section>
      <section class="blk"><h4>前後の画面</h4><div class="mini">${localSVG(id)}</div></section>
      <section class="blk"><h4>満たすストーリー <span class="n">${s.stories.length}本</span></h4>
        ${s.stories.length?`<div class="chips">${s.stories.map(storyChip).join("")}</div>`:'<p class="empty">この画面を挙げたストーリーはない。</p>'}
      </section>
    </div>
  </div></div>`;
}
function renderApi(id){
  const a=A[id];
  const ms=methods(a.route); const ps=paths(a.route);
  const fmt=p=>esc(p).replace(/\{([^}]+)\}/g,'<span class="p">{$1}</span>').replace(/(\?.*)$/,'<span class="q">$1</span>');
  const lines = ps.length===1 ? [`<div class="line"><span class="methods">${ms.map(m=>`<span class="m ${m}">${m}</span>`).join("")}</span><span>${fmt(ps[0])}</span></div>`]
     : ps.map((p,i)=>`<div class="line"><span class="methods">${(i===0?[ms[0]]:ms.slice(1)).map(m=>`<span class="m ${m}">${m}</span>`).join("")}</span><span>${fmt(p)}</span></div>`);
  const errs=errCodes(a.rule), f=flags(id);
  const remind = SCHED.includes(id);
  const sn = sentences(a.rule.replace(/\\\|/g,"|"));
  const tags=[f.write?["書く","w"]:["読むだけ","r"], /できる人|だけ/.test(a.rule)&&/(オーナー|申込者|本人|作った人|購入担当)だけ/.test(a.rule)?[a.rule.match(/(オーナー|申込者|本人|作った人|購入担当)だけ/)[1]+"だけ","o"]:["メンバー全員","r"], f.async?["202で受けて裏で進む","a"]:null, f.sched?["リマインドを合わせる","n"]:null, f.s3?["画像（S3）","n"]:null, /`id`|\{ id/.test(a.rule)?["IDは画面が作る（UUIDv7）","r"]:null].filter(Boolean);
  return `<div class="pane" style="${cc(a.ctx)}">
  <div class="head"><span class="ctxlabel"><span class="dot"></span>${CTX[a.ctx]}（${a.ctx}）</span></div>
  <div class="head"><h2>${esc(a.name)}</h2></div>
  <div class="route" style="margin-top:10px">${lines.join("")}</div>
  <div class="tags">${tags.map(([t,k])=>`<span class="tag ${k}">${t}</span>`).join("")}</div>
  <section class="blk"><h4>要求が通る順番</h4>${pipeline(id)}</section>
  <section class="blk"><h4>要求と応答の例</h4>${exampleBlock(id)}</section>
  <section class="blk"><h4>中身と決まり</h4>
    ${sn.length?`<ul class="sentences">${sn.map(x=>`<li>${inl(x)}</li>`).join("")}</ul>`:'<p class="empty">設計資料の表に書き込みはない。グループのメンバー全員が呼べる。</p>'}
  </section>
  ${remind?`<section class="blk"><h4>リマインドの合わせ方</h4><div class="box" style="${cc('notification')}">${md(D.remindText.slice(0,1))}${md(["| 申込の状態 | あるべき予約 |","|---|---|",...D.remindTable.map(r=>`| ${r[0]} | ${r[1]} |`)])}<p class="empty" style="margin:0">${inl(D.remindText.slice(1).join(""))}</p></div></section>`:""}
  ${errs.length?`<section class="blk"><h4>この決まりに出てくるエラー</h4><div class="errs">${errs.map(e=>`<div><span class="err">${e}<i>${ERR[e][1]}</i></span><span>${inl(ERR[e][2])}</span></div>`).join("")}</div></section>`:""}
  <section class="blk"><h4>呼ぶ画面 <span class="n">${a.screens.length}</span></h4>
    <div class="wfrow">${a.screens.map(sid=>{const href=boardLink("screens",sid);return `<a class="wfcell" ${href?`href="${href}" target="_blank" rel="noopener"`:""}><div class="wfcap"><b>${sid}</b>${esc(S[sid].title)}${href?' ↗':''}</div>${wf(sid,{sm:1,hl:id})}</a>`;}).join("")}</div>
    <p class="empty" style="margin-top:6px">枠で囲んだところが、このAPIを呼ぶ場所。</p></section>
  <section class="blk"><h4>関わるストーリー <span class="n">${a.stories.length}</span></h4>${a.stories.length?`<div class="chips">${a.stories.map(storyChip).join("")}</div>`:'<p class="empty">ストーリーとの対応の表には名前が無い（画面の表だけに出てくる）。</p>'}</section>
  </div>`;
}
function renderStory(id){
  const s=ST[id];
  const steps=s.screens.map(sid=>({sid, apis:s.apis.filter(a=>S[sid].apis.includes(a))}));
  const unplaced=s.apis.filter(a=>!steps.some(x=>x.apis.includes(a)));
  const who=(s.text.match(/^(.+?)として/)||[])[1]||"";
  const what=(s.text.match(/として、(.+?)。/)||[])[1]||"";
  const why=(s.text.match(/。(.+)$/)||[])[1]||"";
  return `<div class="pane" style="${cc(s.ctx)}">
  <div class="head"><span class="ctxlabel"><span class="dot"></span>${CTX[s.ctx]}（${s.ctx}）</span></div>
  <div class="head"><span class="bid">${id}</span><h2>${esc(s.title)}</h2></div>
  <div class="card3"><div><span>誰が</span><b>${inl(who)}</b></div><div><span>何をしたい</span><b>${inl(what)}</b></div><div><span>なぜ</span><b>${inl(why)}</b></div></div>
  <section class="blk"><h4>進み具合</h4>${progress()}</section>
  <section class="blk"><h4>画面をたどる流れ</h4>
    <div class="journey">${steps.map((x,i)=>{const href=boardLink("screens",x.sid);return `${i?'<div class="jarrow" aria-hidden="true">→</div>':""}<div class="jstep"><a class="wfcap" ${href?`href="${href}" target="_blank" rel="noopener"`:""}><b>${x.sid}</b>${esc(S[x.sid].title)}${href?" ↗":""}</a>${wf(x.sid,{sm:1,hl:x.apis[0]})}<div class="japis">${x.apis.map(a=>{const h=boardLink("apis",a);return `<a class="ja" ${h?`href="${h}" target="_blank" rel="noopener"`:""}><span class="m ${MCOL(a)}">${MCOL(a)}</span>${esc(A[a].name)}</a>`;}).join("")}</div></div>`;}).join("")}</div>
    ${unplaced.length?`<p class="empty">画面の表に名前が無いAPI：${unplaced.map(a=>esc(A[a].name)).join("、")}</p>`:""}
  </section>
  <section class="blk"><h4>受け入れ条件 <span class="n">${s.ac.length}</span></h4><ul class="ac">${s.ac.map(x=>`<li>${check}<span>${inl(x)}</span></li>`).join("")}</ul></section>
  <section class="blk"><h4>使うAPI <span class="n">${s.apis.length}</span></h4><div class="apis">${s.apis.map(a=>apiCard(a)).join("")}</div>
  ${/（/.test(s.apiRef)?`<p class="empty" style="margin-top:8px">設計資料の書き方では「${inl(s.apiRef)}」。</p>`:""}</section>
  </div>`;
}

function renderOverview(){
  if(BOARD==="screens"){
    return `<div class="pane"><div class="head"><h2>画面の一覧と移り方</h2></div>
    <div class="stats"><div class="stat"><span class="v">23</span><span class="k">画面</span></div><div class="stat"><span class="v">${D.edges.length}</span><span class="k">移り方</span></div><div class="stat"><span class="v">${D.apis.length}</span><span class="k">API</span></div></div>
    <section class="blk"><h4>移り方の図</h4><p class="lead" style="margin-bottom:8px">箱を押すと、その画面のタブを開く。点線は、通知を押して申込の画面を開く移り方。</p>
    <div class="mini scroll" style="padding:6px">${flowSVG(null)}</div>
    <div class="md" style="margin-top:12px">${md(D.flowNotes.map(x=>"- "+x))}</div></section>
    <section class="blk"><h4>23画面のワイヤーフレーム</h4><div class="gallery">${SCREEN_GROUPS.flatMap(g=>g[2]).map(sid=>`<a class="wfcell" href="#${sid}"><div class="wfcap"><b>${sid}</b>${esc(S[sid].title)}<span class="n">API ${S[sid].apis.length}</span></div>${wf(sid,{sm:1})}</a>`).join("")}</div></section></div>`;
  }
  if(BOARD==="apis"){
    const cnt={}; D.apis.forEach(a=>methods(a.route).forEach(m=>cnt[m]=(cnt[m]||0)+1));
    return `<div class="pane"><div class="head"><h2>APIの全体の決まり</h2></div>
    <div class="stats"><div class="stat"><span class="v">${D.apis.length}</span><span class="k">API（表の行）</span></div>${Object.entries(cnt).map(([m,n])=>`<div class="stat"><span class="m ${m}">${m}</span><span class="v" style="font-size:24px">${n}</span></div>`).join("")}<div class="stat"><span class="v">${D.errors.length}</span><span class="k">エラーの<code>code</code></span></div></div>
    <section class="blk"><h4>文脈ごとのAPIの地図</h4><div class="apimap">${D.ctxs.map(([k,ja])=>`<div class="amcol" style="${cc(k)}"><h5><span class="dot"></span>${ja}</h5>${D.apis.filter(a=>a.ctx===k).map(a=>`<a href="#${a.id}" class="amrow"><span class="methods">${methods(a.route).map(m=>`<span class="m ${m}">${m[0]}</span>`).join("")}</span>${esc(a.name)}</a>`).join("")}</div>`).join("")}</div></section>
    <section class="blk"><h4>要求が通る順番（例：申込の状態を変える）</h4>${pipeline("ticket-05")}</section>
    <section class="blk"><h4>エラーの形</h4><pre class="json">${jsonHL({type:"about:blank",title:"Unprocessable Content",status:422,code:"invalid_input",errors:[{path:"quantity",code:"too_small"}]})}</pre>
      <div class="errgrid">${D.errors.map(r=>`<div class="eg s${String(r[1]).trim()[0]}"><b>${inl(r[0])}</b><i>${r[1]}</i><span>${inl(r[2])}</span></div>`).join("")}</div></section>
    <section class="blk"><h4>全体の決まり（設計資料から）</h4><div class="md">${D.rules.filter(r=>r.h!=="エラーの形").map(r=>`<h5>${inl(r.h)}</h5>${md(r.lines)}`).join("")}
    <h5>通知</h5>${md(D.notifNote)}</div></section></div>`;
  }
  const scr=D.screens.map(s=>s.id);
  return `<div class="pane"><div class="head"><h2>ストーリーの全体</h2></div>
  <div class="stats"><div class="stat"><span class="v">${D.stories.length}</span><span class="k">ストーリー</span></div><div class="stat"><span class="v">${D.stories.reduce((n,s)=>n+s.ac.length,0)}</span><span class="k">受け入れ条件</span></div><div class="stat"><span class="v">${new Set(D.stories.flatMap(s=>s.screens)).size}</span><span class="k">挙がっている画面（23のうち）</span></div></div>
  <section class="blk"><h4>進み具合（37本とも同じ段階）</h4>${progress()}</section>
  <section class="blk"><h4>文脈ごとのストーリー</h4><div class="kanban">${D.ctxs.map(([k,ja])=>`<div class="kcol" style="${cc(k)}"><h5><span class="dot"></span>${ja}<span class="n">${D.stories.filter(s=>s.ctx===k).length}</span></h5>${D.stories.filter(s=>s.ctx===k).map(s=>`<a class="kcard" href="#${s.id}"><b>${s.id}</b><span>${esc(s.title)}</span><small>画面 ${s.screens.join("・")}　API ${s.apis.length}　条件 ${s.ac.length}</small></a>`).join("")}</div>`).join("")}</div></section>
  <section class="blk"><h4>ストーリーと画面の対応</h4><p class="lead" style="margin-bottom:8px">色の付いたマスは、そのストーリーを満たす画面。</p>
  <div class="scroll"><table class="matrix"><thead><tr><th class="rowh"></th>${scr.map(x=>`<th class="colh" title="${esc(S[x].title)}">${x}</th>`).join("")}</tr></thead>
  <tbody>${D.stories.map(s=>`<tr style="${cc(s.ctx)}"><th class="rowh"><button data-go="${s.id}">${s.id} <span style="font-family:var(--body)">${esc(s.title)}</span></button></th>${scr.map(x=>`<td class="${s.screens.includes(x)?"on":""}"${s.screens.includes(x)?` title="${s.id} → ${x} ${esc(S[x].title)}"`:""}></td>`).join("")}</tr>`).join("")}</tbody></table></div>
  <p class="empty" style="margin-top:8px">どのストーリーにも挙がっていない画面：${scr.filter(x=>!D.stories.some(s=>s.screens.includes(x))).map(x=>`${x} ${esc(S[x].title)}`).join("、")}。</p></section>
  <section class="blk"><h4>登場する人</h4><div class="md">${md(["| 人 | 用語集での名前 | 説明 |","|---|---|---|",...D.people.map(r=>`| ${r.join(" | ")} |`)])}</div></section></div>`;
}
