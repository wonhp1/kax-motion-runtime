"""kax-motion 비평 패널 묶기 — 비평가 2~3명의 결과를 critic/critic.md의 판정 절차·관문 규칙대로 합친다.

사용: python3 -I critic/tools/panel.py <critic 폴더> <critic 폴더> [<critic 폴더> ...] --out <폴더> [--shots storyboard/shots.json]
  각 폴더에 critic.json(v0.3 양식이 기본, v0.2 결과도 읽음)과 있으면 critic.md.
결과: <out>/panel.json, <out>/panel.md
  - 항목별 점수 표·중앙값·중앙값 평균, 관문 합침, 맞대기 다수결(같은 샷 2명 이상 '못하다'), 통과 여부와 이유
  - need_third: 앞 두 명(A·B)만으로 1장 3번 조건(2점 차 / 통과 여부 다름 / 평균 경계 띠 / 핵심 샷 한 명 '못하다')
    + 4장 관문 갈림(G2·G4)이 걸리면 true. 세 명 이상을 주면 false(이미 C가 있음)이고 앞 두 명 기준 이유만 남긴다.
  - 고칠 것 후보: 2명 이상이 같은 항목을 짚은 것 먼저, 그다음 중앙값 낮은 항목 순
판정 규칙의 숫자는 critic/critic.md를 따른다. 묶기만 하고 점수를 고치지 않는다(cap을 넘는 score는 cap으로 읽고 표시).
"""
import argparse
import copy
import json
import os
import re
import statistics
import sys

QS = [f"Q{i}" for i in range(1, 9)]
GS = [f"G{i}" for i in range(1, 6)]
QNAME = {"Q1": "밀도·층", "Q2": "타이포", "Q3": "움직임 곡선", "Q4": "디테일", "Q5": "구성·시선", "Q6": "시그니처", "Q7": "내용", "Q8": "소리"}
BAND = (7.75, 8.25)
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))  # 스킬 뿌리
KAX_PATHS_PUBLIC = {"base": "cwd", "refs": "review/refs"}  # kax_paths.json이 없을 때(공개 값)


def kax_path(key):
    """스킬 뿌리 kax_paths.json(도구 기본 경로 표)의 key 경로. base: skill = 스킬 뿌리 기준, cwd = 도구를 돌린 폴더 기준.
    파일이나 칸이 없으면 공개 값(공개 값에도 없는 칸은 None)."""
    try:
        with open(os.path.join(REPO, "kax_paths.json"), encoding="utf-8") as f:
            t = json.load(f)
    except (OSError, ValueError):
        t = {}
    if not isinstance(t, dict) or key not in t:
        t = KAX_PATHS_PUBLIC
    if t.get(key) is None:
        return None
    base = REPO if t.get("base") == "skill" else os.getcwd()
    return os.path.normpath(os.path.join(base, os.path.expanduser(t[key])))


# ---------------------------------------------------------------- 읽기 (v0.2 → v0.3 양식 맞추기)
def shot_no(x):
    if isinstance(x, bool) or x is None:
        return None
    if isinstance(x, (int, float)):
        return int(x)
    m = re.search(r"\d+", str(x))
    return int(m.group()) if m else None


def verdict_of(v):
    v = re.sub(r"[*\s]", "", str(v or ""))
    for k, words in (("못하다", ("못하다", "worse")), ("낫다", ("낫다", "better")), ("같다", ("같다", "same"))):
        if any(w in v for w in words):
            return k
    return None


def pass_of(v):
    if isinstance(v, dict):
        v = v.get("pass", v.get("ok", v.get("result")))
    if isinstance(v, bool):
        return v
    if v is None:
        return None
    s = str(v)
    if "불합격" in s or "fail" in s.lower() or s.strip().lower() == "false":
        return False
    if "합격" in s or "pass" in s.lower() or s.strip().lower() == "true":
        return True
    return None


def fix_items(head, text):
    items = list(dict.fromkeys(re.findall(r"\b([QG][1-8])\b", head)))
    if not items:
        items = list(dict.fromkeys(re.findall(r"\b([QG][1-8])\b", text[:80])))
    if not items and "맞대기" in head:
        items = ["맞대기"]
    return items or ["기타"]


def fixes_from_md(md):
    """critic.md의 '고칠 것' 절에서 번호 목록을 읽는다(v0.2 critic.json에 고칠 것이 없을 때)."""
    out, on = [], False
    for line in md.splitlines():
        if re.match(r"^#+\s", line):
            on = "고칠" in line
            continue
        m = re.match(r"^\s*\d+\.\s+(.*)", line)
        if on and m:
            t = m.group(1).strip()
            hm = re.match(r"\*\*(.+?)\*\*", t)
            head = hm.group(1) if hm else re.split(r"[:—]", t, maxsplit=1)[0]
            out.append(dict(items=fix_items(head, t), text=re.sub(r"\*\*", "", t)))
    return out


def normalize(j, folder, md=""):
    """v0.3 양식(critic_v0.3.md 5장)으로 맞춘다. v0.2 결과의 키 차이(pairs/pairing.rows, fixes/fixes_top3/fix_top3,
    critic/critic_id, 시그니처 표시 방식, quality 안의 min·mean 칸)를 흡수한다."""
    ver = str(j.get("critic_version") or j.get("version") or "")
    form = "v0.3" if "0.3" in ver else "v0.2"
    cid = j.get("critic_id") or os.path.basename(os.path.normpath(folder))
    notes = []
    gates = {}
    G = j.get("gates") or {}
    for g in GS:
        gates[g] = pass_of(G.get(g)) if g in G else None
    quality = {}
    Q = j.get("quality") or j.get("scores") or {}
    for q in QS:
        v = Q.get(q)
        sc = v.get("score") if isinstance(v, dict) else v
        cap = v.get("cap") if isinstance(v, dict) else None
        try:
            sc = float(sc) if sc is not None else None
        except (TypeError, ValueError):
            sc = None
        eff = sc
        if sc is not None and cap is not None and sc > float(cap):
            eff = float(cap)
            notes.append(f"{q} score {sc:g}가 cap {cap}을 넘어 cap으로 읽음")
        quality[q] = dict(score=sc, cap=cap, eff=eff,
                          why=(v.get("why") or v.get("reason") or "") if isinstance(v, dict) else "",
                          frames=v.get("frames", []) if isinstance(v, dict) else [])
    P = j.get("pairs")
    if isinstance(P, dict):
        P = P.get("rows")
    if not P and isinstance(j.get("pairing"), dict):
        P = j["pairing"].get("rows")
    pairs, sig = [], set()
    for r in P or []:
        n = shot_no(r.get("shot"))
        if n is None:
            continue
        pairs.append(dict(shot=n, anchor=r.get("anchor"), frame=r.get("frame"), verdict=verdict_of(r.get("verdict")),
                          why=r.get("why") or r.get("reason") or ""))
        if r.get("signature") is True or "시그니처" in str(r.get("role", "")):
            sig.add(n)
    # 같은 샷을 두 줄로 적었으면 가장 낮은 판정 하나로
    rank = {"못하다": 0, "같다": 1, "낫다": 2, None: 3}
    byshot = {}
    for p in pairs:
        if p["shot"] not in byshot or rank[p["verdict"]] < rank[byshot[p["shot"]]["verdict"]]:
            byshot[p["shot"]] = p
    pairs = [byshot[k] for k in sorted(byshot)]
    s = j.get("signature_shot")
    if s is not None:
        sig.update(shot_no(x) for x in (s if isinstance(s, list) else [s]) if shot_no(x) is not None)
    if not sig:
        sfl = (j.get("pairing") or {}).get("signature_first_last") or {}
        if isinstance(sfl, dict) and sfl.get("signature"):
            n = shot_no(sfl["signature"])
            if n:
                sig.add(n)
        for k in (j.get("pairs_summary") or {}):
            m = re.match(r"signature_shot(\d+)", k)
            if m:
                sig.add(int(m.group(1)))
    fixes = []
    F = j.get("fixes") or j.get("fixes_top3") or j.get("fix_top3") or []
    for f in F:
        if isinstance(f, dict):
            head = str(f.get("item", ""))
            text = " — ".join(str(f[k]) for k in ("item", "what", "how") if f.get(k))
            fixes.append(dict(items=fix_items(head, text), text=text))
        else:
            t = str(f)
            fixes.append(dict(items=fix_items(re.split(r"[:—]", t, maxsplit=1)[0], t), text=t))
    if not fixes and md:
        fixes = fixes_from_md(md)
        if fixes:
            notes.append("고칠 것을 critic.md에서 읽음")
    dp = j.get("pass", j.get("overall_pass"))
    return dict(id=str(cid), folder=folder, form=form, video=j.get("video") or j.get("target"), gates=gates, quality=quality,
                pairs=pairs, signature_shots=sorted(sig), fixes=fixes, declared_pass=dp if isinstance(dp, bool) else None,
                notes=notes)


def load_critic(folder):
    jp = os.path.join(folder, "critic.json")
    j = json.load(open(jp, encoding="utf-8"))
    mp = os.path.join(folder, "critic.md")
    md = open(mp, encoding="utf-8").read() if os.path.exists(mp) else ""
    return normalize(j, folder, md)


# ---------------------------------------------------------------- 작품(영상) 경로
def video_work(c):
    """critic.json video → (작업 폴더 경로 또는 이름, 찾은 영상 경로 또는 None).
    양식(critic/critic.md 7장)은 작업 폴더 기준 상대 경로('out/final.mp4'). 상대 경로면 비평 폴더에서 위로 올라가며
    <위 폴더>/<video>가 있는 곳을 찾는다(<작업 폴더>/review/critic_A, review/round2/critic_A 배치) — 작업 폴더 = 그 영상의
    'out/' 위 폴더(없으면 찾은 위 폴더). 절대 경로·'~'는 그대로. 어디에도 없으면 경로 글자에서 'out/' 위 폴더 이름(예전 꼴 —
    '<모음 폴더>/<작품>/out/final.mp4' → '<작품>'), 그것도 없으면 (None, None)."""
    v = os.path.expanduser((c.get("video") or "").strip())
    if not v:
        return None, None

    def work_of(p, base):
        p = os.path.normpath(p)
        return os.path.dirname(os.path.dirname(p)) if os.path.basename(os.path.dirname(p)) == "out" else base
    if os.path.isabs(v):
        return work_of(v, os.path.dirname(v)), (v if os.path.exists(v) else None)
    d = os.path.abspath(c["folder"])
    for _ in range(8):
        p = os.path.normpath(os.path.join(d, v))
        if os.path.isfile(p):
            return work_of(p, d), p
        if os.path.dirname(d) == d:
            break
        d = os.path.dirname(d)
    parts = os.path.normpath(v).split(os.sep)
    if "out" in parts and parts.index("out") >= 1:
        return parts[parts.index("out") - 1], None
    return None, None


# ---------------------------------------------------------------- 스토리보드
def find_shots(critics, given):
    if given:
        return given
    cands = []
    for c in critics:  # v0.3 배치: <작품>/review/critic_A → <작품>/storyboard/shots.json
        d = os.path.abspath(c["folder"])
        for _ in range(4):
            d = os.path.dirname(d)
            cands.append(os.path.join(d, "storyboard", "shots.json"))
    for c in critics:  # critic.json video로 찾은 작업 폴더
        w, _ = video_work(c)
        if w and os.path.isabs(w):
            cands.append(os.path.join(w, "storyboard", "shots.json"))
    arch = kax_path("archived_works")  # 옮겨 둔 작품 폴더(kax_paths.json에 있을 때만): <그 폴더>/<판>/<작품>/storyboard/shots.json
    for c in critics:  # critic.json의 video 경로(옮겨 둔 작품은 archived_works 아래에서도 찾음)
        v = c.get("video")
        if not v:
            continue
        v = os.path.expanduser(v)
        for base in (v, os.path.join(REPO, v)):
            cands.append(os.path.join(os.path.dirname(os.path.dirname(base)), "storyboard", "shots.json"))
        parts = os.path.normpath(v).split(os.sep)
        if "out" in parts:
            i = parts.index("out")
            if i >= 2 and arch:
                cands.append(os.path.join(arch, parts[i - 2], parts[i - 1], "storyboard", "shots.json"))
    for p in cands:
        if os.path.exists(p):
            return p
    return None


def shots_info(path):
    if not path:
        return None
    j = json.load(open(path, encoding="utf-8"))
    S = j["shots"] if isinstance(j, dict) else j
    nos = [shot_no(s.get("no")) for s in S if shot_no(s.get("no")) is not None]
    sig = set()
    top = j.get("signature") if isinstance(j, dict) else None
    if isinstance(top, dict):
        for k in ("shot", "shots"):
            v = top.get(k)
            if v is not None:
                sig.update(shot_no(x) for x in (v if isinstance(v, list) else [v]))
    elif isinstance(top, (int, list)):
        sig.update(shot_no(x) for x in (top if isinstance(top, list) else [top]))
    for s in S:
        if s.get("signature") is True:
            sig.add(shot_no(s.get("no")))
    anchors = {shot_no(s.get("no")): s.get("anchor") for s in S}
    return dict(path=path, shots=sorted(nos), signature=sorted(x for x in sig if x is not None), anchors=anchors,
                has_anchor=any(v for v in anchors.values()))


def anchor_ids():
    p = os.path.join(kax_path("refs"), "anchors.json")  # 기준 그림 폴더(kax_paths.json refs)
    try:
        return {a["id"] for a in json.load(open(p, encoding="utf-8"))["anchors"]}
    except Exception:
        return None


# ---------------------------------------------------------------- 한 명의 판정(v0.3 규칙으로 다시 계산)
def key_shots(info, critics):
    shots = info["shots"] if info else sorted({p["shot"] for c in critics for p in c["pairs"]})
    if info and info["signature"]:
        sig, src = info["signature"], "스토리보드"
    else:
        sig, src = sorted({s for c in critics for s in c["signature_shots"]}), "비평가가 적은 것(합집합)"
    first, last = (shots[0], shots[-1]) if shots else (None, None)
    return dict(shots=shots, signature=sig, signature_from=src, first=first, last=last,
                key=sorted(set(sig) | {x for x in (first, last) if x is not None}))


def single_verdict(c, ks):
    eff = [c["quality"][q]["eff"] for q in QS]
    ok_scores = all(x is not None for x in eff)
    mean = round(sum(eff) / 8, 3) if ok_scores else None
    gates_ok = all(c["gates"][g] is not False for g in GS)
    q_ok = ok_scores and min(eff) >= 7 and mean >= 8.0
    v = {p["shot"]: p["verdict"] for p in c["pairs"]}
    shots = ks["shots"] or sorted(v)
    sob = sum(v.get(s) in ("같다", "낫다") for s in shots)
    ratio = sob / len(shots) if shots else None
    key_bad = [s for s in ks["key"] if v.get(s) == "못하다"]
    p_ok = ratio is not None and ratio >= 0.8 and not key_bad
    why = []
    if not gates_ok:
        why.append("관문 불합격: " + ",".join(g for g in GS if c["gates"][g] is False))
    if ok_scores and min(eff) < 7:
        why.append("7 미만 항목: " + ",".join(q for q in QS if c["quality"][q]["eff"] < 7))
    if ok_scores and mean < 8.0:
        why.append(f"평균 {mean} < 8.0")
    if ratio is not None and ratio < 0.8:
        why.append(f"맞대기 같다 이상 {sob}/{len(shots)} < 80%")
    if key_bad:
        why.append(f"핵심 샷 못하다: {key_bad}")
    return dict(mean=mean, gates_pass=gates_ok, quality_pass=q_ok, pairs_pass=p_ok, same_or_better=f"{sob}/{len(shots)}",
                passed=bool(gates_ok and q_ok and p_ok), reasons=why)


# ---------------------------------------------------------------- 패널
def panel(critics, info):
    n = len(critics)
    ks = key_shots(info, critics)
    letters = [chr(65 + i) for i in range(n)]
    for c, L in zip(critics, letters):
        c["letter"] = L
        c["own"] = single_verdict(c, ks)
    # 품질
    table, med = {}, {}
    for q in QS:
        vals = [c["quality"][q]["eff"] for c in critics]
        table[q] = vals
        vv = [x for x in vals if x is not None]
        med[q] = statistics.median(vv) if vv else None
    mm = [med[q] for q in QS if med[q] is not None]
    mean_med = round(sum(mm) / len(mm), 3) if len(mm) == 8 else None
    q_pass = len(mm) == 8 and min(mm) >= 7 and mean_med >= 8.0
    # 관문
    gates, gate_split = {}, []
    for g in GS:
        vals = [c["gates"][g] for c in critics]
        known = [x for x in vals if x is not None]
        nf = sum(x is False for x in known)
        if not known:
            res = None
        elif nf == 0:
            res = True
        elif nf * 2 > len(known):
            res = False
        elif nf * 2 == len(known):
            res = None
            gate_split.append(g)
        else:
            res = True  # 소수만 불합격(3명 중 1명)
        gates[g] = dict(votes=vals, result=res, n_fail=nf,
                        note=("갈림 — 눈 확인 관문이라 C를 띄움" if g in ("G2", "G4") else "갈림 — 도구 값 관문이니 측정값을 다시 본다")
                        if (res is None and known) else ("소수 불합격(다수결 합격)" if (res and nf) else ""))
    gates_pass = all(gates[g]["result"] is True for g in GS if gates[g]["votes"] != [None] * n)
    # 맞대기
    ids = anchor_ids()
    rule2 = bool(info and info["has_anchor"])
    shots = ks["shots"] or sorted({p["shot"] for c in critics for p in c["pairs"]})
    prow = []
    for s in shots:
        vs = [{p["shot"]: p for p in c["pairs"]}.get(s) for c in critics]
        verd = [v["verdict"] if v else None for v in vs]
        anc = [v["anchor"] if v else None for v in vs]
        worse = sum(x == "못하다" for x in verd)
        better = sum(x == "낫다" for x in verd)
        sb_anchor = info["anchors"].get(s) if info else None
        no_anchor = rule2 and (not sb_anchor or (ids is not None and sb_anchor not in ids))
        if no_anchor:
            fin, why = "못하다", "스토리보드에 기준 그림이 없거나 anchors.json에 없는 id(2장 규칙)"
        elif worse >= 2:
            fin, why = "못하다", f"{worse}명이 못하다"
        else:
            fin = "낫다" if better * 2 > n else "같다"
            why = f"못하다 {worse}명(2명 미만이라 세지 않음)" if worse else ""
        off_anchor = [L for L, a in zip(letters, anc) if sb_anchor and a and a != sb_anchor]
        prow.append(dict(shot=s, verdicts=verd, anchors=anc, storyboard_anchor=sb_anchor, final=fin, why=why,
                         key=("시그니처" if s in ks["signature"] else "") + ("첫 샷" if s == ks["first"] else "") + ("끝 샷" if s == ks["last"] else ""),
                         anchor_differs=off_anchor))
    sob = sum(r["final"] != "못하다" for r in prow)
    ratio = sob / len(prow) if prow else None
    key_bad = [r["shot"] for r in prow if r["final"] == "못하다" and r["shot"] in ks["key"]]
    pairs_pass = ratio is not None and ratio >= 0.8 and not key_bad
    # 3번째 비평가 (앞 두 명 기준)
    A, B = critics[0], critics[1]
    reasons = []
    d2 = [q for q in QS if A["quality"][q]["eff"] is not None and B["quality"][q]["eff"] is not None
          and abs(A["quality"][q]["eff"] - B["quality"][q]["eff"]) >= 2]
    if d2:
        reasons.append(dict(rule="1-3 ① 항목 2점 이상 차이", detail=", ".join(f"{q} {A['quality'][q]['eff']:g}/{B['quality'][q]['eff']:g}" for q in d2)))
    if A["own"]["passed"] != B["own"]["passed"]:
        reasons.append(dict(rule="1-3 ② A·B 통과 여부가 다름", detail=f"A {'통과' if A['own']['passed'] else '불통과'} / B {'통과' if B['own']['passed'] else '불통과'}"))
    ab_mean = None
    if A["own"]["mean"] is not None and B["own"]["mean"] is not None:
        ab_mean = round((A["own"]["mean"] + B["own"]["mean"]) / 2, 4)
        if BAND[0] <= ab_mean <= BAND[1]:
            reasons.append(dict(rule="1-3 ③ 두 명 평균이 경계 띠 7.75~8.25", detail=f"({A['own']['mean']} + {B['own']['mean']}) / 2 = {ab_mean}"))
    one_bad = []
    for s in ks["key"]:
        va = {p["shot"]: p["verdict"] for p in A["pairs"]}.get(s)
        vb = {p["shot"]: p["verdict"] for p in B["pairs"]}.get(s)
        if (va == "못하다") != (vb == "못하다"):
            one_bad.append(s)
    if one_bad:
        reasons.append(dict(rule="1-3 ④ 핵심 샷(시그니처·첫·끝)에 한 명만 '못하다'", detail=f"샷 {one_bad}"))
    gsplit_ab = [g for g in ("G2", "G4") if A["gates"][g] is not None and B["gates"][g] is not None and A["gates"][g] != B["gates"][g]]
    if gsplit_ab:
        reasons.append(dict(rule="4장 눈 확인 관문(G2·G4) 갈림", detail=", ".join(gsplit_ab)))
    need_third_rule = n == 2 and bool(reasons)  # 1장 3번 조건(v0.4까지의 need_third)
    need_third, cannot_change, scen, why3 = need_third_rule, False, None, ""
    if need_third_rule:
        # v0.5: 3번째가 결과를 바꿀 수 있는가 — 가상 C가 가장 좋게(모든 항목 10·관문 합격·맞대기 낫다) /
        # 가장 나쁘게(모든 항목 1·관문 불합격·맞대기 못하다) 매겼을 때 패널 통과 여부가 같으면 3번째는 결과를 못 바꾼다
        scen = {}
        for k, val in (("best", True), ("worst", False)):
            R3 = panel(copy.deepcopy(critics) + [virtual_third(10.0 if val else 1.0, val, ks["shots"] or shots)], info)
            scen[k] = dict(passed=R3["passed"], mean_of_medians=R3["quality"]["mean_of_medians"],
                           median={q: R3["quality"]["median"][q] for q in QS}, reasons=R3["reasons"])
        if scen["best"]["passed"] == scen["worst"]["passed"]:
            need_third, cannot_change = False, True
            if scen["best"]["passed"]:
                why3 = f"3번째가 모든 항목 1점·관문 불합격·맞대기 못하다를 줘도 통과(중앙값 평균 최소 {scen['worst']['mean_of_medians']})"
            else:
                why3 = (f"3번째가 모든 항목 10점·관문 합격·맞대기 낫다를 줘도 불통과(중앙값 평균 최대 {scen['best']['mean_of_medians']}; "
                        + "; ".join(scen["best"]["reasons"]) + ")")
        else:
            why3 = (f"3번째 점수에 따라 바뀜: 가장 좋게 주면 통과(중앙값 평균 {scen['best']['mean_of_medians']}), "
                    f"가장 나쁘게 주면 불통과({scen['worst']['mean_of_medians']})")
    # 통과
    why = []
    for g in GS:
        if gates[g]["result"] is False:
            why.append(f"관문 {g} 불합격")
        elif gates[g]["result"] is None and gates[g]["votes"] != [None] * n:
            why.append(f"관문 {g} 갈림")
    low = [q for q in QS if med[q] is not None and med[q] < 7]
    if low:
        why.append("중앙값 7 미만: " + ", ".join(f"{q} {med[q]:g}" for q in low))
    if mean_med is not None and mean_med < 8.0:
        why.append(f"중앙값 평균 {mean_med} < 8.0")
    if ratio is not None and ratio < 0.8:
        why.append(f"맞대기 같다 이상 {sob}/{len(prow)} < 80%")
    if key_bad:
        why.append(f"핵심 샷 맞대기 못하다: {key_bad}")
    passed = gates_pass and q_pass and pairs_pass
    if need_third:
        status = "보류 — 3번째 비평가 필요"
    elif cannot_change:
        # 두 명만으로 낸 결과가 아니라 '어떤 3번째가 와도 같은 결과'를 쓴다(두 명 계산과 다르면 메모)
        status = "통과" if scen["best"]["passed"] else "불통과"
        if scen["best"]["passed"] != passed:
            why.append(f"두 명 중앙값으로는 {'통과' if passed else '불통과'}이나, 3번째가 누구든 {status}")
    else:
        status = "통과" if passed else "불통과"
    # 고칠 것 후보
    agg = {}
    for c in critics:
        for f in c["fixes"]:
            for it in f["items"]:
                agg.setdefault(it, {})
                agg[it].setdefault(c["letter"], []).append(f["text"])
    def order(it):
        k = len(agg[it])
        m = med.get(it) if it in med else 99
        return (-min(k, 2), m if m is not None else 99, -k, it)
    fixes = []
    for it in sorted(agg, key=order):
        fixes.append(dict(item=it, name=QNAME.get(it, "관문" if it.startswith("G") else ""), n_critics=len(agg[it]), median=med.get(it),
                          group="2명 이상" if len(agg[it]) >= 2 else "1명", by=agg[it]))
    lowest = sorted([q for q in QS if med[q] is not None], key=lambda q: med[q])[:3]
    return dict(
        critic_version="0.3", n_critics=n,
        critics=[dict(letter=c["letter"], id=c["id"], folder=c["folder"], form=c["form"], video=c["video"],
                      own=c["own"], declared_pass=c["declared_pass"], notes=c["notes"]) for c in critics],
        storyboard=info["path"] if info else None, key_shots=ks,
        anchor_rule_2="적용(스토리보드에 anchor 있음)" if rule2 else "적용 안 함(스토리보드에 anchor가 없음 — v0.3 이전 작품)",
        quality=dict(table={q: table[q] for q in QS}, median=med, mean_of_medians=mean_med,
                     spread={q: (max(x for x in table[q] if x is not None) - min(x for x in table[q] if x is not None)) if any(x is not None for x in table[q]) else None for q in QS},
                     passed=q_pass),
        gates=dict(per_gate=gates, passed=gates_pass, split=gate_split),
        pairs=dict(rows=prow, same_or_better=f"{sob}/{len(prow)}", ratio=round(ratio, 3) if ratio is not None else None,
                   key_worse=key_bad, passed=pairs_pass),
        passed=passed, status=status, reasons=why,
        need_third=need_third, need_third_reasons=reasons, ab_mean=ab_mean,
        need_third_rule=need_third_rule, third_cannot_change=cannot_change, need_third_why=why3, third_scenarios=scen,
        need_third_note=("앞 두 명(A·B) 기준. 비평가가 3명 이상이라 이미 C까지 매겼음" if n >= 3 else "앞 두 명(A·B) 기준"),
        fix_candidates=fixes, lowest_items=lowest,
        fix_rule="critic_v0.3 4장: 2명 이상이 짚은 것 먼저, 그다음 중앙값이 가장 낮은 항목 순서로 3개. 묶는 것은 지휘하는 쪽이 읽고 정한다")


def virtual_third(score, good, shots):
    """need_third 계산용 가상 3번째 비평가: 모든 항목 score, 관문 모두 good, 맞대기 모든 샷 낫다(good)/못하다."""
    return dict(id="가상 C(" + ("최고" if good else "최저") + ")", folder="", form="v0.3", video=None,
                gates={g: good for g in GS},
                quality={q: dict(score=score, cap=None, eff=score, why="", frames=[]) for q in QS},
                pairs=[dict(shot=x, anchor=None, frame=None, verdict="낫다" if good else "못하다", why="") for x in shots],
                signature_shots=[], fixes=[], declared_pass=None, notes=[])


# ---------------------------------------------------------------- 쓰기
def fmt(x):
    if x is None:
        return "–"
    if isinstance(x, bool):
        return "합격" if x else "불합격"
    if isinstance(x, float):
        return f"{x:g}"
    return str(x)


def write_md(R, path):
    L = R["critics"]
    hdr = [c["letter"] for c in L]
    o = [f"# 비평 패널 (v0.3) — {R['status']}", ""]
    for k, lab in (("warning", "경고"), ("video_note", "안내")):
        if R.get(k):
            o += [f"> {lab}: {R[k]}", ""]
    o.append("| 비평가 | 폴더 | 양식 | 본인 평균 | v0.3 규칙으로 본 본인 판정 | 적은 판정 |")
    o.append("|---|---|---|---|---|---|")
    for c in L:
        own = c["own"]
        o.append(f"| {c['letter']} | `{c['folder']}` | {c['form']} | {fmt(own['mean'])} | {'통과' if own['passed'] else '불통과'}"
                 f"{(' (' + '; '.join(own['reasons']) + ')') if own['reasons'] else ''} | {fmt(c['declared_pass']) if c['declared_pass'] is not None else '–'} |")
    o += ["", "## 품질 (항목별 중앙값)", "", "| 항목 | " + " | ".join(hdr) + " | 중앙값 | 폭 |", "|---|" + "---|" * (len(hdr) + 2)]
    for q in QS:
        o.append(f"| {q} {QNAME[q]} | " + " | ".join(fmt(x) for x in R["quality"]["table"][q]) + f" | **{fmt(R['quality']['median'][q])}** | {fmt(R['quality']['spread'][q])} |")
    means = [fmt(c["own"]["mean"]) for c in L]
    o.append("| 평균 | " + " | ".join(means) + f" | **{fmt(R['quality']['mean_of_medians'])}** (중앙값 평균) | |")
    o += ["", f"품질 조건(중앙값 모두 7 이상, 중앙값 평균 8.0 이상): **{'충족' if R['quality']['passed'] else '못 채움'}**", ""]
    o += ["## 관문", "", "| 관문 | " + " | ".join(hdr) + " | 합침 | 메모 |", "|---|" + "---|" * (len(hdr) + 2)]
    for g in GS:
        G = R["gates"]["per_gate"][g]
        o.append(f"| {g} | " + " | ".join(fmt(x) for x in G["votes"]) + f" | {'갈림' if G['result'] is None and any(v is not None for v in G['votes']) else fmt(G['result'])} | {G['note']} |")
    ks = R["key_shots"]
    o += ["", f"## 맞대기 (같은 샷에 2명 이상 '못하다'일 때만 못하다) — 핵심 샷: 시그니처 {ks['signature']}({ks['signature_from']}), 첫 {ks['first']}, 끝 {ks['last']}", "",
          "| 샷 | 핵심 | " + " | ".join(hdr) + " | 스토리보드 기준 그림 | 최종 | 메모 |", "|---|---|" + "---|" * (len(hdr) + 3)]
    for r in R["pairs"]["rows"]:
        cells = [f"{v or '–'}" + (f" ({a})" if a and a != r["storyboard_anchor"] else "") for v, a in zip(r["verdicts"], r["anchors"])]
        o.append(f"| {r['shot']} | {r['key']} | " + " | ".join(cells) + f" | {r['storyboard_anchor'] or '–'} | **{r['final']}** | {r['why']} |")
    o += ["", f"같다 이상 {R['pairs']['same_or_better']}, 핵심 샷 못하다 {R['pairs']['key_worse'] or '없음'} → 맞대기 **{'통과' if R['pairs']['passed'] else '불통과'}**. "
          f"괄호 = 스토리보드와 다른 기준 그림을 쓴 비평가. 기준 그림 규칙(2장): {R['anchor_rule_2']}", ""]
    o += ["## 판정", "", f"- **{R['status']}** (규칙대로 계산한 결과: {'통과' if R['passed'] else '불통과'})"]
    for w in R["reasons"]:
        o.append(f"  - {w}")
    o += [f"- 3번째 비평가 필요(need_third): **{R['need_third']}** — {R['need_third_note']}, 두 명 평균 {fmt(R['ab_mean'])}"]
    o.append(f"  - 1장 3번 조건(need_third_rule): {R['need_third_rule']}")
    for r in R["need_third_reasons"]:
        o.append(f"    - {r['rule']}: {r['detail']}")
    if not R["need_third_reasons"]:
        o.append("    - 걸린 조건 없음")
    if R.get("need_third_why"):
        o.append(f"  - 3번째가 결과를 바꿀 수 있는가: {'못 바꿈(third_cannot_change)' if R['third_cannot_change'] else '바꿀 수 있음'} — {R['need_third_why']}")
    o += ["", "## 고칠 것 후보 (2명 이상이 짚은 것 먼저 → 중앙값 낮은 순)", ""]
    for f in R["fix_candidates"]:
        o.append(f"- **{f['item']} {f['name']}** — {f['n_critics']}명({', '.join(f['by'])}), 중앙값 {fmt(f['median'])}")
        for who, ts in f["by"].items():
            for t in ts:
                o.append(f"  - {who}: {t[:220]}{'…' if len(t) > 220 else ''}")
    lows = ", ".join(q + " " + fmt(R["quality"]["median"][q]) for q in R["lowest_items"])
    o += ["", f"중앙값이 가장 낮은 항목: {lows}. {R['fix_rule']}"]
    notes = [f"{c['letter']}: {n}" for c in L for n in c["notes"]]
    if notes:
        o += ["", "## 읽기 메모", ""] + [f"- {n}" for n in notes]
    open(path, "w", encoding="utf-8").write("\n".join(o) + "\n")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("critics", nargs="+", help="비평가 폴더(critic.json) 2개 이상. 앞의 두 개가 A·B")
    ap.add_argument("--out", required=True)
    ap.add_argument("--shots", help="storyboard/shots.json (없으면 비평 폴더 위쪽·critic.json의 video 경로로 찾음)")
    a = ap.parse_args()
    if len(a.critics) < 2:
        ap.error("비평가 폴더가 2개 이상 필요")
    C = [load_critic(f) for f in a.critics]
    vids, nopath = {}, []
    for i, c in enumerate(C):
        v = (c["video"] or "").strip()
        work, found = video_work(c)
        if work:   # 작품 비교는 작업 폴더 이름으로(찾은 경로·글자 꼴이 섞여도 같게)
            vids.setdefault(os.path.basename(os.path.normpath(work)), []).append(chr(65 + i))
        else:  # video 칸이 비었거나, 상대 경로인데 비평 폴더 위쪽 어디에도 그 영상이 없음 → 작품 비교에서 빼고 안내만
            nopath.append(f"{chr(65 + i)}({c['id']}): " + (f"'{v}'를 비평 폴더 위쪽에서 못 찾음" if v else "video 칸 비어 있음"))
    info = shots_info(find_shots(C, a.shots))
    R = panel(C, info)
    if len(vids) > 1:
        R["warning"] = f"비평가들의 영상 경로가 서로 다른 작품을 가리킴: {dict(sorted(vids.items()))}"
        print("경고:", R["warning"], file=sys.stderr)
    if nopath:
        R["video_note"] = ("영상을 못 찾음(작품 비교에서 뺌 — critic.json video 칸은 작업 폴더 기준 'out/final.mp4' 또는 절대 경로, "
                           "비평 폴더는 작업 폴더 안 review/ 아래): " + "; ".join(nopath))
        print("안내:", R["video_note"], file=sys.stderr)
    os.makedirs(a.out, exist_ok=True)
    json.dump(R, open(os.path.join(a.out, "panel.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    write_md(R, os.path.join(a.out, "panel.md"))
    print(json.dumps(dict(status=R["status"], median={q: R["quality"]["median"][q] for q in QS}, mean_of_medians=R["quality"]["mean_of_medians"],
                          pairs=R["pairs"]["same_or_better"], need_third=R["need_third"], need_third_rule=R["need_third_rule"],
                          third_cannot_change=R["third_cannot_change"],
                          need_third_reasons=[r["rule"] for r in R["need_third_reasons"]]), ensure_ascii=False))


if __name__ == "__main__":
    main()
