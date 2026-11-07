"""부품 데모를 HyperFrames 작업 폴더로 옮긴다(스테이징) + lint·check·render·snapshot.

왜: 부품 데모(demo/index.html)는 kc.js·부품 .js·typography·texture·fonts를 '뿌리 기준 경로'로 부른다
(예: <script src="components/kc.js">). HyperFrames는 프로젝트 폴더 밖(../)을 못 읽으므로, 스테이징 폴더에
같은 경로 구조로 필요한 파일만 복사한다. 원본을 고치지 않으니 원본 파일 하나만 고치면 모든 데모가 따라온다.

사용:
  python3 -I components/tools/stage.py components/fx/path_draw            # 스테이징만(기본 위치: $TMPDIR/kc_stage/<id>)
  python3 -I components/tools/stage.py components/fx/path_draw --lint     # + lint·check
  python3 -I components/tools/stage.py components/fx/path_draw --render   # + 렌더(--workers 2) → <스테이징 폴더>/out/demo.mp4
  python3 -I components/tools/stage.py components/fx/path_draw --out /tmp/x --selftest
  python3 -I <스킬>/components/tools/stage.py components/fx/path_draw --lint   # 작업 폴더에서: get_component로 받은 부품

파일을 찾는 곳(앞에서 찾으면 그것):
  1) 작업 폴더 = 부품 폴더(<작업 폴더>/components/<분류>/<이름>/)의 세 단계 위. get_component로 받은 부품과
     그 requires.parts 부품이 여기 있다.
  2) 스킬 뿌리의 kax_paths.json에 engine_dirs 표가 있으면, 표의 경로 머리(예: engine/km)로 시작하는 경로를 표의 폴더
     차례로 푼다(앞 폴더에 있으면 그것). 폴더를 부르면 뒤 폴더부터 복사하고 앞 폴더의 맨 위 파일로 덮는다.
  3) 스킬 뿌리 = --skill <폴더>, 없으면 이 스크립트의 두 단계 위. kc.js·lib·typography·texture·fonts·components/vendor·engine.
  GSAP: 데모가 부르는 components/vendor/gsap-<판>/gsap.min.js(공개 스킬에는 없음)를 못 찾으면 vendor/gsap.min.js(같은 파일)를 그 경로로 복사.
  스테이징 폴더에는 데모가 부른 경로 그대로 둔다.

복사 규칙:
  1) demo/ 폴더 전체 → 스테이징 폴더 뿌리(index.html이 뿌리에 옴)
  2) index.html의 src="..."·href="..."·importmap 중 demo/에 없는 상대 경로 → 위 차례로 찾아 같은 경로로 복사
  3) typography/pairs.js를 부르면 pairs.json의 서체 파일 전부(데모의 인자 없는 KTypo.ready()가 모두 읽어 봄 — 작품에서는
     KTypo.ready(역할들)로 쓰는 서체만 읽는다, references/typography.md 2장)
  4) demo/stage.json {"copy": ["뿌리 기준 경로", ...]} — 위로 못 찾는 것(스크립트가 동적으로 읽는 파일 등)
--selftest: <head> 맨 앞에 window.KC_SELFTEST=1을 넣는다(kc.js가 시크·결정성 자가 시험 + 금지 호출 검사).
--seq all|k: window.KC_SEQ를 넣는다 — toHF가 렌더처럼 앞 프레임을 차례로 다 그린 뒤(k면 앞 k프레임) 그 프레임을 그림(차례 그리기 시험).
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

SKILL = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
REPO = SKILL  # 스킬 뿌리(regress.py·pair.py가 ST.REPO로 쓴다)
HF = "hyperframes@0.8.188"


def part_id(part_dir):
    d = os.path.abspath(part_dir)
    return os.path.basename(os.path.dirname(d)) + "." + os.path.basename(d)


def gpu_mode(part_dir):
    """webgl 부품(부품 .js renderer)이거나 test/snap.json "gpu"가 software로 시작하면 "software", "hardware"로 시작하면 None(자동)."""
    part_dir = os.path.abspath(part_dir)
    sp = os.path.join(part_dir, "test", "snap.json")
    g = ""
    if os.path.isfile(sp):
        g = str(json.load(open(sp, encoding="utf-8")).get("gpu", "")).strip().lower()
    if g.startswith("software"):
        return "software"
    if g.startswith("hardware"):
        return None
    js = os.path.join(part_dir, os.path.basename(part_dir) + ".js")
    if os.path.isfile(js) and re.search(r'renderer:\s*"webgl"', open(js, encoding="utf-8").read()):
        return "software"
    return None


def work_root(part_dir):
    """부품 폴더가 <작업 폴더>/components/<분류>/<이름>/ 꼴이면 <작업 폴더>, 아니면 None."""
    comp = os.path.dirname(os.path.dirname(os.path.abspath(part_dir)))
    return os.path.dirname(comp) if os.path.basename(comp) == "components" else None


def engine_dirs(skill):
    """스킬 뿌리 kax_paths.json의 engine_dirs {경로 머리: [폴더(스킬 뿌리 기준), ...]}. 파일이나 표가 없으면 {}."""
    try:
        with open(os.path.join(skill, "kax_paths.json"), encoding="utf-8") as f:
            t = json.load(f).get("engine_dirs") or {}
    except (OSError, ValueError, AttributeError):
        return {}
    return {os.path.normpath(k): [os.path.normpath(d) for d in v] for k, v in t.items() if isinstance(v, list)}


def _under(root, p):
    return p.startswith(root + os.sep)


# GSAP 자리는 공개 스킬에 하나(vendor/gsap.min.js, v0.6.6). 데모 HTML이 부르는 옛 자리(같은 파일)를 못 찾으면 그것으로 — 스테이징 폴더에는
#   데모가 부른 경로 그대로 둔다(HTML을 고치지 않음). 저작자 저장소는 옛 자리에 파일이 있어 그대로 찾는다.
GSAP_OLD = re.compile(r"^(?:components/vendor/gsap-[0-9.]+|engine(?:/km)?/vendor)/gsap\.min\.js$")
GSAP_ONE = "vendor/gsap.min.js"


def find(rel, work, skill, edirs):
    """뿌리 기준 경로 rel → 복사할 원본 경로 목록(앞의 것부터 복사 — 여럿은 engine_dirs 폴더를 덮어 합칠 때뿐). 못 찾으면 []."""
    hit = _find(rel, work, skill, edirs)
    if not hit and GSAP_OLD.match(rel.replace(os.sep, "/")):
        hit = _find(GSAP_ONE, work, skill, edirs)
    return hit


def _find(rel, work, skill, edirs):
    if work:
        p = os.path.normpath(os.path.join(work, rel))
        if _under(work, p) and os.path.exists(p):
            return [p]
    for pre, dirs in edirs.items():
        if rel == pre or rel.startswith(pre + os.sep):
            rest = rel[len(pre) + 1:]
            hits = [os.path.normpath(os.path.join(skill, d, rest)) for d in dirs]
            hits = [p for p in hits if _under(skill, p) and os.path.exists(p)]
            if hits:
                return hits[::-1] if os.path.isdir(hits[0]) else hits[:1]
    p = os.path.normpath(os.path.join(skill, rel))
    if _under(skill, p) and os.path.exists(p):
        return [p]
    return []


def _copy(srcs, dst):
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    first = srcs[0]
    if not os.path.isdir(first):
        shutil.copy2(first, dst)
        return
    shutil.copytree(first, dst, dirs_exist_ok=True)
    for s in srcs[1:]:  # engine_dirs의 앞 폴더: 맨 위 파일만 덮음
        for name in sorted(os.listdir(s)):
            if os.path.isfile(os.path.join(s, name)):
                shutil.copy2(os.path.join(s, name), os.path.join(dst, name))


def stage(part_dir, out=None, selftest=False, seq=None, skill=None):
    """seq: "all" 또는 숫자 k → <head>에 window.KC_SEQ(차례 그리기 시험 — kc.js toHF)와 KC_DEV(금지 호출 검사)를 넣는다.
    자가 시험(selftest)과 같이 쓰지 않는다(자가 시험은 프레임을 건너뛰며 그려 차례가 깨짐) — 스테이징 폴더도 따로(<id>_seq).
    skill: 스킬 뿌리(없으면 이 스크립트의 두 단계 위). 파일은 작업 폴더 → engine_dirs → 스킬 뿌리 차례로 찾는다."""
    part_dir = os.path.abspath(part_dir)
    skill = os.path.abspath(skill) if skill else SKILL
    work = work_root(part_dir)
    edirs = engine_dirs(skill)
    demo = os.path.join(part_dir, "demo")
    if not os.path.isfile(os.path.join(demo, "index.html")):
        raise SystemExit(f"demo/index.html 없음: {demo}")
    if selftest and seq:
        raise SystemExit("stage: selftest와 seq는 같이 못 씀")
    out = out or os.path.join(tempfile.gettempdir(), "kc_stage", part_id(part_dir) + ("_selftest" if selftest else "_seq" if seq else ""))
    if os.path.isdir(out):
        for name in os.listdir(out):  # 앞 스테이징 지우기(out/·.hyperframes 렌더 산출물은 남김)
            if name in ("out", ".hyperframes", "snapshots"):
                continue
            p = os.path.join(out, name)
            shutil.rmtree(p) if os.path.isdir(p) and not os.path.islink(p) else os.remove(p)
    os.makedirs(out, exist_ok=True)
    for name in os.listdir(demo):
        if name == "stage.json":
            continue
        s, d = os.path.join(demo, name), os.path.join(out, name)
        shutil.copytree(s, d) if os.path.isdir(s) else shutil.copy2(s, d)
    html = open(os.path.join(demo, "index.html"), encoding="utf-8").read()
    refs = set()
    urls = [m.group(1) for m in re.finditer(r'(?:src|href)\s*=\s*"([^"]+)"', html)]
    # <script type="importmap">{"imports": {"three": "components/vendor/..."}} — 그 경로도 복사(three 모듈)
    for im in re.finditer(r'<script[^>]*type\s*=\s*"importmap"[^>]*>(.*?)</script>', html, re.S):
        try:
            imp = json.loads(im.group(1))
        except ValueError:
            raise SystemExit("importmap JSON을 못 읽음: " + im.group(1)[:120])
        for tbl in [imp.get("imports") or {}] + list((imp.get("scopes") or {}).values()):
            urls += [v for v in tbl.values() if isinstance(v, str)]
    for u in urls:
        if re.match(r"^[a-z]+:|^#|^/", u):
            continue
        u = u.split("?")[0].split("#")[0]
        if not os.path.exists(os.path.join(demo, u)):
            refs.add(u)
    if "typography/pairs.js" in refs:
        pj = find(os.path.join("typography", "pairs.json"), work, skill, edirs)
        if not pj:
            raise SystemExit("typography/pairs.json 없음(작업 폴더·스킬 뿌리)")
        pairs = json.load(open(pj[0], encoding="utf-8"))
        for f in pairs["fonts"].values():
            refs.add(f["path"])
    sj = os.path.join(demo, "stage.json")
    if os.path.isfile(sj):
        refs.update(json.load(open(sj, encoding="utf-8")).get("copy", []))
    refs = {os.path.normpath(r) for r in refs}
    refs = {r for r in refs if not any(r != q and r.startswith(q + os.sep) for q in refs)}  # 이미 복사할 폴더 안의 것은 뺌
    missing = []
    for r in sorted(refs):
        srcs = find(r, work, skill, edirs)
        if not srcs:
            missing.append(r)
            continue
        _copy(srcs, os.path.join(out, r))
    if missing:
        raise SystemExit("작업 폴더·스킬 뿌리 어디에도 없는 경로: " + ", ".join(missing)
                         + f" (작업 폴더 {work or '없음'}, 스킬 뿌리 {skill})")
    if selftest or seq:
        p = os.path.join(out, "index.html")
        h = open(p, encoding="utf-8").read()
        flag = "window.KC_SELFTEST = 1;" if selftest else f"window.KC_SEQ = {json.dumps(seq)}; window.KC_DEV = 1;"
        h = re.sub(r"<head>", "<head>\n    <script>" + flag + "</script>", h, count=1)
        open(p, "w", encoding="utf-8").write(h)
    return out


def hf(args, cwd, check=True, gpu=None):
    """gpu="software"면 PRODUCER_BROWSER_GPU_MODE=software(SwiftShader — webgl 부품의 골든·결정성은 이 모드로 찍는다)."""
    env = dict(os.environ, HYPERFRAMES_SKIP_SKILLS="1")
    if gpu:
        env["PRODUCER_BROWSER_GPU_MODE"] = gpu
    r = subprocess.run(["npx", "--yes", HF] + args, cwd=cwd, capture_output=True, text=True, env=env)
    if check and r.returncode != 0:
        sys.stderr.write(r.stdout[-3000:] + r.stderr[-3000:])
        raise SystemExit(f"hyperframes {' '.join(args)} 실패({r.returncode})")
    return r


def _report_errors(txt):
    """check가 남긴 보고서 JSON(Report: 경로)에서 오류만 센다(경고·정보는 안 셈 — 대비 경고 등). 못 읽으면 None."""
    m = re.search(r"Report:\s*(\S+\.json)", txt)
    if not m or not os.path.isfile(m.group(1)):
        return None
    try:
        d = json.load(open(m.group(1), encoding="utf-8"))
    except (OSError, ValueError):
        return None
    n, msgs = 0, []
    for sec, v in d.items():
        if isinstance(v, dict) and "errorCount" in v:
            n += int(v.get("errorCount") or 0)
            for fd in v.get("findings") or []:
                if fd.get("severity") == "error":
                    msgs.append(f"{sec}/{fd.get('code')}: {str(fd.get('message', ''))[:120]}")
    return n, msgs


def lint_check(out, gpu=None):
    """lint·check 결과 → (오류 수 합, 요약 문자열). check는 보고서 JSON의 errorCount만 센다(경고는 오류 아님)."""
    res = []
    errs = 0
    for cmd in (["lint"], ["check"]):
        r = hf(cmd, out, check=False, gpu=gpu)
        txt = (r.stdout + r.stderr)
        rep = _report_errors(txt) if cmd[0] == "check" else None
        msgs = []
        if rep is not None:
            n, msgs = rep
        else:
            n = sum(int(x) for x in re.findall(r"(\d+)\s+error", txt))
            n += len(re.findall(r"^\s*✗", txt, re.M))  # 보고서가 없을 때만: Layout·Motion 오류 줄(✗)은 '0 errors' 요약 밖에 찍힌다
        if n == 0 and r.returncode != 0:
            n = 1
            msgs = [(txt.strip().splitlines() or ["?"])[-1][:160]]
        errs += n
        res.append(f"{cmd[0]}: 오류 {n} (종료 {r.returncode})" + (" — " + " / ".join(msgs[:2]) if msgs else ""))
        if n:
            sys.stderr.write(txt[-2500:])
    return errs, "; ".join(res)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("part")
    ap.add_argument("--out")
    ap.add_argument("--skill", help="스킬 뿌리(기본: 이 스크립트의 두 단계 위)")
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("--seq", help="차례 그리기 시험: all | 앞 프레임 수 k")
    ap.add_argument("--lint", action="store_true")
    ap.add_argument("--render", action="store_true")
    ap.add_argument("--gpu", choices=["auto", "software", "hardware"], default="auto",
                    help="auto: webgl 부품이거나 test/snap.json의 gpu가 software면 software")
    a = ap.parse_args()
    seq = None if not a.seq else ("all" if a.seq == "all" else int(a.seq))
    out = stage(a.part, a.out, a.selftest, seq, skill=a.skill)
    print("스테이징:", out)
    gpu = gpu_mode(a.part) if a.gpu == "auto" else a.gpu
    if gpu:
        print("GPU 모드:", gpu)
    if a.lint:
        n, s = lint_check(out, gpu)
        print(s)
        if n:
            raise SystemExit(1)
    if a.render:
        os.makedirs(os.path.join(out, "out"), exist_ok=True)
        hf(["render", "--workers", "2", "-o", "out/demo.mp4"], out, gpu=gpu)
        print("렌더:", os.path.join(out, "out", "demo.mp4"))


if __name__ == "__main__":
    main()
