"""바탕 결(질감) 세기 측정 — kax-motion 바탕 결 키트.

그림(png/webp/jpg) 또는 영상의 지정 프레임에서 주인공·글자를 뺀 '바탕 영역'의 결 세기를 원본 크기(긴 변 1280)와
폰 폭 360px 사본에서 재고, 빈 면 비율을 함께 낸다. 숫자만 낸다. 판정은 references/texture.md의 범위(texture/ranges.json)로 한다.

  python3 -I texture/measure_texture.py review/refs/<기준 그림 id>.webp
  python3 -I texture/measure_texture.py out/final.mp4 --frames 24,175,300 --json review/texture.json
  python3 -I texture/measure_texture.py out/final.mp4 --every 1.0 --debug review/texture_dbg
  python3 -I texture/measure_texture.py out/final.mp4 --frames 10,58,170 --shots storyboard/shots.json   # 샷 짝 그림과 빈 면 차
  python3 -I texture/measure_texture.py out/final.mp4 --frames 170 --anchor <기준 그림 id>
기준 그림 id는 기준 그림 폴더(스킬 뿌리 kax_paths.json의 refs — 공개 기본 작업 폴더 review/refs/) 안의 파일 이름(확장자 없이).

정의 (식은 references/texture.md의 측정 정의와 같다)
  Y      = 0.2126 R + 0.7152 G + 0.0722 B  (0~255, 영상은 bt709 tv 범위로 풀어서)
  크기   = 긴 변 1280으로 상자 평균 축소(기준 그림과 같은 크기). 폰 = 폭 360으로 상자 평균 축소.
  고역   HP = Y - G_s(Y)   (G_s = 가우시안 흐림, 원본 s=3px, 폰 s=1px)
  글자·주인공 = RGB 중 하나라도 |RGB - G_12(RGB)| > 30 인 픽셀 → 10px(폰 3px) 넓힘
  바탕색 = 화면 가장자리 띠(짧은 변의 3%)의 RGB 중앙값. 바탕 = 글자·주인공이 아니고 |G_8(RGB) - 바탕색|max < 24
           인 픽셀. 바탕이 화면의 12% 미만이면(사진·그라데이션 전면) 글자·주인공만 뺀 전체를 쓰고 bg_mode=fallback.
  tex      = 바탕 픽셀 HP의 RMS (= 바탕 전체 고역 표준편차, 성긴 격자·사선도 잡힘)  ← 주 숫자
  tex_p50  = 100px 조각(바탕 60% 이상인 조각) HP 표준편차의 중앙값 — '100px 조각 고역 표준편차'와
             같은 꼴(결이 또렷한 캔버스 바탕 = 2.6 안팎, 결이 거의 없는 바탕 = 0.2 안팎). 촘촘한 결은 tex와 비슷, 성긴 격자는 0에 가깝다.
  peak     = 바탕 픽셀 |HP|의 99백분위 (격자 선·사선처럼 성긴 무늬의 밝기 차)
  span     = 바탕 픽셀 G_8(Y)의 5~95백분위 폭 (큰 밝기 흐름: 빛 번짐·그라데이션·주름. 요소 둘레 그림자도 섞인다)
  tex360 / tex360_p50(28px 조각) / peak360 = 폰 360px 사본에서 같은 식(s=1). 바탕 영역은 원본에서 정한 마스크를
             폭 360으로 줄여(완전히 바탕인 픽셀만) 3px 깎아 쓴다 — 원본과 같은 곳을 잰다
  keep360  = tex360 / tex (폰에서 남는 비율)
  flick    = (--temporal) 이웃 프레임 고역 바뀜 RMS / (√2 × 고역 RMS). 0 = 정지한 결, 1 = 매 프레임 새 그레인.
             바탕 마스크를 프레임마다 다시 잡고 이웃 두 프레임 중 어느 쪽에서든 글자·주인공인 픽셀을 뺀다(첫 프레임 마스크로 고정한 값 = *_f0mask)
  empty    = 32px 칸 중 '빈 칸' 비율. 빈 칸 = 글자·주인공 픽셀이 없고 G_3(Y)의 2~98백분위 폭 < 16
             (결만 있는 칸은 빈 칸이다. 결은 빈 면을 채우지 않는다)
  empty_diff_vs_anchor = (--anchor 또는 --shots) empty − 짝 기준 그림 empty. + = 짝보다 더 빔, − = 더 참.
             empty_side = 더 빔 / 더 참 / 범위 안(±0.10)
"""
import argparse
import json
import os
import re
import subprocess
import sys

os.environ.setdefault("OMP_NUM_THREADS", "2")
os.environ.setdefault("OPENBLAS_NUM_THREADS", "2")
import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402
from scipy import ndimage as nd  # noqa: E402

DEC = "scale=in_range=tv:in_color_matrix=bt709:flags=accurate_rnd+full_chroma_int+bitexact"
LUMA = np.array([0.2126, 0.7152, 0.0722], np.float32)
IMG_EXT = (".png", ".webp", ".jpg", ".jpeg", ".bmp", ".tif", ".tiff")

# 원본(긴 변 1280) / 폰(폭 360) 측정 상수
FULL = dict(hp_s=3.0, patch=100, dil=10, mid=True)
PHONE = dict(hp_s=1.0, patch=28, dil=3, mid=False)
INK_TOL, INK_S, BG_TOL, BG_S, BG_MIN = 30.0, 12.0, 24.0, 8.0, 0.12


def resize_box(rgb, w, h):
    if (w, h) == (rgb.shape[1], rgb.shape[0]):
        return rgb.astype(np.float32)
    im = Image.fromarray(rgb)
    return np.asarray(im.resize((w, h), Image.BOX if w < rgb.shape[1] else Image.LANCZOS)).astype(np.float32)


def gauss_rgb(a, s):
    return np.stack([nd.gaussian_filter(a[..., c], s) for c in range(3)], -1)


def masks(rgb, scale):
    """글자·주인공(ink) 마스크와 바탕 마스크. scale = 1280 기준 대비 배율(폰 ≈ 0.28)."""
    ink = np.abs(rgb - gauss_rgb(rgb, max(INK_S * scale, 2.0))).max(-1) > INK_TOL
    H, W = ink.shape
    b = max(2, int(round(min(H, W) * 0.03)))
    band = np.concatenate([rgb[:b].reshape(-1, 3), rgb[-b:].reshape(-1, 3), rgb[:, :b].reshape(-1, 3), rgb[:, -b:].reshape(-1, 3)])
    bgc = np.median(band, 0)
    return ink, bgc


def measure_one(rgb, cfg, scale, bg_from=None):
    """bg_from = (원본 바탕 마스크, 모드): 폰 사본은 원본에서 정한 바탕 영역을 줄여 그대로 쓴다(같은 곳을 잰다)."""
    rgb = rgb.astype(np.float32)
    Y = rgb @ LUMA
    ink, bgc = masks(rgb, scale)
    if bg_from is not None:
        fm, mode = bg_from
        H, W = Y.shape
        frac = np.asarray(Image.fromarray((fm * 255).astype(np.uint8)).resize((W, H), Image.BOX)).astype(np.float32) / 255
        bg = nd.binary_erosion(frac > 0.995, iterations=int(cfg["dil"]))
    else:
        dil = int(cfg["dil"])
        inkd = nd.binary_dilation(ink, iterations=dil) if dil > 0 else ink
        near_bg = np.abs(gauss_rgb(rgb, max(BG_S * scale, 1.5)) - bgc[None, None, :]).max(-1) < BG_TOL
        bg = ~inkd & near_bg
        mode = "bg_color"
        if bg.mean() < BG_MIN:
            bg, mode = ~inkd, "fallback"
    hp = Y - nd.gaussian_filter(Y, cfg["hp_s"])
    out = dict(bg_mode=mode, bg_frac=round(float(bg.mean()), 3), bg_rgb=[round(float(x), 1) for x in bgc],
               bg_luma=round(float(bgc @ LUMA), 1))
    if bg.sum() < 500:
        out.update(tex=None, tex_p50=None, peak=None)
        return out, ink, bg
    v = hp[bg]
    out["tex"] = round(float(np.sqrt(np.mean(v * v))), 3)
    out["peak"] = round(float(np.percentile(np.abs(v), 99)), 2)
    P = cfg["patch"]
    H, W = Y.shape
    ps = []
    for y in range(0, H - P + 1, P):
        for x in range(0, W - P + 1, P):
            m = bg[y:y + P, x:x + P]
            if m.mean() >= 0.6:
                ps.append(float(hp[y:y + P, x:x + P][m].std()))
    out["tex_p50"] = round(float(np.median(ps)), 3) if ps else None
    out["patches"] = len(ps)
    if cfg["mid"]:
        lo = nd.gaussian_filter(Y, 8)[bg]
        out["span"] = round(float(np.percentile(lo, 95) - np.percentile(lo, 5)), 2)
    out["_mode"] = mode
    return out, ink, bg


def empty_ratio(rgb, ink, cell=32):
    Y = nd.gaussian_filter(rgb.astype(np.float32) @ LUMA, 3)
    H, W = Y.shape
    n = e = 0
    for y in range(0, H - cell + 1, cell):
        for x in range(0, W - cell + 1, cell):
            n += 1
            if ink[y:y + cell, x:x + cell].any():
                continue
            p = Y[y:y + cell, x:x + cell]
            if np.percentile(p, 98) - np.percentile(p, 2) < 16:
                e += 1
    return round(e / max(n, 1), 3)


def measure_frame(rgb, debug_path=None):
    """rgb: uint8 HxWx3 (원래 크기). 결과 dict."""
    H, W = rgb.shape[:2]
    k = 1280.0 / max(H, W)
    fw, fh = int(round(W * k)), int(round(H * k))
    full = resize_box(rgb, fw, fh)
    r_full, ink, bg = measure_one(full, FULL, 1.0)
    pw, ph = 360, int(round(H * 360.0 / W))
    phone = resize_box(rgb, pw, ph)
    r_ph, _, _ = measure_one(phone, PHONE, pw / fw, bg_from=(bg, r_full["_mode"]))
    res = dict(src_px=[W, H], full_px=[fw, fh], phone_px=[pw, ph])
    res.update({k2: r_full.get(k2) for k2 in ("tex", "tex_p50", "peak", "span", "bg_mode", "bg_frac", "bg_luma", "bg_rgb", "patches")})
    res["tex360"] = r_ph.get("tex")
    res["tex360_p50"] = r_ph.get("tex_p50")
    res["peak360"] = r_ph.get("peak")
    res["keep360"] = round(res["tex360"] / res["tex"], 3) if res["tex"] and res["tex360"] is not None and res["tex"] > 0.05 else None
    res["empty"] = empty_ratio(full, ink)
    if debug_path:
        dbg = full.copy()
        dbg[ink] = dbg[ink] * 0.3 + np.array([255, 40, 40]) * 0.7
        dbg[~bg & ~ink] = dbg[~bg & ~ink] * 0.6 + np.array([40, 40, 255]) * 0.4
        Image.fromarray(np.clip(dbg, 0, 255).astype(np.uint8)).save(debug_path)
    return res


# ------------------------------------------------------------------ 입력
def probe(path):
    pr = json.loads(subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                                    "stream=width,height,r_frame_rate,nb_frames:format=duration", "-of", "json", path],
                                   capture_output=True, text=True, check=True).stdout)
    s = pr["streams"][0]
    a, b = s["r_frame_rate"].split("/")
    fps = float(a) / float(b)
    dur = float(pr["format"]["duration"])
    return int(s["width"]), int(s["height"]), fps, int(s.get("nb_frames") or round(dur * fps))


_PASS = []


def passthrough_args():
    """프레임을 그대로 내보내는 ffmpeg 옵션. 예전 `-vsync 0`은 FFmpeg 5.1부터 `-fps_mode passthrough`로 바뀌었고
    FFmpeg 9에는 `-vsync`가 없다(2026-11-01 새 컴퓨터). 5.1 미만일 때만 예전 옵션(critic/tools/measure_motion.py와 같은 처리)."""
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


def video_frames(path, idx):
    W, H, fps, nb = probe(path)
    idx = sorted(set(i for i in idx if 0 <= i < nb))
    out = {}
    for k in range(0, len(idx), 40):
        part = idx[k:k + 40]
        sel = "+".join(f"eq(n\\,{i})" for i in part)
        raw = subprocess.run(["ffmpeg", "-v", "error", "-threads", "2", "-i", path, "-vf",
                              f"{DEC},select='{sel}',format=rgb24", *passthrough_args(), "-f", "rawvideo", "-"],
                             capture_output=True, check=True).stdout
        arr = np.frombuffer(raw, np.uint8).reshape(-1, H, W, 3)
        out.update({i: arr[j] for j, i in enumerate(part) if j < len(arr)})
    return out, fps


def temporal(path, f0, f1):
    """결 깜빡임: 이웃 프레임 고역의 바뀜 flick(t) = RMS(HP_t - HP_t-1) / (sqrt(2) * RMS(HP)).
    0 = 결이 그대로(정지), 1 = 프레임마다 새 그레인(깜빡임). 1px 통째 이동도 고운 그레인이면 1 가까이 나온다.
    프레임마다 바탕 마스크를 다시 잡고, 두 프레임 중 어느 쪽에서든 글자·주인공(바탕 아님)인 픽셀(합집합)을 빼고 잰다
    → 움직이는 글자가 바탕으로 섞이지 않는다. 첫 프레임 마스크로 고정해 잰 값은 *_f0mask 키."""
    fr, fps = video_frames(path, list(range(f0, f1 + 1)))
    idx = sorted(fr)
    hps, bgs = [], []
    for i in idx:
        H, W = fr[i].shape[:2]
        k = 1280.0 / max(H, W)
        full = resize_box(fr[i], int(round(W * k)), int(round(H * k)))
        _, _, bg = measure_one(full, FULL, 1.0)
        Y = full @ LUMA
        hps.append(Y - nd.gaussian_filter(Y, FULL["hp_s"]))
        bgs.append(bg)

    def flick(a, b):
        d = b - a
        den = np.sqrt(2) * np.sqrt(0.5 * (np.mean(a * a) + np.mean(b * b))) + 1e-9
        return float(np.sqrt(np.mean(d * d)) / den)

    def stats(fl, suffix=""):
        fl = np.array(fl)
        return {f"flick_mean{suffix}": round(float(fl.mean()), 3), f"flick_p95{suffix}": round(float(np.percentile(fl, 95)), 3),
                f"flick_max{suffix}": round(float(fl.max()), 3), f"jumps_over_0_5{suffix}": int((fl > 0.5).sum())}
    fl_new, fl_old, valid = [], [], []
    m0 = bgs[0]
    for t in range(1, len(idx)):
        a, b = hps[t - 1], hps[t]
        m = bgs[t - 1] & bgs[t]  # 두 프레임 모두 바탕인 픽셀만(글자·주인공 마스크의 합집합 제외)
        valid.append(float(m.mean()))
        fl_new.append(flick(a[m], b[m]) if m.sum() >= 500 else np.nan)
        fl_old.append(flick(a[m0], b[m0]))
    fl_new = [x for x in fl_new if not np.isnan(x)] or [np.nan]
    res = dict(frames=[idx[0], idx[-1]])
    res.update(stats(fl_new))
    res.update(mask="v0.5: 프레임마다 다시 잡은 바탕 마스크, 이웃 두 프레임 마스크의 교집합(= 글자·주인공 합집합 제외)",
               bg_frac_min=round(min(valid), 3), bg_frac_mean=round(float(np.mean(valid)), 3),
               tex_first=round(float(np.sqrt(np.mean(hps[0][bgs[0]] ** 2))), 3), tex_last=round(float(np.sqrt(np.mean(hps[-1][bgs[-1]] ** 2))), 3))
    res.update(stats(fl_old, "_f0mask"))
    res["tex_last_f0mask"] = round(float(np.sqrt(np.mean(hps[-1][m0] ** 2))), 3)
    if len(fl_new) < len(fl_old):
        res["note"] = f"바탕이 너무 적은(500px 미만) 프레임 쌍 {len(fl_old) - len(fl_new)}개는 뺐다"
    return res


EMPTY_BAND = 0.10  # critic 문서 Q1의 '짝 기준 그림 ±10%p'
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # 스킬 뿌리
KAX_PATHS_PUBLIC = {"base": "cwd", "refs": "review/refs"}  # kax_paths.json이 없을 때(공개 값)
_ANCHOR_CACHE = {}


def kax_path(key):
    """스킬 뿌리 kax_paths.json(도구 기본 경로 표)의 key → (절대 경로, 표에 적힌 글). 파일이나 칸이 없으면 공개 값.
    base: skill = 스킬 뿌리 기준, cwd = 도구를 돌린 폴더(작업 폴더) 기준."""
    try:
        with open(os.path.join(REPO, "kax_paths.json"), encoding="utf-8") as f:
            t = json.load(f)
    except (OSError, ValueError):
        t = {}
    if not isinstance(t, dict) or key not in t:
        t = KAX_PATHS_PUBLIC
    base = REPO if t.get("base") == "skill" else os.getcwd()
    return os.path.normpath(os.path.join(base, os.path.expanduser(t[key]))), t[key]


def anchor_path(x):
    """짝 그림: 파일 경로, 또는 기준 그림 폴더(kax_paths.json refs) 안의 id(확장자 없이)."""
    if os.path.exists(x):
        return x
    refs = kax_path("refs")[0]
    for ext in (".webp", ".png", ".jpg"):
        p = os.path.join(refs, x + ext)
        if os.path.exists(p):
            return p
    return None


def anchor_empty(x):
    p = anchor_path(x)
    if p is None:
        return None, None
    if p not in _ANCHOR_CACHE:
        _ANCHOR_CACHE[p] = measure_frame(np.asarray(Image.open(p).convert("RGB")))["empty"]
    return p, _ANCHOR_CACHE[p]


def empty_vs_anchor(empty, anchor):
    """부호 있는 차 empty_diff_vs_anchor = 이 프레임 empty − 짝 그림 empty.  + = 짝보다 더 빔, − = 짝보다 더 참(내용·층이 많음).
    empty_side: '더 빔'/'더 참'(차가 ±EMPTY_BAND 밖) 또는 '범위 안'. 규칙에서 어느 쪽을 막을지는 critic 문서가 정한다."""
    p, ae = anchor_empty(anchor)
    if ae is None:
        return dict(anchor=anchor, anchor_error=f"짝 그림을 못 찾음(경로 또는 {kax_path('refs')[1]}/<id>)")
    d = round(empty - ae, 3)
    side = "더 빔" if d > EMPTY_BAND else ("더 참" if d < -EMPTY_BAND else "범위 안")
    return dict(anchor=os.path.relpath(p, REPO) if p.startswith(REPO) else p, anchor_empty=ae,
                empty_diff_vs_anchor=d, empty_side=side, empty_band=EMPTY_BAND)


def shot_anchors(path):
    """storyboard/shots.json → [(f0, f1, anchor id)]"""
    j = json.load(open(path, encoding="utf-8"))
    S = j["shots"] if isinstance(j, dict) else j
    return [(int(x["f0"]), int(x["f1"]), x.get("anchor")) for x in S if x.get("anchor") and "f0" in x and "f1" in x]


def summarize(rows):
    keys = ["tex", "tex_p50", "peak", "span", "tex360", "tex360_p50", "peak360", "keep360", "empty"]
    s = {}
    for k in keys:
        v = [r[k] for r in rows if r.get(k) is not None]
        if v:
            s[k] = dict(min=round(min(v), 3), median=round(float(np.median(v)), 3), max=round(max(v), 3))
    return s


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("src", nargs="+", help="그림 파일들 또는 영상 하나")
    ap.add_argument("--frames", help="영상 프레임 번호(쉼표)")
    ap.add_argument("--every", type=float, help="영상 N초마다")
    ap.add_argument("--json", help="결과 JSON 경로")
    ap.add_argument("--temporal", help="영상 프레임 구간 f0-f1: 결 깜빡임(flick)만 잰다")
    ap.add_argument("--debug", help="마스크 그림 폴더(빨강 = 글자·주인공, 파랑 = 바탕 아님)")
    ap.add_argument("--anchor", action="append", default=[],
                    help="짝 기준 그림(경로 또는 기준 그림 폴더 안의 id — kax_paths.json refs). 모든 줄에 쓰거나 'F=그림'으로 프레임마다(여러 번). "
                         "→ anchor_empty·empty_diff_vs_anchor(+ = 더 빔, − = 더 참)·empty_side")
    ap.add_argument("--shots", help="storyboard/shots.json: 프레임이 든 샷의 anchor를 짝 그림으로(--anchor가 먼저)")
    a = ap.parse_args()
    if a.debug:
        os.makedirs(a.debug, exist_ok=True)
    rows = []
    if a.temporal:
        f0, f1 = (int(x) for x in a.temporal.split("-"))
        r = temporal(a.src[0], f0, f1)
        print(json.dumps(r, ensure_ascii=False))
        if a.json:
            json.dump(r, open(a.json, "w"), ensure_ascii=False, indent=1)
        return 0
    if len(a.src) == 1 and not a.src[0].lower().endswith(IMG_EXT):
        W, H, fps, nb = probe(a.src[0])
        if a.frames:
            idx = [int(x) for x in a.frames.split(",")]
        else:
            step = a.every or 1.0
            idx = [int(round(t * fps)) for t in np.arange(0, nb / fps, step)]
        fr, fps = video_frames(a.src[0], idx)
        for i in sorted(fr):
            dp = os.path.join(a.debug, f"f{i:05d}.png") if a.debug else None
            r = dict(src=os.path.basename(a.src[0]), frame=i, time_s=round(i / fps, 3))
            r.update(measure_frame(fr[i], dp))
            rows.append(r)
    else:
        for p in a.src:
            rgb = np.asarray(Image.open(p).convert("RGB"))
            dp = os.path.join(a.debug, os.path.splitext(os.path.basename(p))[0] + "_mask.png") if a.debug else None
            r = dict(src=os.path.basename(p))
            r.update(measure_frame(rgb, dp))
            rows.append(r)
    per, common = {}, None
    for x in a.anchor:
        k, sep, v = x.partition("=")
        if sep and k.strip().isdigit():
            per[int(k)] = v
        else:
            common = x
    sa = shot_anchors(a.shots) if a.shots else []
    for r in rows:
        anc = per.get(r.get("frame")) if "frame" in r else None
        if anc is None and "frame" in r:
            anc = next((x for f0, f1, x in sa if f0 <= r["frame"] <= f1), None)
        anc = anc or common
        if anc and r.get("empty") is not None:
            r.update(empty_vs_anchor(r["empty"], anc))
    for r in rows:
        tag = r["src"] + (f" f{r['frame']}" if "frame" in r else "")
        print(f"{tag:42s} tex {r['tex']}  p50 {r['tex_p50']}  peak {r['peak']}  span {r.get('span')}  "
              f"| 360: tex {r['tex360']} p50 {r['tex360_p50']} keep {r['keep360']}  | empty {r['empty']}  "
              f"bg {r['bg_mode']} {r['bg_frac']} L{r['bg_luma']}"
              + (f"  | 짝 {os.path.basename(r['anchor'])} {r['anchor_empty']} 차 {r['empty_diff_vs_anchor']:+.3f} {r['empty_side']}" if "empty_side" in r else ""))
    out = dict(tool="texture/measure_texture.py", definition="references/texture.md 측정 정의", rows=rows, summary=summarize(rows))
    if a.json:
        os.makedirs(os.path.dirname(os.path.abspath(a.json)), exist_ok=True)
        with open(a.json, "w") as f:
            json.dump(out, f, ensure_ascii=False, indent=1)
    return 0


if __name__ == "__main__":
    sys.exit(main())
