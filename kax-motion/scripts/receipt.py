#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""kax-motion 영수증: 이 작업에서 Claude Code가 쓴 요청·토큰을 세션 기록에서 세고 API 요금으로 환산한다.

사용(작업 폴더에서):
  python3 -I scripts/receipt.py [--since 2026-11-02T01:00:00Z] [--session <세션 id 또는 .jsonl 경로>]
                               [--md review/receipt.md] [--price 입력,출력,캐시읽기,캐시쓰기5분,캐시쓰기1시간]
- 시작 시각: --since가 없으면 작업 폴더 kax.json의 started_at, 그것도 없으면 세션 처음부터.
- 세션: --session이 없으면 ~/.claude/projects/ 아래에서 지금 폴더(없으면 위 폴더들)에 맞는 기록 중 가장 최근 것.
- 같은 메시지가 여러 줄로 기록되므로 메시지 id마다 한 번만 센다. 서브 에이전트(비평가 등) 기록도 더한다.
- 요금($/MTok)은 아래 PRICES에 있는 모델만 셈한다. 없는 모델은 --price로 주거나 토큰만 적는다(값을 지어내지 않는다).
- 구독 요금제면 추가 결제는 0원이고, 이 값은 같은 일을 API로 했을 때의 어림이다.
"""
import datetime as dt
import glob
import json
import os
import re
import sys
import unicodedata

# 모델 id 앞부분 → (입력, 출력, 캐시 읽기, 캐시 쓰기 5분, 캐시 쓰기 1시간) $/MTok
PRICES = {
    "claude-opus-5-5": (4.0, 20.0, 0.20, 5.0, 8.0),
}
KEYS = ("in", "out", "read", "w5m", "w1h")


def arg(name, default=None):
    if name in sys.argv:
        i = sys.argv.index(name)
        if i + 1 < len(sys.argv):
            return sys.argv[i + 1]
    return default


def project_dirs(start):
    root = os.path.expanduser("~/.claude/projects")
    home = os.path.expanduser("~")
    d = os.path.abspath(start)
    while True:
        if d == os.path.dirname(d) or (d != home and not d.startswith(home + os.sep) and d != os.path.abspath(start)):
            break   # 루트, 그리고 홈 밖의 위 폴더는 보지 않는다(지금 폴더 자체는 봄)
        # 파일 시스템이 한글 경로를 자모로 나눈 꼴(NFD)로 돌려줄 수 있다 — Claude Code 폴더 이름은 합친 꼴(NFC) 기준
        for form in ("NFC", "NFD"):
            slug = re.sub(r"[^A-Za-z0-9]", "-", unicodedata.normalize(form, d))
            p = os.path.join(root, slug)
            if os.path.isdir(p):
                yield p
                break
        parent = os.path.dirname(d)
        if parent == d:
            break
        d = parent


def find_session(spec):
    if spec:
        if spec.endswith(".jsonl") and os.path.exists(spec):
            return spec
        for p in glob.glob(os.path.expanduser(f"~/.claude/projects/*/{spec}.jsonl")):
            return p
        sys.exit(f"세션 기록을 못 찾음: {spec}")
    files = [f for pd in project_dirs(os.getcwd()) for f in glob.glob(os.path.join(pd, "*.jsonl"))]
    if files:
        newest = max(files, key=os.path.getmtime)
        # 지금 도는 세션은 방금도 기록을 쓴다 — 15분 넘게 멈춘 기록이면 다른 세션일 수 있어 고르지 않는다
        if dt.datetime.now().timestamp() - os.path.getmtime(newest) <= 900:
            return newest
    sys.exit("이 폴더에서 지금 도는 Claude Code 세션 기록을 못 찾음 — --session <id 또는 경로>로 알려 주세요.")


def started_at():
    p = os.path.join(os.getcwd(), "kax.json")
    if os.path.exists(p):
        try:
            return json.load(open(p, encoding="utf-8")).get("started_at")
        except Exception:
            return None
    return None


def price_for(model, override):
    if override:
        return override
    for k, v in PRICES.items():
        if model.startswith(k):
            return v
    return None


def scan(path, since):
    best = {}
    for line in open(path, encoding="utf-8"):
        if '"usage"' not in line:
            continue
        try:
            o = json.loads(line)
        except Exception:
            continue
        if o.get("type") != "assistant":
            continue
        ts = o.get("timestamp", "")
        if since and ts < since:
            continue
        m = o.get("message", {})
        u = m.get("usage") or {}
        mid = m.get("id") or o.get("requestId") or o.get("uuid")
        prev = best.get(mid)
        if prev is None or u.get("output_tokens", 0) >= prev[0].get("output_tokens", 0):
            best[mid] = (u, m.get("model", "?"), ts)
    return best


def tally(best, override):
    acc = dict.fromkeys(KEYS, 0)
    acc.update(req=0, cost=0.0, unpriced=set(), first=None, last=None)
    for u, model, ts in best.values():
        cc = u.get("cache_creation") or {}
        w1h = cc.get("ephemeral_1h_input_tokens", 0) or 0
        w5m = cc.get("ephemeral_5m_input_tokens", 0) or 0
        if w1h + w5m == 0:
            w5m = u.get("cache_creation_input_tokens", 0) or 0   # 나눔 정보가 없으면 5분으로 본다
        n = (u.get("input_tokens", 0) or 0, u.get("output_tokens", 0) or 0,
             u.get("cache_read_input_tokens", 0) or 0, w5m, w1h)
        for k, v in zip(KEYS, n):
            acc[k] += v
        acc["req"] += 1
        p = price_for(model, override)
        if p is None:
            acc["unpriced"].add(model)
        else:
            acc["cost"] += sum(a * b for a, b in zip(n, p)) / 1e6
        acc["first"] = ts if acc["first"] is None or ts < acc["first"] else acc["first"]
        acc["last"] = ts if acc["last"] is None or ts > acc["last"] else acc["last"]
    return acc


def local(ts):
    if not ts:
        return "-"
    t = dt.datetime.fromisoformat(ts.replace("Z", "+00:00")).astimezone()
    return t.strftime("%m/%d %H:%M")


def main():
    override = arg("--price")
    if override:
        override = tuple(float(x) for x in override.split(","))
        if len(override) != 5:
            sys.exit("--price는 입력,출력,캐시읽기,캐시쓰기5분,캐시쓰기1시간 다섯 값($/MTok)")
    since = arg("--since") or started_at()
    main_path = find_session(arg("--session"))
    sid = os.path.basename(main_path)[:-len(".jsonl")]
    rows = [("메인 세션", tally(scan(main_path, since), override))]
    sub = os.path.join(os.path.dirname(main_path), sid, "subagents")
    for p in sorted(glob.glob(os.path.join(sub, "agent-*.jsonl"))):
        acc = tally(scan(p, since), override)
        if acc["req"] == 0:
            continue
        name = os.path.basename(p)[len("agent-"):-len(".jsonl")][:8]
        meta = p[:-len(".jsonl")] + ".meta.json"
        if os.path.exists(meta):
            try:
                d = json.load(open(meta, encoding="utf-8"))
                name = d.get("name") or d.get("description") or name
            except Exception:
                pass
        rows.append((f"서브 에이전트 {name}", acc))
    rows[1:] = sorted(rows[1:], key=lambda r: r[1]["first"] or "")
    tot = dict.fromkeys(KEYS, 0)
    tot.update(req=0, cost=0.0, unpriced=set(), first=None, last=None)
    for _, a in rows:
        for k in KEYS + ("req", "cost"):
            tot[k] += a[k]
        tot["unpriced"] |= a["unpriced"]
        for k, f in (("first", min), ("last", max)):
            if a[k]:
                tot[k] = a[k] if tot[k] is None else f(tot[k], a[k])
    out = ["| 누가 | 요청 | 입력 | 출력 | 캐시 읽기 | 캐시 쓰기 5분 | 캐시 쓰기 1시간 | API 환산 $ | 시각 |",
           "|---|---|---|---|---|---|---|---|---|"]
    for name, a in rows + [("**합계**", tot)]:
        out.append(f"| {name} | {a['req']:,} | {a['in']:,} | {a['out']:,} | {a['read']:,} | {a['w5m']:,} | {a['w1h']:,} | "
                   f"{a['cost']:,.2f} | {local(a['first'])}~{local(a['last'])} |")
    out.append("")
    out.append(f"시작 시각: {since or '세션 처음부터'} · 세션 기록: {os.path.basename(main_path)}")
    if tot["unpriced"]:
        out.append(f"요금표에 없는 모델(토큰만 셈, 환산에서 빠짐): {', '.join(sorted(tot['unpriced']))} — `--price`로 주면 셈")
    out.append("구독 요금제면 추가 결제 0원 — 위 값은 같은 일을 API로 했을 때의 어림.")
    text = "\n".join(out)
    print(text)
    md = arg("--md")
    if md:
        os.makedirs(os.path.dirname(md) or ".", exist_ok=True)
        open(md, "w", encoding="utf-8").write("# 영수증\n\n" + text + "\n")


if __name__ == "__main__":
    main()
