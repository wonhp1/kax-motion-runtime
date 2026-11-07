#!/usr/bin/env python3
"""KAX MCP로 받은 파일을 작업 폴더에 놓는다(명세 v0.3 — 부품·예시·비평 목록 파일은 blob 리소스로 온다).

  python3 -I <이 스킬>/scripts/mcp_files.py place <<'EOF'      # 리소스 줄을 붙여 넣으면 저장된 파일을 제자리로 복사·확인
  [Resource from kax at kax://work/components/ui/calendar_week/calendar_week.js] Binary content (text/javascript, 20314 bytes) saved to <저장된 파일>
  EOF
  python3 -I <이 스킬>/scripts/mcp_files.py place --sha256 example/meta.json=<64자> "<리소스 줄>" ...
  python3 -I <이 스킬>/scripts/mcp_files.py refs [review/refs]   # get_critic_refs 목록 조각을 합쳐 비평 도구가 읽는 목록 둘을 씀

place — get_component·get_example·get_critic_refs 결과의 리소스 한 줄(Claude Code가 보여 주는 꼴)
    [Resource from <서버> at kax://work/<path>] Binary content (<mimeType>, <크기>) saved to <저장된 파일>
  마다 <저장된 파일>을 작업 폴더(--root, 기본 지금 폴더)의 <path>로 복사하고 크기를 맞춘다(<크기> = 1KB 아래는 '842 bytes'처럼
  바이트 그대로, 그 위는 '10.8KB'처럼 1024 단위 소수 한 자리 — 반올림 안에서 맞춘다). 줄은 인자나 stdin으로 준다(줄이 붙어 와도 읽는다). 클라이언트가 다른 꼴로 보여 주면 --pair <저장된 파일>=<path>. --sha256 <path>=<값>(structuredContent.files[].sha256)을 주면
  그 값과도 맞춘다. 끝에 path·bytes·sha256 표를 찍는다 — files[]의 sha256과 같은지 본다.
refs — 작업 폴더 review/refs/parts/의 목록 조각(get_critic_refs 리소스 anchors-<키>.json·exemplars-<키>.json, 나눠 받은 것 모두)을 합쳐
    review/refs/anchors.json        = {"types": {유형: {desc, count}}, "anchors": [{id, type, type_desc, …, motion, file}]}
    review/refs/exemplars/exemplars.json = {"exemplars": [{받은 칸 그대로, board: "<id>.png" 또는 null}]}
  을 쓴다(같은 id는 하나). 조각의 images로 그림을 확인한다: 기준 그림 review/refs/<id>.webp, 채점 판 review/refs/exemplars/<id>.webp
  (받은 webp를 그대로 복사해 두면 PNG로 바꿔 <id>.png를 쓴다 — Pillow). 그림이 없거나 크기·sha256이 다르면 그 기준 그림은 목록에서 빼고
  알리며 끝 코드 1. 판을 아직 못 받은 채점 예시는 board null로 적고 id를 알린다(get_critic_refs exemplar_ids로 받아 다시 refs).
끝 코드: 0 = 됨, 1 = 맞지 않거나 없는 파일, 2 = 부르는 꼴이 틀림(리소스 줄·조각이 없음 등).
"""
import argparse
import hashlib
import json
import re
import shutil
import sys
from collections import OrderedDict
from pathlib import Path

WORK = "kax://work/"
SAFE_REL = re.compile(r"^[A-Za-z0-9_-][A-Za-z0-9_.-]*(/[A-Za-z0-9_-][A-Za-z0-9_.-]*)*$")  # 작업 폴더 안 상대 경로('..'·'/' 시작 없음)
LINE = re.compile(r"\[Resource from (?P<server>[^\]]*?) at (?P<uri>[^\]\s]+)\]\s*Binary content \((?P<mime>[^,()]*),\s*"
                  r"(?P<size>[0-9]+(?:\.[0-9]+)?)\s?(?P<unit>bytes?|B|KB|MB|GB)\)\s*saved to (?P<saved>.+?)(?=\[Resource |\[Image|\r|\n|$)")
UNIT = {"byte": 1, "bytes": 1, "B": 1, "KB": 1024, "MB": 1024 ** 2, "GB": 1024 ** 3}
TYPE_ORDER = ["logo_title", "chat_input", "ui_screen", "card_list", "calendar_data", "connect_icons", "kinetic_type",
              "big_type_closeup", "transition_mid", "product_3d_hero", "endcard_glow"]


def sha256_file(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


# ------------------------------------------------------------------ place
def parse_lines(text):
    """리소스 줄 → [(uri, mime, (크기 수, 단위 바이트, 소수 자리), 저장된 파일)]. 꼴이 다른 리소스(본문 글·링크)는 건너뛴다."""
    out = []
    for m in LINE.finditer(text):
        num = m.group("size")
        out.append((m.group("uri"), m.group("mime").strip(), (float(num), UNIT[m.group("unit")], len(num.partition(".")[2])),
                    m.group("saved").strip()))
    return out


def size_ok(size, want):
    """실제 바이트 수가 리소스 줄 크기와 맞는가 — 바이트면 그대로, KB·MB면 그 자리 반올림 안."""
    if want is None:
        return True
    num, unit, places = want
    if unit == 1:
        return size == int(num)
    return abs(size / unit - num) <= 0.5 * 10 ** -places + 1e-9


def size_text(want):
    num, unit, places = want
    return f"{int(num)} bytes" if unit == 1 else f"{num:.{places}f}{ {1024: 'KB', 1024 ** 2: 'MB', 1024 ** 3: 'GB'}[unit] }"


def cmd_place(a):
    root = Path(a.root)
    text = "\n".join(a.lines) if a.lines else ("" if sys.stdin.isatty() else sys.stdin.read())
    jobs = []  # (path, 저장된 파일, 바랄 크기 또는 None)
    for uri, _, n, saved in parse_lines(text):
        if not uri.startswith(WORK):
            print(f"건너뜀  {uri}: kax://work/ 리소스가 아님", file=sys.stderr)
            continue
        jobs.append((uri[len(WORK):], saved, n))
    for pair in a.pair:
        saved, sep, rel = pair.rpartition("=")
        if not sep:
            print(f"--pair는 <저장된 파일>=<path>: {pair}", file=sys.stderr)
            return 2
        jobs.append((rel, saved, None))
    if not jobs:
        print("리소스 줄을 찾지 못함 — '[Resource from … at kax://work/<path>] Binary content (<mimeType>, <크기>) saved to <파일>' 줄을 주거나 "
              "--pair <저장된 파일>=<path>", file=sys.stderr)
        return 2
    want_sha = {}
    for s in a.sha256:
        rel, sep, val = s.rpartition("=")
        if not sep or not re.fullmatch(r"[0-9a-f]{64}", val):
            print(f"--sha256은 <path>=<16진 64자>: {s}", file=sys.stderr)
            return 2
        want_sha[rel] = val
    bad, rows, last = 0, [], {}
    for rel, saved, n in jobs:
        last[rel] = (saved, n)
    for rel, (saved, n) in last.items():
        if not SAFE_REL.match(rel):
            print(f"틀림  {rel}: 작업 폴더 안 상대 경로가 아님", file=sys.stderr)
            bad += 1
            continue
        src = Path(saved).expanduser()
        if not src.is_file():
            print(f"틀림  {rel}: 저장된 파일이 없음 {saved}", file=sys.stderr)
            bad += 1
            continue
        dst = root / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src, dst)
        size, sha = dst.stat().st_size, sha256_file(dst)
        why = []
        if not size_ok(size, n):
            why.append(f"크기 {size:,}바이트가 리소스 줄 {size_text(n)}과 다름")
        if rel in want_sha and sha != want_sha[rel]:
            why.append("sha256이 --sha256 값과 다름")
        if why:
            bad += 1
        rows.append(("틀림" if why else "ok", rel, size, sha, "; ".join(why)))
    for st, rel, size, sha, why in rows:
        print(f"{st:4}  {rel}  {size:,}바이트  sha256 {sha}" + (f"  — {why}" if why else ""))
    missing = sorted(set(want_sha) - set(last))
    for rel in missing:
        print(f"없음  {rel}: --sha256을 줬지만 리소스 줄에 없음", file=sys.stderr)
    print(f"놓은 파일 {len(rows) - sum(1 for r in rows if r[0] != 'ok')}개 · 틀림 {bad + len(missing)}개 (기준: {root.resolve()})")
    return 1 if bad or missing else 0


# ------------------------------------------------------------------ refs
def to_png(src, dst):
    from PIL import Image  # 공개 스킬 비평 도구와 같은 Pillow
    with Image.open(src) as im:
        im.convert("RGB").save(dst, optimize=True)


def cmd_refs(a):
    refs = Path(a.refs_dir)
    parts = sorted((refs / "parts").glob("*.json"), key=lambda p: (p.stat().st_mtime_ns, p.name))
    if not parts:
        print(f"목록 조각이 없음: {refs / 'parts'}/ — get_critic_refs 결과의 리소스(review/refs/parts/…)를 먼저 place로 놓는다", file=sys.stderr)
        return 2
    anchors, exemplars = OrderedDict(), OrderedDict()
    a_img, e_img, versions, problems = {}, {}, set(), []
    for p in parts:
        try:
            doc = json.loads(p.read_text(encoding="utf-8"))
        except (OSError, ValueError) as e:
            problems.append(f"조각을 못 읽음 {p.name}: {e}")
            continue
        kind = doc.get("part") if isinstance(doc, dict) else None
        versions.add(doc.get("asset_version") if isinstance(doc, dict) else None)
        imgs = {i.get("id"): i for i in doc.get("images", []) if isinstance(i, dict)} if kind else {}
        if kind == "anchors":
            a_img.update(imgs)
            for x in doc.get("anchors", []):
                anchors.setdefault(x["id"], x)
        elif kind == "exemplars":
            e_img.update(imgs)
            for x in doc.get("exemplars", []):
                old = exemplars.get(x["id"])
                if old is None:
                    exemplars[x["id"]] = dict(x)
                elif x.get("board") and not old.get("board"):
                    old["board"] = x["board"]
        else:
            problems.append(f"모르는 조각 {p.name}(part = {kind!r})")
    good = OrderedDict()
    for aid, x in anchors.items():
        f = refs / str(x.get("file", f"{aid}.webp"))
        im = a_img.get(aid)
        if not f.is_file():
            problems.append(f"기준 그림 없음: {f} — get_critic_refs 결과에서 {aid}의 그림(기준 그림 차례)을 이 자리로 복사")
        elif im and (f.stat().st_size != im.get("bytes") or sha256_file(f) != im.get("sha256")):
            problems.append(f"기준 그림이 다름: {f} — 받은 그림 차례를 다시 맞춘다(바랄 {im.get('bytes')}바이트, 지금 {f.stat().st_size})")
        else:
            good[aid] = {**x, "motion": x.get("motion", "")}
    ex_dir = refs / "exemplars"
    no_board = []
    for xid, x in exemplars.items():
        png, webp = ex_dir / f"{xid}.png", ex_dir / f"{xid}.webp"
        im = e_img.get(xid)
        if webp.is_file() and im and (webp.stat().st_size != im.get("bytes") or sha256_file(webp) != im.get("sha256")):
            problems.append(f"채점 판이 다름: {webp} — 받은 그림 차례를 다시 맞춘다(바랄 {im.get('bytes')}바이트)")
            x["board"] = None
            continue
        if webp.is_file() and (not png.is_file() or png.stat().st_mtime_ns < webp.stat().st_mtime_ns):
            try:
                to_png(webp, png)
            except Exception as e:  # Pillow가 없거나 그림이 깨짐
                problems.append(f"채점 판을 PNG로 못 바꿈: {webp} ({e})")
        if png.is_file():
            x["board"] = f"{xid}.png"
        else:
            if x.get("board"):
                problems.append(f"채점 판 없음: {webp} — get_critic_refs 결과에서 {xid}의 판(기준 그림 다음 차례)을 이 자리로 복사")
            x["board"] = None
            no_board.append(xid)
    types = OrderedDict()
    for t in TYPE_ORDER + sorted({x.get("type") for x in good.values()} - set(TYPE_ORDER)):
        mine = [x for x in good.values() if x.get("type") == t]
        if mine:
            types[t] = {"desc": mine[0].get("type_desc", t), "count": len(mine)}
    refs.mkdir(parents=True, exist_ok=True)
    (refs / "anchors.json").write_text(json.dumps({"types": types, "anchors": list(good.values())}, ensure_ascii=False, indent=1) + "\n",
                                       encoding="utf-8")
    if exemplars:
        ex_dir.mkdir(parents=True, exist_ok=True)
        (ex_dir / "exemplars.json").write_text(json.dumps({"exemplars": list(exemplars.values())}, ensure_ascii=False, indent=1) + "\n",
                                               encoding="utf-8")
    per_type = ", ".join(f"{t} {v['count']}" for t, v in types.items()) or "없음"
    print(f"기준 그림 {len(good)}장(유형 {len(types)}: {per_type}) → {refs / 'anchors.json'}")
    if exemplars:
        nb = sum(1 for x in exemplars.values() if x.get("board"))
        print(f"채점 예시 {len(exemplars)}개(판 {nb}장) → {ex_dir / 'exemplars.json'}")
    if no_board:
        print(f"판을 아직 못 받은 채점 예시 {len(no_board)}개: {', '.join(no_board)} — get_critic_refs {{\"exemplar_ids\": [...]}}(8개씩)로 받아 다시 refs")
    if len(versions - {None}) > 1:
        print(f"주의: 자료 판이 섞임 {sorted(v for v in versions if v)} — 같은 판으로 다시 받는 것이 좋다")
    for p in problems:
        print(f"틀림  {p}", file=sys.stderr)
    return 1 if problems else 0


def main():
    ap = argparse.ArgumentParser(description="KAX MCP로 받은 파일을 작업 폴더에 놓는다(place) · 비평 목록 조각 합치기(refs)")
    sub = ap.add_subparsers(dest="cmd", required=True)
    pp = sub.add_parser("place", help="리소스 줄의 저장된 파일을 kax://work/<path> 자리로 복사·확인")
    pp.add_argument("lines", nargs="*", help="리소스 줄(없으면 stdin)")
    pp.add_argument("--root", default=".", help="작업 폴더(기본 지금 폴더)")
    pp.add_argument("--pair", action="append", default=[], help="<저장된 파일>=<path> — 리소스 줄 꼴이 다른 클라이언트")
    pp.add_argument("--sha256", action="append", default=[], help="<path>=<sha256> — structuredContent.files[].sha256과도 맞춤")
    pr = sub.add_parser("refs", help="review/refs/parts/의 목록 조각을 합쳐 anchors.json·exemplars/exemplars.json")
    pr.add_argument("refs_dir", nargs="?", default="review/refs", help="기준 그림 폴더(기본 review/refs)")
    a = ap.parse_args()
    return cmd_place(a) if a.cmd == "place" else cmd_refs(a)


if __name__ == "__main__":
    sys.exit(main())
