"""서체 윤곽 실측 — 한글·라틴 짝의 보정값(배율·기준선·자간·회전 중심)을 fonttools로 잰다.

사용:  python3 typography/tools/measure.py            (저장소 루트에서) → typography/pairs.json 의 measured 칸을 다시 씀
       python3 typography/tools/measure.py --dump    → 서체별 원측정값만 출력
모든 값은 em(=font-size) 단위, 위(+)가 기준선 위. 커닝은 보지 않는다(윤곽 상자·advance만).
"""
import json, os, statistics as st, sys
from fontTools.ttLib import TTFont
from fontTools.pens.boundsPen import BoundsPen

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
# 한글 표본: 받침 없는/있는 글자, 견본 문장 글자 섞음 (빈도 높은 음절 위주)
HANGUL = "가나다라마바사아자차카타파하한국어글말로정리하는루영상만드수오후치과습니다있것을에서의이고게지기도면시대들"
CAPS = "HAMBURGEFONTSIVKXZ"
LOWER = "hamburgefontsivkxz"
DIGITS = "0123456789"
_cache = {}


def font(path):
    if path not in _cache:
        _cache[path] = TTFont(os.path.join(ROOT, path))
    return _cache[path]


def glyphset(t, axes):
    if "fvar" not in t or not axes:
        return t.getGlyphSet()
    loc = {}
    for a in t["fvar"].axes:
        v = float(axes.get(a.axisTag, a.defaultValue))
        loc[a.axisTag] = min(a.maxValue, max(a.minValue, v))
    return t.getGlyphSet(location=loc)


def boxes(path, axes, chars):
    t = font(path)
    upm = t["head"].unitsPerEm
    gs = glyphset(t, axes)
    cmap = t.getBestCmap()
    out = []
    for ch in chars:
        g = cmap.get(ord(ch))
        if g is None:
            continue
        bp = BoundsPen(gs)
        gs[g].draw(bp)
        if bp.bounds is None:
            continue
        x0, y0, x1, y1 = (v / upm for v in bp.bounds)
        out.append({"ch": ch, "x0": x0, "y0": y0, "x1": x1, "y1": y1, "adv": gs[g].width / upm})
    return out


def raw(path, axes):
    """서체 하나(가변 인스턴스)의 원측정값."""
    t = font(path)
    upm = t["head"].unitsPerEm
    os2, hh = t["OS/2"], t["hhea"]
    H = boxes(path, axes, "H")[0]
    x = boxes(path, axes, "x")
    caps = boxes(path, axes, CAPS)
    low = boxes(path, axes, LOWER)
    dig = boxes(path, axes, DIGITS)
    ko = boxes(path, axes, HANGUL)
    r = {
        "cap": round(H["y1"], 4),
        "xh": round(x[0]["y1"], 4) if x else None,
        "digit_h": round(st.median(d["y1"] for d in dig), 4) if dig else None,
        "caps_gap_per_cap": round(st.mean((d["adv"] - (d["x1"] - d["x0"])) for d in caps) / H["y1"], 4) if caps else None,
        "lower_gap_per_xh": round(st.mean((d["adv"] - (d["x1"] - d["x0"])) for d in low) / x[0]["y1"], 4) if (low and x) else None,
        "line": {"hhea_asc": round(hh.ascent / upm, 4), "hhea_desc": round(-hh.descent / upm, 4),
                 "typo_asc": round(os2.sTypoAscender / upm, 4), "typo_desc": round(-os2.sTypoDescender / upm, 4),
                 "typo_gap": round(os2.sTypoLineGap / upm, 4), "use_typo": bool(os2.fsSelection & 128)},
    }
    if len(ko) >= 20:
        top = st.median(d["y1"] for d in ko)
        bot = st.median(d["y0"] for d in ko)
        r["ko"] = {
            "n": len(ko),
            "top": round(top, 4), "bottom": round(bot, 4), "height": round(top - bot, 4),
            "center_y": round((top + bot) / 2, 4),
            "adv": round(st.median(d["adv"] for d in ko), 4),
            "ink_w": round(st.median(d["x1"] - d["x0"] for d in ko), 4),
            "center_x": round(st.median((d["x0"] + d["x1"]) / 2 for d in ko), 4),
            "gap_per_h": round(st.mean(d["adv"] - (d["x1"] - d["x0"]) for d in ko) / (top - bot), 4),
        }
    return r


# 목표 관계: Pretendard(Inter 바탕 한글 서체) 안에서 설계자가 정한 한글:라틴 대문자 비·중심 차이를 '맞는 짝'의 기준으로 쓴다.
REF = ("fonts/PretendardVariable.ttf", {"wght": 400})


def target():
    r = raw(*REF)
    return {"ko_h_per_cap": r["ko"]["height"] / r["cap"],
            "ko_center_minus_capcenter_per_cap": (r["ko"]["center_y"] - r["cap"] / 2) / r["cap"]}


def pair_values(lat, ko, tgt, mode="cap"):
    """라틴(lat)·한글(ko) 원측정값 → 같은 font-size에서 한글에 곱할 배율, 기준선 이동(em, +위), 회전 중심."""
    k = ko["ko"]
    if mode == "cap":       # 대문자·제목: 한글 높이를 라틴 대문자 높이 × (Pretendard 설계비)로
        want_h = lat["cap"] * tgt["ko_h_per_cap"]
        scale = want_h / k["height"]
        want_center = lat["cap"] / 2 + tgt["ko_center_minus_capcenter_per_cap"] * lat["cap"]
    else:                   # 소문자 본문: x높이 기준(Pretendard 안의 한글 높이 / x높이 비)
        ref = raw(*REF)
        want_h = lat["xh"] * (ref["ko"]["height"] / ref["xh"])
        scale = want_h / k["height"]
        want_center = lat["xh"] / 2 + (ref["ko"]["center_y"] - ref["xh"] / 2) / ref["xh"] * lat["xh"]
    shift = want_center - k["center_y"] * scale
    return {"scale": round(scale, 3), "baseline_shift_em": round(shift, 3)}


def weight_of(path, axes):
    if axes and "wght" in axes:
        return axes["wght"]
    return font(path)["OS/2"].usWeightClass


def build(roles_path, out_path):
    """roles(역할별 라틴·한글·숫자 서체 지정) → pairs.json(실측 보정값 포함)."""
    spec = json.load(open(os.path.join(ROOT, roles_path)))
    tgt = target()
    out = {"_doc": spec.get("_doc", ""), "target": {k: round(v, 4) for k, v in tgt.items()},
           "fonts": spec["fonts"], "roles": {}}
    for name, r in spec["roles"].items():
        F = spec["fonts"]
        def ax(side):
            a = dict(side.get("axes", {}))
            if "wght" in side and F[side["font"]].get("wght_range"):
                a["wght"] = side["wght"]
            return a
        lat = raw(F[r["latin"]["font"]]["path"], ax(r["latin"]))
        ko = raw(F[r["ko"]["font"]]["path"], ax(r["ko"]))
        dg_side = r.get("digit", r["latin"])
        dg = raw(F[dg_side["font"]]["path"], ax(dg_side))
        pv = pair_values(lat, ko, tgt, r.get("mode", "cap"))
        if "display_ratio" in r:           # 큰 제목에서 눈으로 고른 한글:대문자 비(견본 판 확인) — 실측 높이에 곱해 씀
            want_h = lat["cap"] * r["display_ratio"]
            pv["scale"] = round(want_h / ko["ko"]["height"], 3)
            pv["baseline_shift_em"] = round(lat["cap"] / 2 - ko["ko"]["center_y"] * pv["scale"], 3)
        # 자간: 역할 기본값(%) + 한글 서체의 기본 간격 밀도를 같은 굵기 Pretendard 에 맞추는 실측 보정
        pw = max(45, min(930, weight_of(F[r["ko"]["font"]]["path"], ax(r["ko"]))))
        pref = raw(REF[0], {"wght": pw})["ko"]
        dens = -(ko["ko"]["gap_per_h"] - pref["gap_per_h"]) * ko["ko"]["height"]
        base_ko = r.get("tracking_pct", {}).get("ko", 0) / 100
        base_lat = r.get("tracking_pct", {}).get("latin", 0) / 100
        ko_h_em = ko["ko"]["height"] * pv["scale"]
        lh = round(ko_h_em * (1 + r.get("line_gap", 0.5)), 3)
        out["roles"][name] = {
            "use": r.get("use", ""),
            **({"ko_unit_scale": r["ko_unit_scale"]} if "ko_unit_scale" in r else {}),
            "latin": r["latin"], "ko": r["ko"], "digit": r.get("digit", r["latin"]),
            "measured": {
                "latin": {"scale": 1, "baseline_shift_em": 0, "tracking_em": round(base_lat, 4),
                          "cap": lat["cap"], "xh": lat["xh"], "glyph_center": [0.5, round(lat["cap"] / 2, 3)]},
                "ko": {"scale": pv["scale"], "baseline_shift_em": pv["baseline_shift_em"],
                       "tracking_em": round(base_ko + dens, 4), "tracking_density_fix_em": round(dens, 4),
                       "height_em": ko["ko"]["height"], "top_em": ko["ko"]["top"], "bottom_em": ko["ko"]["bottom"],
                       "glyph_center": [round(ko["ko"]["center_x"] / ko["ko"]["adv"], 3), ko["ko"]["center_y"]],
                       "ko_h_per_latin_cap_after_scale": round(ko_h_em / lat["cap"], 3)},
                "digit": {"scale": 1, "baseline_shift_em": 0, "tracking_em": round(r.get("tracking_pct", {}).get("digit", 0) / 100, 4),
                          "digit_h": dg["digit_h"], "glyph_center": [0.5, round(dg["digit_h"] / 2, 3)]},
                "line_height": lh,
                "min_size_ratio_to_body": r.get("min_size_ratio_to_body"),
            },
        }
    with open(os.path.join(ROOT, out_path), "w") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    with open(os.path.join(ROOT, out_path.replace(".json", ".js")), "w") as f:
        f.write("// typography/tools/measure.py 가 만든 파일 — pairs.json 과 같은 내용(file:// 에서 JSON 을 못 읽어서)\n")
        f.write("window.KTYPO_PAIRS = " + json.dumps(out, ensure_ascii=False) + ";\n")
    print("wrote", out_path)


if __name__ == "__main__":
    if len(sys.argv) >= 3 and sys.argv[1] == "--build":
        build(sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else "typography/pairs.json")
    elif "--dump" in sys.argv:
        specs = json.load(open(os.path.join(ROOT, "typography/tools/fonts_to_measure.json")))
        for name, (p, ax) in specs.items():
            print(name, json.dumps(raw(p, ax), ensure_ascii=False))
        print("target", target())
