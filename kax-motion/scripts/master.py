#!/usr/bin/env python3
"""kax-motion 기본 마스터: 선형 이득 + 미리보기 피크 리미터. loudnorm을 쓰지 않는다.

왜: 2패스 loudnorm은 선형으로 맞출 수 없으면(트루피크 여유가 모자라면) 조용히
동적 자동 음량으로 바뀌어, 큰 사건 바로 뒤의 작은 사건을 끌어올린다 → 크기 위계(Q8 ②)가 무너진다.
이 스크립트는 믹스 전체에
**같은 이득 하나**를 곱하고, 넘치는 순간만 2ms 미리보기·80ms 되돌림 리미터로 눌러 트루피크를 막는다.
이득은 목표 LUFS가 될 때까지 되풀이해 찾는다. 바탕(패드·비트)과 효과음의 크기 비는 그대로 남는다.

HyperFrames 0.8.188은 렌더 때 소리를 AAC 192k로 굳히고 그 트루피크가 -1 dBTP를 넘으면 전체를 낮춘다. 그래서 마지막에
같은 AAC로 굳혀 트루피크를 재고, -1.2 dBTP를 넘으면 리미터 천장을 그만큼 낮춰 다시 한다.

사용 (프로젝트 루트에서):
  python3 -I scripts/master.py audio/mix_raw.wav audio/mix.wav
  python3 -I scripts/master.py audio/mix_raw.wav audio/mix.wav --target -14 --ceiling -2 \
      --events audio/events.json --report review/master.json

--events: 효과음 계획(`measure_motion.py --sfx`와 같은 형식: {"fps", "events": [{frame 또는 time_s, tier}]}) —
  사건마다 리미터가 얼마나 눌렀는지, 등급별(signature·first vs normal) 크기 차가 마스터 전후로 그대로인지 보고한다.
  잴 수 있는 것은 믹스 한 줄에서의 사건 창 크기다(같은 창 정의: [t−30ms, t+90ms]의 20ms RMS 최댓값).
결과: 화면에 한 줄 요약, --report에 JSON. 리미터 때문에 위계가 +4dB 아래로 내려갔거나, 목표 LUFS·AAC 트루피크를 못 맞췄으면
경고하고 종료 코드 2. 위계가 0.5dB 넘게 줄었지만 +4dB 위면 '참고'로만 알린다.
입력: 섞은 믹스(마스터 전)는 표본 봉우리를 0 dBFS 아래(−3 dBFS 안팎)로 둔다 — 음량은 이 스크립트가 맞춘다. 입력이 0 dBFS에서
잘려 있으면(전 눈금에서 같은 값이 3표본 넘게 이어짐, 16비트 WAV에 넘친 믹스를 쓴 흔적) 경고하고 종료 코드 2(--report input.clipped_*).
(R12 효과음 등급 순서) --events가 있으면 마스터 뒤 등급별(detail / normal / first·signature) 사건 크기 중앙값을 한 줄 더 보고하고(--report의 tier_order),
detail 중앙값이 normal 중앙값보다 2dB 이상 작지 않으면(등급 순서 뒤집힘, 비평 Q8 ④) 경고하고 종료 코드 2. 이때도 마스터가 아니라 믹스를 고친다.
(v0.6.6 짧은 소리 봉우리) --events가 있으면 사건마다 창의 표본 봉우리 − 20ms RMS(crest_db)를 --report events[]에 적고, 12dB를 넘는 사건(peaky_events)이
있으면 리미터 경고 글 끝에 '원인 후보'로 붙인다 — 4~30ms 소리를 RMS 크기로 맞추면 봉우리가 13dB 넘게 솟아 리미터가 그것부터 누른다(references/sound.md 5장).
"""
import argparse
import json
import os
import re
import subprocess
import sys

for _k in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS"):
    os.environ.setdefault(_k, "2")   # 스레드 2개

import numpy as np
from scipy.io import wavfile
from scipy.ndimage import minimum_filter1d
from scipy.signal import resample_poly

AAC_ARGS = ["-acodec", "aac", "-b:a", "192k"]   # HyperFrames 0.8.188과 같음
AAC_CEILING = -1.2                              # HyperFrames는 -1.0 넘으면 낮춤 → 여유 0.2
TIER_GAP_DB = 2.0                               # R12 효과음 등급 순서: detail 중앙값 ≤ normal 중앙값 − 2dB (비평 Q8 ④)
TIER_ALIAS = {"general": "normal", "일반": "normal", "디테일": "detail", "시그니처": "signature", "첫 사건": "first"}  # measure_motion TIERS와 같음


def ebur(path):
    """ffmpeg ebur128 → (I LUFS, true peak dBTP, LRA LU)"""
    o = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", path, "-af", "ebur128=peak=true", "-f", "null", "-"],
                       capture_output=True, text=True).stderr
    I = float(re.findall(r"I:\s+(-?[\d.]+) LUFS", o)[-1])
    tp = re.findall(r"Peak:\s+(-?[\d.]+|-inf) dBFS", o)[-1]
    lra = float(re.findall(r"LRA:\s+(-?[\d.]+) LU", o)[-1])
    return I, (-120.0 if tp == "-inf" else float(tp)), lra


def aac_true_peak(path):
    tmp = path + ".aac-check.m4a"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", path, *AAC_ARGS, tmp], check=True)
    try:
        return ebur(tmp)[1]
    finally:
        os.remove(tmp)


def limiter_gain(y, sr, ceiling_db, lookahead=0.002, release=0.08):
    """4배 오버샘플 피크 기준 리미터의 이득 곡선(1 = 안 누름). 미리보기 lookahead초 동안 미리 내려가 있고, 되돌림은 release초."""
    over = np.abs(resample_poly(y, 4, 1, axis=0)).max(axis=1)
    peak = over[: len(y) * 4].reshape(len(y), 4).max(axis=1)
    need = np.minimum(1.0, 10 ** (ceiling_db / 20) / np.maximum(peak, 1e-9))
    hold = max(1, int(lookahead * sr))
    g = minimum_filter1d(need, size=2 * hold + 1)
    rel = np.exp(-1.0 / (release * sr))
    out = np.empty(len(g))
    cur = 1.0
    gl = g.tolist()
    for i, v in enumerate(gl):
        cur = v if v < cur else rel * cur + (1 - rel) * v
        out[i] = cur
    k = max(1, int(0.001 * sr))
    return np.minimum(out, np.convolve(out, np.ones(k) / k, mode="same"))   # 꺾임만 둥글게, 위로는 안 올림


def read_wav(path):
    sr, x = wavfile.read(path)
    if x.dtype.kind == "i":
        x = x / float(np.iinfo(x.dtype).max + 1)
    elif x.dtype.kind == "u":
        x = (x.astype(np.float64) - 128) / 128
    else:
        x = x.astype(np.float64)
    return sr, (x[:, None] if x.ndim == 1 else x)


FULL_SCALE = 32767 / 32768 - 1e-7   # 16비트 WAV 전 눈금(+32767 → 0.99997, −32768 → −1.0)


def clip_runs(x, min_run=3):
    """마스터 전 믹스가 0 dBFS에서 잘린 흔적 → (잘린 곳 수, 표본 수). 채널마다 전 눈금(|x| ≥ 32767/32768)에서 같은 값이
    min_run표본 넘게 이어진 곳만 센다 — 0 dBFS로 맞춘 낮은 소리의 봉우리(이웃 표본 값이 다름)는 세지 않는다."""
    n_runs = n_smp = 0
    for c in range(x.shape[1]):
        v = x[:, c]
        m = np.abs(v) >= FULL_SCALE
        if not m.any():
            continue
        same = (m[1:] & m[:-1] & (v[1:] == v[:-1])).astype(np.int8)
        d = np.diff(np.concatenate([[0], same, [0]]))
        lens = np.where(d == -1)[0] - np.where(d == 1)[0] + 1   # 같은 값 짝 k개 = 표본 k+1개
        lens = lens[lens >= min_run]
        n_runs += int(len(lens))
        n_smp += int(lens.sum())
    return n_runs, n_smp


def read_events(path, fps_default):
    j = json.load(open(path, encoding="utf-8"))
    fps = j.get("fps", fps_default) if isinstance(j, dict) else fps_default
    if isinstance(fps, str) and "/" in fps:   # "30000/1001"
        n_, d_ = fps.split("/")
        fps = float(n_) / float(d_)
    fps = float(fps)
    rows = (j.get("events") or j.get("rows") or []) if isinstance(j, dict) else j
    out = []
    for e in rows:
        if "time_s" in e:
            t = float(e["time_s"])
        elif "frame" in e:
            t = float(e["frame"]) / fps
        elif "k" in e:
            t = float(e["k"]) / fps
        else:
            continue
        tier = str(e.get("tier", "normal")).strip().lower() or "normal"
        out.append(dict(t=t, tier=tier, name=e.get("event") or e.get("id") or e.get("type") or ""))
    return sorted(out, key=lambda e: e["t"])


def event_levels(mono, sr, ev):
    """measure_motion --sfx와 같은 사건 창: [t−30ms, t+90ms]의 20ms RMS(5ms 간격) 최댓값, dBFS"""
    hop, win = int(0.005 * sr), int(0.02 * sr)
    sq = np.concatenate([[0.0], np.cumsum(mono * mono)])
    starts = np.arange(0, max(1, len(mono) - win), hop)
    rms = np.sqrt(np.maximum(0, sq[starts + win] - sq[starts]) / win)
    tc = (starts + win / 2) / sr
    lv = []
    for e in ev:
        m = (tc >= e["t"] - 0.03) & (tc <= e["t"] + 0.09)
        lv.append(float(20 * np.log10(max(rms[m].max(), 1e-6))) if m.any() else None)
    return lv


CREST_HINT_DB = 12.0   # 사건 창의 표본 봉우리 − 20ms RMS가 이보다 크면 '짧은 소리 봉우리' 힌트(references/sound.md 5장)


def event_crest(mono, sr, ev, levels):
    """사건 창 [t−30ms, t+90ms]의 표본 봉우리(dBFS) − 그 창 20ms RMS 최댓값(event_levels) = 봉우리 높이(dB). 4~30ms짜리 짧은 소리를
    20ms RMS 기준 크기(sfx.json gain_db)로 맞추면 이 값이 13dB를 넘어 리미터가 그 봉우리부터 누른다."""
    out = []
    for e, lv in zip(ev, levels):
        a, b = max(0, int((e["t"] - 0.03) * sr)), min(len(mono), int((e["t"] + 0.09) * sr))
        if lv is None or b <= a:
            out.append(None)
            continue
        pk = float(20 * np.log10(max(float(np.abs(mono[a:b]).max()), 1e-9)))
        out.append(round(pk - lv, 1))
    return out


def hierarchy(levels, ev):
    """등급별 중앙값 − normal 중앙값(normal이 없으면 detail) — measure_motion --sfx 2_hierarchy와 같은 기준"""
    by = {}
    for v, e in zip(levels, ev):
        if v is not None:
            by.setdefault(e["tier"], []).append(v)
    gen = by.get("normal") or by.get("detail")
    if not gen:
        return {}
    g = float(np.median(gen))
    return {t: round(float(np.median(by[t])) - g, 2) for t in ("signature", "first") if t in by}


def tier_medians(levels, ev):
    """R12 등급 순서: 등급별(detail / normal / first·signature) 사건 크기 중앙값과 detail − normal.
    measure_motion --sfx tier_order와 같은 기준(같은 사건 창, 0.1dB로 반올림한 중앙값의 차, ok = 차 ≤ −2dB). detail이나 normal이 없으면 ok None"""
    by = {"detail": [], "normal": [], "first_signature": []}
    for v, e in zip(levels, ev):
        t = TIER_ALIAS.get(e["tier"], e["tier"])
        k = "first_signature" if t in ("first", "signature") else t
        if v is not None and k in by:
            by[k].append(v)
    med = {k: (round(float(np.median(v)), 1) if v else None) for k, v in by.items()}
    d = None if med["detail"] is None or med["normal"] is None else round(med["detail"] - med["normal"], 1)
    return dict(n={k: len(v) for k, v in by.items()}, median_dbfs=med, detail_minus_normal_db=d,
                ok=None if d is None else d <= -TIER_GAP_DB)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("src")
    ap.add_argument("dst")
    ap.add_argument("--target", type=float, default=-14.0, help="목표 통합 음량 LUFS (기본 -14, 01 규칙 ±0.5)")
    ap.add_argument("--tol", type=float, default=0.15, help="LUFS 허용 오차 (기본 0.15)")
    ap.add_argument("--ceiling", type=float, default=-2.0, help="리미터 천장 dBTP (기본 -2.0; AAC로 굳힌 뒤 -1.2 아래가 되게 스스로 낮춤)")
    ap.add_argument("--release", type=float, default=0.08, help="리미터 되돌림 초 (기본 0.08)")
    ap.add_argument("--events", help="효과음 계획 JSON(tier) — 사건별 리미터 눌림·위계 전후 보고")
    ap.add_argument("--fps", type=float, default=24.0, help="--events에 fps가 없을 때")
    ap.add_argument("--report", help="결과 JSON 경로")
    ap.add_argument("--no-aac-check", action="store_true")
    a = ap.parse_args()

    sr, x = read_wav(a.src)
    I0, tp0, lra0 = ebur(a.src)
    ev = read_events(a.events, a.fps) if a.events else []
    passes, warn = [], []
    peak0 = float(20 * np.log10(max(float(np.abs(x).max()), 1e-9)))
    n_clip, n_clip_smp = clip_runs(x)
    if n_clip:   # 잘린 소리는 마스터(이득 + 리미터)가 되돌리지 못한다 — 믹스를 고쳐 다시 쓴다(references/sound.md 5장)
        warn.append(f"마스터 전 믹스가 0 dBFS에서 잘려 있다(잘린 곳 {n_clip}군데·{n_clip_smp}표본, 표본 봉우리 {peak0:+.1f} dBFS). "
                    "잘린 소리는 마스터가 되돌리지 못한다 → 섞은 뒤 믹스 전체에 같은 이득을 곱해 표본 봉우리를 −3 dBFS로 내리고 다시 쓴다")
    ceiling = a.ceiling
    for attempt in range(4):
        gdb = a.target - I0   # 첫 추정: 리미터가 없을 때의 이득
        for it in range(8):
            y0 = x * 10 ** (gdb / 20)
            g = limiter_gain(y0, sr, ceiling, release=a.release)
            y = y0 * g[:, None]
            wavfile.write(a.dst, sr, (np.clip(y, -1, 1) * 32767).round().astype(np.int16))
            I, tp, lra = ebur(a.dst)
            passes.append(dict(ceiling_dbtp=ceiling, gain_db=round(gdb, 2), I=I, TP=tp))
            print(f"  천장 {ceiling:+.1f} dBTP · 이득 {gdb:+.2f} dB → {I:.1f} LUFS, 트루피크 {tp:.1f} dBTP")
            if abs(I - a.target) < a.tol:
                break
            gdb += a.target - I
        aac_tp = None if a.no_aac_check else aac_true_peak(a.dst)
        if aac_tp is None or aac_tp <= AAC_CEILING:
            break
        ceiling -= (aac_tp - AAC_CEILING) + 0.2
        print(f"  AAC로 굳히면 트루피크 {aac_tp:.1f} dBTP > {AAC_CEILING} → 천장을 {ceiling:+.1f}로 낮춰 다시")

    red = -20 * np.log10(np.maximum(g, 1e-9))
    lim = dict(max_reduction_db=round(float(red.max()), 2),
               pct_samples_over_1db=round(100 * float((red > 1).mean()), 2),
               pct_samples_over_3db=round(100 * float((red > 3).mean()), 2))
    rep = dict(tool="kax-motion scripts/master.py v0.6", src=a.src, dst=a.dst,
               method="선형 이득 하나 + 4배 오버샘플 피크 리미터(미리보기 2ms, 되돌림 %.0fms). loudnorm·동적 음량 없음" % (a.release * 1000),
               input=dict(I=I0, TP=tp0, LRA=lra0, sample_peak_dbfs=round(peak0, 2), clipped_runs=n_clip, clipped_samples=n_clip_smp),
               target_lufs=a.target, gain_db=round(gdb, 2), ceiling_dbtp=round(ceiling, 2),
               output=dict(I=I, TP=tp, LRA=lra), aac192k_true_peak=aac_tp, limiter=lim, passes=passes)
    if abs(I - a.target) >= max(a.tol, 0.5):
        warn.append(f"목표 {a.target} LUFS를 못 맞춤({I}). 사건만 있고 바탕이 없는 성긴 믹스는 리미터를 세게 걸어도 잘 안 커진다 → 바탕을 깔거나 목표를 낮춘다")
    if lim["pct_samples_over_1db"] > 5:
        warn.append(f"리미터가 전체 시간의 {lim['pct_samples_over_1db']}%를 1dB 넘게 눌렀다(된 믹스: 0~3%). 리미터가 음량을 만들고 있어 위계가 눌린다 → "
                    "마스터 전 믹스를 목표 가까이 키우고(바탕·일반 사건을 올림) 가장 큰 사건만 봉우리가 남게 한다")
    if aac_tp is not None and aac_tp > AAC_CEILING:
        warn.append(f"AAC 트루피크 {aac_tp} > {AAC_CEILING} dBTP — HyperFrames가 렌더 때 전체를 낮춘다. 가장 큰 사건을 믹스에서 줄인다")
    if ev:
        m_in = (x * 10 ** (gdb / 20)).mean(axis=1)
        m_out = y.mean(axis=1)
        lv_in, lv_out = event_levels(m_in, sr, ev), event_levels(m_out, sr, ev)
        h_in, h_out = hierarchy(lv_in, ev), hierarchy(lv_out, ev)
        crest = event_crest(m_in, sr, ev, lv_in)
        rows = []
        for e, li, lo, cr in zip(ev, lv_in, lv_out, crest):
            rows.append(dict(time_s=round(e["t"], 3), tier=e["tier"], name=e["name"],
                             level_linear_gain_dbfs=None if li is None else round(li, 1),
                             level_out_dbfs=None if lo is None else round(lo, 1),
                             limiter_db=None if li is None or lo is None else round(lo - li, 2),
                             crest_db=cr))
        rep["events"] = rows
        rep["hierarchy_db"] = dict(linear_gain_only=h_in, after_limiter=h_out,
                                   note="등급 중앙값 − normal 중앙값. linear_gain_only = 리미터 전(이득만), after_limiter = 결과. 차가 0.5dB 넘게 줄면 경고")
        notes = []
        for t in h_in:
            if t not in h_out:
                continue
            d = h_in[t] - h_out[t]
            if h_out[t] < 4 <= h_in[t]:
                warn.append(f"리미터가 {t} 위계를 +4dB 아래로 눌렀다({h_in[t]} → {h_out[t]}dB, Q8 ②). 그 사건을 믹스에서 1~3dB 줄이거나 천장을 올리고 다시 한다")
            elif d > 0.5:
                notes.append(f"리미터가 {t} 사건을 다른 사건보다 {d:.1f}dB 더 눌렀다({h_in[t]} → {h_out[t]}dB). +4dB 위라 Q8은 그대로지만, 차이를 지키려면 그 소리를 믹스에서 미리 줄인다")
        rep["notes"] = notes
        worst = min((r for r in rows if r["limiter_db"] is not None), key=lambda r: r["limiter_db"], default=None)
        if worst:
            rep["most_limited_event"] = worst
        # R12 등급 순서(비평 Q8 ④): 마스터 뒤 detail이 normal보다 2dB 이상 작아야 한다
        to_in, to_out = tier_medians(lv_in, ev), tier_medians(lv_out, ev)
        rep["tier_order"] = dict(after_limiter=to_out, linear_gain_only=to_in,
                                 need=f"detail 중앙값 ≤ normal 중앙값 − {TIER_GAP_DB:g}dB (v0.6 R12, 비평 Q8 ④)",
                                 note="measure_motion --sfx tier_order와 같은 사건 창·기준. 판정은 after_limiter(마스터 결과). detail이나 normal이 없으면 ok None(해당 없음)")
        if to_out["ok"] is False:
            m = to_out["median_dbfs"]
            warn.append(f"등급 순서가 맞지 않다(Q8 ④): 마스터 뒤 detail 중앙값 {m['detail']} dBFS가 normal {m['normal']}보다 "
                        f"{TIER_GAP_DB:g}dB 이상 작지 않다(차 {to_out['detail_minus_normal_db']:+.1f}dB). "
                        + ("리미터 전에도 같다 → 마스터가 아니라 믹스에서 detail 사건(작은 튐·반짝·톡)을 내리거나 normal 사건을 올린다"
                           if to_in["ok"] is not True else
                           "리미터 전에는 맞았다 → 리미터가 큰 normal 사건을 눌렀다. 그 사건을 믹스에서 1~3dB 줄이고 다시 한다"))
        # 짧은 소리 봉우리 힌트: 리미터 경고가 났고 봉우리가 RMS보다 CREST_HINT_DB 넘게 높은 사건이 있으면 원인으로 붙인다
        peaky = [r for r in rows if r["crest_db"] is not None and r["crest_db"] > CREST_HINT_DB]
        rep["peaky_events"] = dict(over_db=CREST_HINT_DB, count=len(peaky), events=[dict(time_s=r["time_s"], name=r["name"], crest_db=r["crest_db"]) for r in peaky[:20]])
        if peaky:
            top = sorted(peaky, key=lambda r: -r["crest_db"])[:3]
            hint = (f" — 원인 후보: 봉우리가 20ms RMS보다 {CREST_HINT_DB:g}dB 넘게 높은 사건 {len(peaky)}개("
                    + ", ".join(f"{r['name'] or r['tier']} {r['time_s']}s +{r['crest_db']}dB" for r in top)
                    + "). 4~30ms짜리 짧은 소리를 RMS 크기(gain_db)로 맞추면 봉우리가 솟는다 → 그 효과음의 봉우리를 둥글게(tanh 등 부드러운 자르기로"
                      " 봉우리 − RMS ≤ 10dB) 한 뒤 다시 섞는다(references/sound.md 5장)")
            warn[:] = [w + hint if w.startswith("리미터가") else w for w in warn]
    rep["warnings"] = warn
    if a.report:
        os.makedirs(os.path.dirname(os.path.abspath(a.report)), exist_ok=True)
        json.dump(rep, open(a.report, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    hs = ""
    if ev:
        hs = " · 위계(이득만→결과) " + ", ".join(f"{t} {rep['hierarchy_db']['linear_gain_only'][t]:+.1f}→{rep['hierarchy_db']['after_limiter'].get(t, float('nan')):+.1f}dB"
                                         for t in rep["hierarchy_db"]["linear_gain_only"])
    print(f"마스터: {I0:.1f} → {I:.1f} LUFS (이득 {gdb:+.2f} dB), 트루피크 {tp:.1f} dBTP, AAC {aac_tp} dBTP, "
          f"리미터 최대 {lim['max_reduction_db']:.1f} dB · 1dB 넘게 누른 시간 {lim['pct_samples_over_1db']:.1f}%{hs}")
    if ev:  # R12 등급 순서 한 줄
        to = rep["tier_order"]["after_limiter"]
        m = to["median_dbfs"]

        def f_(v):
            return "없음" if v is None else f"{v:.1f}"
        st = ("해당 없음(detail이나 normal 사건이 없음)" if to["ok"] is None else
              f"detail−normal {to['detail_minus_normal_db']:+.1f}dB → " +
              ("맞음" if to["ok"] else ("뒤집힘" if to["detail_minus_normal_db"] >= 0 else "차가 모자람") + f"({-TIER_GAP_DB:g}dB 이하여야 함)"))
        print(f"등급 순서(마스터 뒤, 사건 크기 중앙값): detail {f_(m['detail'])} · normal {f_(m['normal'])} · "
              f"first·signature {f_(m['first_signature'])} dBFS — {st}")
    for n_ in rep.get("notes", []):
        print("참고:", n_)
    for w in warn:
        print("경고:", w)
    sys.exit(2 if warn else 0)


if __name__ == "__main__":
    main()
