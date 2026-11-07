"""견본 판: 같은 문장을 후보 짝으로 렌더해 typography/specimens/*.png 로 저장 (헤드리스 Chromium 스크린샷).
사용: python3 typography/tools/specimen.py [판이름 ...]   (스킬 뿌리에서)
     PAIRS=typography/pairs.js 로 최종 표를 쓸 수 있음(기본: 후보 표 specimens/candidates_pairs.js)
판 왼쪽의 기준 그림: 스킬 뿌리 kax_paths.json의 refs 폴더(공개 기본: 작업 폴더 review/refs/)에서 판의 유형(anchor_type)으로 찾는다 —
  kax_paths.json specimen_refs {판이름: 파일}이 있으면 그 파일, 없으면 그 유형의 첫 그림(<유형>_*.webp·.png·.jpg). 없으면 그림 없이.
브라우저: 환경 변수 CHROME → kax_paths.json browser(glob 꼴) → PATH의 chrome-headless-shell·chromium.
"""
import json, os, subprocess, sys, glob, shutil

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = os.path.join(ROOT, "typography/specimens/src")
PAIRS = os.environ.get("PAIRS", "typography/specimens/candidates_pairs.js")
KAX_PATHS_PUBLIC = {"base": "cwd", "refs": "review/refs"}  # kax_paths.json이 없을 때(공개 값)


def kax_paths():
    """스킬 뿌리 kax_paths.json(도구 기본 경로 표). 없거나 못 읽으면 {}."""
    try:
        with open(os.path.join(ROOT, "kax_paths.json"), encoding="utf-8") as f:
            t = json.load(f)
    except (OSError, ValueError):
        return {}
    return t if isinstance(t, dict) else {}


def refs_dir():
    """기준 그림 폴더 → (절대 경로, 표에 적힌 글). base: skill = 스킬 뿌리 기준, cwd = 도구를 돌린 폴더 기준."""
    t = kax_paths()
    if "refs" not in t:
        t = KAX_PATHS_PUBLIC
    base = ROOT if t.get("base") == "skill" else os.getcwd()
    return os.path.normpath(os.path.join(base, os.path.expanduser(t["refs"]))), t["refs"]


def chrome():
    p = os.environ.get("CHROME")
    if p:
        return p
    pat = kax_paths().get("browser")
    hits = sorted(glob.glob(os.path.expanduser(pat))) if pat else []
    if hits:
        return hits[0]
    for name in ("chrome-headless-shell", "chromium", "chromium-browser"):
        p = shutil.which(name)
        if p:
            return p
    sys.exit("헤드리스 브라우저를 못 찾음 — 환경 변수 CHROME에 실행 파일 경로를 준다")


def anchor_file(name, kind):
    """판 name의 기준 그림 → (스크린샷 HTML에서 부를 상대 경로, 판에 적을 글). 못 찾으면 (None, 안내 글)."""
    d, label = refs_dir()
    f = kax_paths().get("specimen_refs", {}).get(name)
    if not f:
        hits = sorted(os.path.basename(p) for e in ("webp", "png", "jpg") for p in glob.glob(os.path.join(d, f"{kind}_*.{e}")))
        f = hits[0] if hits else None
    if not f or not os.path.exists(os.path.join(d, f)):
        return None, f"없음 — {label}/{kind}_*"
    return os.path.relpath(os.path.join(d, f), SRC), f"{label}/{f}"


K1, K2, K3, K4 = "말로 정리하는 일정", "UX로 만드는 화면", "수 · 오후 3:00 회의", "KAX"

BOARDS = {
 "kinetic": {"w": 2400, "h": 2200, "bg": "#0b0010", "fg": "#f5f0ff", "anchor_type": "kinetic_type",
   "rows": [(r, [(K2, 96, None), (K4 + " 모션그래픽", 96, "#ff9d2e"), ("Memo로 " + K1, 52, None)])
            for r in ["kin_archivo_pret_r1228", "kin_archivo_pret", "kin_unbounded_pret", "kin_bigsh_bhs", "kin_archivo_bhs", "kin_bigsh_dohyeon_OLD"]]},
 "ui": {"w": 2400, "h": 1500, "bg": "#f4f1ea", "fg": "#17140f", "anchor_type": "ui_screen",
   "rows": [(t, [(K1, 68, None), ("Memo로 회의록을 정리하고 내일 일정을 잡아요", 28, "#57524a", b), (K3, 24, "#8a8377", b)])
            for t, b in [("title_inter_pret", "body_pret"), ("title_archivo_pret", "body_pret"), ("title_inter_noto", "body_noto")]]},
 "serif": {"w": 2400, "h": 1500, "bg": "#efebe3", "fg": "#1b1813", "anchor_type": "big_type_closeup",
   "rows": [(r, [(K1, 96, None), ("Made with 메모, 2026", 64, "#7a5b3a"), ("__mix__" + r, 72, None)])
            for r in ["serif_hahmlet", "serif_notoserif", "serif_gowun"]]},
 "numeric": {"w": 2400, "h": 1300, "bg": "#101113", "fg": "#f2f2f2", "anchor_type": "calendar_data",
   "rows": [(r, [(K3, 64, None), ("12,480명 · 98.6% · D-3", 64, "#9ad0ff"), ("3:00", 150, None)])
            for r in ["num_inter", "num_spacegrotesk", "num_bigsh"]]},
}
FINAL = "typography/pairs.js"
BOARDS.update({
 "final_kinetic": {"w": 2400, "h": 1500, "bg": "#0b0010", "fg": "#f5f0ff", "anchor_type": "kinetic_type", "pairs": FINAL,
   "rows": [("kinetic_heavy", [(K2, 120, None), (K4 + " 모션그래픽", 120, "#ff9d2e")]),
            ("kinetic_wide", [(K4 + " 스튜디오", 110, None)]),
            ("kinetic_condensed", [("말로 정리하는 DAY", 120, "#c8ff3d")])]},
 "final_ui": {"w": 2400, "h": 1150, "bg": "#f4f1ea", "fg": "#17140f", "anchor_type": "ui_screen", "pairs": FINAL,
   "rows": [("ui_title", [(K1, 72, None), ("Memo로 회의록을 정리하고 내일 일정을 잡아요", 28, "#57524a", "ui_body"), (K3, 26, "#8a8377", "numeric")]),
            ("numeric_hero", [("3:00", 200, None), ("12,480명", 120, "#2f6fe0")])]},
 "final_serif": {"w": 2400, "h": 1100, "bg": "#efebe3", "fg": "#1b1813", "anchor_type": "big_type_closeup", "pairs": FINAL,
   "rows": [("display_serif", [(K1, 110, None), ("Made with 메모, 2026", 72, "#7a5b3a"), ("__mix__display_serif", 80, None)]),
            ("serif_bold", [("__mix__serif_bold", 80, None)])]},
})

HTML = """<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;background:%(bg)s;color:%(fg)s;width:%(w)dpx;height:%(h)dpx;overflow:hidden}
#wrap{display:flex;gap:56px;padding:48px}
#anc{width:860px;flex:none}#anc img{width:860px;display:block;border-radius:6px;outline:1px solid #8884}
#anc p,.lab{font:500 18px/1.3 monospace;opacity:.55;margin:10px 0 0}
.row{margin:0 0 30px;padding-bottom:18px;border-bottom:1px solid #8883}
.ln{white-space:pre;margin:4px 0}
</style></head><body><div id="wrap"><div id="anc"><img src="%(anchor_src)s"%(anchor_hide)s><p>기준 그림 %(anchor_label)s</p></div><div id="rows"></div></div>
<script src="../../../%(pairs)s"></script><script src="../../mixed_text.js"></script>
<script>
const ROWS=%(rows)s;
(async()=>{KTypo.load(window.KTYPO_PAIRS,"../../../");await KTypo.ready();
const host=document.getElementById('rows');
for(const [role,lines] of ROWS){const row=document.createElement('div');row.className='row';
 const r=KTypo.role(role), m=r.measured.ko;
 const lab=document.createElement('div');lab.className='lab';
 lab.textContent=`${role}  ·  ${r.latin.font} ${r.latin.wght||''} ↔ ${r.ko.font} ${r.ko.wght||''}  ·  한글 ×${m.scale} 기준선 ${m.baseline_shift_em}em 자간 ${(m.tracking_em*100).toFixed(1)}%%`;
 row.appendChild(lab);
 for(const [t,size,color,roleOver] of lines){const d=document.createElement('div');d.className='ln';if(color)d.style.color=color;
  if(t.startsWith('__mix__')){ // 산세리프 제목 안 한 단어만 세리프로 전환
    const a=document.createElement('span'),b=document.createElement('span');d.style.fontSize=size+'px';
    KTypo.dom(a,'말로 정리하는 ',KTYPO_PAIRS.roles.ui_title?'ui_title':'title_inter_pret',{});KTypo.dom(b,'일정',t.slice(7),{});b.style.color='#b0532a';d.append(a,b);
  } else KTypo.dom(d,t,roleOver||role,{size});
  row.appendChild(d);}
 host.appendChild(row);}
document.body.dataset.done=1;})();
</script></body></html>"""


CAL = """<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#fff}</style></head><body>
<canvas id="c" width="2400" height="%(h)d"></canvas>
<script src="../../../typography/pairs.js"></script><script src="../../mixed_text.js"></script><script>
(async()=>{KTypo.load(window.KTYPO_PAIRS,"../../../");await KTypo.ready();
const c=document.getElementById('c'),x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,c.width,c.height);
const roles=%(roles)s, S=100; let y=60;
x.font='500 22px monospace';x.fillStyle='#555';x.fillText('왼쪽: 같은 font-size 그대로(보정 없음)   오른쪽: KTypo 보정(배율·기준선·자간)   선: 기준선(검정)·라틴 대문자 높이(파랑)·한글 윗선(빨강)',40,y);y+=40;
for(const role of roles){const r=KTypo.role(role),m=r.measured;y+=S*1.1;
 x.fillStyle='#777';x.font='500 20px monospace';x.fillText(role+'  ×'+m.ko.scale+'  shift '+m.ko.baseline_shift_em+'em',40,y-S*1.0);
 for(const [ox,corr] of [[40,false],[1220,true]]){
  const txt='HAX 한글로 만든 Hx';
  let w;
  if(corr){w=KTypo.canvas(x,txt,role,ox,y,S,{});}
  else{ // 보정 없이: 같은 크기·기준선, 서체만 바꿈
   let pen=ox;for(const seg of KTypo.segments(txt)){const s=KTypo.spec(role,seg.script);x.font=KTypo.ctxFont(s,S);x.fontStretch=KTypo.ctxStretch(s);x.fillStyle='#111';x.fillText(seg.text,pen,y);pen+=x.measureText(seg.text).width;}w=pen-ox;}
  const capY=y-m.latin.cap*S, koTop=corr? y-(m.ko.top_em*m.ko.scale+m.ko.baseline_shift_em)*S : y-m.ko.top_em*S;
  for(const [yy,col] of [[y,'#000'],[capY,'#1f6feb'],[koTop,'#e5484d']]){x.strokeStyle=col;x.lineWidth=1.5;x.beginPath();x.moveTo(ox-10,yy);x.lineTo(ox+Math.min(w,1120)+10,yy);x.stroke();}
 }
 x.fillStyle='#111';y+=40;}
document.body.dataset.done=1;})();
</script></body></html>"""


def calibration():
    roles = ["ui_title", "kinetic_heavy", "kinetic_wide", "kinetic_condensed", "display_serif", "serif_bold", "numeric_hero"]
    h = 120 + len(roles) * 152
    src = os.path.join(SRC, "calibration.html")
    open(src, "w").write(CAL % {"h": h, "roles": json.dumps(roles)})
    out = os.path.join(ROOT, "typography/specimens/calibration.png")
    subprocess.run([chrome(), "--headless", "--disable-gpu", "--hide-scrollbars", "--allow-file-access-from-files",
                    f"--window-size=2400,{h}", "--virtual-time-budget=8000", f"--screenshot={out}", "file://" + src],
                   check=True, capture_output=True, timeout=120)
    print("wrote", out)


def render(name):
    if name == "calibration":
        return calibration()
    b = BOARDS[name]
    rows = [[r, [list(x) for x in lines]] for r, lines in b["rows"]]
    src_a, label = anchor_file(name, b["anchor_type"])
    html = HTML % {**b, "rows": json.dumps(rows, ensure_ascii=False), "pairs": b.get("pairs", PAIRS),
                   "anchor_src": src_a or "", "anchor_hide": "" if src_a else ' style="display:none"', "anchor_label": label}
    src = os.path.join(SRC, name + ".html")
    open(src, "w").write(html)
    out = os.path.join(ROOT, "typography/specimens", name + ".png")
    subprocess.run([chrome(), "--headless", "--disable-gpu", "--hide-scrollbars", "--allow-file-access-from-files",
                    f"--window-size={b['w']},{b['h']}", "--virtual-time-budget=8000", f"--screenshot={out}", "file://" + src],
                   check=True, capture_output=True, timeout=120)
    print("wrote", out)


if __name__ == "__main__":
    for n in sys.argv[1:] or list(BOARDS) + ["calibration"]:
        render(n)
