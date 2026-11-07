"""판정 전 확인 관문: 다시 판정받기 전에 앞 판정의 '고칠 것'을 정말 고치고 확인했는지 본다 (SKILL 5장 6 비평 루프 3번).

사용(작업 폴더에서):
  python3 -I <스킬>/critic/tools/fix_gate.py init review/panel --out review/fix_r1/고칠것.md
      앞 판정 패널 폴더(panel.json)의 고칠 것 후보(2명 이상이 짚은 것 먼저) + 불합격·갈린 관문 + 맞대기 '못하다' 샷으로 표를 만든다.
  python3 -I <스킬>/critic/tools/fix_gate.py strip <영상.mp4> --frame 104 --out review/fix_r1/f0104_before.jpg [--span 3]
      그 프레임 앞뒤(기본 ±3)를 1프레임 간격으로 가로로 이은 띠 한 장(ffmpeg만 씀). 고치기 전 영상·고친 뒤 영상에서 같은 프레임으로 한 번씩.
      띠 옆에 <out>.json(어느 영상 — 경로·sha256·수정 시각 — 의 몇 프레임인지)을 함께 쓴다. check가 이것으로 후 띠의 출처를 본다.
  python3 -I <스킬>/critic/tools/fix_gate.py check review/fix_r1/고칠것.md --video out/final.mp4
      줄마다 고친 방법·전 띠·후 띠(파일이 실제로 있는지)·상태를 보고, 다 맞으면 끝 코드 0, 아니면 빠진 것을 적고 끝 코드 1.
      확인 항목(v0.6.6 — 시간 대신): '확인됨' 줄마다 ① 후 띠가 strip으로 만든 것이고(옆 .json) 그 영상이 전 띠 영상과 다른 파일(sha256)이며
      앞 판정(panel.json) 뒤에 렌더된 것, ② --video를 주면 후 띠가 모두 그 영상(다시 판정받을 영상)에서 나온 것, ③ '측정 전→후'에
      'a→b' 꼴 숫자가 있으면 전과 후가 실제로 다른 값. --min-minutes(분)는 예전 시간 조건 — 기본 0(보지 않음), 주면 함께 본다.

상태 값: `할 것`(처음) → `확인됨` / `못 고침: <사유>` / `미룸`(1명만 짚은 줄만 — 시간이 남으면 고치는 줄).
맞대기 '못하다' 샷 줄은 고친 방법에 `다시 짬`과 키프레임 맞대기 판(pair_board.py 결과 `pair_f<프레임>__<기준 그림 id>.png`) 경로가 있어야 한다.
판정(고친 것이 충분한지)은 비평가가 한다. 이 도구는 '고쳤다고 적고, 그림으로 남겼는지'만 본다. 표준 라이브러리 + ffmpeg(strip만).
"""
import argparse
import datetime
import hashlib
import json
import os
import re
import subprocess
import sys
import time

VERSION = 1
COLS = ["번호", "항목", "지적", "프레임", "고친 방법", "전 띠", "후 띠", "측정 전→후", "상태"]
TODO, OK, CANT, LATER = "할 것", "확인됨", "못 고침", "미룸"
QNAME = {"Q1": "밀도·층", "Q2": "타이포", "Q3": "움직임 곡선", "Q4": "디테일", "Q5": "구성·시선",
         "Q6": "시그니처", "Q7": "내용", "Q8": "소리"}
IMG = (".png", ".jpg", ".jpeg", ".webp")
PAIR_RE = re.compile(r"pair_f\d+__[^\s`|()]+\.(?:png|jpg|jpeg|webp)|pairs_sheet\.(?:png|jpg)")
PATH_RE = re.compile(r"[^\s`|()<>\"']+\.(?:png|jpg|jpeg|webp)", re.I)


# ---------------------------------------------------------------- 공통
def sha256(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def panel_json(p):
    p = os.path.abspath(p)
    return p if p.endswith(".json") else os.path.join(p, "panel.json")


def cell(s, n=None):
    """표 칸에 넣을 글: 줄바꿈·| 없애고 n자로 줄임."""
    s = re.sub(r"\s+", " ", str(s or "")).replace("|", "／").strip()
    return s if n is None or len(s) <= n else s[: n - 1].rstrip() + "…"


def frames_in(text):
    return sorted({int(x) for x in re.findall(r"(?<![A-Za-z0-9])f(\d{1,5})(?!\d)", str(text))})


def fmt_frames(fs, n=8):
    fs = sorted(set(fs))
    s = " ".join(f"f{x}" for x in fs[:n])
    return s + (" …" if len(fs) > n else "")


def find_up(start, rel):
    """start에서 위로 올라가며 start/../rel 이 있는 첫 자리(작업 폴더 기준 상대 경로를 푸는 데)."""
    d = os.path.abspath(start)
    while True:
        p = os.path.join(d, rel)
        if os.path.exists(p):
            return p
        up = os.path.dirname(d)
        if up == d:
            return None
        d = up


def load_critic(panel_dir, folder):
    if not folder:
        return {}
    # 패널 폴더 옆(판정마다 round<n>/로 옮겨 둔 배치)을 먼저, 그다음 작업 폴더 기준 상대 경로
    side = os.path.join(os.path.dirname(os.path.abspath(panel_dir)), os.path.basename(os.path.normpath(folder)))
    p = side if os.path.exists(os.path.join(side, "critic.json")) else (folder if os.path.isabs(folder) else find_up(panel_dir, folder))
    if not p:
        return {}
    try:
        with open(os.path.join(p, "critic.json"), encoding="utf-8") as f:
            j = json.load(f)
        return j if isinstance(j, dict) else {}
    except (OSError, ValueError):
        return {}


def critic_pairs(c):
    rows = c.get("pairs") or (c.get("pairing") or {}).get("rows") or []
    return rows if isinstance(rows, list) else []


def what_of(text, item):
    """'Q6 — 무엇 — 어떻게' 꼴에서 '무엇'만."""
    parts = [x.strip() for x in re.split(r"\s+—\s+", str(text)) if x.strip()]
    if parts and re.fullmatch(r"[QG]\d", parts[0]):
        parts = parts[1:]
    return parts[0] if parts else str(text)


# ---------------------------------------------------------------- init
def build_rows(P, panel_dir):
    critics = {c.get("letter"): load_critic(panel_dir, c.get("folder")) for c in P.get("critics", [])}
    rows, full = [], []
    for fc in P.get("fix_candidates", []):
        it = fc.get("item", "기타")
        by = fc.get("by", {})
        texts = [(k, t) for k, v in by.items() for t in (v if isinstance(v, list) else [v])]
        fs = set()
        for _, t in texts:
            fs.update(frames_in(t))
        if not fs:
            for c in critics.values():
                q = (c.get("quality") or {}).get(it) or {}
                fs.update(int(x) for x in (q.get("frames") or []) if str(x).isdigit())
        n = fc.get("n_critics", len(by))
        group = "2명" if n >= 2 else "1명"
        rows.append(dict(kind="fix", key=it, group=group,
                         항목=f"{it} {fc.get('name') or QNAME.get(it, '')} ({group})".replace("  ", " "),
                         지적=" / ".join(f"{k}: {cell(what_of(t, it), 90)}" for k, t in texts),
                         프레임=fmt_frames(fs)))
        full.append((rows[-1]["항목"], texts))
    have = {r["key"] for r in rows}
    for g, v in sorted(((P.get("gates") or {}).get("per_gate") or {}).items()):
        if v.get("result") is True or g in have:
            continue
        if v.get("result") is None and not any(x is not None for x in v.get("votes", [])):
            continue
        state = "불합격" if v.get("result") is False else "갈림"
        why = []
        for k, c in critics.items():
            gv = (c.get("gates") or {}).get(g) or {}
            if gv.get("pass") is False:
                why.append((k, gv.get("value", "")))
        fs = set()
        for _, t in why:
            fs.update(frames_in(t))
        rows.append(dict(kind="gate", key=g, group="관문", 항목=f"관문 {g} {state}",
                         지적=" / ".join(f"{k}: {cell(t, 90)}" for k, t in why) or cell(v.get("note")) or state,
                         프레임=fmt_frames(fs)))
        full.append((rows[-1]["항목"], why))
    for pr in (P.get("pairs") or {}).get("rows", []):
        if pr.get("final") != "못하다":
            continue
        sh = pr.get("shot")
        fs, why = set(), []
        for k, c in critics.items():
            for r in critic_pairs(c):
                if str(r.get("shot")) == str(sh):
                    if isinstance(r.get("frame"), int):
                        fs.add(r["frame"])
                    if r.get("verdict") == "못하다":
                        why.append((k, r.get("why", "")))
        key = f" ({pr['key']})" if pr.get("key") else ""
        rows.append(dict(kind="pair", key=f"샷{sh}", group="맞대기", 항목=f"맞대기 샷{sh} 못하다{key}",
                         지적=f"기준 {pr.get('storyboard_anchor') or (pr.get('anchors') or ['?'])[0]} — 다시 짬 + 키프레임 맞대기 판 필요",
                         프레임=fmt_frames(fs)))
        full.append((rows[-1]["항목"], why))
    for i, r in enumerate(rows, 1):
        r["번호"] = str(i)
        r.update({"고친 방법": "", "전 띠": "", "후 띠": "", "측정 전→후": "", "상태": TODO})
    return rows, full


def cmd_init(a):
    pj = panel_json(a.panel)
    if not os.path.exists(pj):
        sys.exit(f"panel.json이 없음: {pj}")
    with open(pj, encoding="utf-8") as f:
        P = json.load(f)
    rows, full = build_rows(P, os.path.dirname(pj))
    out = os.path.abspath(a.out)
    if os.path.exists(out) and not a.force:
        sys.exit(f"이미 있음: {a.out} (덮어쓰려면 --force)")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    m = re.search(r"fix_r(\d+)", out)
    rn = m.group(1) if m else "?"
    meta = dict(fix_gate=VERSION, panel=os.path.relpath(pj, os.path.dirname(out)), panel_sha256=sha256(pj),
                panel_mtime=round(os.path.getmtime(pj), 1), created=datetime.datetime.now().isoformat(timespec="seconds"))
    q = P.get("quality") or {}
    L = [f"# 고칠 것 — {rn}번째 고침 (앞 판정: {P.get('status', '?')}, 중앙값 평균 {q.get('mean_of_medians', '?')})",
         f"<!-- fix_gate {json.dumps(meta, ensure_ascii=False)} -->", "",
         "다시 판정받기 전에 줄마다 채우고 `fix_gate.py check`로 확인한다(끝 코드 0이어야 판정).",
         "- **고친 방법**: 무엇을 어떻게 바꿨는지(어느 부품·값·키프레임). 맞대기 '못하다' 줄은 `다시 짬` + 키프레임 맞대기 판 경로"
         "(`pair_board.py --frame <f> --type <유형>` 결과 `pair_f<f>__<id>.png`).",
         "- **전 띠 / 후 띠**: 같은 프레임 번호의 1프레임 간격 띠 그림 경로(작업 폴더 기준). "
         "`fix_gate.py strip <고치기 전 영상> --frame <f> --out review/fix_r<n>/f<f>_before.jpg`, 고친 뒤 영상으로 `_after.jpg`.",
         "- **측정 전→후**: 상한·관문에 걸린 값이면 다시 잰 값(예: `G3 0.62→0.95`, `Q2 제목:본문 1.05→2.3`). 잴 것이 없으면 `–`.",
         f"- **상태**: `{TODO}` → `{OK}` / `{CANT}: <사유>` / `{LATER}`(1명만 짚은 줄만).", "",
         "## 고칠 것", "",
         "| " + " | ".join(COLS) + " |", "|" + "---|" * len(COLS)]
    for r in rows:
        L.append("| " + " | ".join(cell(r[c]) for c in COLS) + " |")
    L += ["", "## 지적 원문", ""]
    for (head, texts), r in zip(full, rows):
        L.append(f"### {r['번호']}. {head}")
        for k, t in texts:
            L.append(f"- {k}: {cell(t)}")
        if not texts:
            L.append("- (원문 없음)")
        L.append("")
    with open(out, "w", encoding="utf-8") as f:
        f.write("\n".join(L))
    print(f"{a.out}: {len(rows)}줄 (2명 {sum(r['group'] == '2명' for r in rows)} · 1명 {sum(r['group'] == '1명' for r in rows)}"
          f" · 관문 {sum(r['kind'] == 'gate' for r in rows)} · 맞대기 못하다 {sum(r['kind'] == 'pair' for r in rows)})")


# ---------------------------------------------------------------- strip
def passthrough_args():
    try:
        v = subprocess.run(["ffmpeg", "-hide_banner", "-version"], capture_output=True, text=True).stdout
        m = re.search(r"ffmpeg version n?(\d+)\.(\d+)", v)
        if m and (int(m.group(1)), int(m.group(2))) < (5, 1):
            return ["-vsync", "0"]
    except OSError:
        sys.exit("ffmpeg가 없음")
    return ["-fps_mode", "passthrough"]


def cmd_strip(a):
    lo, hi = max(0, a.frame - a.span), a.frame + a.span
    n = hi - lo + 1
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    vf = f"select='between(n\\,{lo}\\,{hi})',scale={a.width}:-2,tile={n}x1:padding=4:color=white"
    cmd = ["ffmpeg", "-v", "error", "-y", "-threads", "2", "-i", a.video, "-vf", vf] + passthrough_args() + ["-frames:v", "1", a.out]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode or not os.path.exists(a.out):
        sys.exit("ffmpeg 실패: " + r.stderr.strip()[-400:])
    src = dict(fix_gate=VERSION, video=os.path.abspath(a.video), video_sha256=sha256(a.video),
               video_mtime=round(os.path.getmtime(a.video), 1), frame=a.frame, span=a.span,
               created=datetime.datetime.now().isoformat(timespec="seconds"))
    with open(a.out + ".json", "w", encoding="utf-8") as f:
        json.dump(src, f, ensure_ascii=False, indent=1)
    print(f"{a.out}: f{lo}~f{hi} ({n}장, 1프레임 간격, 폭 {a.width}px씩) · 출처 {os.path.basename(a.out)}.json(영상 sha256 {src['video_sha256'][:12]})")


# ---------------------------------------------------------------- check
def split_row(line):
    s = line.strip()
    if s.startswith("|"):
        s = s[1:]
    if s.endswith("|") and not s.endswith("\\|"):
        s = s[:-1]
    return [c.strip() for c in re.split(r"(?<!\\)\|", s)]


def read_table(md):
    rows, head = [], None
    for line in md.splitlines():
        if not line.strip().startswith("|"):
            if head is not None and rows:
                break
            continue
        cells = split_row(line)
        if head is None:
            if "번호" in cells and "상태" in cells:
                head = cells
            continue
        if all(re.fullmatch(r":?-{2,}:?", c) for c in cells if c):
            continue
        rows.append(dict(zip(head, cells + [""] * (len(head) - len(cells)))))
    return head, rows


def resolve(p, md_dir):
    p = p.strip().strip("`")
    if not p:
        return None
    if os.path.isabs(p):
        return p if os.path.exists(p) else None
    for base in (os.getcwd(), md_dir):
        q = os.path.join(base, p)
        if os.path.exists(q):
            return q
    return find_up(md_dir, p)


def paths_in(text):
    return [m.group(0) for m in PATH_RE.finditer(text or "")]


def strip_src(img):
    """strip이 띠 옆에 쓴 출처(<그림>.json) → dict, 없거나 못 읽으면 None."""
    try:
        with open(img + ".json", encoding="utf-8") as f:
            j = json.load(f)
        return j if isinstance(j, dict) and j.get("video_sha256") else None
    except (OSError, ValueError):
        return None


NUM = r"[-+−]?\d+(?:[.,]\d+)?"
MEAS_RE = re.compile(rf"({NUM})\s*(?:dB|px|배|x|%|프레임|f)?\s*(?:→|->|=>|⇒)\s*(?:약\s*|~\s*)?({NUM})")


def measure_pairs(text):
    """'G3 0.62→0.95, Q2 1.05→2.3' → [(0.62, 0.95), (1.05, 2.3)] (숫자 a→b 꼴만)."""
    out = []
    for m in MEAS_RE.finditer(str(text or "")):
        try:
            out.append(tuple(float(x.replace("−", "-").replace(",", ".")) for x in m.groups()))
        except ValueError:
            pass
    return out


def frame_of(path):
    m = re.search(r"(?<![A-Za-z0-9])f0*(\d{1,5})(?!\d)", os.path.basename(path))
    return int(m.group(1)) if m else None


def cmd_check(a):
    md_path = os.path.abspath(a.table)
    if not os.path.exists(md_path):
        print(f"표가 없음: {a.table} — 먼저 `fix_gate.py init <앞 panel 폴더> --out {a.table}`")
        return 1
    md_dir = os.path.dirname(md_path)
    md = open(md_path, encoding="utf-8").read()
    head, rows = read_table(md)
    miss, warn = [], []
    if not head:
        print("표(머리 줄에 '번호'·'상태')를 못 찾음")
        return 1
    for c in COLS:
        if c not in head:
            miss.append(f"표에 '{c}' 칸이 없음")
    m = re.search(r"<!--\s*fix_gate\s+(\{.*?\})\s*-->", md)
    meta = json.loads(m.group(1)) if m else {}
    panel_mtime, P = meta.get("panel_mtime"), None
    if meta.get("panel"):
        pj = os.path.normpath(os.path.join(md_dir, meta["panel"]))
        if os.path.exists(pj):
            with open(pj, encoding="utf-8") as f:
                P = json.load(f)
            if sha256(pj) != meta.get("panel_sha256"):
                warn.append("init 뒤 panel.json이 바뀜 — 같은 판정인지 확인")
        else:
            warn.append(f"앞 panel.json을 못 찾음({meta['panel']}) — 빠진 줄 대조를 건너뜀")
    else:
        warn.append("머리 주석(fix_gate)이 없음 — init으로 만든 표가 아니면 빠진 줄 대조를 건너뜀")
    # 앞 판정의 반드시 고칠 것이 표에 다 있는지
    if P is not None:
        want, _ = build_rows(P, os.path.dirname(pj))
        text_items = " ".join(r.get("항목", "") for r in rows)
        for w in want:
            if w["group"] == "1명":
                continue
            k = w["key"]
            pat = rf"(?<![A-Za-z0-9]){k}(?!\d)" if w["kind"] != "pair" else rf"맞대기\s*{k}(?!\d)"
            if not re.search(pat, text_items):
                miss.append(f"앞 판정의 '{w['항목']}' 줄이 표에서 빠짐")
    vid_sha = None
    if a.video:
        if not os.path.exists(a.video):
            miss.append(f"--video 영상이 없음: {a.video}")
        else:
            vid_sha = sha256(a.video)
            if panel_mtime and os.path.getmtime(a.video) < panel_mtime:
                miss.append(f"--video {a.video}가 앞 판정(panel.json)보다 먼저 렌더된 영상 — 고친 뒤 다시 렌더한다")
    n_ok = n_cant = n_later = 0
    for r in rows:
        no, item = r.get("번호", "?"), r.get("항목", "")
        tag = f"{no}. {cell(item, 40)}"
        how, st = r.get("고친 방법", "").strip(), r.get("상태", "").strip()
        one = "(1명)" in item
        is_pair = item.startswith("맞대기") or "못하다" in item
        if st.startswith(LATER):
            if one:
                n_later += 1
                continue
            miss.append(f"{tag}: '{LATER}'는 1명만 짚은 줄에만 쓸 수 있음")
            continue
        if st.startswith(CANT):
            why = re.sub(r"^못\s*고침\s*[:：(（-]?\s*", "", st).strip(" )）")
            if not why:
                miss.append(f"{tag}: '못 고침'에 사유가 없음(`못 고침: <사유>`)")
            else:
                n_cant += 1
            continue
        if st in (TODO, "") and not any(r.get(c, "").strip() for c in ("고친 방법", "전 띠", "후 띠", "측정 전→후")):
            miss.append(f"{tag}: 아직 손대지 않음(고친 방법·전 띠·후 띠·상태 모두 빈칸)" + (f" — 1명 줄이면 '{LATER}'로 둘 수 있음" if one else ""))
            continue
        if st != OK:
            miss.append(f"{tag}: 상태가 '{st or '빈칸'}' — '{OK}' 또는 '{CANT}: <사유>'")
        if not how or how in ("-", "–"):
            miss.append(f"{tag}: 고친 방법이 비어 있음")
        got = {}
        for col in ("전 띠", "후 띠"):
            ps = paths_in(r.get(col, ""))
            if not ps:
                miss.append(f"{tag}: {col} 그림 경로가 없음")
                continue
            real = [resolve(p, md_dir) for p in ps]
            for p, q in zip(ps, real):
                if not q:
                    miss.append(f"{tag}: {col} 파일이 없음 — {p}")
            got[col] = [q for q in real if q]
        if got.get("전 띠") and got.get("후 띠"):
            b, af = got["전 띠"][0], got["후 띠"][0]
            if os.path.abspath(b) == os.path.abspath(af):
                warn.append(f"{tag}: 전·후가 같은 파일(한 장에 함께 그렸다면 괜찮음)")
            elif sha256(b) == sha256(af):
                miss.append(f"{tag}: 전 띠와 후 띠가 똑같은 그림(바뀐 것이 없음)")
            fb, fa = frame_of(b), frame_of(af)
            if fb is not None and fa is not None and fb != fa:
                miss.append(f"{tag}: 전 띠(f{fb})와 후 띠(f{fa})의 프레임 번호가 다름 — 같은 프레임으로")
            if panel_mtime and os.path.getmtime(af) < panel_mtime:
                miss.append(f"{tag}: 후 띠가 앞 판정(panel.json)보다 먼저 만든 그림")
            # 확인 항목(v0.6.6): 후 띠가 새로 렌더한 영상에서 나왔는지 — strip이 남긴 출처(sha256)로
            if os.path.abspath(b) != os.path.abspath(af) and st == OK:
                sb, sa = strip_src(b), strip_src(af)
                if not sa:
                    miss.append(f"{tag}: 후 띠의 출처({os.path.basename(af)}.json)가 없음 — `fix_gate.py strip <고친 뒤 영상> --frame <f> --out …`로 다시 만든다")
                else:
                    if sb and sb["video_sha256"] == sa["video_sha256"]:
                        miss.append(f"{tag}: 전 띠와 후 띠가 같은 영상(sha256 {sa['video_sha256'][:12]})에서 나옴 — 고친 뒤 다시 렌더한 영상으로 후 띠를")
                    if panel_mtime and sa.get("video_mtime", 0) < panel_mtime:
                        miss.append(f"{tag}: 후 띠 영상이 앞 판정보다 먼저 렌더됨 — 고친 뒤 다시 렌더한 영상으로")
                    if vid_sha and sa["video_sha256"] != vid_sha:
                        miss.append(f"{tag}: 후 띠가 --video 영상이 아닌 다른 영상(sha256 {sa['video_sha256'][:12]})에서 나옴 — 판정받을 영상으로 다시 strip")
        if st == OK:
            mp = measure_pairs(r.get("측정 전→후", ""))
            if mp and all(abs(x - y) < 1e-9 for x, y in mp):
                miss.append(f"{tag}: 측정 전→후 값이 그대로({', '.join(f'{x:g}→{y:g}' for x, y in mp)}) — 바뀐 값을 다시 재서 적거나 상태를 고친다")
            elif mp and any(abs(x - y) < 1e-9 for x, y in mp):
                warn.append(f"{tag}: 측정 전→후 가운데 그대로인 값이 있음({', '.join(f'{x:g}→{y:g}' for x, y in mp if abs(x - y) < 1e-9)})")
        if is_pair:
            if "다시 짬" not in how and "다시짬" not in how:
                miss.append(f"{tag}: 맞대기 '못하다' 샷은 손질이 아니라 다시 짠다 — 고친 방법에 '다시 짬'")
            boards = [p for col in COLS for p in paths_in(r.get(col, "")) if PAIR_RE.search(os.path.basename(p))]
            okb = [p for p in boards if resolve(p, md_dir)]
            if not okb:
                miss.append(f"{tag}: 키프레임 맞대기 판(pair_board.py 결과 pair_f<f>__<id>.png) 경로가 없거나 파일이 없음")
            elif panel_mtime and all(os.path.getmtime(resolve(p, md_dir)) < panel_mtime for p in okb):
                miss.append(f"{tag}: 맞대기 판이 앞 판정보다 먼저 만든 그림 — 다시 짠 키프레임으로 새로")
        if st == OK and not r.get("측정 전→후", "").strip():
            warn.append(f"{tag}: 측정 전→후가 빈칸(잴 것이 없으면 '–')")
        if st == OK:
            n_ok += 1
    if not rows:
        miss.append("표에 줄이 없음")
    mins = None
    if panel_mtime:
        mins = (time.time() - panel_mtime) / 60
        if a.min_minutes and mins < a.min_minutes:
            miss.append(f"앞 판정 뒤 {mins:.0f}분 — 고침에 최소 {a.min_minutes:g}분(--min-minutes)")
    print(f"{a.table}: {len(rows)}줄 — 확인됨 {n_ok} · 못 고침 {n_cant} · 미룸 {n_later}"
          + (f" · 앞 판정 뒤 {mins:.0f}분" if mins is not None else ""))
    for w in warn:
        print("  참고:", w)
    if miss:
        print(f"아직 다시 판정받지 않는다 — 빠진 것 {len(miss)}개:")
        for x in miss:
            print("  -", x)
        return 1
    print("통과: 다시 판정받아도 된다")
    return 0


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("init", help="앞 판정 panel 폴더 → 고칠 것 표")
    p.add_argument("panel", help="앞 판정 패널 폴더(panel.json) 또는 panel.json")
    p.add_argument("--out", required=True, help="review/fix_r<n>/고칠것.md")
    p.add_argument("--force", action="store_true", help="이미 있으면 덮어씀")
    p = sub.add_parser("strip", help="한 프레임 앞뒤 1프레임 간격 띠")
    p.add_argument("video")
    p.add_argument("--frame", type=int, required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--span", type=int, default=3, help="앞뒤 몇 프레임(기본 3 → 7장)")
    p.add_argument("--width", type=int, default=360, help="한 장 폭 px(기본 360)")
    p = sub.add_parser("check", help="고칠 것 표 확인(끝 코드 0 = 다시 판정 가능)")
    p.add_argument("table")
    p.add_argument("--video", help="다시 판정받을 영상(예: out/final.mp4) — 후 띠가 모두 이 영상에서 나왔는지 본다(sha256)")
    p.add_argument("--min-minutes", type=float, default=0, help="(예전 시간 조건) 앞 판정(panel.json) 뒤 지난 시간 최소(분, 기본 0 = 보지 않음). "
                   "v0.6.6부터 확인 항목(후 띠 출처·--video·측정 전→후)이 이 일을 한다")
    a = ap.parse_args()
    if a.cmd == "init":
        cmd_init(a)
    elif a.cmd == "strip":
        cmd_strip(a)
    else:
        sys.exit(cmd_check(a))


if __name__ == "__main__":
    main()
