"""kax-motion 비평 측정 도구 — 결과 영상의 움직임·글자 크기·싱크·등장 곡선·여백·효과음을 숫자와 그림으로 낸다.

사용(어디서나): python3 -I critic/tools/measure_motion.py <video.mp4> --out <폴더> [--shots shots.json] [재는 것 ...]
  --pace      첫 움직임·첫 내용·정지 비율·움직임 평균·컷 간격·바탕 바뀜 (관문 G1)
  --text      글자 덩어리 높이 → 1920 폭 기준 대문자 높이 추정 (관문 G2 근거)  [--frames 30,120 | --shots | 1초마다]
  --sync      소리의 강한 시작점 ↔ 화면 변화 프레임 대조 (관문 G3)        [--events audio/events.json 있으면 계획 사건도]
  --entries   요소 등장 곡선: 첫 프레임 진행·감속비·넘침·정착 (진행 비율)  [--entry-spec spec.json | --shots 자동]
  --contact   밀착 시트 contact.png + 360px 사본 phone360.png               [--shots 키 프레임 | --every 0.5]
  --margins   (Q5) 내용 상자의 가장자리 여백 ÷ 짧은 변, 5% 미만 7프레임 이상 구간  [--margin-step 6]
  --sfx       (Q8) 사건마다 크기·음색·바탕 대비, 음색 묶음 수, 크기 위계       [--events 있으면 계획 사건]
              (Q8 ④) 등급 순서 tier_order: detail·normal·first+signature 중앙값, detail이 normal보다 2dB 이상 작은지
  --all       위 일곱 가지 전부
결과: <out>/measure.json (+ 그림: contact.png, phone360.png, text/f*.jpg, sync.png, margins/f*.jpg)
판정은 하지 않는다. 숫자와 '참고 기준'만 낸다. 한계는 같은 폴더 README.md.
"""
import argparse
import io
import json
import os
import re
import subprocess
import sys

os.environ.setdefault("OMP_NUM_THREADS", "2")
os.environ.setdefault("OPENBLAS_NUM_THREADS", "2")
import numpy as np  # noqa: E402
from PIL import Image, ImageDraw, ImageFont  # noqa: E402
from scipy import ndimage  # noqa: E402

DEC = "scale=in_range=tv:in_color_matrix=bt709:flags=accurate_rnd+full_chroma_int+bitexact"
SKILL = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # 스킬 뿌리


def _label_fonts():
    """그림 글자 서체 차례: 스킬 뿌리 kax_paths.json의 label_fonts, 없으면 스킬 fonts/의 한글 서체 → DejaVu."""
    try:
        with open(os.path.join(SKILL, "kax_paths.json"), encoding="utf-8") as f:
            v = json.load(f).get("label_fonts")
    except (OSError, ValueError, AttributeError):
        v = None
    return v or [os.path.join(SKILL, "fonts", "PretendardVariable.ttf"), "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"]


FONT_PATHS = _label_fonts()


def font(size):
    for p in FONT_PATHS:
        try:
            return ImageFont.truetype(p, size)
        except OSError:
            pass
    return ImageFont.load_default()


_PASS = []


def passthrough_args():
    """프레임을 그대로(복제·버림 없이) 내보내는 ffmpeg 출력 옵션. 예전 `-vsync 0`은 FFmpeg 5.1부터 `-fps_mode passthrough`로 바뀌었고
    FFmpeg 9에는 `-vsync`가 아예 없다. 5.1 미만일 때만 예전 옵션을 쓴다."""
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


# ---------------------------------------------------------------- 공통
class Video:
    def __init__(self, path):
        self.path = path
        pr = json.loads(subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "stream=codec_type,width,height,r_frame_rate,nb_frames",
             "-show_entries", "format=duration", "-of", "json", path], capture_output=True, text=True, check=True).stdout)
        v = next(s for s in pr["streams"] if s["codec_type"] == "video")
        self.W, self.H = int(v["width"]), int(v["height"])
        a, b = v["r_frame_rate"].split("/")
        self.fps = float(a) / float(b)
        self.duration = float(pr["format"]["duration"])
        self.nb = int(v.get("nb_frames") or round(self.duration * self.fps))
        self.has_audio = any(s["codec_type"] == "audio" for s in pr["streams"])

    def decode(self, w=None, h=None, sel=None, fps=None, gray=False):
        """프레임 배열. w만 주면 비율대로 h. sel은 ffmpeg select 식(프레임 번호 n)."""
        if w and not h:
            h = int(round(self.H * w / self.W / 2) * 2)
        w, h = w or self.W, h or self.H
        vf = DEC
        if sel:
            vf += f",select='{sel}'"
        if fps:
            vf += f",fps={fps}"
        vf += f",scale={w}:{h}:flags=area,format={'gray' if gray else 'rgb24'}"
        raw = subprocess.run(["ffmpeg", "-v", "error", "-threads", "2", "-i", self.path, "-vf", vf, *passthrough_args(),
                              "-f", "rawvideo", "-"], capture_output=True, check=True).stdout
        shape = (h, w) if gray else (h, w, 3)
        return np.frombuffer(raw, np.uint8).reshape(-1, *shape)

    def frames(self, idx, w=None):
        idx = sorted(set(int(i) for i in idx if 0 <= int(i) < self.nb))
        if not idx:
            return {}
        out = {}
        for k in range(0, len(idx), 40):  # select 식이 너무 길지 않게 나눔
            part = idx[k:k + 40]
            arr = self.decode(w=w, sel="+".join(f"eq(n\\,{i})" for i in part))
            out.update({i: arr[j] for j, i in enumerate(part) if j < len(arr)})
        return out


def load_shots(path):
    if not path:
        return []
    j = json.load(open(path, encoding="utf-8"))
    S = j["shots"] if isinstance(j, dict) else j
    out = []
    for s in S:
        try:
            out.append(dict(no=s.get("no"), f0=int(s["f0"]), f1=int(s["f1"]), key=int(s.get("key", s["f0"])),
                            size=s.get("size", ""), bleed=s.get("bleed") is True, anchor=s.get("anchor")))
        except (KeyError, ValueError, TypeError):
            pass
    return out


def shot_of(shots, f):
    for s in shots:
        if s["f0"] <= f <= s["f1"]:
            return s["no"]
    return None


CELL_T = 8            # 칸 나눔(8×8), --pace 정지와 --sync 화면 변화가 함께 쓴다
STATIC_CELL_THR = 0.10  # v0.5 정지 문턱: 칸별 평균 차의 최댓값(0~255). 근거는 README '--pace'
SLOW_CELL_THR = 0.5     # 참고용 '아주 느린 흐름' 문턱(정지 아님)


def cell_diffs(V):
    """320px 회색, 원래 fps. 프레임마다 8×8 칸별 |이번 − 앞| 평균 → (프레임 수, 8, 8). 0번 프레임은 0.
    --pace(v0.5 정지)·--sync(솟음·착지)가 같은 값을 쓰도록 V에 한 번만 계산해 둔다."""
    if getattr(V, "_cells", None) is None:
        g = V.decode(w=320, gray=True).astype(np.int16)
        d = np.abs(np.diff(g, axis=0)).astype(np.float32)
        T = CELL_T
        h, w = d.shape[1] // T * T, d.shape[2] // T * T
        c = d[:, :h, :w].reshape(len(d), T, h // T, T, w // T).mean(axis=(2, 4))
        V._cells = np.concatenate([np.zeros((1, T, T), np.float32), c])
    return V._cells


def runs_of(mask, fps, min_s=0.4):
    """참인 프레임이 min_s초 이상 이어진 구간 [[시작 s, 끝 s], ...]과 그 합(초)."""
    runs, tot, r0, N = [], 0.0, None, len(mask)
    for i in range(N + 1):
        s = i < N and bool(mask[i])
        if s and r0 is None:
            r0 = i
        if not s and r0 is not None:
            if (i - r0) / fps >= min_s:
                tot += (i - r0) / fps
                runs.append([round(r0 / fps, 2), round(i / fps, 2)])
            r0 = None
    return runs, tot


def motion_diff(gray):
    g = gray.astype(np.int16)
    return np.concatenate([[0.0], np.abs(np.diff(g, axis=0)).mean(axis=(1, 2))])


def detect_cuts(V):
    """컷 찾기: 270px 회색 프레임 차가 1.0을 넘고 앞뒤 3프레임 중앙값의 4배를 넘는 곳 = 컷(그 프레임이 새 샷 첫 프레임)."""
    G = V.decode(w=270, gray=True)
    d1 = np.abs(np.diff(G.astype(np.int16), axis=0)).mean(axis=(1, 2))
    cuts = []
    for i in range(len(d1)):
        nb = np.concatenate([d1[max(0, i - 3):i], d1[i + 1:i + 4]])
        if d1[i] > 1.0 and d1[i] > 4 * max(float(np.median(nb)) if len(nb) else 0, 0.15):
            cuts.append(i + 1)
    return cuts, d1


# ---------------------------------------------------------------- --pace
def run_pace(V, shots):
    """움직임(30fps로 맞춘 128px 회색 프레임 평균 차, 움직임 기준 0.35) + 첫 내용 시각 + 컷 간격."""
    FPS = 30
    g = V.decode(w=128, fps=FPS, gray=True)
    N = len(g)
    diff = motion_diff(g)
    first_move = next((i for i in range(1, N) if diff[i] > 0.35), None)
    runs, hold = runs_of(diff < 0.35, FPS)  # v0.4까지의 정지(화면 평균 차 < 0.35) → *_mean 키로 남김
    # v0.5 정지: 8×8 칸 중 '어느 칸도' 안 바뀜 = 칸별 평균 차의 최댓값 < STATIC_CELL_THR (원래 fps, 320px)
    cmax = cell_diffs(V).reshape(len(cell_diffs(V)), -1).max(1)
    runs_c, hold_c = runs_of(cmax < STATIC_CELL_THR, V.fps)
    runs_slow, _ = runs_of(cmax < SLOW_CELL_THR, V.fps)  # 참고: 아주 느린 흐름만 있는 구간(정지 아님)
    # 첫 내용: 원본 크기 회색에서 이웃 픽셀과 40단계 넘게 차이 나는 픽셀(윤곽) 비율이 0.05%를 넘는 첫 프레임(첫 1.5초 안)
    n_chk = min(V.nb, int(round(V.fps * 1.5)))
    G = V.decode(sel=f"lt(n\\,{n_chk})", gray=True).astype(np.int16)
    cover = [float(((np.abs(np.diff(f, axis=1))[:-1, :] + np.abs(np.diff(f, axis=0))[:, :-1]) > 40).mean()) for f in G]
    first_content = next((i for i, c in enumerate(cover) if c > 0.0005), None)
    # 바탕 바뀜(가장자리 띠, 0.25초마다, RGB 거리 48 넘는 색이 0.5초 넘게)
    c = V.decode(w=96, fps=4).astype(np.float32)
    bw = max(1, int(round(96 * 0.04)))
    band = np.concatenate([c[:, :bw].reshape(len(c), -1, 3), c[:, -bw:].reshape(len(c), -1, 3),
                           c[:, :, :bw].reshape(len(c), -1, 3), c[:, :, -bw:].reshape(len(c), -1, 3)], axis=1).mean(axis=1)
    state, changes, cand, cn = band[0], [], None, 0
    for i in range(1, len(band)):
        if np.linalg.norm(band[i] - state) > 48:
            if cand is not None and np.linalg.norm(band[i] - cand) <= 48:
                cn += 1
            else:
                cand, cn = band[i], 1
            if cn >= 2:
                state, cand, cn = cand, None, 0
                changes.append(round((i - 1) / 4, 2))
        else:
            cand, cn = None, 0
    cuts, _ = detect_cuts(V)
    edges = [0] + cuts + [V.nb]
    gaps = [b - a for a, b in zip(edges, edges[1:])]
    def longest(rr):
        return round(max((b - a for a, b in rr), default=0.0), 2)
    res = dict(
        method="움직임 = 30fps로 맞춘 128px 회색 프레임 평균 차(0~255), 0.35 넘으면 '움직임'(first_move_s·motion_*). "
               f"정지(v0.5) = 320px 회색 8×8 칸별 프레임 차 평균의 최댓값이 {STATIC_CELL_THR} 미만 — 화면 어디도 안 바뀐 프레임이 0.4초 이상 이어진 구간. "
               "예전 정지(화면 평균 차 < 0.35)는 *_mean 키",
        first_move_s=None if first_move is None else round(first_move / FPS, 3),
        first_content_s=None if first_content is None else round(first_content / V.fps, 3),
        first_content_note="윤곽 픽셀 0.05% 초과 첫 프레임(빈 화면이 아닌 첫 순간). '첫 글자·주인공' 여부는 눈으로 확인",
        f0_edge_ratio=round(cover[0], 5) if cover else None,
        first_1s_motion=round(float(diff[1:FPS + 1].mean()), 2),
        static_ratio=round(hold_c / V.duration, 3), static_runs_s=runs_c, static_longest_s=longest(runs_c),
        static_cell_thr=STATIC_CELL_THR,
        slow_runs_s=runs_slow, slow_cell_thr=SLOW_CELL_THR,
        slow_note=f"참고만: 칸 최댓값 < {SLOW_CELL_THR}(1.00→1.02/3.5초 흐름이 0.2~0.45) — 아주 느린 흐름·숨쉬기만 있는 구간. 정지가 아니므로 E7 판단에 쓰지 않는다",
        static_ratio_mean=round(hold / V.duration, 3), static_runs_s_mean=runs, static_longest_s_mean=longest(runs),
        motion_mean=round(float(diff.mean()), 2),
        motion_by_second=[round(float(diff[i:i + FPS].mean()), 2) for i in range(0, N, FPS)],
        bg_changes=len(changes), bg_change_times_s=changes,
        cuts_detected=cuts, cut_gaps_frames=gaps,
        cut_gap_mean_s=round(float(np.mean(gaps)) / V.fps, 2), cut_gap_min_s=round(min(gaps) / V.fps, 2),
        cut_gap_max_s=round(max(gaps) / V.fps, 2),
        reference=dict(G1="첫 움직임 ≤ 0.15초, 첫 글자·주인공 ≤ 0.7초",
                       static_ratio_mean="잘 만든 참고 영상들의 중앙값 약 0.13, 최대 0.38(motion-launch 규칙: 35% 아래) — 예전 정의(평균 차) 값이라 static_ratio_mean과 비교",
                       static_runs_s="E7 '1초 넘는 정지'는 static_runs_s(어느 칸도 안 바뀜)로 본다",
                       motion_mean="참고 의뢰작 최소 1.88(motion-launch 규칙: 1.5 이상)", bg_changes=f"권장 길이/5초 = {int(V.duration // 5)}번 이상"),
    )
    if shots:
        planned = [s["f0"] for s in shots[1:]]
        res["cuts_planned"] = planned
        res["cuts_planned_hit_1f"] = f"{sum(any(abs(p - c) <= 1 for c in cuts) for p in planned)}/{len(planned)}"
    return res


# ---------------------------------------------------------------- --text
BIG_H = 0.5  # v0.5: 덩어리 높이 상한(화면 높이 비). v0.4는 0.22
SYL_GAP = 0.35  # v0.5 음절 묶기: 위아래 조각 사이 틈 ≤ 큰 조각 높이 × 0.35 (금 = ㄱ·ㅁ 사이 가는 ㅡ가 빠져도 이어지게)


def merge_syllables(comps, H):
    """v0.5 1단 묶기: 한글 음절을 이루는 자모 조각(위아래로 쌓인 ㅅ+ㅜ, ㅇㅝ+ㄹ 등)을 한 덩어리로.
    두 덩어리(지금까지 묶인 상자끼리)가 ① 가로로 좁은 쪽 폭의 30% 이상 겹치고 ② 세로 틈이 큰 쪽 높이의 35% 이하이며
    ③ 높이 비 2.2 안, 합친 폭이 넓은 쪽 폭의 1.15배 안 ④ 합친 상자가 음절 모양(폭/높이 0.55~1.6)이고 높이 상한(BIG_H) 안일 때만
    묶는다(틈이 작은 쌍부터). ③④ 때문에 위아래 두 줄, 글자 + 밑줄 막대, 글자 + 아래 원(날짜 동그라미)은 묶이지 않는다."""
    m = len(comps)
    if m < 2:
        return [list(c) + [1] for c in comps]
    order = sorted(range(m), key=lambda k: comps[k][0])
    pairs = []
    for ii, a in enumerate(order):
        ax0, ay0, ax1, ay1 = comps[a][:4]
        for b in order[ii + 1:]:
            bx0, by0, bx1, by1 = comps[b][:4]
            if bx0 >= ax1:
                break
            xov = min(ax1, bx1) - max(ax0, bx0)
            gap = max(ay0, by0) - min(ay1, by1)
            if xov >= 0.3 * min(ax1 - ax0, bx1 - bx0) and gap <= SYL_GAP * max(ay1 - ay0, by1 - by0):
                pairs.append((gap, a, b))
    pairs.sort()
    par, box, cnt = list(range(m)), [list(c[:4]) for c in comps], [1] * m

    def find(a):
        while par[a] != a:
            par[a] = par[par[a]]
            a = par[a]
        return a
    for gap, a, b in pairs:
        ra, rb = find(a), find(b)
        if ra == rb:
            continue
        A, B = box[ra], box[rb]
        U = [min(A[0], B[0]), min(A[1], B[1]), max(A[2], B[2]), max(A[3], B[3])]
        uw, uh = U[2] - U[0], U[3] - U[1]
        xov = min(A[2], B[2]) - max(A[0], B[0])
        g = max(A[1], B[1]) - min(A[3], B[3])
        ha, hb = A[3] - A[1], B[3] - B[1]
        if (xov >= 0.3 * min(A[2] - A[0], B[2] - B[0]) and g <= SYL_GAP * max(ha, hb)
                and max(ha, hb) <= 2.2 * max(1, min(ha, hb))           # 조각 높이 비 2.2 안(글자 위에 놓인 원·판과 안 묶임)
                and uw <= 1.15 * max(A[2] - A[0], B[2] - B[0])          # 쌓기는 폭을 거의 안 늘림(옆 글자·밑줄 막대와 안 묶임)
                and 0.55 <= uw / max(uh, 1) <= 1.6 and uh <= BIG_H * H):  # 음절 모양(위아래 두 줄은 세로로 길어 안 묶임)
            par[rb] = ra
            box[ra] = U
            cnt[ra] += cnt[rb]
    return [box[r] + [cnt[r]] for r in range(m) if find(r) == r]


def text_lines(rgb, W_full, ver="v05"):
    """글자 덩어리를 찾아 줄로 묶고, 줄마다 대문자 높이를 추정한다. rgb는 원본 크기.
    ver="v05": 한글 음절 1단 묶기(merge_syllables) + 큰 글자(화면 높이 22~50%)도 받음. ver="v04": 예전 그대로(비교용)."""
    H, W = rgb.shape[:2]
    f = rgb.astype(np.float32)
    # 바탕: 16배 줄여 (화면 높이 20%) 칸 중앙값 → 늘림. 굵은 큰 글자가 창을 채워 바탕으로 잡히지 않게 창을 넉넉히,
    # 그보다 큰 판(카드·패널)은 바탕으로 흡수된다
    s = 16
    small = f[: H // s * s, : W // s * s].reshape(H // s, s, W // s, s, 3).mean(axis=(1, 3))
    win = max(9, int(round(0.2 * H / s)) | 1)
    bgs = np.stack([ndimage.median_filter(small[..., c], size=win, mode="nearest") for c in range(3)], -1)
    bg = np.kron(bgs, np.ones((s, s, 1)))
    bg = np.pad(bg, ((0, H - bg.shape[0]), (0, W - bg.shape[1]), (0, 0)), mode="edge")
    ink = np.abs(f - bg).max(-1) > 40
    lab, n = ndimage.label(ink, structure=np.ones((3, 3)))
    objs = ndimage.find_objects(lab)
    area = ndimage.sum(ink, lab, index=np.arange(1, n + 1)) if n else []
    comps = []
    for i, sl in enumerate(objs):
        if sl is None:
            continue
        y0, y1, x0, x1 = sl[0].start, sl[0].stop, sl[1].start, sl[1].stop
        h, w = y1 - y0, x1 - x0
        if h < 5 or h > (BIG_H if ver == "v05" else 0.22) * H or w > 0.6 * W:  # v0.4: 화면 높이 22% 넘는 덩어리는 글자로 보지 않음
            continue
        fill = area[i] / (h * w)
        if not (0.08 <= fill <= 0.92) or w / h > 8 or (w / h < 0.1 and h > 20):  # 커서·세로 막대 제외
            continue
        if fill > 0.7 and min(w, h) > 0.08 * H and 0.67 < w / h < 1.5:  # 큰 꽉 찬 도형(아이콘 판·원) 제외
            continue
        if h > 0.22 * H and not (0.15 <= fill <= 0.75 and 0.15 <= w / h <= 3):  # v0.5 큰 덩어리: 테두리·고리(채움 적음)·판(꽉 참) 제외
            continue
        comps.append((x0, y0, x1, y1))
    if ver == "v05":
        comps = [tuple(c) for c in merge_syllables(comps, H)]  # (x0, y0, x1, y1, 조각 수)
    else:
        comps = [tuple(c) + (1,) for c in comps]
    comps.sort()
    m = len(comps)
    par = list(range(m))

    def find(a):
        while par[a] != a:
            par[a] = par[par[a]]
            a = par[a]
        return a
    for a in range(m):
        ax0, ay0, ax1, ay1 = comps[a][:4]
        ha = ay1 - ay0
        for b in range(a + 1, m):
            bx0, by0, bx1, by1 = comps[b][:4]
            hb = by1 - by0
            if bx0 - ax1 > 1.2 * max(ha, hb):
                break  # x로 정렬했으므로 더 멀어짐
            ov = min(ay1, by1) - max(ay0, by0)
            if (ov >= 0.5 * min(ha, hb) and max(ha, hb) / min(ha, hb) < 1.8
                    and abs((ay0 + ay1) - (by0 + by1)) / 2 < 0.45 * max(ha, hb)):  # 가운데 높이도 가까워야 같은 줄
                par[find(a)] = find(b)
    groups = {}
    for a in range(m):
        groups.setdefault(find(a), []).append(comps[a])
    lines = []
    for g in groups.values():
        syl = False
        if len(g) < 2:
            x0, y0, x1, y1, npc = g[0]
            syl = ver == "v05" and npc >= 2 and 0.6 <= (x1 - x0) / (y1 - y0) <= 1.5 and y1 - y0 >= 10
            if not (1.5 <= (x1 - x0) / (y1 - y0) <= 8 and y1 - y0 >= 10) and not syl:
                continue  # 홀로 있는 덩어리는 '붙은 단어'처럼 가로로 긴 것만 줄로 인정(글로우·흐림으로 글자가 붙은 경우). v0.5: 조각 2개 이상을 묶은 음절 하나(요일 '월' 등)도 인정
        hs = np.array([c[3] - c[1] for c in g])
        cap = float(np.percentile(hs, 80))
        x0, y0 = min(c[0] for c in g), min(c[1] for c in g)
        x1, y1 = max(c[2] for c in g), max(c[3] for c in g)
        cap1920 = cap * 1920 / W_full
        lines.append(dict(bbox=[int(x0), int(y0), int(x1), int(y1)], glyphs=len(g), pieces=int(sum(c[4] for c in g)),
                          single_blob=len(g) == 1, single_syllable=syl, big=bool(cap > 0.22 * H), cap_px=round(cap, 1),
                          cap_1920=round(cap1920, 1), phone360_px=round(cap * 360 / W_full, 1),
                          cls="≥28" if cap1920 >= 28 else ("20~28" if cap1920 >= 20 else "<20")))
    lines.sort(key=lambda d: -d["cap_1920"])
    return lines


def run_text(V, shots, frames_arg, out):
    if frames_arg:
        idx = [int(x) for x in frames_arg.split(",") if x.strip()]
    elif shots:
        idx = [s["key"] for s in shots]
    else:
        idx = [int(round(t * V.fps)) for t in np.arange(0.5, V.duration, 1.0)]
    fr = V.frames(idx)
    os.makedirs(os.path.join(out, "text"), exist_ok=True)
    F = font(max(14, V.W // 90))
    col = {"≥28": (0, 170, 80), "20~28": (240, 160, 0), "<20": (230, 40, 40)}
    rows = []
    for i in sorted(fr):
        L = text_lines(fr[i], V.W)
        L4 = text_lines(fr[i], V.W, ver="v04")  # 예전 방식(비교용 *_v04 키)
        im = Image.fromarray(fr[i]).copy()
        d = ImageDraw.Draw(im)
        for k, ln in enumerate(L[:40]):
            x0, y0, x1, y1 = ln["bbox"]
            d.rectangle([x0 - 2, y0 - 2, x1 + 2, y1 + 2], outline=col[ln["cls"]], width=3)
            d.text((x0, max(0, y0 - F.size - 4)), f"{k}:{ln['cap_1920']:.0f}", fill=col[ln["cls"]], font=F)
        sc = 960 / V.W if V.W >= V.H else 960 / V.H
        im.resize((round(V.W * sc), round(V.H * sc)), Image.LANCZOS).save(os.path.join(out, "text", f"f{i:04d}.jpg"), quality=85)
        rows.append(dict(frame=i, time_s=round(i / V.fps, 3), shot=shot_of(shots, i), n_lines=len(L),
                         largest_cap_1920=L[0]["cap_1920"] if L else None,
                         n_lines_under20=sum(ln["cls"] == "<20" for ln in L), lines=L[:25],
                         n_big_lines=sum(ln["big"] for ln in L), n_single_syllable=sum(ln["single_syllable"] for ln in L),
                         n_lines_v04=len(L4), largest_cap_1920_v04=L4[0]["cap_1920"] if L4 else None,
                         n_lines_under20_v04=sum(ln["cls"] == "<20" for ln in L4),
                         overlay=f"text/f{i:04d}.jpg"))
    return dict(
        method="바탕(화면 높이 20% 창 중앙값)과 RGB 최대 차 40 넘는 픽셀 덩어리 → 높이·채움 비율로 글자 후보 → "
               "(v0.5) 1단: 위아래로 쌓인 자모 조각을 음절 하나로 묶음(가로 30% 겹침·세로 틈 35% 이하·높이 비 2.2 안·합친 폭 1.15배 안·합친 상자 폭/높이 0.55~1.6) → "
               "2단: 같은 줄(세로 50% 겹침, 글자 높이 1.2배 안 간격)로 묶음 → 줄의 덩어리 높이 80백분위 = 대문자 높이 추정. "
               "덩어리 높이 상한 화면 높이 50%(v0.4는 22%), 22% 넘는 덩어리는 채움 0.15~0.75·폭/높이 0.15~3만(테두리·고리·판 제외), 그런 줄은 big=true. "
               "cap_1920 = 원본 px × 1920/영상 폭(360px 폰에서 같은 크기로 보이는 1920 폭 환산). 예전 방식 값은 *_v04",
        reference="참고 기준(critic 문서 G2): 주요 글자 cap_1920 ≥ 28, 보조 ≥ 20. 장식·배경 글자, 아이콘 줄은 비평가가 겹침 그림(overlay)을 보고 뺀다",
        limits="흐린 글자·사진 위 글자·바탕과 밝기 차가 작은 글자는 놓침, 아이콘·점 줄·표 선도 줄로 잡힐 수 있음, 소문자만 있는 줄은 x높이(작게) 쪽으로 치우침, "
               "붙은 필기체·한글 음절은 덩어리 높이가 대문자 높이보다 큼(한글은 em 높이에 가까움). single_blob=true 줄은 글로우·흐림으로 붙은 단어 또는 반원 같은 도형일 수 있어 겹침 그림으로 확인. "
               "single_syllable=true는 조각 2개 이상을 묶은 홀로 있는 음절(요일 '월' 등) — 여러 조각으로 된 아이콘도 이렇게 잡힐 수 있다. 줄 간격이 아주 좁은 두 줄(틈 < 글자 높이 25%)은 음절로 잘못 묶일 수 있다. "
               "화면 높이 20%보다 큰 글자는 바탕 창에 안쪽이 흡수돼 획 가장자리만 잡혀 작게·쪼개져 나올 수 있다",
        frames=rows)


# ---------------------------------------------------------------- --sync
def audio_mono(V, sr=48000):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", V.path, "-ac", "1", "-ar", str(sr), "-f", "f32le", "-"],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.float32)


def onsets(a, sr, top=0.25, min_gap=0.06):
    """고역 강조 스펙트럼 플럭스의 극대(±30ms) 중 '두드러짐'(봉우리 − 앞 50ms 최저) 상위 top 비율 = 강한 시작점.
    시각은 봉우리 앞 50% 급등점으로 당긴다. 음악 박자도 섞이므로 상위만 남겨 효과음 쪽으로 치우치게 한다."""
    hop, n = 256, 1024
    x = np.diff(a, prepend=0).astype(np.float32)  # 고역 강조(음악 바닥 킥 영향 줄임)
    nfr = 1 + (len(x) - n) // hop
    if nfr < 4:
        return []
    idx = np.arange(n)[None, :] + hop * np.arange(nfr)[:, None]
    S = np.log1p(np.abs(np.fft.rfft(x[idx] * np.hanning(n), axis=1)) * 100)
    fl = np.concatenate([[0], np.maximum(0, np.diff(S, axis=0)).sum(1)])
    rad, back = int(0.03 * sr / hop), int(0.05 * sr / hop)
    pk = [i for i in range(1, len(fl) - 1) if fl[i] > 0 and fl[i] == fl[max(0, i - rad):i + rad + 1].max()]
    if not pk:
        return []
    prom = np.array([fl[i] - fl[max(0, i - back):i].min() for i in pk])
    thr = np.percentile(prom, 100 * (1 - top))
    out, last = [], -1e9
    for i, pr in zip(pk, prom):
        t = i * hop / sr
        if pr >= thr and t - last >= min_gap:
            base = fl[max(0, i - back):i].min()
            j = i
            while j > 0 and fl[j - 1] > base + 0.5 * (fl[i] - base):
                j -= 1
            out.append(dict(t=round(j * hop / sr + n / 2 / sr, 4), prominence=round(float(pr), 1)))
            last = t
    return out


class VisualChange:
    """화면 변화: 320px 회색을 8×8 칸으로 나눠 칸별 프레임 차의 최댓값(작은 글자 하나가 생겨도 잡히게) →
    '솟음' = 지금 값 − 앞 3프레임 평균. 어떤 프레임 f 근처 ±3프레임에서 두드러진 솟음(극대, 창 최댓값의 35% 이상) 중 f에 가장 가까운 프레임을 그 사건의 화면 프레임으로 본다."""
    LAND_FRAC, LAND_ABS = 0.5, 6.0  # v0.5 착지: 앞 2프레임 평균의 50% 미만으로 줄어든 첫 프레임, 앞 평균 ≥ 6.0

    def __init__(self, V):
        G = cell_diffs(V)
        N = len(G)
        self.tm = G.reshape(N, -1).max(1)
        self.rise = np.array([self.tm[i] - self.tm[max(0, i - 3):i].mean() if i else 0.0 for i in range(len(self.tm))])
        # v0.5 착지(속도 급정지): 칸 둘레 3×3·5×5 칸 최댓값이 함께 앞 2프레임 평균의 50% 미만으로 처음 줄어든 프레임 i →
        # 사건 프레임은 i−1(마지막으로 크게 움직여 자리에 닿은 프레임). 5×5도 함께 줄어야 하므로 '옆 칸으로 지나감'(움직임이 옮겨 감)은 빠진다.
        N3 = ndimage.maximum_filter(G, size=(1, 3, 3), mode="nearest")
        N5 = ndimage.maximum_filter(G, size=(1, 5, 5), mode="nearest")
        fr, ab = self.LAND_FRAC, self.LAND_ABS
        self.land = np.zeros(N)
        for i in range(3, N):
            p3, p5 = 0.5 * (N3[i - 2] + N3[i - 1]), 0.5 * (N5[i - 2] + N5[i - 1])
            ok = (N3[i] < fr * p3) & (N5[i] < fr * p5) & (p3 >= ab) & ~(N3[i - 1] < fr * 0.5 * (N3[i - 3] + N3[i - 2]))
            if ok.any():
                self.land[i - 1] = max(self.land[i - 1], float((p3 - N3[i])[ok].max()))

    def land_frames(self, floor=1.5):
        return [dict(frame=int(i), drop=round(float(self.land[i]), 2)) for i in range(len(self.land)) if self.land[i] >= floor]

    def offset_land(self, f, win=3):
        """f에서 가장 가까운 착지(급감) 프레임까지: (화면 프레임, f − 화면 프레임, 급감 크기). 없으면 (None, None, 0)."""
        return self._near(self.land, f, win, fallback=False)

    def offset(self, f, win=3):
        """f(소리·계획 프레임)에서 가장 가까운 화면 솟음까지: (화면 프레임, f − 화면 프레임, 솟음 크기)."""
        return self._near(self.rise, f, win, fallback=True)

    def _near(self, r, f, win, fallback):
        fi = int(round(f))
        lo, hi = max(1, fi - win), min(len(self.tm) - 1, fi + win)
        if lo > hi:
            return None, None, 0.0
        top = float(r[lo:hi + 1].max())
        # 창 안에서 솟음이 극대이고 창 최댓값의 35%(최소 1.5) 넘는 프레임 중 f에 가장 가까운 것.
        # (여러 요소가 동시에 움직이는 화면에서 '가장 큰 것'만 고르면 창 끝으로 치우친다)
        cand = [j for j in range(lo, hi + 1) if r[j] >= max(1.5, 0.35 * top) and r[j] >= r[j - 1] and (j + 1 >= len(r) or r[j] >= r[j + 1])]
        if not cand:
            if not fallback:
                return None, None, 0.0
            j = lo + int(np.argmax(r[lo:hi + 1]))
        else:
            j = min(cand, key=lambda c: (abs(c - f), -r[c]))
        return j, round(float(f - j), 2), round(float(r[j]), 2)


def plan_events(path, fps):
    j = json.load(open(path, encoding="utf-8"))
    if isinstance(j, dict):
        j = j.get("events") or j.get("rows") or []
    out = []
    for e in j:
        if "frame" in e:
            f = float(e["frame"])
        elif "k" in e:
            f = float(e["k"])
        elif "time_s" in e:
            f = float(e["time_s"]) * fps
        else:
            continue
        name = e.get("event") or e.get("what") or e.get("type") or ""
        typ = str(e.get("type") or "")
        lk = land_kind(typ, name, e.get("visual"))
        out.append(dict(name=e.get("event") or e.get("type") or "", frame=f, type=typ, land_like=lk is not None, land_why=lk))
    return sorted(out, key=lambda e: e["frame"])


LAND_WORDS = ("착지", "앉", "멈춤", "멈춰", "정착", "닿", "land", "settle", "stop", "thud")


def land_kind(typ, name, visual=None):
    """사건이 '착지·멈춤' 계열인지: 계획의 visual 칸("land"), type, 이름·설명에 LAND_WORDS가 있으면 그 근거 글자를 돌려준다."""
    if str(visual or "").lower() in ("land", "settle", "stop", "착지"):
        return "visual=" + str(visual)
    for where, txt in (("type", typ), ("이름", name)):
        low = str(txt).lower()
        for w in LAND_WORDS:
            if w in low:
                return f"{where}에 '{w}'"
    return None


def run_sync(V, events_path, out, top=0.25):
    if not V.has_audio:
        return dict(error="소리 없음")
    sr = 48000
    a = audio_mono(V, sr)
    peaks = onsets(a, sr, top=top)
    VC = VisualChange(V)

    def within(o):
        o = np.array([x for x in o if x is not None])
        return int((np.abs(o) <= 1).sum()), len(o)

    def chance(frames, land_like=None):
        # 우연 기준: 같은 프레임들을 +7·−9·+13 옮겨도 ±1 안에 화면 솟음이 '가장 큰 것'으로 걸리는 비율
        # land_like를 주면 그 사건은 착지(급감)까지 함께 봐서(실제 측정과 같은 방식) 우연 값도 그만큼 오른다
        land_like = land_like or [False] * len(frames)
        r = []
        for f, lk in zip(frames, land_like):
            for sh in (7, -9, 13):
                j, o, _ = VC.offset(f + sh)
                if j is None:
                    continue
                hit = abs(o if o is not None else 99) <= 1
                if lk and not hit:
                    o2 = VC.offset_land(f + sh)[1]
                    hit = o2 is not None and abs(o2) <= 1
                r.append(hit)
        return round(float(np.mean(r)), 3) if r else None
    rows = []
    for p in peaks:
        fr = p["t"] * V.fps
        vf, off, rs = VC.offset(fr)
        rows.append(dict(onset_s=p["t"], onset_frame=round(fr, 2), prominence=p["prominence"], visual_frame=vf,
                         offset_frames=off, visual_rise=rs))
    w, n = within([r["offset_frames"] for r in rows])
    res = dict(
        method="소리: 1차 차분(고역 강조) 스펙트럼 플럭스의 극대 중 두드러짐 상위 %d%%(--onset-top), 시각은 봉우리 앞 50%% 급등점. "
               "화면: 320px 회색 8×8 칸 프레임 차의 최댓값이 앞 3프레임 평균보다 솟은 정도. 소리 시작점 ±3프레임에서 두드러진 솟음 중 가장 가까운 프레임까지 차이(프레임, +면 소리가 늦음)" % round(top * 100),
        n_onsets=len(rows), within_1frame=f"{w}/{n}", within_1frame_ratio=round(w / n, 3) if n else None,
        median_abs_offset=round(float(np.median(np.abs([r["offset_frames"] for r in rows if r["offset_frames"] is not None]))), 2) if rows else None,
        chance_within_1frame_ratio=chance([r["onset_frame"] for r in rows]),
        chance_note="같은 시작점을 7·9·13프레임 옮겨 잰 맞음 비율(±3 창에서 아무 곳이나 걸려도 약 0.3~0.4). 실제 비율이 이것보다 충분히 높아야 싱크 근거",
        reference="critic 문서 G3: 효과음의 80% 이상이 화면 사건과 ±1프레임. 자동 모드는 음악 박자도 섞이므로 근거가 약하다. 효과음 계획(--events)이 있으면 planned 쪽을 본다",
        onsets=rows,
        land_frames=VC.land_frames(),
        land_note="v0.5 착지(속도 급정지) 후보: 칸 둘레(3×3·5×5 칸) 변화가 앞 2프레임 평균의 50% 미만으로 처음 줄어든 프레임의 앞 프레임. "
                  "drop = 줄어든 크기(0~255). 계획 모드에서 착지·멈춤 계열 사건만 이것과 대조한다")
    if events_path:
        E = plan_events(events_path, V.fps)
        H = 96
        e = np.sqrt(np.convolve(np.diff(a, prepend=0) ** 2, np.ones(H) / H, "same"))
        er = []
        for ev in E:
            t = ev["frame"] / V.fps
            i0, i1 = int((t - 0.045) * sr), int((t + 0.045) * sr)  # ±45ms(30fps에서 ±1.35프레임) 창
            seg = e[max(0, i0):i1]
            if len(seg) == 0 or ev["frame"] >= V.nb:
                er.append(dict(event=ev["name"], frame=ev["frame"], note="영상 밖"))
                continue
            base = np.median(e[max(0, i0 - 4800):max(1, i0)])
            kk = int(np.argmax(seg > base + 0.5 * (seg.max() - base)))
            on = (max(0, i0) + kk) / sr
            fa = on * V.fps
            vf, voff, rs = VC.offset(fa)
            row = dict(event=ev["name"], frame=ev["frame"], type=ev["type"], audio_onset_s=round(on, 4),
                       audio_vs_plan_frames=round((on - t) * V.fps, 2), visual_frame=vf,
                       audio_vs_visual_frames=voff, visual_rise=rs, visual_kind="rise",
                       visual_frame_rise=vf, audio_vs_rise_frames=voff, land_like=ev["land_like"])
            if ev["land_like"]:
                lf, loff, ld = VC.offset_land(fa)
                row.update(land_why=ev["land_why"], land_frame=lf, audio_vs_land_frames=loff, land_drop=ld)
                if loff is not None and (voff is None or abs(loff) < abs(voff)):  # 솟음·착지 중 더 가까운 것
                    row.update(visual_frame=lf, audio_vs_visual_frames=loff, visual_kind="land")
            er.append(row)
        ok = [r for r in er if "audio_onset_s" in r]
        wa, na = within([r["audio_vs_plan_frames"] for r in ok])
        wv, nv = within([r["audio_vs_visual_frames"] for r in ok])
        wr, nr = within([r["audio_vs_rise_frames"] for r in ok])
        lands = [r for r in ok if r["land_like"]]
        res["planned"] = dict(
            source=events_path, n=len(er), n_in_video=len(ok),
            audio_on_plan_within_1frame=f"{wa}/{na}",
            audio_on_visual_within_1frame=f"{wv}/{nv}", audio_on_visual_ratio=round(wv / nv, 3) if nv else None,
            chance_audio_on_visual=chance([r["audio_onset_s"] * V.fps for r in ok], [r["land_like"] for r in ok]),
            audio_on_visual_within_1frame_rise=f"{wr}/{nr}", audio_on_visual_ratio_rise=round(wr / nr, 3) if nr else None,
            chance_audio_on_visual_rise=chance([r["audio_onset_s"] * V.fps for r in ok]),
            n_land_like=len(lands), land_like_within_1frame=f"{within([r['audio_vs_visual_frames'] for r in lands])[0]}/{len(lands)}",
            land_like_within_1frame_rise=f"{within([r['audio_vs_rise_frames'] for r in lands])[0]}/{len(lands)}",
            note="audio_vs_plan: 계획 시각 ±45ms 창 안 에너지 급등. audio_vs_visual: 그 소리 시작점 ±3프레임의 두드러진 화면 솟음 중 가장 가까운 것까지 — "
                 "착지·멈춤 계열 사건(type·이름에 착지/land/settle/thud 등, land_why)은 '착지(칸 변화 급감)' 프레임과도 대조해 더 가까운 쪽(visual_kind). "
                 "G3에 쓰는 값은 audio_on_visual. 예전 값(솟음만)은 *_rise. 소리가 정지 화면 위에 놓였거나 화면 변화가 부드러우면(서서히 커짐) 어긋나게 나온다",
            rows=er)
    # 그림: 위 = 화면 변화(칸 최대 차), 아래 = 소리 시작점(초록 ±1 안, 빨강 밖)
    try:
        Wp, Hp = 1600, 300
        im = Image.new("RGB", (Wp, Hp), (250, 249, 246))
        dr = ImageDraw.Draw(im)
        tm = VC.tm
        n = len(tm)
        dm = max(float(np.percentile(tm, 99)), 1e-3)
        for i in range(1, n):
            dr.line([(i - 1) * Wp / n, 140 - min(1, tm[i - 1] / dm) * 120, i * Wp / n, 140 - min(1, tm[i] / dm) * 120], fill=(40, 40, 40), width=1)
        for lf in res.get("land_frames", []):  # 착지 후보 = 파란 짧은 눈금
            x = lf["frame"] * Wp / n
            dr.line([x, 142, x, 160], fill=(40, 90, 220), width=2)
        src = res.get("planned", {}).get("rows") or rows
        for r in src:
            f = r.get("audio_onset_s", r.get("onset_s"))
            off = r.get("audio_vs_visual_frames", r.get("offset_frames"))
            if f is None:
                continue
            x = f * V.fps * Wp / n
            dr.line([x, 170, x, 280], fill=(0, 160, 70) if off is not None and abs(off) <= 1 else (220, 40, 40), width=2)
        F = font(14)
        dr.text((6, 4), "화면 변화(8×8 칸 프레임 차 최댓값), 파랑 눈금 = 착지(급감) 후보", fill=(0, 0, 0), font=F)
        dr.text((6, 284), ("계획 효과음" if "planned" in res else "소리 시작점") + ": 초록=±1프레임 안 화면 사건(솟음, 착지 계열은 착지도), 빨강=밖", fill=(0, 0, 0), font=F)
        im.save(os.path.join(out, "sync.png"))
        res["figure"] = "sync.png"
    except Exception as ex:  # 그림 실패는 측정 결과에 영향 없음
        res["figure_error"] = str(ex)
    return res


# ---------------------------------------------------------------- --entries
def curve_stats(v, start=None, tol=1.0):
    """등장 곡선 정의. v: 프레임마다 위치(또는 크기), start: 첫 프레임 '앞'의 출발값(설계값, 있으면)."""
    v = np.array(v, float)
    if start is not None:
        v = np.concatenate([[start], v])
    a, b = v[0], v[-1]
    dist = b - a
    if abs(dist) < 1e-6:
        return dict(distance_px=0.0, note="변화 없음")
    p = (v - a) / dist
    rem = 1 - p
    ratios = [rem[i + 1] / rem[i] for i in range(1, len(rem) - 1) if rem[i] > 0.03 and rem[i + 1] >= 0]
    over = max(0.0, float(-(rem.min())))
    settle = next((i for i in range(len(rem)) if all(abs(r) * abs(dist) < tol for r in rem[i:])), len(rem))
    arrive80 = next((i for i in range(len(p)) if p[i] >= 0.8), None)
    return dict(distance_px=round(float(dist), 1), first_jump=round(float(p[1]), 3) if len(p) > 1 else None,
                ratio_median=round(float(np.median(ratios)), 3) if ratios else None,
                overshoot_pct=round(over * 100, 2), overshoot_px=round(over * abs(float(dist)), 2),
                arrive80_frames=arrive80, frames_to_settle=int(settle), progress=[round(float(x), 3) for x in p])


def accel_g(v):
    v = np.array(v, float)
    sp = np.abs(np.diff(v))
    g = [sp[i + 1] / sp[i] for i in range(len(sp) - 1) if sp[i] > 0.4]
    ii = [i for i in range(len(sp)) if sp[i] > 0]
    gfit = float(np.exp(np.polyfit(ii, np.log(sp[ii]), 1)[0])) if len(ii) > 3 else None
    return dict(speeds=[round(float(s), 2) for s in sp], g_median=round(float(np.median(g)), 3) if g else None,
                g_fit=round(gfit, 3) if gfit else None)


STAT = {"x": lambda xs, ys: (xs.min() + xs.max()) / 2, "y": lambda xs, ys: (ys.min() + ys.max()) / 2,
        "w": lambda xs, ys: xs.max() - xs.min(), "h": lambda xs, ys: ys.max() - ys.min(),
        "left": lambda xs, ys: xs.min(), "right": lambda xs, ys: xs.max(),
        "top": lambda xs, ys: ys.min(), "bottom": lambda xs, ys: ys.max()}


def ink_mask(im, bg, tol):
    return np.abs(im.astype(np.int16) - np.array(bg, np.int16)[None, None, :]).max(-1) > tol


def border_bg(im):
    b = np.concatenate([im[:3].reshape(-1, 3), im[-3:].reshape(-1, 3), im[:, :3].reshape(-1, 3), im[:, -3:].reshape(-1, 3)])
    return np.median(b, axis=0)


def run_entries(V, shots, spec_path):
    out = []
    if spec_path:
        spec = json.load(open(spec_path, encoding="utf-8"))
        for e in spec:
            f0, f1 = int(e["f0"]), int(e["f1"])
            fr = V.decode(sel=f"between(n\\,{f0}\\,{f1})")
            x0, y0, x1, y1 = e.get("box", [0, 0, V.W, V.H])
            vals = []
            for im in fr:
                crop = im[y0:y1, x0:x1]
                bg = e.get("color_bg") or border_bg(fr[-1][y0:y1, x0:x1])
                m = ink_mask(crop, bg, e.get("tol", 40)) if "color" not in e else \
                    (np.abs(crop.astype(np.int16) - np.array(e["color"])[None, None, :]).max(-1) <= e.get("tol", 40))
                ys, xs = np.nonzero(m)
                vals.append(np.nan if len(xs) < 5 else STAT[e.get("stat", "x")](xs + x0, ys + y0))
            vals = np.array(vals, float)
            ok = ~np.isnan(vals)
            row = dict(name=e.get("name", f"f{f0}"), f0=f0, f1=f1, stat=e.get("stat", "x"), mode=e.get("mode", "enter"))
            if ok.sum() < 3:
                row["error"] = "요소를 못 찾음(box·tol·color 확인)"
            elif e.get("mode") == "exit":
                row.update(accel_g(vals[ok]))
            else:
                st = e.get("start")
                if st is None and e.get("start_offset") is not None:  # '끝 자리 + 설계 거리'로 출발값을 줄 때
                    st = float(vals[ok][-1]) + float(e["start_offset"])
                row.update(curve_stats(vals[ok], start=st, tol=e.get("settle_tol", 1.0)))
            out.append(row)
        mode = "spec"
    else:
        # 자동(거침): 샷마다 첫 프레임부터 최대 24프레임, 480px에서 바탕(마지막 프레임 가장자리 색)과 다른 픽셀 전체의 상자
        sc = 1920 / 480
        for s in shots:
            f0, f1 = s["f0"], min(s["f1"], s["f0"] + 24)
            if f1 - f0 < 3:
                continue
            fr = V.decode(w=480, sel=f"between(n\\,{f0}\\,{f1})")
            bg = border_bg(fr[-1])
            feats = []
            for im in fr:
                ys, xs = np.nonzero(ink_mask(im, bg, 40))
                feats.append([np.nan] * 4 if len(xs) < 20 else [(xs.min() + xs.max()) / 2 * sc, (ys.min() + ys.max()) / 2 * sc,
                                                                 (xs.max() - xs.min()) * sc, (ys.max() - ys.min()) * sc])
            Fm = np.array(feats, float)
            okr = ~np.isnan(Fm).any(1)
            row = dict(shot=s["no"], f0=f0, f1=f1)
            if okr.sum() < 3:
                row["note"] = "바탕과 다른 요소가 거의 없음"
                out.append(row)
                continue
            Fv = Fm[okr]
            ax = int(np.argmax(np.abs(Fv[0] - Fv[-1])))
            row["axis"] = ["x", "y", "w", "h"][ax]
            row["first_valid_frame"] = f0 + int(np.argmax(okr))
            st = curve_stats(Fv[:, ax], tol=2.0)
            row.update(st)
            if abs(st.get("distance_px", 0)) < 8:
                row["note"] = "변화가 8px(1920 기준) 미만: 등장 움직임 없음 또는 컷 등장"
            out.append(row)
        mode = "auto"
    return dict(mode=mode,
                method="progress = (값−시작)/(끝−시작). first_jump = 첫 프레임 진행(출발값 start를 주면 그 다음 프레임), "
                       "ratio_median = 남은 거리의 프레임당 비율 중앙값(작을수록 빨리 감속, 지수 감속이면 일정), overshoot = 끝값을 넘은 정도, "
                       "arrive80 = 80% 도달 프레임, settle = 끝값과 tol 안에 머물기 시작한 프레임. exit 모드는 프레임당 이동 배율 g(가속)",
                reference="예시 패키지 motion.json 범위(예: 채팅·UI 예시 패키지 expo_settle first_jump 0.17~0.57, r 0.69~0.90, 넘침 0, expo_accel g 1.2~1.6)와 비평가가 대조",
                limits="자동 모드는 화면 전체 상자라 여러 요소가 동시에 움직이면 섞이고, 카메라 이동·컷 등장도 '등장'처럼 잡힌다. 정밀 측정은 --entry-spec로 상자·축을 준다",
                rows=out)


# ---------------------------------------------------------------- --contact
def run_contact(V, shots, out, every=0.5, phone_frames=None):
    if shots:
        idx = [s["key"] for s in shots]
    else:
        idx = [int(round(t * V.fps)) for t in np.arange(0, V.duration, every)]
    portrait = V.H > V.W
    CW = int(round(384 * V.W / V.H)) if portrait else 384
    CH = 384 if portrait else int(round(384 * V.H / V.W))
    fr = V.frames(idx, w=None)
    idx = sorted(fr)
    COLS, PAD, LH = (8 if portrait else 6), 8, 26
    R = (len(idx) + COLS - 1) // COLS
    sheet = Image.new("RGB", (COLS * (CW + PAD) + PAD, R * (CH + LH + PAD) + PAD), (16, 16, 18))
    d = ImageDraw.Draw(sheet)
    F = font(15)
    for n, i in enumerate(idx):
        r, c = divmod(n, COLS)
        x, y = PAD + c * (CW + PAD), PAD + r * (CH + LH + PAD)
        sheet.paste(Image.fromarray(fr[i]).resize((CW, CH), Image.LANCZOS), (x, y + LH))
        sh = shot_of(shots, i)
        d.text((x + 2, y + 4), f"#{n:02d} f{i} {i / V.fps:.2f}s" + (f" s{sh}" if sh is not None else ""), fill=(230, 230, 230), font=F)
    sheet.save(os.path.join(out, "contact.png"))
    # 360px 사본: 폰 화면 폭 360에 꽉 차게 줄였을 때의 모습
    pidx = [int(x) for x in phone_frames.split(",")] if phone_frames else idx
    pf = V.frames(pidx) if phone_frames else fr
    pidx = sorted(pf)
    PH = int(round(360 * V.H / V.W))
    PCOLS = 5
    R2 = (len(pidx) + PCOLS - 1) // PCOLS
    ph = Image.new("RGB", (PCOLS * 370 + 10, R2 * (PH + 30) + 10), (16, 16, 18))
    dp = ImageDraw.Draw(ph)
    for n, i in enumerate(pidx):
        r, c = divmod(n, PCOLS)
        x, y = 10 + c * 370, 10 + r * (PH + 30)
        ph.paste(Image.fromarray(pf[i]).resize((360, PH), Image.LANCZOS), (x, y + 24))
        dp.text((x, y + 2), f"f{i} {i / V.fps:.2f}s", fill=(230, 230, 230), font=F)
    ph.save(os.path.join(out, "phone360.png"))
    res = dict(contact="contact.png", contact_frames=idx, phone360="phone360.png", phone360_frames=pidx,
               phone_note="한 칸 = 폰 폭 360px에 영상을 꽉 채운 크기. 1920 폭 원본의 28px 대문자 = 이 그림에서 약 5.3px")
    # v0.5 빈 면 ↔ 짝 기준 그림: 스토리보드 샷에 anchor가 있으면 key 프레임의 empty(texture/measure_texture.py와 같은 정의)와 부호 있는 차
    rows = []
    if any(s.get("anchor") for s in shots):
        try:
            MT = texture_module()
            for s in shots:
                if not s.get("anchor") or s["key"] not in fr:
                    continue
                e = MT.measure_frame(fr[s["key"]])["empty"]
                r = dict(shot=s["no"], frame=s["key"], empty=e)
                r.update(MT.empty_vs_anchor(e, s["anchor"]))
                rows.append(r)
        except Exception as ex:  # 빈 면 계산 실패는 밀착 시트에 영향 없음
            res["empty_error"] = str(ex)
    if rows:
        res["empty_vs_anchor"] = rows
        res["empty_note"] = ("empty_diff_vs_anchor = 샷 key 프레임 empty − 짝 기준 그림 empty. + = 짝보다 더 빔, − = 더 참(층·내용이 많음). "
                             "empty_side는 ±0.10 밖이면 '더 빔'/'더 참'. 어느 쪽을 상한으로 막을지는 critic 문서 Q1이 정한다")
        res["empty_out_of_band"] = dict(more_empty=[r["shot"] for r in rows if r.get("empty_side") == "더 빔"],
                                        more_full=[r["shot"] for r in rows if r.get("empty_side") == "더 참"], n_shots=len(rows))
    return res


def texture_module():
    """texture/measure_texture.py를 불러온다(-I 실행이라 경로로 직접)."""
    import importlib.util
    p = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "texture", "measure_texture.py")
    spec = importlib.util.spec_from_file_location("kax_measure_texture", p)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


# ---------------------------------------------------------------- --margins (v0.3 Q5 상한)
MW = 480  # 여백 측정 작업 폭(1920 원본의 1/4). 짧은 변 5% = 1080 원본 54px = 작업 크기 13.5px


def content_boxes(rgb, min_area=8):
    """바탕과 다른 내용(글자·주인공) 덩어리 상자. --text와 같은 바탕 추정(4배 줄인 그림의 화면 높이 20% 창 중앙값)에
    RGB 최대 차 40. 화면 전체를 덮는 바탕·결·가장자리까지 깔리는 장식은 뺀다:
      ① 상자가 화면 폭 또는 높이의 85% 이상(전면 판·테두리·가로지르는 선·격자)  → 'span'
      ② 같은 줄에 늘어선 작은 덩어리 6개 이상이 화면 폭(또는 높이)의 85% 이상 이어짐(파형 막대·점 줄·눈금) → 'row'
      ③ 화면 모서리 두 변에 닿은 작은 조각(짧은 변 5% 미만, 둥근 판 바깥 귀퉁이·비네트) → 'corner'
      ④ 넓이 min_area px 미만(작업 크기, 그레인·잡티) → 버림
    돌려줌: (kept, excluded) — 각 [x0, y0, x1, y1, area] (작업 크기 픽셀)"""
    H, W = rgb.shape[:2]
    f = rgb.astype(np.float32)
    s = 4
    small = f[: H // s * s, : W // s * s].reshape(H // s, s, W // s, s, 3).mean(axis=(1, 3))
    win = max(9, int(round(0.2 * H / s)) | 1)
    bgs = np.stack([ndimage.median_filter(small[..., c], size=win, mode="nearest") for c in range(3)], -1)
    bg = np.kron(bgs, np.ones((s, s, 1)))
    bg = np.pad(bg, ((0, H - bg.shape[0]), (0, W - bg.shape[1]), (0, 0)), mode="edge")
    ink = np.abs(f - bg).max(-1) > 40
    lab, n = ndimage.label(ink, structure=np.ones((3, 3)))
    if not n:
        return [], []
    objs = ndimage.find_objects(lab)
    area = ndimage.sum(ink, lab, index=np.arange(1, n + 1))
    kept, excl = [], []
    for i, sl in enumerate(objs):
        if sl is None or area[i] < min_area:
            continue
        b = [sl[1].start, sl[0].start, sl[1].stop, sl[0].stop, int(area[i])]
        cs = 0.05 * min(H, W)
        if b[2] - b[0] >= 0.85 * W or b[3] - b[1] >= 0.85 * H:
            excl.append(b + ["span"])
        elif (b[2] - b[0] < cs and b[3] - b[1] < cs and (b[0] == 0 or b[2] == W) and (b[1] == 0 or b[3] == H)):
            excl.append(b + ["corner"])  # 모서리 조각(둥근 판 바깥 귀퉁이·비네트)
        else:
            kept.append(b)
    # ② 줄 장식: 작은 덩어리(짧은 변 15% 미만)가 같은 줄(세로 겹침 50%)로 이어져 폭 85% 이상
    for axis in (0, 1):  # 0 = 가로 줄, 1 = 세로 줄
        small_ids = [k for k, b in enumerate(kept) if max(b[2] - b[0], b[3] - b[1]) < 0.15 * min(H, W)]
        par = {k: k for k in small_ids}

        def find(a):
            while par[a] != a:
                par[a] = par[par[a]]
                a = par[a]
            return a
        for ii, a in enumerate(small_ids):
            A = kept[a]
            for b in small_ids[ii + 1:]:
                B = kept[b]
                if axis == 0:
                    ov = min(A[3], B[3]) - max(A[1], B[1])
                    if ov >= 0.5 * min(A[3] - A[1], B[3] - B[1]):
                        par[find(a)] = find(b)
                else:
                    ov = min(A[2], B[2]) - max(A[0], B[0])
                    if ov >= 0.5 * min(A[2] - A[0], B[2] - B[0]):
                        par[find(a)] = find(b)
        groups = {}
        for k in small_ids:
            groups.setdefault(find(k), []).append(k)
        drop = set()
        for g in groups.values():
            if len(g) < 6:
                continue
            lo = min(kept[k][0 if axis == 0 else 1] for k in g)
            hi = max(kept[k][2 if axis == 0 else 3] for k in g)
            if hi - lo >= 0.85 * (W if axis == 0 else H):
                drop.update(g)
        if drop:
            excl += [kept[k] + ["row"] for k in sorted(drop)]
            kept = [b for k, b in enumerate(kept) if k not in drop]
    return kept, excl


def frame_margins(rgb):
    """한 프레임의 네 변 여백(짧은 변 대비 비율)과 그 변에 가장 가까운 상자."""
    H, W = rgb.shape[:2]
    S = min(H, W)
    kept, excl = content_boxes(rgb)
    out = dict(n_boxes=len(kept), boxes=[b[:4] for b in kept], HW=(H, W))
    for side in ("top", "bottom", "left", "right"):
        best = None
        for b in kept:
            d = {"top": b[1], "bottom": H - b[3], "left": b[0], "right": W - b[2]}[side]
            if best is None or d < best[0]:
                best = (d, b)
        out[side] = None if best is None else round(best[0] / S, 4)
        out[side + "_box"] = None if best is None else best[1][:4]
    return out, kept, excl


def run_margins(V, shots, out, step=6, thr=0.05, min_run=7):
    sc = V.W / MW  # 작업 크기 → 원본 px
    if shots:
        allowed = sorted({f for s in shots for f in range(s["f0"], min(s["f1"], V.nb - 1) + 1)})
    else:
        allowed = list(range(V.nb))
    allowed_set = set(allowed)
    bleed = {f for s in shots if s.get("bleed") for f in range(s["f0"], s["f1"] + 1)}
    coarse = allowed[::step]
    if allowed and coarse[-1] != allowed[-1]:
        coarse.append(allowed[-1])

    def measure(idx):
        res = {}
        idx = sorted(set(idx))
        for k in range(0, len(idx), 40):
            part = idx[k:k + 40]
            arr = V.decode(w=MW, sel="+".join(f"eq(n\\,{i})" for i in part))
            for j, i in enumerate(part):
                if j < len(arr):
                    res[i] = frame_margins(arr[j])[0]
        return res
    M = measure(coarse)
    sides = ("top", "bottom", "left", "right")

    def bad(m, side):
        return m.get(side) is not None and m[side] < thr
    # 어긴 표본 둘레(앞뒤 표본 사이)를 한 프레임씩 다시 재서 구간 끝을 정확히 잡는다
    refine = set()
    for n_, f in enumerate(coarse):
        if any(bad(M[f], s) for s in sides if f in M):
            lo = coarse[n_ - 1] + 1 if n_ > 0 else f
            hi = coarse[n_ + 1] - 1 if n_ + 1 < len(coarse) else f
            refine.update(x for x in range(lo, hi + 1) if x in allowed_set and x not in M)
    M.update(measure(sorted(refine)))
    frames_sorted = sorted(M)
    runs = []
    for side in sides:
        r0 = prev = None
        for f in frames_sorted + [None]:
            b = f is not None and bad(M[f], side)
            if b and r0 is not None and f == prev + 1 and ((f in bleed) == (prev in bleed)):
                prev = f
                continue
            if r0 is not None:  # 구간 닫기
                fr = list(range(r0, prev + 1))
                if len(fr) >= min_run:
                    mf = min(fr, key=lambda x: M[x][side])
                    box = M[mf][side + "_box"]
                    Hh, Ww = M[mf]["HW"]
                    under = []  # 그 프레임에서 같은 변 기준을 어긴 상자 전부(원본 px, 거리 px)
                    for b in M[mf]["boxes"]:
                        dd = {"top": b[1], "bottom": Hh - b[3], "left": b[0], "right": Ww - b[2]}[side]
                        if dd < thr * min(Hh, Ww):
                            under.append(dict(box=[round(v * sc) for v in b], dist_px=round(dd * sc), ratio=round(dd / min(Hh, Ww), 4)))
                    runs.append(dict(side=side, f0=r0, f1=prev, frames=len(fr), t0_s=round(r0 / V.fps, 2), t1_s=round(prev / V.fps, 2),
                                     min_ratio=M[mf][side], min_px=round(M[mf][side] * min(V.W, V.H), 1), min_frame=mf,
                                     kind="닿음(잘림·화면 밖으로 넘침)" if M[mf][side] <= 1 / min(V.W, V.H) * sc else "가까움",
                                     box=[round(v * sc) for v in box],
                                     box_area_ratio=round((box[2] - box[0]) * (box[3] - box[1]) / (Hh * Ww), 3),
                                     boxes_under=under, bleed_shot=r0 in bleed,
                                     shots=sorted({shot_of(shots, x) for x in fr} - {None}) if shots else None))
                r0 = prev = None
            if b:
                r0 = prev = f
    runs.sort(key=lambda r: (r["f0"], r["side"]))
    # 근거 그림: 구간마다 가장 가까운 프레임에 상자(초록 = 내용, 빨강 = 어긴 상자, 회색 = 바탕·장식으로 뺀 것), 노란 선 = 5% 선
    if runs:
        os.makedirs(os.path.join(out, "margins"), exist_ok=True)
        figs = {r["min_frame"] for r in runs}
        big = V.frames(sorted(figs), w=960)
        small = V.frames(sorted(figs), w=MW)
        F = font(16)
        for f in sorted(figs):
            if f not in big or f not in small:
                continue
            _, kept, excl = frame_margins(small[f])
            im = Image.fromarray(big[f]).copy()
            d = ImageDraw.Draw(im)
            k = 960 / MW
            Hh, Ww = im.size[1], im.size[0]
            g = thr * min(Hh, Ww)
            for x in range(0, Ww, 16):
                d.line([x, g, x + 8, g], fill=(255, 220, 0), width=1)
                d.line([x, Hh - g, x + 8, Hh - g], fill=(255, 220, 0), width=1)
            for y in range(0, Hh, 16):
                d.line([g, y, g, y + 8], fill=(255, 220, 0), width=1)
                d.line([Ww - g, y, Ww - g, y + 8], fill=(255, 220, 0), width=1)
            for b in excl:
                d.rectangle([b[0] * k, b[1] * k, b[2] * k, b[3] * k], outline=(150, 150, 150), width=1)
            badboxes = [r for r in runs if r["min_frame"] == f]
            for b in kept:
                d.rectangle([b[0] * k, b[1] * k, b[2] * k, b[3] * k], outline=(0, 200, 90), width=2)
            for r in badboxes:
                for u in r["boxes_under"]:
                    d.rectangle([v / V.W * 960 for v in u["box"]], outline=(235, 30, 30), width=3)
                bx = [v / V.W * 960 for v in r["box"]]
                d.rectangle(bx, outline=(235, 30, 30), width=4)
                d.text((max(0, bx[0]), min(Hh - 22, bx[3] + 4)), f"{r['side']} {r['min_ratio'] * 100:.1f}% ({r['min_px']:.0f}px)",
                       fill=(235, 30, 30), font=F)
            d.text((6, Hh - 22), f"f{f} {f / V.fps:.2f}s  노랑 점선 = 짧은 변 {thr * 100:.0f}%", fill=(255, 220, 0), font=F)
            im.save(os.path.join(out, "margins", f"f{f:04d}.jpg"), quality=85)
        for r in runs:
            r["figure"] = f"margins/f{r['min_frame']:04d}.jpg"
    per = [dict(frame=f, shot=shot_of(shots, f), n_boxes=M[f]["n_boxes"], **{s: M[f][s] for s in sides}) for f in coarse if f in M]
    excused = [r for r in runs if r["bleed_shot"]]
    runs = [r for r in runs if not r["bleed_shot"]]
    big_runs = [r for r in runs if r["box_area_ratio"] >= 0.1]
    mins = {}
    for s in sides:
        v = [(M[f][s], f) for f in M if M[f][s] is not None]
        mins[s] = None if not v else dict(ratio=min(v)[0], frame=min(v)[1])
    return dict(
        method=f"{step}프레임마다(--shots가 있으면 샷 범위 안) 폭 {MW}px로 줄여 바탕(--text와 같은 4배 축소·화면 높이 20% 창 중앙값)과 RGB 최대 차 40 넘는 덩어리 상자를 찾고, "
               "상자가 화면 가장자리에서 떨어진 거리 ÷ 짧은 변. 전면 판·테두리·가로지르는 선(폭·높이 85% 이상), 화면을 가로지르는 작은 덩어리 줄(파형·점 줄), 모서리 귀퉁이 조각은 뺀다. "
               f"{thr * 100:.0f}% 미만인 표본 둘레는 한 프레임씩 다시 재서 {min_run}프레임 이상 이어진 구간만 margin_violations로 낸다",
        threshold_ratio=thr, step=step, min_run_frames=min_run, short_side_px=min(V.W, V.H),
        frames_checked=len(M), margin_violations=runs, n_violations=len(runs),
        margin_violations_excused=excused, n_excused=len(excused),
        bleed_shots=[s["no"] for s in shots if s.get("bleed")],
        excused_note="shots.json에서 bleed: true인 샷(의도한 넘침: 화면보다 큰 글자·줌 통과·밀어 들어가는 화면) 안의 구간. 상한 판단(margin_violations)에서 뺀다 — critic_v0.3 3장 Q5",
        n_violations_small_box=len(runs) - len(big_runs),
        note_big_box="box_area_ratio ≥ 0.1(화면 10% 이상 덩어리)인 구간은 줌 통과·화면보다 큰 글자(블리드) 같은 전환·의도된 넘침일 수 있다 — 눈으로 확인",
        min_by_side=mins, samples=per,
        reference="critic_v0.3 3장 Q5: 주요 글자·주인공이 가장자리에서 짧은 변의 5% 이상(예외: 전환 중 6프레임 이하, bleed: true 샷). 예외가 아닌데 어긴 구간이 있으면 Q5 상한 7",
        limits="바탕과 색 차 40 넘는 모든 덩어리를 '내용'으로 본다 — 장식 도형·흐린 카드·공 같은 작은 소품도 들어가고, 바탕과 색 차가 작은 흐린 글자는 빠진다. "
               "화면 밖에서 들어오거나 일부러 넘치게 둔 큰 글자(블리드)는 '닿음'으로 나온다. 전환(줌 통과·밀기) 중의 큰 덩어리도 잡힌다. "
               "어긴 상자가 주요 글자·주인공인지, 전환 중인지는 근거 그림(margins/fNNNN.jpg)을 보고 비평가가 정한다")


# ---------------------------------------------------------------- --sfx (v0.3 Q8 상한)
ROLE_WORDS = [("signature", ("시그니처", "signature")), ("first", ("첫 사건", "첫사건", "first"))]
TIERS = {"signature": "signature", "first": "first", "normal": "normal", "general": "normal", "일반": "normal",
         "detail": "detail", "디테일": "detail", "시그니처": "signature", "첫 사건": "first"}


def sfx_events(path, fps):
    """효과음 계획(--sync와 같은 형식)에서 사건 시각·이름·종류(role)·계획 크기를 읽는다.
    role(사건 등급): critic_v0.3 3장대로 'tier' 칸(signature / first / normal / detail)을 먼저 읽는다.
    없으면 대체로 'role'·'class'·'importance' 키 값, 그것도 없으면 이름·설명(what·note·id·event·desc)에 '시그니처/signature',
    '첫 사건/first'가 있으면 그것, 아니면 normal. role_source에 어디서 읽었는지 남긴다."""
    j = json.load(open(path, encoding="utf-8"))
    if isinstance(j, dict):
        j = j.get("events") or j.get("rows") or []
    out = []
    for e in j:
        if "frame" in e:
            f = float(e["frame"])
        elif "k" in e:
            f = float(e["k"])
        elif "time_s" in e:
            f = float(e["time_s"]) * fps
        else:
            continue
        role, explicit, src = "normal", False, "없음(normal로 봄)"
        tv = str(e.get("tier", "")).strip().lower()
        if tv:
            role, explicit, src = TIERS.get(tv, "normal"), True, "tier" if tv in TIERS else f"tier(알 수 없는 값 {tv} → normal)"
        for key in ("role", "class", "importance"):
            v = str(e.get(key, "")).lower()
            if v and not explicit:
                explicit, src = True, key
                for r, words in ROLE_WORDS:
                    if any(w in v for w in words):
                        role = r
                if "detail" in v or "디테일" in v:
                    role = "detail"
        if not explicit:
            txt = " ".join(str(e.get(k, "")) for k in ("what", "note", "id", "event", "desc", "name")).lower()
            for r, words in ROLE_WORDS:
                if any(w in txt for w in words):
                    role, src = r, "설명 글"
                    break
        out.append(dict(name=e.get("id") or e.get("event") or e.get("type") or "", type=e.get("type") or e.get("event") or "",
                        frame=f, role=role, role_source=src, plan_db=e.get("level_db", e.get("gain_db"))))
    return sorted(out, key=lambda e: e["frame"])


TIER_GAP_DB = 2.0   # v0.6 R12 · Q8 조건 ④: detail 중앙값 ≤ normal 중앙값 − 2dB
NEAR_S = (-0.12, 0.09)  # 다른 사건 시작이 이 범위(초, 사건 시각 기준)에 있으면 사건 창(120ms)을 나눠 쓴다고 본다


def tier_order(L, gap=TIER_GAP_DB):
    """v0.6 Q8 조건 ④(R12) 등급 순서. 조건 ②와 같은 사건 크기(level_dbfs = 사건 창 20ms RMS 최댓값)로
    등급별(detail / normal / first·signature) 중앙값을 내고 ok = detail 중앙값 ≤ normal 중앙값 − gap.
    detail이나 normal 사건이 없으면 ok None(해당 없음)과 이유. 참고 값 alone = 다른 사건과 창을 나눠 쓰지 않는 사건만으로 낸 같은 값
    (믹스 한 줄이라 큰 착지 1~2프레임 뒤 작은 튐은 앞 소리 크기를 읽는다 — 판정 값은 ok)."""
    def near(r):
        return [x for x in L if x is not r and NEAR_S[0] <= x["time_s"] - r["time_s"] <= NEAR_S[1]]

    def summary(rows):
        grp = {"detail": [r["level_dbfs"] for r in rows if r["role"] == "detail"],
               "normal": [r["level_dbfs"] for r in rows if r["role"] == "normal"],
               "first_signature": [r["level_dbfs"] for r in rows if r["role"] in ("first", "signature")]}
        med = {k: (round(float(np.median(v)), 1) if v else None) for k, v in grp.items()}
        d = None if med["detail"] is None or med["normal"] is None else round(med["detail"] - med["normal"], 1)
        return {k: len(v) for k, v in grp.items()}, med, d
    n, med, d = summary(L)
    out = dict(basis="사건 등급(tier)별 사건 크기 level_dbfs(조건 ②와 같은 값) 중앙값. first·signature는 한 묶음",
               need=f"detail 중앙값 ≤ normal 중앙값 − {gap:g}dB (normal과 first·signature 차는 조건 ② +4dB)",
               n=n, median_dbfs=med, detail_minus_normal_db=d,
               head_minus_normal_db=None if med["first_signature"] is None or med["normal"] is None
               else round(med["first_signature"] - med["normal"], 1))
    if d is None:
        miss = [k for k in ("detail", "normal") if med[k] is None]
        out.update(ok=None, why=f"{'·'.join(miss)} 사건이 없음 → 조건 ④ 해당 없음"
                   + ("" if any(r.get("role_source") == "tier" for r in L) else " (사건에 tier 칸이 없음: 계획에 tier를 적는다. 자동 모드는 등급이 없다)"))
        return out
    out["ok"] = d <= -gap
    out["order"] = ("detail < normal" if d < 0 else "detail ≥ normal(뒤집힘)") + (" — 2dB 이상 작음" if out["ok"] else " — 2dB 이상 작지 않음")
    lim = med["normal"] - gap
    out["louder_details"] = [dict(frame=r["frame"], name=r["name"], type=r["type"], level_dbfs=r["level_dbfs"],
                                  shares_window_with=[f"{x['role']} f{x['frame']:g}" for x in near(r)])
                             for r in L if r["role"] == "detail" and r["level_dbfs"] > lim]
    out["louder_details_note"] = f"normal 중앙값 − {gap:g}dB({lim:.1f} dBFS)보다 큰 detail 사건. shares_window_with = 사건 창을 나눠 쓰는 다른 사건(그 소리를 함께 읽었을 수 있음)"
    n2, med2, d2 = summary([r for r in L if not near(r)])
    out["alone"] = dict(n=n2, median_dbfs=med2, detail_minus_normal_db=d2, ok=None if d2 is None else d2 <= -gap,
                        note="참고: 다른 사건과 창을 나눠 쓰지 않는 사건만(시작이 −120~+90ms 안에 다른 사건 없음). ok와 다르면 겹친 사건 때문")
    return out


def run_sfx(V, events_path, top=0.25, group_ratio=1.3):
    if not V.has_audio:
        return dict(has_audio=False, note="소리 없는 영상 — Q8 측정 없음(효과음 없음으로 본다)")
    sr = 48000
    a = audio_mono(V, sr).astype(np.float64)
    if len(a) == 0 or np.abs(a).max() < 1e-4:
        return dict(has_audio=True, silent=True, note="소리 트랙은 있으나 무음(최대 -80dBFS 미만) — Q8 측정 없음")
    # 짧은 RMS: 20ms 창, 5ms 간격
    hop, win = int(0.005 * sr), int(0.02 * sr)
    sq = np.concatenate([[0.0], np.cumsum(a * a)])
    starts = np.arange(0, len(a) - win, hop)
    rms = np.sqrt((sq[starts + win] - sq[starts]) / win)
    tcen = (starts + win / 2) / sr

    def db(x):
        return float(20 * np.log10(max(x, 1e-6)))

    def psd(t0, t1, n=1024):
        i0, i1 = max(0, int(t0 * sr)), min(len(a), int(t1 * sr))
        seg = a[i0:i1]
        if len(seg) < n:
            seg = np.pad(seg, (0, n - len(seg)))
        hh = n // 4
        idx = np.arange(n)[None, :] + hh * np.arange(1 + (len(seg) - n) // hh)[:, None]
        return (np.abs(np.fft.rfft(seg[idx] * np.hanning(n), axis=1)) ** 2).mean(0)
    freqs = np.fft.rfftfreq(1024, 1 / sr)
    band = (freqs >= 50) & (freqs <= 16000)

    if events_path:
        E = sfx_events(events_path, V.fps)
        mode = "plan"
    else:
        E = [dict(name=f"onset{k}", type="", frame=p["t"] * V.fps, role="normal", role_source="자동 시작점", plan_db=None)
             for k, p in enumerate(onsets(a.astype(np.float32), sr, top=top))]
        mode = "auto"
    rows = []
    ev_t = np.array([e["frame"] / V.fps for e in E])
    for e in E:
        t = e["frame"] / V.fps
        if t >= V.duration:
            continue
        # 음악 바탕만: 앞 1초에서 다른 사건 창 [te−30ms, te+250ms]을 뺀 20ms RMS 20백분위(50ms 이상 남을 때)
        mc = (tcen >= t - 1.0) & (tcen <= t - 0.03)
        for te in ev_t[(ev_t < t - 0.03) & (ev_t > t - 1.3)]:
            mc &= ~((tcen >= te - 0.03) & (tcen <= te + 0.25))
        music = db(np.percentile(rms[mc], 20)) if mc.sum() >= 10 else None
        w0, w1 = t - 0.03, t + 0.09            # 사건 창 120ms
        b0, b1 = t - 0.23, t - 0.03            # 바로 앞 200ms
        m = (tcen >= w0) & (tcen <= w1)
        mb = (tcen >= b0) & (tcen <= b1)
        lvl = db(rms[m].max()) if m.any() else None
        bed = db(np.percentile(rms[mb], 20)) if mb.any() else None
        pe, pb = psd(w0, w1), psd(b0, b1)
        raw_c = float((freqs[band] * pe[band]).sum() / max(pe[band].sum(), 1e-20))
        res_ = np.clip(pe - pb, 0, None)  # 바탕 스펙트럼을 뺀 나머지 = 효과음 몫
        share = float(res_[band].sum() / max(pe[band].sum(), 1e-20))
        cen = float((freqs[band] * res_[band]).sum() / res_[band].sum()) if share >= 0.1 else raw_c
        rows.append(dict(name=e["name"], type=e["type"], role=e["role"], role_source=e["role_source"], frame=round(e["frame"], 2), time_s=round(t, 3),
                         plan_db=e["plan_db"], level_dbfs=None if lvl is None else round(lvl, 1),
                         bed_dbfs=None if bed is None else round(bed, 1),
                         over_bed_db=None if lvl is None or bed is None else round(lvl - bed, 1),
                         music_bed_dbfs=None if music is None else round(music, 1),
                         over_music_db=None if lvl is None or music is None else round(lvl - music, 1),
                         centroid_hz=round(cen), centroid_raw_hz=round(raw_c), sfx_share=round(share, 2),
                         buried=share < 0.1))
    if not rows:
        return dict(has_audio=True, mode=mode, note="잴 사건이 없음")
    # 음색 묶음: 로그 축에서 가장 낮은 것부터 1.3배 안을 한 묶음(묶음 안 어느 두 사건도 1.3배 넘게 떨어지지 않음)
    order = sorted(range(len(rows)), key=lambda k: rows[k]["centroid_hz"])
    groups, cur, lead = [], [], None
    for k in order:
        c = max(rows[k]["centroid_hz"], 1)
        if lead is None or c > lead * group_ratio:
            if cur:
                groups.append(cur)
            cur, lead = [k], c
        else:
            cur.append(k)
    groups.append(cur)
    timbres = []
    for gi, g in enumerate(groups):
        for k in g:
            rows[k]["timbre"] = gi + 1
        cs = [rows[k]["centroid_hz"] for k in g]
        timbres.append(dict(timbre=gi + 1, n=len(g), centroid_hz=[min(cs), max(cs)],
                            types=sorted({rows[k]["type"] for k in g if rows[k]["type"]})))
    n_timbre = len(groups)
    # 크기 위계
    L = [r for r in rows if r["level_dbfs"] is not None]
    gen = [r["level_dbfs"] for r in L if r["role"] == "normal"] or [r["level_dbfs"] for r in L if r["role"] == "detail"]
    roles_found = sorted({r["role"] for r in L} & {"signature", "first"})
    hier = {}
    if roles_found and gen:
        gmed = float(np.median(gen))
        hier["basis"] = "사건 등급(tier) signature·first 중앙값 − normal 중앙값(detail은 일부러 작게 둔 소리라 일반에 넣지 않음; normal이 없을 때만 detail로)"
        hier["n_by_tier"] = {t: sum(r["role"] == t for r in L) for t in ("signature", "first", "normal", "detail")}
        hier["general_median_dbfs"] = round(gmed, 1)
        for r in roles_found:
            v = [x["level_dbfs"] for x in L if x["role"] == r]
            hier[r] = dict(n=len(v), median_dbfs=round(float(np.median(v)), 1), over_general_db=round(float(np.median(v)) - gmed, 1))
        diffs = [hier[r]["over_general_db"] for r in roles_found]
    else:
        first = min(L, key=lambda r: r["time_s"])
        loud = max(L, key=lambda r: r["level_dbfs"])
        rest = [r["level_dbfs"] for r in L if r is not first and r is not loud]
        rmed = float(np.median(rest)) if rest else float("nan")
        hier["basis"] = "사건 등급이 없음 → 첫 사건과 가장 큰 사건 − 나머지 중앙값"
        hier["rest_median_dbfs"] = round(rmed, 1)
        hier["first"] = dict(name=first["name"], level_dbfs=first["level_dbfs"], over_rest_db=round(first["level_dbfs"] - rmed, 1))
        hier["loudest"] = dict(name=loud["name"], level_dbfs=loud["level_dbfs"], over_rest_db=round(loud["level_dbfs"] - rmed, 1))
        diffs = [hier["first"]["over_rest_db"], hier["loudest"]["over_rest_db"]]
    for r in L:
        if r["over_bed_db"] is not None and r["over_bed_db"] < 8:
            if r["over_music_db"] is None:
                r["masked_by"] = "알 수 없음(앞 1초가 다른 사건으로 꽉 참)"
            else:
                r["masked_by"] = "앞 효과음(사건이 촘촘함)" if r["over_music_db"] >= 8 else "음악 바탕"
    ob = [r["over_bed_db"] for r in L if r["over_bed_db"] is not None]
    om = [r["over_music_db"] for r in L if r["over_music_db"] is not None]
    ratio8 = float(np.mean([x >= 8 for x in ob])) if ob else 0.0
    cond = {
        "1_timbres": dict(value=n_timbre, need="≥ 4", ok=n_timbre >= 4),
        "2_hierarchy": dict(value=[round(d, 1) for d in diffs], need="모두 ≥ +4dB", ok=bool(diffs) and all(d >= 4 for d in diffs)),
        "3_over_bed": dict(value=round(ratio8, 3), need="+8dB 이상인 사건 비율 ≥ 0.8", ok=ratio8 >= 0.8,
                           median_over_bed_db=round(float(np.median(ob)), 1) if ob else None,
                           n_under8_masked_by_music=sum(r.get("masked_by") == "음악 바탕" for r in L),
                           n_under8_masked_by_prev_sfx=sum(r.get("masked_by", "").startswith("앞 효과음") for r in L),
                           n_under8_unknown=sum(r.get("masked_by", "").startswith("알 수 없음") for r in L),
                           ratio_over_music_only=round(float(np.mean([x >= 8 for x in om])), 3) if om else None,
                           note="판정 값은 value(바로 앞 200ms 기준). 참고: 앞 1초에서 다른 사건을 뺀 '음악 바탕만' 기준 비율 = ratio_over_music_only"),
    }
    nfail = sum(not c["ok"] for c in cond.values())
    # v0.6 조건 ④ 등급 순서(R12). 위 q8_conditions·q8_failed·q8_cap(①~③)은 그대로 두고 ①~④를 따로 센다
    tord = tier_order(L)
    cond4 = {k: v["ok"] for k, v in cond.items()}
    cond4["4_tier_order"] = tord["ok"]
    nfail4 = sum(v is False for v in cond4.values())
    q8_v06 = dict(conditions_ok=cond4, failed=nfail4, cap=None if nfail4 == 0 else (7 if nfail4 <= 2 else 6),
                  note="critic_v0.3 3장 Q8(v0.6): ①~④ 중 하나·둘 못 채우면 상한 7, 셋 이상 6. ④가 해당 없음(None)이면 세지 않는다. "
                       "q8_failed·q8_cap은 예전대로 ①~③만 센 값")
    return dict(
        has_audio=True, mode=mode, source=events_path,
        method="사건 시각 t마다 ① 사건 창 [t−30ms, t+90ms](120ms)의 20ms RMS 최댓값(dBFS) ② 그 창의 스펙트럼 중심(Hz, 50Hz~16kHz) — 바로 앞 200ms 스펙트럼을 빼고 남은 몫으로 잼"
               "(남은 몫이 10% 미만이면 빼지 않은 값, buried=true) ③ 바로 앞 200ms [t−230ms, t−30ms]의 20ms RMS 20백분위(= 사건 사이 바탕) 대비 차(dB). "
               "참고로 앞 1초에서 다른 사건 창을 뺀 '음악 바탕만' 대비 차(over_music_db)와, 8dB 못 미친 사건이 음악에 묻힌 것인지 앞 효과음에 묻힌 것인지(masked_by)를 함께 낸다. "
               f"음색 = 스펙트럼 중심을 로그 축에서 낮은 쪽부터 {group_ratio}배 안을 한 묶음으로",
        n_events=len(rows), n_timbres=n_timbre, timbres=timbres, hierarchy=hier,
        q8_conditions=cond, q8_failed=nfail, q8_cap=None if nfail == 0 else (7 if nfail <= 2 else 6),
        tier_order=tord, q8_v06=q8_v06,
        reference="critic_v0.3 3장 Q8: ① 음색 4종 이상 ② 시그니처·첫 사건이 일반(normal)보다 +4dB 이상 ③ 바로 앞 바탕보다 +8dB 이상인 비율 80% 이상. 하나·둘 못 채우면 상한 7, 셋 다 못 채우면 상한 6",
        limits="믹스된 한 줄 소리에서 잰다 — 같은 시각에 겹친 사건(같은 프레임 두 소리)은 같은 값이 나오고, 음악 박자가 사건 창에 걸리면 크기·음색에 섞인다. "
               "음색은 스펙트럼 중심 하나로만 나누므로 중심이 비슷한 다른 소리(예: 톡과 딸깍)는 한 묶음이 될 수 있고, 같은 소리도 음높이를 바꾸면 갈릴 수 있다. "
               "자동 모드(계획 없음)는 음악 박자도 사건으로 잡는다. 귀로 듣는 판단을 대신하지 않는다",
        events=rows)


# ---------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("video")
    ap.add_argument("--out", required=True)
    ap.add_argument("--shots", help="storyboard/shots.json (f0·f1·key, --margins는 bleed: true 샷을 예외로)")
    ap.add_argument("--pace", action="store_true")
    ap.add_argument("--text", action="store_true")
    ap.add_argument("--sync", action="store_true")
    ap.add_argument("--entries", action="store_true")
    ap.add_argument("--contact", action="store_true")
    ap.add_argument("--margins", action="store_true", help="v0.3 Q5: 가장자리 여백")
    ap.add_argument("--sfx", action="store_true", help="v0.3 Q8: 효과음 크기·음색·위계 (+ v0.6 ④ 등급 순서 tier_order)")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--frames", help="--text 에 쓸 프레임 번호(쉼표)")
    ap.add_argument("--events", help="--sync·--sfx 효과음 계획 JSON(frame·time_s 또는 k·type). --sfx는 사건마다 tier(signature/first/normal/detail)를 읽음")
    ap.add_argument("--onset-top", type=float, default=0.25, help="--sync 자동 모드: 두드러짐 상위 비율(기본 0.25)")
    ap.add_argument("--entry-spec", help="--entries 정밀 측정 명세 JSON(README 참고)")
    ap.add_argument("--every", type=float, default=0.5, help="--contact 샷 없을 때 간격(초)")
    ap.add_argument("--phone-frames", help="--contact 360px 사본에 쓸 프레임(쉼표)")
    ap.add_argument("--margin-step", type=int, default=6, help="--margins 표본 간격(프레임, 기본 6)")
    ap.add_argument("--margin-thr", type=float, default=0.05, help="--margins 기준 비율(짧은 변 대비, 기본 0.05)")
    ap.add_argument("--margin-min-run", type=int, default=7, help="--margins 구간 최소 길이(프레임, 기본 7 = 6프레임 넘는 것)")
    ap.add_argument("--timbre-ratio", type=float, default=1.3, help="--sfx 음색 묶음 폭(스펙트럼 중심 배수, 기본 1.3)")
    a = ap.parse_args()
    if a.all:
        a.pace = a.text = a.sync = a.entries = a.contact = a.margins = a.sfx = True
    if not any([a.pace, a.text, a.sync, a.entries, a.contact, a.margins, a.sfx]):
        ap.error("--pace/--text/--sync/--entries/--contact/--margins/--sfx/--all 중 하나 이상")
    os.makedirs(a.out, exist_ok=True)
    V = Video(a.video)
    shots = load_shots(a.shots)
    res = dict(video=os.path.abspath(a.video), size=f"{V.W}x{V.H}", fps=round(V.fps, 3), frames=V.nb,
               duration_s=round(V.duration, 3), has_audio=V.has_audio, shots=a.shots)
    jp = os.path.join(a.out, "measure.json")
    if os.path.exists(jp):  # 같은 폴더에 따로 돌린 결과는 합친다
        try:
            old = json.load(open(jp, encoding="utf-8"))
            if old.get("video") == res["video"]:
                res = {**old, **res}
        except Exception:
            pass
    steps = [("pace", a.pace, lambda: run_pace(V, shots)),
             ("text", a.text, lambda: run_text(V, shots, a.frames, a.out)),
             ("sync", a.sync, lambda: run_sync(V, a.events, a.out, a.onset_top)),
             ("entries", a.entries, lambda: run_entries(V, shots, a.entry_spec)),
             ("contact", a.contact, lambda: run_contact(V, shots, a.out, a.every, a.phone_frames)),
             ("margins", a.margins, lambda: run_margins(V, shots, a.out, a.margin_step, a.margin_thr, a.margin_min_run)),
             ("sfx", a.sfx, lambda: run_sfx(V, a.events, a.onset_top, a.timbre_ratio))]
    for name, on, fn in steps:
        if on:
            print(f"[{name}] ...", file=sys.stderr, flush=True)
            res[name] = fn()
    json.dump(res, open(jp, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    summ = {}
    if "pace" in res:
        p = res["pace"]
        summ["pace"] = {k: p[k] for k in ("first_move_s", "first_content_s", "static_ratio", "static_longest_s", "static_ratio_mean",
                                          "static_longest_s_mean", "motion_mean", "bg_changes", "cut_gap_mean_s")}
    if "text" in res:
        t = res["text"]["frames"]
        summ["text"] = dict(frames=len(t), min_largest_cap_1920=min((r["largest_cap_1920"] for r in t if r["largest_cap_1920"]), default=None),
                            lines_under20=sum(r["n_lines_under20"] for r in t), lines_under20_v04=sum(r["n_lines_under20_v04"] for r in t))
    if "sync" in res and "error" not in res["sync"]:
        s = res["sync"]
        summ["sync"] = dict(within_1frame=s["within_1frame"], chance=s["chance_within_1frame_ratio"])
        if "planned" in s:
            summ["sync"]["planned_audio"] = s["planned"]["audio_on_plan_within_1frame"]
            summ["sync"]["planned_audio_on_visual"] = s["planned"]["audio_on_visual_within_1frame"]
            summ["sync"]["planned_chance"] = s["planned"]["chance_audio_on_visual"]
            summ["sync"]["planned_audio_on_visual_rise"] = s["planned"]["audio_on_visual_within_1frame_rise"]
            summ["sync"]["land_like"] = s["planned"]["land_like_within_1frame"]
    if "margins" in res:
        m = res["margins"]
        summ["margins"] = dict(violations=m["n_violations"], excused_bleed=m["n_excused"], runs=[f"{r['side']} f{r['f0']}~{r['f1']} {r['min_ratio'] * 100:.1f}%" for r in m["margin_violations"]][:8])
    if "sfx" in res:
        x = res["sfx"]
        summ["sfx"] = x.get("note") or dict(timbres=x["n_timbres"], q8={k: v["ok"] for k, v in x["q8_conditions"].items()}, cap=x["q8_cap"])
        if isinstance(summ["sfx"], dict) and "tier_order" in x:  # v0.6 ④ (덧붙임)
            to = x["tier_order"]
            summ["sfx"]["tier_order"] = dict(detail=to["median_dbfs"]["detail"], normal=to["median_dbfs"]["normal"],
                                             first_signature=to["median_dbfs"]["first_signature"],
                                             detail_minus_normal=to["detail_minus_normal_db"], ok=to["ok"])
            summ["sfx"]["cap_v06"] = x["q8_v06"]["cap"]
    if "contact" in res and "empty_out_of_band" in res["contact"]:
        summ["empty_vs_anchor"] = res["contact"]["empty_out_of_band"]
    if "entries" in res:
        summ["entries"] = f"{len(res['entries']['rows'])}개 ({res['entries']['mode']})"
    print(json.dumps(summ, ensure_ascii=False))


if __name__ == "__main__":
    main()
