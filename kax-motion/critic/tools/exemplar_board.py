"""kax-motion 비평 채점 예시(critic/critic.md 채점 예시) 만들기.

사용: python3 -I critic/tools/exemplar_board.py [--spec <채점 예시 표 exemplars.json>] [--only <id>[,<id>...]]
  기본 자리: 스킬 뿌리 kax_paths.json의 exemplars_spec(표)·exemplars(판 그림 폴더) — 공개 기본은 작업 폴더 review/refs/exemplars/.
  표 안의 상대 경로(sources·shots·video)도 같은 기준(base)으로 읽는다.
  exemplars.json의 예시마다
    - sources(비평 폴더들)를 panel.py와 같은 읽기로 읽어 항목별 점수(여러 명 = 중앙값, 한 명 = 그 점수 + one_critic)를 채우고
    - storyboard shots.json의 key 프레임을 샷마다 한 장씩 가로로 놓고, 아래에 항목 점수 줄과 공통 지적(common_notes)을 적은 판
      <판 그림 폴더>/<id>.png 을 그린다.
  공통 지적(common_notes)은 사람이 critic.md를 읽고 적는다(2명 이상이 짚은 것만, 한 명 채점이면 그 한 명의 주요 지적).
새 예시 더하기: exemplars.json의 exemplars에 id·title·video·shots·sources·common_notes를 적고 이 스크립트를 다시 돌린다.
판에는 영상 프레임이 그대로 들어가니 작업 폴더 안의 기록으로만 쓴다.
"""
import argparse
import json
import os
import statistics
import sys

os.environ.setdefault("OMP_NUM_THREADS", "2")
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))  # 스킬 뿌리
KAX_PATHS_PUBLIC = {"base": "cwd", "exemplars": "review/refs/exemplars", "exemplars_spec": "review/refs/exemplars/exemplars.json"}
sys.path.insert(0, HERE)
import panel as P  # noqa: E402
from measure_motion import Video, font  # noqa: E402
from PIL import Image, ImageDraw  # noqa: E402

QS = P.QS


def kax_table(key):
    """스킬 뿌리 kax_paths.json(도구 기본 경로 표) → (표, 기준 폴더). 파일이나 key 칸이 없으면 공개 값(도구를 돌린 폴더 기준)."""
    try:
        with open(os.path.join(REPO, "kax_paths.json"), encoding="utf-8") as f:
            t = json.load(f)
    except (OSError, ValueError):
        t = {}
    if not isinstance(t, dict) or key not in t:
        t = KAX_PATHS_PUBLIC
    return t, (REPO if t.get("base") == "skill" else os.getcwd())


def kax_path(key):
    t, base = kax_table(key)
    return os.path.normpath(os.path.join(base, os.path.expanduser(t[key])))


BASE = kax_table("exemplars_spec")[1]  # 표 안 상대 경로의 기준


def rp(p):
    return p if os.path.isabs(p) else os.path.join(BASE, p)


def fill_scores(ex):
    C = [P.load_critic(rp(s)) for s in ex["sources"]]
    info = P.shots_info(rp(ex["shots"]))
    per = {q: [c["quality"][q]["eff"] for c in C] for q in QS}
    sc = {q: statistics.median(per[q]) for q in QS}
    ex["n_critics"] = len(C)
    ex["one_critic"] = len(C) == 1
    ex["score_basis"] = "한 명" if len(C) == 1 else f"{len(C)}명 중앙값"
    ex["scores"] = {q: (int(v) if float(v).is_integer() else v) for q, v in sc.items()}
    ex["per_critic"] = {q: [int(x) if x is not None and float(x).is_integer() else x for x in per[q]] for q in QS}
    ex["mean"] = round(sum(sc.values()) / 8, 3)
    if len(C) >= 2:
        R = P.panel(C, info)
        ex["gates"] = {g: R["gates"]["per_gate"][g]["result"] for g in P.GS}
        ex["pairs"] = {r["shot"]: r["final"] for r in R["pairs"]["rows"]}
        ex["pairs_same_or_better"] = R["pairs"]["same_or_better"]
        ex["verdict"] = R["status"]
        ex["verdict_reasons"] = R["reasons"]
    else:
        c = C[0]
        own = P.single_verdict(c, P.key_shots(info, C))
        ex["gates"] = c["gates"]
        ex["pairs"] = {p["shot"]: p["verdict"] for p in c["pairs"]}
        ex["pairs_same_or_better"] = own["same_or_better"]
        ex["verdict"] = "통과" if own["passed"] else "불통과"
        ex["verdict_reasons"] = own["reasons"]
    ex["signature_shots"] = (info or {}).get("signature") or sorted({s for c in C for s in c["signature_shots"]})
    return ex


def draw(ex, out_png):
    import json as _j
    S = _j.load(open(rp(ex["shots"]), encoding="utf-8"))
    shots = S["shots"] if isinstance(S, dict) else S
    V = Video(rp(ex["video"]))
    keys = [(s.get("no"), int(s.get("key", s["f0"]))) for s in shots]
    fr = V.frames([k for _, k in keys], w=640)
    n = len(keys)
    per_row = 7
    TW = 320
    TH = int(round(TW * V.H / V.W))
    PAD, LAB = 10, 24
    rows = (n + per_row - 1) // per_row
    W = PAD + min(n, per_row) * (TW + PAD)
    W = max(W, 1500)
    F, FB, FS = font(17), font(22), font(15)
    text_h = 40 + 30 + 30 + 28 * len(ex.get("common_notes", [])) + 20
    H = PAD + 36 + rows * (TH + LAB + PAD) + text_h
    im = Image.new("RGB", (W, H), (246, 244, 239))
    d = ImageDraw.Draw(im)
    d.text((PAD, 8), f"{ex['title']}  ·  {ex['score_basis']}  ·  {ex['verdict']}", fill=(20, 20, 20), font=FB)
    sig = set(ex.get("signature_shots") or [])
    for i, (no, k) in enumerate(keys):
        r, c = divmod(i, per_row)
        x, y = PAD + c * (TW + PAD), PAD + 36 + r * (TH + LAB + PAD)
        if k in fr:
            im.paste(Image.fromarray(fr[k]).resize((TW, TH), Image.LANCZOS), (x, y + LAB))
        v = ex["pairs"].get(no) or ex["pairs"].get(str(no)) or ""
        col = (200, 40, 40) if v == "못하다" else (40, 40, 40)
        d.text((x + 2, y + 3), f"샷{no}{' ★' if no in sig else ''}  f{k}  {v}", fill=col, font=FS)
    y = PAD + 36 + rows * (TH + LAB + PAD) + 6
    parts = []
    for q in QS:
        s = ex["scores"][q]
        spread = ex["per_critic"][q]
        parts.append(f"{q} {P.QNAME[q]} {s:g}" + (f"({'/'.join(f'{x:g}' for x in spread)})" if len(spread) > 1 and len(set(spread)) > 1 else ""))
    line1 = "   ".join(parts[:4])
    line2 = "   ".join(parts[4:]) + f"     평균 {ex['mean']:g}   맞대기 같다 이상 {ex['pairs_same_or_better']}"
    d.text((PAD, y), line1, fill=(20, 20, 20), font=F)
    d.text((PAD, y + 28), line2, fill=(20, 20, 20), font=F)
    gf = [g for g, v in ex["gates"].items() if v is False]
    d.text((PAD, y + 58), ("관문 불합격: " + ", ".join(gf)) if gf else "관문 모두 합격", fill=(200, 40, 40) if gf else (40, 120, 60), font=FS)
    yy = y + 84
    head = "공통 지적(2명 이상)" if not ex["one_critic"] else "주요 지적(한 명)"
    for t in ex.get("common_notes", []):
        d.text((PAD, yy), f"· {head}: {t}" if t is ex["common_notes"][0] else f"· {t}", fill=(60, 60, 60), font=FS)
        yy += 28
    im = im.crop((0, 0, W, min(H, yy + 10)))
    os.makedirs(os.path.dirname(out_png), exist_ok=True)
    im.save(out_png, optimize=True)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--spec", default=kax_path("exemplars_spec"), help="채점 예시 표(기본: kax_paths.json exemplars_spec)")
    ap.add_argument("--only", help="이 예시만 다시(쉼표로 여러 개)")
    a = ap.parse_args()
    J = json.load(open(a.spec, encoding="utf-8"))
    only = {x.strip() for x in a.only.split(",") if x.strip()} if a.only else None
    unknown = sorted(only - {ex["id"] for ex in J["exemplars"]}) if only else []
    if unknown:
        sys.exit(f"exemplars.json에 없는 id: {', '.join(unknown)}")
    for ex in J["exemplars"]:
        if only and ex["id"] not in only:
            continue
        fill_scores(ex)
        board = os.path.join(kax_path("exemplars"), ex["id"] + ".png")
        ex["board"] = os.path.relpath(board, BASE)
        draw(ex, board)
        print(ex["id"], ex["score_basis"], ex["scores"], ex["mean"], ex["verdict"], file=sys.stderr)
    json.dump(J, open(a.spec, "w", encoding="utf-8"), ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
