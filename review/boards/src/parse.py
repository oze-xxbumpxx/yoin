import json, re, sys
D = sys.argv[1]
api = open(f"{D}/api.md", encoding="utf-8").read().splitlines()
st = open(f"{D}/stories.md", encoding="utf-8").read().splitlines()

def section(lines, start_pat, level):
    out, on = [], False
    for l in lines:
        if re.match(start_pat, l):
            on = True; continue
        if on and re.match(r"^#{1,%d} " % level, l):
            break
        if on: out.append(l)
    return out

def table(lines):
    rows = [l for l in lines if l.startswith("|")]
    res = []
    for r in rows[2:]:
        cells = [c.strip() for c in r.strip().strip("|").split("|")]
        res.append(cells)
    return res

def split_cells(line):
    # handle escaped \| inside cells
    tmp = line.replace("\\|", "\u0000")
    return [c.strip().replace("\u0000", "|") for c in tmp.strip().strip("|").split("|")]

def table2(lines):
    rows = [l for l in lines if l.startswith("|")]
    return [split_cells(r) for r in rows[2:]]

# --- screens
scr_rows = table2(section(api, r"^### 画面ごとの中身と呼ぶAPI", 3))
screens = []
for name, body, calls in scr_rows:
    sid, title = name.split(" ", 1)
    screens.append({"id": sid, "title": title, "body": body, "calls": calls})

# flow
flow = section(api, r"^### 移り方", 3)
mer = []
inm = False
for l in flow:
    if l.startswith("```mermaid"): inm = True; continue
    if inm and l.startswith("```"): inm = False; continue
    if inm: mer.append(l)
nodes, edges = {}, []
for l in mer:
    for m in re.finditer(r"(\w+)\[(S-\d+) [^\]]+\]", l):
        nodes[m.group(1)] = m.group(2)
for l in mer:
    m = re.match(r"\s*(\w+)(?:\[[^\]]*\]|\(\([^)]*\)\))?\s*(-->|-\.[^.]*\.->)\s*(\w+)", l)
    if m:
        edges.append([m.group(1), m.group(3), m.group(2) != "-->"])
E = []
for a, b, dotted in edges:
    E.append([nodes.get(a, "push"), nodes.get(b, "push"), dotted])
flow_notes = [l[2:] for l in flow if l.startswith("- ")]

# --- apis
ctxs = [("group", "グループ"), ("catalog", "公演カタログ"), ("attendance", "参戦記録"),
        ("ticket", "チケット"), ("merch", "グッズ"), ("notification", "通知")]
apis = []
for key, ja in ctxs:
    sec = section(api, r"^### %s（`%s`）" % (ja, key), 3)
    for i, (name, mp, rule) in enumerate(table2(sec), 1):
        apis.append({"id": f"{key}-{i:02d}", "ctx": key, "name": name, "route": mp, "rule": rule})
    if key == "notification":
        extra = [l for l in sec if l and not l.startswith("|")]
        notif_note = extra
remind = section(api, r"^### 申込とリマインド", 3)
remind_text = [l for l in remind if l and not l.startswith("|")]
remind_table = table2(remind)

errors = table2(section(api, r"^### エラーの形", 3))

# general rules: subsections of 全体の決まり
gen = section(api, r"^## 全体の決まり", 2)
rules, cur = [], None
for l in gen:
    if l.startswith("### "):
        cur = {"h": l[4:], "lines": []}; rules.append(cur)
    elif cur is not None:
        cur["lines"].append(l)

# --- resolver
def norm(s):
    s = re.sub(r"（[^）]*）", "", s).strip()
    s = s.replace("`", "")
    return s
def atoms(s):
    s = norm(s)
    if "を" in s:
        n, v = s.split("を", 1)
        return [f"{n}を{x}".replace("申込を状態を変える", "申込の状態を変える") for x in v.split("・")]
    return [s]
amap = {}
for a in apis:
    for t in atoms(a["name"]):
        amap[t] = a["id"]
def resolve(ref):
    out, miss = [], []
    for part in re.split(r"、(?![^（]*）)", ref):
        part = part.strip()
        if not part: continue
        hit = False
        for t in atoms(part):
            if t in amap:
                if amap[t] not in out: out.append(amap[t])
                hit = True
            else:
                miss.append(t)
        if not hit and not miss: miss.append(part)
    return out, miss
for s in screens:
    s["apis"], s["miss"] = resolve(s["calls"])
    if s["miss"]: print("SCREEN MISS", s["id"], s["miss"], file=sys.stderr)

# --- stories
cmap = {
    "G": "group", "C": "catalog", "A": "attendance", "T": "ticket", "M": "merch", "N": "notification"}
stories = []
mvp = section(st, r"^## MVP1$", 2)
cur = None
for l in mvp:
    m = re.match(r"^#### ([GCATMN]-\d+)(.+)$", l)
    if m:
        cur = {"id": m.group(1), "title": m.group(2).strip(), "ctx": cmap[m.group(1)[0]], "text": "", "ac": []}
        stories.append(cur); continue
    if l.startswith("###"): cur = None; continue
    if cur is None or not l.strip(): continue
    if l.startswith("- "): cur["ac"].append(l[2:])
    else: cur["text"] += l
smap = {r[0].split(" ", 1)[0]: r for r in table2(section(api, r"^## ストーリーとの対応", 2))}
for s in stories:
    r = smap[s["id"]]
    s["screens"] = re.findall(r"S-\d+", r[1])
    s["apis"], miss = resolve(r[2])
    s["apiRef"] = r[2]
    if miss: print("STORY MISS", s["id"], miss, file=sys.stderr)
people = table2(section(st, r"^## 登場する人", 2))

# reverse links
for a in apis:
    a["screens"] = [s["id"] for s in screens if a["id"] in s["apis"]]
    a["stories"] = [s["id"] for s in stories if a["id"] in s["apis"]]
for s in screens:
    s["stories"] = [x["id"] for x in stories if s["id"] in x["screens"]]
    s["from"] = sorted({a for a, b, d in E if b == s["id"]})
    s["to"] = sorted({b for a, b, d in E if a == s["id"]})

data = {"screens": screens, "apis": apis, "stories": stories, "edges": E, "mermaid": "\n".join(mer),
        "flowNotes": flow_notes, "errors": errors, "rules": rules, "remindText": remind_text,
        "remindTable": remind_table, "notifNote": notif_note, "people": people,
        "ctxs": ctxs}
print(len(screens), len(apis), len(stories), len(E), file=sys.stderr)
json.dump(data, open(f"{D}/data.json", "w", encoding="utf-8"), ensure_ascii=False)

# ===== DB
dm = open(f"{D}/dm.md", encoding="utf-8").read().splitlines()
tables, cur = [], None
in_tables = False
for i, l in enumerate(dm):
    if l == "## テーブル": in_tables = True; continue
    if in_tables and l.startswith("## "): break
    if not in_tables: continue
    m = re.match(r"^#### `(\w+)\.(\w+)`(.*)$", l)
    if m:
        ja = m.group(3).strip(); ent = ""
        mm = re.match(r"^(.*?)`(\w+)`$", ja)
        if mm: ja, ent = mm.group(1), mm.group(2)
        cur = {"id": f"{m.group(1)}.{m.group(2)}", "schema": m.group(1), "name": m.group(2), "ja": ja, "entity": ent, "desc": "", "cols": []}
        tables.append(cur); continue
    if cur is None: continue
    if l.startswith("|"):
        c = split_cells(l)
        if c[0] in ("列", "---") or set(c[0]) <= set("-"): continue
        cur["cols"].append({"name": c[0].strip("`"), "type": c[1], "desc": c[2]})
    elif l.strip() and not l.startswith("#"):
        cur["desc"] += l.strip()
names = {}
for t in tables: names.setdefault(t["name"], []).append(t["id"])
fks = []
for t in tables:
    for c in t["cols"]:
        for ref in re.findall(r"(?<![\w.])(\w+)\.id\b", c["desc"]):
            cand = names.get(ref, [])
            if not cand: continue
            tgt = next((x for x in cand if x.startswith(t["schema"] + ".")), cand[0])
            fks.append([t["id"], c["name"], tgt])
# on-delete table
ondel = table2(section(dm, r"^## 外部キーと、消したときの動き", 2))
schema_ctx = {"groups": "group", "catalog": "catalog", "attendance": "attendance", "ticket": "ticket", "merch": "merch", "notification": "notification"}
dm_sections = {}
for h in ["## 全体の決まり", "## 外部キーと、消したときの動き", "## グループの所属と権限（YADR-01）", "## 書き込みの順番（YADR-02）", "## グループは1人でもよい", "## アーティストごとのまとめ方"]:
    dm_sections[h[3:]] = section(dm, "^" + re.escape(h) + "$", 2)
erase = table2(section(dm, r"^### 各文脈で起きること", 3))
decisions = []
dsec = section(dm, r"^## 決めたこと$", 2)
for l in dsec:
    if l.startswith("|") and not l.startswith("| #") and not l.startswith("|---"):
        c = split_cells(l); decisions.append(c)
tests = table2(section(dm, r"^## 試験の一覧", 2))
data["db"] = {"tables": tables, "fks": fks, "ondel": ondel, "sections": dm_sections, "erase": erase, "decisions": decisions, "tests": tests, "schemaCtx": schema_ctx}
print("tables", len(tables), "fks", len(fks), file=sys.stderr)

# ===== AWS
ar = open(f"{D}/arch.md", encoding="utf-8").read().splitlines()
mer2, inm = [], False
for l in ar:
    if l.startswith("```mermaid"): inm = True; continue
    if inm and l.startswith("```"): inm = False; continue
    if inm: mer2.append(l)
anodes = {}
for l in mer2:
    m = re.match(r"\s*(\w+)[\[\(]+([^\]\)]+)[\]\)]+\s*$", l)
    if m: anodes[m.group(1)] = m.group(2).replace("<br>", " ")
aedges = []
for l in mer2:
    m = re.match(r"\s*(\w+)\s*-->(?:\|([^|]*)\|)?\s*(\w+)", l)
    if m: aedges.append([m.group(1), m.group(3), m.group(2) or ""])
data["aws"] = {"nodes": anodes, "edges": aedges,
  "flows": table2(section(ar, r"^## 処理の流れ", 2)),
  "parts": table2(section(ar, r"^## 構成要素", 2)),
  "decisions": table2(section(ar, r"^## 決めたこと", 2)),
  "cost": [l[2:] for l in section(ar, r"^## 費用の見込み", 2) if l.startswith("- ")],
  "costLead": [l for l in section(ar, r"^## 費用の見込み", 2) if l and not l.startswith("- ")],
  "undecided": [l[2:] for l in section(ar, r"^## 決めないこと", 2) if l.startswith("- ")]}
print("aws", len(anodes), len(aedges), file=sys.stderr)
json.dump(data, open(f"{D}/data.json", "w", encoding="utf-8"), ensure_ascii=False)
