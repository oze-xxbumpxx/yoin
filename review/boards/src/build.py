import json,sys
D=sys.argv[1]; urls=json.loads(sys.argv[2]) if len(sys.argv)>2 else {}
t=open(f"{D}/template.html",encoding="utf-8").read()
data=open(f"{D}/data.json",encoding="utf-8").read().replace("</","<\\/")
names={"screens":"yoin 画面ボード","apis":"yoin APIボード","stories":"yoin ストーリーボード","db":"yoin DBボード","aws":"yoin AWSボード"}
for b,n in names.items():
    h=t.replace("__RENDER__",open(f"{D}/render.js",encoding="utf-8").read()).replace("__RENDER2__",open(f"{D}/render2.js",encoding="utf-8").read()).replace("__WF__",open(f"{D}/wf.js",encoding="utf-8").read()).replace("__EX__",open(f"{D}/ex.js",encoding="utf-8").read()).replace("__TITLE__",n).replace('"__BOARD__"',json.dumps(b)).replace("__URLS__",json.dumps(urls)).replace("__DATA__",data).replace("__SHA__","6526db2")
    open(f"{D}/{b}.html","w",encoding="utf-8").write(h)
