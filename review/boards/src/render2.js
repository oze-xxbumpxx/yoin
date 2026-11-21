/* ================= DBボード ================= */
const DB = D.db || {tables:[]};
const TID = t => t.schema+"--"+t.name.replace(/_/g,"-");
const TB = Object.fromEntries(DB.tables.map(t=>[TID(t),t]));
const TBN = Object.fromEntries(DB.tables.map(t=>[t.id,t]));
const SCH_JA = {groups:"グループ",catalog:"公演カタログ",attendance:"参戦記録",ticket:"チケット",merch:"グッズ",notification:"通知"};
const SC = s => DB.schemaCtx[s];
const COLREF = {group_id:"groups.groups",user_id:"groups.users",applicant_user_id:"groups.users",created_by:"groups.users",updated_by:"groups.users",owner_user_id:"groups.users",concert_id:"catalog.concerts",tour_id:"catalog.tours",venue_id:"catalog.venues",artist_id:"catalog.artists",attendance_id:"attendance.attendances",ticket_application_id:"ticket.ticket_applications",merch_list_id:"merch.merch_lists",merch_item_id:"merch.merch_items",reminder_id:"notification.reminders",push_subscription_id:"notification.push_subscriptions"};
const CASCADE_CHILD = ["groups.members","groups.invite_links","catalog.setlists","catalog.setlist_items","catalog.concert_artists","attendance.attendance_records","attendance.companions","attendance.concert_snapshots","ticket.distributions","merch.buyers","merch.merch_requests","notification.reminder_deliveries"];
function refsOf(t){
  const out=[];
  t.cols.forEach(c=>{
    let tgt=COLREF[c.name]; if(!tgt) return;
    if(t.id==="catalog.setlist_items"&&c.name==="concert_id") tgt="catalog.setlists";
    if(t.id==="attendance.companions"&&c.name==="attendance_id") tgt="attendance.attendance_records";
    if(t.id===tgt) return;
    const cross = tgt.split(".")[0]!==t.schema;
    let rule;
    if(/SET NULL/.test(c.desc)) rule="SET NULL";
    else if(/RESTRICT/.test(c.desc)) rule="RESTRICT";
    else if(t.id==="groups.erasure_jobs") rule="IDだけ";
    else if(cross) rule="RESTRICT";
    else if(CASCADE_CHILD.includes(t.id)) rule="CASCADE";
    else rule="RESTRICT";
    out.push({col:c.name,to:tgt,cross,rule,nullable:/null可/.test(c.desc)});
  });
  return out;
}
DB.tables.forEach(t=>t.refs=refsOf(t));
const childrenOf = id => DB.tables.flatMap(t=>t.refs.filter(r=>r.to===id).map(r=>({from:t.id,...r})));
const isPK = c => /PK/.test(c.desc);
const valuesOf = c => (c.desc.match(/`([a-z_]+)`/g)||[]).map(x=>x.replace(/`/g,"")).filter(x=>!/_id$|^[a-z]+_[a-z_]+_id$/.test(x)&&!COLREF[x]&&!DB.tables.some(t=>t.name===x));
const tableLink = id => { const t=TBN[id]; return `<a class="chip" style="${cc(SC(t.schema))}" href="${boardLink("db",TID(t))||"#"}"${BOARD==="db"?"":' target="_blank" rel="noopener"'}><b>${esc(t.schema)}</b>${esc(t.name)}</a>`; };

/* ER図の配置 */
const ER_COLS = [["groups","notification"],["catalog"],["attendance","ticket","merch"]];
function erLayout(){
  const W=232,RH=30,HH=34,GX=110,GY=26,P=14, pos={}, boxes=[];
  let maxH=0;
  ER_COLS.forEach((col,ci)=>{
    let y=P; const x=P+ci*(W+GX);
    col.forEach(s=>{
      const ts=DB.tables.filter(t=>t.schema===s);
      const h=HH+ts.length*RH+8;
      boxes.push({s,x,y,w:W,h});
      ts.forEach((t,i)=>pos[t.id]={x:x+6,y:y+HH+i*RH,w:W-12,h:RH-4});
      y+=h+GY;
    });
    maxH=Math.max(maxH,y);
  });
  return {pos,boxes,width:P*2+3*W+2*GX,height:maxH};
}
function erSVG(cur, showCommon){
  const {pos,boxes,width,height}=erLayout();
  const near=new Set();
  if(cur){ near.add(cur); TBN[cur].refs.forEach(r=>near.add(r.to)); childrenOf(cur).forEach(r=>near.add(r.from)); }
  let lines="";
  DB.tables.forEach(t=>t.refs.forEach(r=>{
    const common = r.to==="groups.groups"||r.to==="groups.users";
    const hi = cur && (t.id===cur||r.to===cur);
    if(common && !showCommon && !hi) return;
    const a=pos[t.id], b=pos[r.to];
    let d;
    const ax=a.x, bx=b.x;
    if(Math.abs(ax-bx)<5){ const x=a.x+a.w; const off=24+Math.abs(a.y-b.y)/14; d=`M${x} ${a.y+a.h/2} C${x+off} ${a.y+a.h/2},${x+off} ${b.y+b.h/2},${x} ${b.y+b.h/2}`; }
    else if(ax>bx){ d=`M${a.x} ${a.y+a.h/2} C${a.x-55} ${a.y+a.h/2},${b.x+b.w+55} ${b.y+b.h/2},${b.x+b.w} ${b.y+b.h/2}`; }
    else { d=`M${a.x+a.w} ${a.y+a.h/2} C${a.x+a.w+55} ${a.y+a.h/2},${b.x-55} ${b.y+b.h/2},${b.x} ${b.y+b.h/2}`; }
    lines+=`<path class="fk ${r.rule.replace(/\s/g,"")}${hi?" hi":""}${common?" common":""}${cur&&!hi?" dim":""}" d="${d}" marker-end="url(#fk${hi?"h":""})"><title>${t.id}.${r.col} → ${r.to}（${r.rule}）</title></path>`;
  }));
  let bx="";
  boxes.forEach(b=>{ bx+=`<g style="${cc(SC(b.s))}"><rect class="sbox" x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="10"/><text class="sname" x="${b.x+12}" y="${b.y+22}">${b.s}</text><text class="sja" x="${b.x+b.w-12}" y="${b.y+22}" text-anchor="end">${SCH_JA[b.s]}</text></g>`; });
  let tb="";
  DB.tables.forEach(t=>{ const p=pos[t.id]; const id=TID(t); const c=t.id===cur;
    tb+=`<g class="tnode${c?" cur":""}${cur&&!near.has(t.id)?" dim":""}" style="${cc(SC(t.schema))}" data-go="${id}" tabindex="0" role="link" aria-label="${t.id}" transform="translate(${p.x},${p.y})"><rect width="${p.w}" height="${p.h}" rx="6"/><text x="9" y="17">${t.name}</text>${t.name.length<16?`<text class="tja" x="${p.w-8}" y="17" text-anchor="end">${esc(t.ja.length>8?t.ja.slice(0,7)+"…":t.ja)}</text>`:""}</g>`; });
  return `<svg class="er" width="${width}" height="${height}" style="width:100%;min-width:760px;height:auto" viewBox="0 0 ${width} ${height}" role="img" aria-label="テーブルのつながり"><defs>
  <marker id="fk" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0L8 4L0 8z" fill="var(--muted)"/></marker>
  <marker id="fkh" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0L8 4L0 8z" fill="var(--accent)"/></marker></defs>${bx}${lines}${tb}</svg>`;
}
const RULE_TIP = {"CASCADE":"親を消すと一緒に消える","RESTRICT":"使われていれば親を消せない","SET NULL":"親を消すと空になる","IDだけ":"外部キーは資料に書いていない"};
function renderTable(id){
  const t=TB[id], c=SC(t.schema);
  const kids=childrenOf(t.id);
  const ctxRow = DB.erase.find(r=>r[0]===({groups:"グループ",catalog:"公演カタログ",attendance:"参戦記録",ticket:"チケット",merch:"グッズ",notification:"通知"})[t.schema]);
  const decs = DB.decisions.filter(d=>(d[1]+d[2]).includes(t.name)||(t.entity&&(d[1]+d[2]).includes(t.entity)));
  const tests = DB.tests.filter(r=>(r[1]+r[2]).includes(t.name));
  const apis = D.apis.filter(a=>a.ctx===c);
  const refsHtml = t.refs.map(r=>`<div class="rel"><code>${r.col}</code><span class="arrow">→</span>${tableLink(r.to)}<span class="rule ${r.rule.replace(/\s/g,"")}" title="${RULE_TIP[r.rule]}">${r.rule}</span>${r.cross?'<span class="xc">文脈をまたぐ</span>':""}</div>`).join("");
  const kidsHtml = kids.map(r=>`<div class="rel">${tableLink(r.from)}<span class="arrow">の</span><code>${r.col}</code><span class="arrow">が指す</span><span class="rule ${r.rule.replace(/\s/g,"")}" title="${RULE_TIP[r.rule]}">${r.rule}</span></div>`).join("");
  return `<div class="pane" style="${cc(c)}">
  <div class="head"><span class="ctxlabel"><span class="dot"></span>スキーマ ${t.schema}（${SCH_JA[t.schema]}）</span></div>
  <div class="head"><h2>${esc(t.ja)}</h2><code class="big">${t.id}</code>${t.entity?`<span class="ent">${t.entity}</span>`:""}</div>
  ${t.desc?`<p class="lead">${inl(t.desc)}</p>`:""}
  <div class="grid2 wide">
    <div style="min-width:0">
      <div class="tcard"><div class="tcard-h"><span>${t.name}</span><em>${t.cols.length}列</em></div>
      ${t.cols.map(col=>{const ref=t.refs.find(r=>r.col===col.name);const vals=/^(status|kind|step|pickup_method|purchase_status)$/.test(col.name)?valuesOf(col):[];
        return `<div class="trow"><span class="key">${isPK(col)?'<i class="pk" title="主キー">PK</i>':""}${ref?`<i class="fki" title="${ref.to}を指す">FK</i>`:""}</span><span class="cn">${esc(col.name)}${/null可/.test(col.desc)?'<em class="nl">null可</em>':""}</span><span class="ty">${esc(col.type)}</span>${col.desc||vals.length?`<span class="cd">${vals.length?`<span class="vals">${vals.map(v=>`<i>${v}</i>`).join("")}</span>`:""}${inl(col.desc.replace(/^PK・?/,""))}</span>`:""}</div>`;}).join("")}
      </div>
    </div>
    <div style="min-width:0">
      <section class="blk" style="margin-top:0"><h4>このテーブルが指す先 <span class="n">${t.refs.length}</span></h4>${refsHtml||'<p class="empty">ほかのテーブルを指していない。</p>'}</section>
      <section class="blk"><h4>このテーブルを指すもの <span class="n">${kids.length}</span></h4>${kidsHtml||'<p class="empty">指しているテーブルは無い。</p>'}</section>
      ${ctxRow?`<section class="blk"><h4>解散と退会で起きること（${ctxRow[0]}の文脈）</h4><div class="split2"><div class="box" style="${cc('attendance')}"><p><b>解散</b></p><p>${inl(ctxRow[1])}</p></div><div class="box" style="${cc('group')}"><p><b>退会</b></p><p>${inl(ctxRow[2])}</p></div></div></section>`:""}
    </div>
  </div>
  <section class="blk"><h4>つながりの図</h4><div class="scroll er-wrap">${erSVG(t.id,false)}</div><p class="empty" style="margin-top:6px">このテーブルにつながる線だけを色で出した。箱を押すとそのテーブルを開く。</p></section>
  ${decs.length?`<section class="blk"><h4>このテーブルに関わる決定</h4><div class="decs">${decs.map(d=>`<div class="dec"><b>${d[0]}</b><span>${inl(d[1])}</span><p>${inl(d[2])}</p></div>`).join("")}</div></section>`:""}
  ${tests.length?`<section class="blk"><h4>このテーブルに関わる試験</h4><div class="decs">${tests.map(r=>`<div class="dec"><b>${r[0]}</b><span>${inl(r[1])}</span><p>${inl(r[2])}</p></div>`).join("")}</div></section>`:""}
  <section class="blk"><h4>同じ文脈のAPI <span class="n">${apis.length}</span></h4><div class="chips">${apis.map(a=>{const h=boardLink("apis",a.id);return `<a class="chip" style="${cc(a.ctx)}" ${h?`href="${h}" target="_blank" rel="noopener"`:""}><b class="m ${MCOL(a.id)}" style="color:var(--surface)">${MCOL(a.id)}</b>${esc(a.name)}</a>`;}).join("")}</div><p class="empty" style="margin-top:6px">APIとテーブルの1対1の対応は設計資料に無いので、同じ文脈のAPIを並べた。</p></section>
  </div>`;
}
function renderDbOverview(){
  const S=DB.sections;
  const nCross=DB.tables.reduce((n,t)=>n+t.refs.filter(r=>r.cross).length,0);
  return `<div class="pane"><div class="head"><h2>DBの全体図</h2></div>
  <div class="stats"><div class="stat"><span class="v">6</span><span class="k">スキーマ</span></div><div class="stat"><span class="v">${DB.tables.length}</span><span class="k">テーブル</span></div><div class="stat"><span class="v">${DB.tables.reduce((n,t)=>n+t.cols.length,0)}</span><span class="k">列</span></div><div class="stat"><span class="v">${nCross}</span><span class="k">文脈をまたぐ参照</span></div></div>
  <p class="lead">Neon（Postgres）の1つのデータベースを、文脈ごとのスキーマに分けている。箱を押すとそのテーブルを開く。</p>
  <div class="ertools"><label><input type="checkbox" id="common"> グループとユーザーへの線も出す</label><span class="lg"><i class="CASCADE"></i>CASCADE</span><span class="lg"><i class="RESTRICT"></i>RESTRICT</span><span class="lg"><i class="SETNULL"></i>SET NULL</span><span class="lg"><i class="IDだけ"></i>IDだけ</span></div>
  <div class="scroll er-wrap" id="erbox">${erSVG(null,false)}</div>
  <section class="blk"><h4>マイグレーションを流す順番</h4><div class="order">${["groups","catalog","attendance・ticket・merch・notification"].map((s,i)=>`${i?'<span class="arrow">→</span>':""}<span class="ostep">${s}</span>`).join("")}</div><p class="empty" style="margin-top:6px">文脈をまたぐIDにRESTRICTの外部キーを張るので、この順でないと流せない。</p></section>
  <section class="blk"><h4>書き込みの順番</h4><div class="lockflow">
    <div><b>1</b><span>トランザクションを始める</span></div><div><b>2</b><span><code>groups</code>と<code>users</code>と<code>members</code>が<code>active</code>かを確かめ、<code>FOR SHARE</code>でロック</span></div><div><b>3</b><span>文脈の表に書く（同行者や分配先も相手の行をロック）</span></div><div><b>4</b><span>コミット。解散・退会・外すの開始は、ここまで待ってから状態を変える</span></div></div></section>
  <section class="blk"><h4>解散と退会で、文脈ごとに起きること</h4><div class="md">${md(["| 文脈 | 解散のとき | 退会のとき |","|---|---|---|",...DB.erase.map(r=>`| ${r.join(" | ")} |`)])}</div></section>
  <section class="blk"><h4>全体の決まり（設計資料から）</h4><div class="md">${Object.entries(S).map(([h,l])=>`<h5>${inl(h)}</h5>${md(l)}`).join("")}</div></section>
  <section class="blk"><h4>決めたこと <span class="n">${DB.decisions.length}件</span></h4><div class="decs">${DB.decisions.map(d=>`<div class="dec"><b>${d[0]}</b><span>${inl(d[1])}</span><p>${inl(d[2])}</p></div>`).join("")}</div></section>
  </div>`;
}

/* ================= AWSボード ================= */
const AW = D.aws || {nodes:{},edges:[]};
const AN = Object.assign({}, AW.nodes, {sqs:"SQS＋アラーム 失敗の知らせ（メール）"});
const AEDGES = AW.edges.concat([["sched","sqs","起動できなかった"],["worker","sqs","再試行を使い切った"],["sender","sqs","再試行切れ・届かない端末"]]);
const ADDED = new Set(["sched>sqs","worker>sqs","sender>sqs"]);
const ALABEL = {device:["利用者の端末","PWA・Service Worker"],cf:["CloudFront","＋S3 画面のファイル"],cognito:["Cognito","ユーザープール"],apigw:["API Gateway","HTTP API"],api:["api","Lambda"],worker:["erasure-worker","Lambda"],sender:["notification-sender","Lambda"],sched:["EventBridge","Scheduler"],img:["S3","グッズの画像"],ssm:["SSM","Parameter Store"],logs:["CloudWatch","Logs（保存7日）"],sqs:["SQS＋アラーム","失敗をメールで知らせる"],neon:["Neon","Postgres・AWSの外"],push:["Web Push","Apple・Googleの配信"]};
const AL = k => ALABEL[k][0]+(["api","worker","sender"].includes(k)?"（Lambda）":"");
const APOS = {device:[20,300],cf:[240,46],cognito:[240,160],apigw:[240,300],img:[240,470],ssm:[470,46],logs:[700,46],api:[470,300],worker:[700,190],sched:[470,470],sender:[700,470],sqs:[700,600],neon:[940,300],push:[940,470]};
const AKIND = {device:"client",neon:"ext",push:"ext",cf:"edge",cognito:"sec",apigw:"edge",api:"fn",worker:"fn",sender:"fn",sched:"int",img:"store",ssm:"sec",logs:"ops",sqs:"ops"};
const AKIND_JA = {client:"端末",ext:"AWSの外",edge:"入口",sec:"認証と秘密",fn:"Lambda",int:"予約",store:"保存",ops:"見張り"};
const NODE_PART = {device:["画面"],cf:["画面"],cognito:["認証"],apigw:["API"],api:["API"],worker:["解散・退会・外す"],sender:["通知"],sched:["通知"],push:["通知"],neon:["データベース"],img:["画像"],ssm:["設定と秘密"],logs:["ログ"],sqs:["失敗の知らせ"]};
const NODE_DEC = {device:["C-5"],cf:["B-1"],cognito:[],apigw:["A-1"],api:["A-1","A-2","C-6"],worker:["A-1","A-2","C-4","C-6"],sender:["A-1","A-2","C-4","C-5","C-6"],sched:["C-4"],push:["C-5"],neon:["A-1","A-2","C-2"],img:["B-2"],ssm:["C-1"],logs:["C-3","C-6"],sqs:["C-4"]};
const FLOW_EDGES = [
  ["device>cognito"],
  ["device>apigw","apigw>api","api>neon"],
  ["device>apigw","apigw>api","api>neon","device>img"],
  ["device>apigw","apigw>api","api>neon","api>worker","api>sched","sched>worker","worker>neon","worker>img","worker>cognito","worker>sqs"],
  ["api>sched","sched>sender","sender>neon","sender>push","push>device","sched>sqs","sender>sqs"],
];
const FID = i => "flow-"+(i+1);
const ANID = k => "aws-"+k;
function awsSVG(o={}){
  const W=176,H=58;
  const hiE = new Set(o.edges||[]), hiN=new Set(o.node?[o.node]:[]);
  if(o.edges) o.edges.forEach(e=>e.split(">").forEach(n=>hiN.add(n)));
  if(o.node) AEDGES.forEach(([a,b])=>{ if(a===o.node||b===o.node) {hiE.add(a+">"+b); hiN.add(a); hiN.add(b);} });
  const focus = hiE.size>0;
  const c = k => ({x:APOS[k][0]+W/2,y:APOS[k][1]+H/2});
  let es="", ls="";
  AEDGES.forEach(([a,b,l],i)=>{
    const k=a+">"+b, A0=APOS[a], B0=APOS[b]; let d, lx, ly;
    if(k==="push>device"){ d=`M${B0[0]+W/2} ${A0[1]+H} C${A0[0]+W/2} ${A0[1]+H+140},${B0[0]+W/2} ${A0[1]+H+140},${B0[0]+W/2} ${B0[1]+H}`; d=`M${A0[0]+W/2} ${A0[1]+H} C${A0[0]+W/2} 720,${B0[0]+W/2} 720,${B0[0]+W/2} ${B0[1]+H}`; lx=(A0[0]+B0[0])/2+W/2; ly=690; }
    else {
      const ca=c(a), cb=c(b), dx=cb.x-ca.x, dy=cb.y-ca.y;
      let p,q;
      if(Math.abs(dx)>=Math.abs(dy)*0.9){ p={x:ca.x+Math.sign(dx)*W/2,y:ca.y}; q={x:cb.x-Math.sign(dx)*W/2,y:cb.y}; const m=(q.x-p.x)/2; d=`M${p.x} ${p.y} C${p.x+m} ${p.y},${q.x-m} ${q.y},${q.x} ${q.y}`; }
      else { p={x:ca.x,y:ca.y+Math.sign(dy)*H/2}; q={x:cb.x,y:cb.y-Math.sign(dy)*H/2}; const m=(q.y-p.y)/2; d=`M${p.x} ${p.y} C${p.x} ${p.y+m},${q.x} ${q.y-m},${q.x} ${q.y}`; }
      lx=(p.x+q.x)/2; ly=(p.y+q.y)/2;
    }
    const hi=hiE.has(k), cls=`ae${hi?" hi":""}${focus&&!hi?" dim":""}${ADDED.has(k)?" added":""}`;
    es+=`<path class="${cls}" d="${d}" marker-end="url(#am${hi?"h":""})"/>`;
    if(l && (!focus||hi)) ls+=`<g class="al${hi?" hi":""}"><rect x="${lx-l.length*5.6-6}" y="${ly-10}" width="${l.length*11.2+12}" height="20" rx="10"/><text x="${lx}" y="${ly+4}" text-anchor="middle">${esc(l)}</text></g>`;
  });
  let ns="";
  Object.keys(APOS).forEach(k=>{
    const [x,y]=APOS[k]; const [t1,t2]=ALABEL[k];
    const cls=`an ${AKIND[k]}${o.node===k?" cur":""}${focus&&!hiN.has(k)?" dim":""}`;
    ns+=`<g class="${cls}" data-go="${ANID(k)}" tabindex="0" role="link" aria-label="${esc(AN[k])}" transform="translate(${x},${y})"><rect width="${W}" height="${H}" rx="${k==="neon"?18:10}"/>${awsIcon(k)}<text class="t1" x="44" y="25">${esc(t1)}</text><text class="t2" x="44" y="43">${esc(t2)}</text></g>`;
  });
  return `<svg class="awsd" width="1140" height="740" style="width:100%;min-width:780px;height:auto" viewBox="0 0 1140 740" role="img" aria-label="AWS構成図"><defs>
   <marker id="am" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L8 4L0 8z" fill="var(--muted)"/></marker>
   <marker id="amh" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L8 4L0 8z" fill="var(--accent)"/></marker></defs>
   <rect class="frame" x="220" y="14" width="690" height="666" rx="16"/><text class="frame-t" x="236" y="36">AWS 東京リージョン（ap-northeast-1）</text>
   ${es}${ls}${ns}</svg>`;
}
function awsIcon(k){
  const g={client:'<rect x="4" y="2" width="12" height="20" rx="3"/><path d="M8 18h4"/>',fn:'<path d="M3 20L10 4h3l7 16M7 12h8"/>',ext:'<ellipse cx="10" cy="5" rx="8" ry="3"/><path d="M2 5v12c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/>',edge:'<circle cx="11" cy="11" r="8"/><path d="M3 11h16M11 3c3 3 3 13 0 16M11 3c-3 3-3 13 0 16"/>',sec:'<rect x="4" y="9" width="14" height="11" rx="2"/><path d="M7 9V6a4 4 0 018 0v3"/>',int:'<circle cx="11" cy="11" r="8"/><path d="M11 6v5l3 3"/>',store:'<path d="M3 6h16l-2 14H5z"/><ellipse cx="11" cy="6" rx="8" ry="2.5"/>',ops:'<path d="M2 12h4l3-7 4 14 3-7h4"/>'}[AKIND[k]];
  return `<g class="ic" transform="translate(13,18)" fill="none" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${g}</g>`;
}
function flowsOfNode(k){ return AW.flows.map((f,i)=>({f,i})).filter(({i})=>FLOW_EDGES[i].some(e=>e.split(">").includes(k))); }
function renderAwsNode(k){
  const parts = AW.parts.filter(p=>(NODE_PART[k]||[]).includes(p[0]));
  const decs = AW.decisions.filter(d=>(NODE_DEC[k]||[]).includes(d[0]));
  const ins = AEDGES.filter(e=>e[1]===k), outs=AEDGES.filter(e=>e[0]===k);
  const kind=AKIND[k];
  const nm=AN[k];
  const extra = k==="neon" ? `<section class="blk"><h4>中にあるスキーマ</h4><div class="chips">${Object.keys(SCH_JA).map(s=>{const h=boardLink("db",""); return `<a class="chip" style="${cc(SC(s))}" ${URLS.db?`href="${URLS.db}" target="_blank" rel="noopener"`:""}><b>${s}</b>${SCH_JA[s]}</a>`;}).join("")}</div></section><div class="box" style="--cc:var(--c-ticket);margin-top:14px"><p><b>まだ決めていないこと</b></p><p>${inl(AW.undecided.find(x=>x.startsWith("リージョン"))||"")}</p></div>`
    : k==="api" ? `<section class="blk"><h4>受け持つAPI</h4><p>${URLS.apis?`<a href="${URLS.apis}" target="_blank" rel="noopener">APIボードの${D.apis.length}件 ↗</a>`:`${D.apis.length}件`}。全部を1つのLambdaで受け、Honoで文脈ごとのルートにつなぐ。</p></section>`
    : k==="ssm"||k==="logs" ? `<p class="empty">設計資料の図では、ほかの部品とのあいだに線を引いていない。</p>` : k==="sqs" ? `<p class="empty">設計資料の図（mermaid）にはまだ無い。2026-11-21のC-4で足したので、このボードでは点線で描いた。</p>`:"";
  return `<div class="pane" style="--cc:var(--k-${kind})">
  <div class="head"><span class="ctxlabel"><span class="dot"></span>${AKIND_JA[kind]}</span></div>
  <div class="head"><h2>${esc(ALABEL[k][0])}</h2><span class="ent" style="--cc:var(--muted)">${esc(ALABEL[k][1])}</span></div>
  <div class="scroll" style="padding:6px;margin-top:10px">${awsSVG({node:k})}</div>
  ${parts.length?`<section class="blk"><h4>役目と選んだ理由</h4><div class="decs">${parts.map(p=>`<div class="dec"><b>${esc(p[0])}</b><span>${inl(p[1])}</span><p>${inl(p[2])}</p><small>決めた場所：${inl(p[3])}</small></div>`).join("")}</div></section>`:""}
  <section class="blk"><h4>つながり</h4><div class="split2">
    <div><p class="exl" style="padding:0 0 6px">入ってくる</p>${ins.length?ins.map(e=>`<div class="rel"><a class="chip" href="#${ANID(e[0])}"><b>${AKIND_JA[AKIND[e[0]]]}</b>${esc(AL(e[0]))}</a><span class="arrow">${esc(e[2]||"→")}</span></div>`).join(""):'<p class="empty">なし</p>'}</div>
    <div><p class="exl" style="padding:0 0 6px">出ていく</p>${outs.length?outs.map(e=>`<div class="rel"><span class="arrow">${esc(e[2]||"→")}</span><a class="chip" href="#${ANID(e[1])}"><b>${AKIND_JA[AKIND[e[1]]]}</b>${esc(AL(e[1]))}</a></div>`).join(""):'<p class="empty">なし</p>'}</div></div></section>
  ${extra}
  ${flowsOfNode(k).length?`<section class="blk"><h4>通る処理の流れ</h4><div class="chips">${flowsOfNode(k).map(({f,i})=>`<a class="chip" href="#${FID(i)}"><b>流れ</b>${esc(f[0])}</a>`).join("")}</div></section>`:""}
  ${decs.length?`<section class="blk"><h4>関わる決定</h4><div class="decs">${decs.map(d=>`<div class="dec"><b>${d[0]}</b><span>${inl(d[1])}</span><p>${inl(d[2])}</p>${d[3]?`<small>選ばなかった案：${inl(d[3])}</small>`:""}</div>`).join("")}</div></section>`:""}
  </div>`;
}
function renderFlow(i){
  const f=AW.flows[i]; const steps=sentences(f[1]);
  return `<div class="pane" style="--cc:var(--accent)">
  <div class="head"><span class="ctxlabel"><span class="dot"></span>処理の流れ</span></div>
  <div class="head"><h2>${esc(f[0])}</h2></div>
  <div class="scroll" style="padding:6px;margin-top:10px">${awsSVG({edges:FLOW_EDGES[i],anim:1})}</div>
  <p class="empty" style="margin-top:6px">色の付いた線がこの流れで通る道。${FLOW_EDGES[i].some(e=>ADDED.has(e))?"点線は失敗したときだけ通る。":""}</p>
  <section class="blk"><h4>順に起きること</h4><ol class="steps">${steps.map(s=>`<li>${inl(s)}</li>`).join("")}</ol></section>
  </div>`;
}
function renderAwsOverview(){
  return `<div class="pane"><div class="head"><h2>AWSアーキテクチャ</h2></div>
  <div class="stats"><div class="stat"><span class="v">3</span><span class="k">Lambda</span></div><div class="stat"><span class="v">0</span><span class="k">常に動くサーバー</span></div><div class="stat"><span class="v">0</span><span class="k">VPC・NAT</span></div><div class="stat"><span class="v">${AW.decisions.length}</span><span class="k">決めたこと</span></div></div>
  <p class="lead">部品を押すとそのタブを開く。下の流れのボタンを押すと、その流れで通る線を光らせる。</p>
  <div class="flowbtns">${AW.flows.map((f,i)=>`<button class="fb" data-flow="${i}">${esc(f[0])}</button>`).join("")}<button class="fb" data-flow="-1">すべて</button></div>
  <div class="scroll" style="padding:6px" id="awsbox">${awsSVG({})}</div>
  <div class="legend">${Object.entries(AKIND_JA).map(([k,v])=>`<span style="--cc:var(--k-${k})"><i></i>${v}</span>`).join("")}<span><i class="dash"></i>失敗したときだけ（C-4）</span></div>
  <div class="box" style="--cc:var(--c-ticket);margin-top:18px"><p><b>リージョンはまだ動く可能性がある</b></p><p>${inl(AW.undecided.find(x=>x.startsWith("リージョン"))||"")}</p></div>
  <section class="blk"><h4>決めたこと <span class="n">${AW.decisions.length}件</span></h4><div class="decs">${AW.decisions.map(d=>`<div class="dec"><b>${d[0]}</b><span>${inl(d[1])}</span><p>${inl(d[2])}</p><small>選ばなかった案：${inl(d[3])}</small></div>`).join("")}</div></section>
  <section class="blk"><h4>費用の見込み（推測。工程6で公式の料金から試算する）</h4><ul class="sentences" style="--cc:var(--c-catalog)">${AW.cost.map(x=>`<li>${inl(x)}</li>`).join("")}</ul></section>
  <section class="blk"><h4>決めないこと</h4><ul class="sentences" style="--cc:var(--muted)">${AW.undecided.map(x=>`<li>${inl(x)}</li>`).join("")}</ul></section>
  </div>`;
}
