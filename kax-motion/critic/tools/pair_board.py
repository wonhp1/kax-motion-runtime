"""맞대기 판: 결과 영상의 지정 프레임과 기준 그림을 같은 높이로 나란히 붙인다 (critic/critic.md 맞대기).
기준 그림 폴더 = --anchors, 없으면 스킬 뿌리 kax_paths.json의 refs(공개 기본: 작업 폴더 review/refs/ — get_critic_refs로 받은
그림 <id>.webp·.png와 anchors.json {types: {유형: {desc, count}}, anchors: [{id, type, type_desc, q, why, motion, file}]}).

사용:
  python3 -I critic/tools/pair_board.py <video.mp4> --out review/pairs \
      --pair 120=<기준 그림 id> --pair 300=<기준 그림 id> [--shots storyboard/shots.json] [--phone]
  python3 -I critic/tools/pair_board.py <video.mp4> --out review/pairs --frame 120 --type chat_input   # 그 유형 기준 그림 전부와
  python3 -I critic/tools/pair_board.py --list                                                          # 기준 그림 id·유형 목록
결과: <out>/pair_f0120__<기준 그림 id>.png … (+ --sheet 이면 <out>/pairs_sheet.png 한 장)
--phone: 아래에 두 그림을 폭 360px(폰)으로 줄인 줄을 덧붙인다(가독성 맞대기).
--scale: (R11 짝의 화면 크기) 두 그림에 화면 높이 15%·40% 안내선(주인공 가운데 기준 점선)을 긋고, 주인공 높이(추정)·단계
  (close ≥40% / medium 15~40% / wide <15%)를 적는다. 두 단계가 다르면 판 아래와 화면 출력에 '단계 다름'. 값은 <out>/scale.json.
  주인공 = measure_motion.py content_boxes(--margins와 같은 내용 상자) 중 상자 넓이가 가장 큰 것 — 추정이다(한계는 README).
판정(낫다/같다/못하다)은 비평가가 한다. 이 도구는 그림만 만든다.
"""
import argparse
import io
import json
import os
import re
import subprocess
import sys

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
SKILL = os.path.dirname(os.path.dirname(HERE))  # 스킬 뿌리
KAX_PATHS_PUBLIC = {"base": "cwd", "refs": "review/refs"}  # kax_paths.json이 없을 때(공개 값)


def kax_paths():
    """스킬 뿌리 kax_paths.json(도구 기본 경로 표). 없거나 못 읽으면 {}."""
    try:
        with open(os.path.join(SKILL, "kax_paths.json"), encoding="utf-8") as f:
            t = json.load(f)
    except (OSError, ValueError):
        return {}
    return t if isinstance(t, dict) else {}


def kax_path(key):
    """kax_paths.json의 key 경로(base: skill = 스킬 뿌리 기준, cwd = 도구를 돌린 폴더 기준). 파일·칸이 없으면 공개 값."""
    t = kax_paths()
    if key not in t:
        t = KAX_PATHS_PUBLIC
    base = SKILL if t.get("base") == "skill" else os.getcwd()
    return os.path.normpath(os.path.join(base, os.path.expanduser(t[key])))


ANCH = kax_path("refs")
LABEL_FONTS = kax_paths().get("label_fonts") or [os.path.join(SKILL, "fonts", "PretendardVariable.ttf"),
                                                 "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"]
DEC = "scale=in_range=tv:in_color_matrix=bt709:flags=accurate_rnd+full_chroma_int+bitexact"
SCALE_GUIDES = ((0.15, (0, 190, 255), "15%"), (0.40, (255, 60, 200), "40%"))   # R11(짝의 화면 크기) 단계 경계(화면 높이 비)
SCALE_MW = 480   # 주인공 상자 작업 폭 = measure_motion --margins와 같음


_PASS = []


def passthrough_args():
    """예전 -vsync 0. FFmpeg 5.1부터 -fps_mode passthrough, 새 컴퓨터 FFmpeg 9.0.2에는 -vsync가 없다(measure_motion과 같은 처리)."""
    if not _PASS:
        args = ["-fps_mode", "passthrough"]
        try:
            v = subprocess.run(["ffmpeg", "-hide_banner", "-version"], capture_output=True, text=True).stdout
            m = re.search(r"ffmpeg version n?(\d+)\.(\d+)", v)
            if m and (int(m.group(1)), int(m.group(2))) < (5, 1):
                args = ["-vsync", "0"]
        except OSError:
            pass
        _PASS.extend(args)
    return list(_PASS)


def font(size):
    for p in LABEL_FONTS:  # 판 글자 서체(kax_paths.json label_fonts, 없으면 스킬 fonts/의 한글 서체)
        try:
            return ImageFont.truetype(p, size)
        except OSError:
            pass
    return ImageFont.load_default()


def grab(video, f):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-threads", "2", "-i", video, "-vf", f"{DEC},select='eq(n\\,{f})'", *passthrough_args(),
                          "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "-"], capture_output=True, check=True).stdout
    if not raw:
        sys.exit(f"프레임 {f}을 못 읽음(영상 길이 확인)")
    return Image.open(io.BytesIO(raw)).convert("RGB")


def fps_of(video):
    r = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=r_frame_rate", "-of", "csv=p=0", video],
                       capture_output=True, text=True, check=True).stdout.strip()
    a, b = r.split("/")
    return float(a) / float(b)


def wrap(d, text, F, width):
    lines, cur = [], ""
    for ch in text:
        if d.textlength(cur + ch, font=F) > width:
            lines.append(cur)
            cur = ch
        else:
            cur += ch
    return lines + [cur] if cur else lines


def stage_of(p):
    """R11(짝의 화면 크기) 단계: close ≥ 40% / medium 15~40% / wide < 15% (주인공 높이 ÷ 화면 높이)"""
    return None if p is None else ("close" if p >= 0.40 else ("medium" if p >= 0.15 else "wide"))


def scale_estimate(im):
    """(R11 짝의 화면 크기) 주인공 높이 추정. 폭 480으로 줄인 그림에 measure_motion.content_boxes(--margins와 같은 바탕 추정·RGB 차 40)를 돌려
    내용 상자 중 상자 넓이가 가장 큰 것을 주인공으로 본다. content_boxes가 '화면 폭·높이 85% 넘음'(span)으로 뺀 덩어리도
    화면 전체를 덮는 판(폭·높이 모두 95% 이상)·가는 선(짧은 쪽이 짧은 변 4% 미만)·성긴 격자/윤곽(채움 5% 미만)이 아니면 후보에 넣는다
    (화면을 넘치는 큰 글자·도넛 같은 클로즈업 주인공). 상자끼리 겹치면 한 물체로 합친다.
    돌려줌: pct(높이 ÷ 화면 높이), stage, box(원본 px), src, candidates(상위 3)"""
    import numpy as np
    if HERE not in sys.path:
        sys.path.insert(0, HERE)
    from measure_motion import content_boxes
    h = max(1, round(im.height * SCALE_MW / im.width))
    rgb = np.asarray(im.convert("RGB").resize((SCALE_MW, h), Image.BOX))
    kept, excl = content_boxes(rgb)
    S = min(SCALE_MW, h)
    cand = [list(b[:5]) + ["kept"] for b in kept]
    for b in excl:
        if b[5] != "span":
            continue
        w_, h_ = b[2] - b[0], b[3] - b[1]
        if (w_ >= 0.95 * SCALE_MW and h_ >= 0.95 * h) or min(w_, h_) < 0.04 * S or b[4] / max(1, w_ * h_) < 0.05:
            continue
        cand.append(list(b[:5]) + ["span"])
    # 상자끼리 겹치면 한 물체로 합친다(케이스 + 이어폰처럼 하이라이트·그림자로 갈라진 한 물체). 띄어 있으면 합치지 않는다
    merged = True
    while merged:
        merged, out = False, []
        while cand:
            a = cand.pop()
            i = 0
            while i < len(cand):
                c = cand[i]
                if a[0] < c[2] and c[0] < a[2] and a[1] < c[3] and c[1] < a[3]:
                    a = [min(a[0], c[0]), min(a[1], c[1]), max(a[2], c[2]), max(a[3], c[3]), a[4] + c[4],
                         "span" if "span" in (a[5], c[5]) else "kept"]
                    cand.pop(i)
                    merged = True
                else:
                    i += 1
            out.append(a)
        cand = out
    cand.sort(key=lambda b: ((b[2] - b[0]) * (b[3] - b[1]), b[4]), reverse=True)
    k = im.width / SCALE_MW

    def row(b):
        p = round((b[3] - b[1]) / h, 3)   # 단계는 반올림한 값으로(적힌 숫자와 단계가 어긋나지 않게)
        return dict(pct=p, stage=stage_of(p), box=[round(v * k) for v in b[:4]],
                    src="화면을 넘는 덩어리(span)" if b[5] == "span" else "내용 상자")
    if not cand:
        return dict(pct=None, stage=None, box=None, src=None, n_boxes=0, candidates=[], note="내용 상자 없음(빈 화면이거나 바탕과 색 차가 작음)")
    top = row(cand[0])
    return dict(**top, n_boxes=len(cand), candidates=[row(b) for b in cand[:3]])


def draw_scale(im, est):
    """그림 사본에 15%·40% 안내선(주인공 가운데 높이 기준 점선, 화면 폭 전체)과 주인공 상자·라벨을 그린다."""
    im = im.copy()
    d = ImageDraw.Draw(im)
    W, H = im.size
    lw = max(1, round(H / 360))
    dash = max(6, round(H / 60))
    F = font(max(14, round(H / 26)))
    cy = (est["box"][1] + est["box"][3]) / 2 if est.get("box") else H / 2
    for frac, col, lab in SCALE_GUIDES:
        for y in (cy - frac * H / 2, cy + frac * H / 2):
            if 0 <= y < H:
                for x in range(0, W, 2 * dash):
                    d.line([x, y, x + dash, y], fill=col, width=lw)
        y_top = max(0, cy - frac * H / 2)
        d.text((W - d.textlength(lab, font=F) - 6, y_top + 2), lab, fill=col, font=F, stroke_width=max(1, lw), stroke_fill=(0, 0, 0))
    if est.get("box"):
        b = est["box"]
        d.rectangle(b, outline=(255, 205, 0), width=2 * lw + 1)
        lab = f"주인공(추정) {est['pct'] * 100:.1f}% · {est['stage']}"
        ty = b[3] + 4 if b[3] + 4 + F.size + 4 < H else max(0, b[1] - F.size - 8)
        d.text((max(0, b[0]), ty), lab, fill=(255, 205, 0), font=F, stroke_width=max(1, lw), stroke_fill=(0, 0, 0))
    return im


def board(left, right, ltxt, rtxt, H=540, phone=False, note=None, phone_src=None):
    def fit(im):
        return im.resize((round(im.width * H / im.height), H), Image.LANCZOS)
    L, R = fit(left), fit(right)
    P, F, Fs = 16, font(20), font(16)
    W = P + L.width + P + R.width + P
    tmp = ImageDraw.Draw(Image.new("RGB", (10, 10)))
    lt = [ltxt[0]] + wrap(tmp, ltxt[1], Fs, L.width)
    rt = [rtxt[0]] + wrap(tmp, rtxt[1], Fs, R.width)
    TH = 10 + 26 + 20 * (max(len(lt), len(rt)) - 1) + 8
    PH = 0
    if phone:
        pl_, pr_ = phone_src or (left, right)   # (--scale) 폰 사본은 안내선 없는 원본으로
        pl = pl_.resize((360, round(360 * pl_.height / pl_.width)), Image.LANCZOS)
        pr = pr_.resize((360, round(360 * pr_.height / pr_.width)), Image.LANCZOS)
        PH = 30 + max(pl.height, pr.height) + P
    NH = 0
    if note:   # (--scale) 판 아래 한 줄: 단계 비교. note = (글, 빨강 여부)
        nl = wrap(tmp, note[0], F, W - 2 * P)
        NH = 10 + 26 * len(nl) + 8
    im = Image.new("RGB", (W, TH + H + P + PH + NH), (22, 22, 24))
    d = ImageDraw.Draw(im)
    for x, txt in ((P, lt), (P + L.width + P, rt)):
        d.text((x, 10), txt[0], fill=(255, 220, 120), font=F)
        for k, t in enumerate(txt[1:]):
            d.text((x, 38 + 20 * k), t, fill=(215, 215, 215), font=Fs)
    im.paste(L, (P, TH))
    im.paste(R, (P + L.width + P, TH))
    if phone:
        y = TH + H + P
        d.text((P, y), "폰 폭 360px 사본 (왼쪽 결과 · 오른쪽 기준)", fill=(200, 200, 200), font=Fs)
        im.paste(pl, (P, y + 26))
        im.paste(pr, (P + 360 + P, y + 26))
    if note:
        y = TH + H + P + PH
        if note[1]:
            d.rectangle([0, y, W, y + NH], fill=(120, 20, 20))
        for k, t in enumerate(nl):
            d.text((P, y + 10 + 26 * k), t, fill=(255, 255, 255) if note[1] else (200, 230, 200), font=F)
    return im


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("video", nargs="?")
    ap.add_argument("--out")
    ap.add_argument("--pair", action="append", default=[], help="프레임=기준그림id (여러 번)")
    ap.add_argument("--frame", type=int, help="--type 과 함께: 이 프레임을 그 유형 기준 그림 전부와")
    ap.add_argument("--type", help="anchors.json 의 type")
    ap.add_argument("--shots", help="storyboard/shots.json (라벨에 샷 번호·크기)")
    ap.add_argument("--anchors", default=ANCH, help=f"기준 그림 폴더(기본 {ANCH})")
    ap.add_argument("--height", type=int, default=540)
    ap.add_argument("--phone", action="store_true")
    ap.add_argument("--sheet", action="store_true", help="모든 판을 세로로 이은 pairs_sheet.png도")
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--scale", action="store_true", help="(R11 짝의 화면 크기) 15%%·40%% 안내선 + 주인공 높이(추정)·단계, 다르면 '단계 다름'. <out>/scale.json")   # argparse는 도움말에 % 서식을 써서 %%로(%만 쓰면 --help가 죽음)
    a = ap.parse_args()
    meta = json.load(open(os.path.join(a.anchors, "anchors.json"), encoding="utf-8"))
    A = {x["id"]: x for x in meta["anchors"]}
    if a.list:
        for t, v in meta["types"].items():
            print(f"[{t}] {v['desc']} ({v['count']})")
            for x in meta["anchors"]:
                if x["type"] == t:
                    print(f"   {x['id']}  {','.join(x['q'])}  {x['why']}")
        return
    if not a.video or not a.out:
        ap.error("video 와 --out 필요")
    pairs = []
    for p in a.pair:
        f, aid = p.split("=", 1)
        pairs.append((int(f), aid.strip()))
    if a.frame is not None and a.type:
        pairs += [(a.frame, x["id"]) for x in meta["anchors"] if x["type"] == a.type]
    if not pairs:
        ap.error("--pair 또는 --frame+--type")
    for _, aid in pairs:
        if aid not in A:
            sys.exit(f"기준 그림 id 없음: {aid} (--list 로 확인)")
    shots = []
    if a.shots:
        j = json.load(open(a.shots, encoding="utf-8"))
        shots = j["shots"] if isinstance(j, dict) else j
    fps = fps_of(a.video)
    os.makedirs(a.out, exist_ok=True)
    made, cache, scale_rows, est_cache = [], {}, [], {}
    for f, aid in pairs:
        if f not in cache:
            cache[f] = grab(a.video, f)
        s = next((x for x in shots if int(x["f0"]) <= f <= int(x["f1"])), None)
        lhead = f"결과 f{f} · {f / fps:.2f}s" + (f" · 샷{s['no']}" if s else "")
        lsub = (f"{s.get('size', '')} — {str(s.get('action', ''))[:90]}" if s else "")
        x = A[aid]
        rhead = f"기준 {aid}"
        rsub = f"{x['type_desc']} · {'/'.join(x['q'])} · {x['why']} · 움직임: {x['motion']}"
        left, right = cache[f], Image.open(os.path.join(a.anchors, x["file"])).convert("RGB")
        note, phone_src = None, None
        if a.scale:
            if f not in est_cache:
                est_cache[f] = scale_estimate(left)
            if aid not in est_cache:
                est_cache[aid] = scale_estimate(right)
            el, er = est_cache[f], est_cache[aid]
            phone_src = (left, right)
            left, right = draw_scale(left, el), draw_scale(right, er)

            def pc(e):
                return "없음" if e["pct"] is None else f"{e['pct'] * 100:.1f}% {e['stage']}"
            if el["stage"] is None or er["stage"] is None:
                same, verdict, ratio = None, "판단 못 함(주인공 상자 없음)", None
            else:
                same = el["stage"] == er["stage"]
                verdict = "단계 같음" if same else "단계 다름"
                ratio = round(el["pct"] / er["pct"], 2) if er["pct"] else None
            lsub = f"주인공 높이(추정) {pc(el)} · " + lsub
            rsub = f"주인공 높이(추정) {pc(er)} · " + rsub
            note = (f"{verdict}: 결과 {pc(el)} ↔ 기준 {pc(er)}" + (f" · 높이 비(결과÷기준) {ratio:.2f}" if ratio is not None else "")
                    + "  (추정 — 주인공 = 가장 큰 내용 상자. 노란 상자가 주인공이 아니면 점선(15%·40%)으로 눈으로 본다)", same is False)
            scale_rows.append(dict(frame=f, shot=s.get("no") if s else None, anchor=aid, result=el, anchor_est=er,
                                   same_stage=same, verdict=verdict, height_ratio=ratio))
        im = board(left, right, (lhead, lsub), (rhead, rsub), H=a.height, phone=a.phone, note=note, phone_src=phone_src)
        path = os.path.join(a.out, f"pair_f{f:04d}__{aid}.png")
        im.save(path)
        made.append(path)
        print(path)
        if a.scale:
            r = scale_rows[-1]
            print(f"  {r['verdict']}: 결과 {pc(r['result'])} ↔ 기준 {pc(r['anchor_est'])}"
                  + (f", 높이 비 {r['height_ratio']:.2f}" if r["height_ratio"] is not None else "") + " (추정)")
    if a.scale and scale_rows:
        json.dump(dict(rule="v0.6 R11: 주인공 높이 ÷ 화면 높이 → close ≥ 0.40 / medium 0.15~0.40 / wide < 0.15. 짝과 같은 단계로 만든다",
                       method="measure_motion.content_boxes(폭 480, 바탕과 RGB 차 40 넘는 덩어리) 중 상자 넓이가 가장 큰 것. "
                              "화면 폭·높이 85% 넘는 덩어리도 화면 전체 판·가는 선·성긴 격자가 아니면 후보, 겹친 상자는 한 물체로 합침. box는 원본 px",
                       limits="추정이다: 바탕과 색 차가 작은 판(밝은 바탕 위 흰 입력창·카드)은 상자로 안 잡혀 커서·아이콘 같은 작은 물체가 주인공이 될 수 있고, "
                              "글자는 낱자(이어진 덩어리)마다 상자라 글자 화면은 글자 높이를 잰다. 노란 상자가 주인공이 아니면 점선으로 눈으로 본다",
                       height_ratio_note="height_ratio = 결과 주인공 높이 ÷ 기준 주인공 높이(참고, 단계 경계 근처를 볼 때)",
                       pairs=scale_rows), open(os.path.join(a.out, "scale.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        print(os.path.join(a.out, "scale.json"))
    if a.sheet and made:
        ims = [Image.open(p) for p in made]
        W = max(i.width for i in ims)
        sh = Image.new("RGB", (W, sum(i.height for i in ims)), (22, 22, 24))
        y = 0
        for i in ims:
            sh.paste(i, (0, y))
            y += i.height
        sh.save(os.path.join(a.out, "pairs_sheet.png"))
        print(os.path.join(a.out, "pairs_sheet.png"))


if __name__ == "__main__":
    main()
