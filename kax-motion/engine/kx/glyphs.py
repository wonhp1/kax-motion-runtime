"""서체 윤곽 → 브라우저용 글자 자료(glyphs.js). 브라우저는 서체 파일을 읽지 않고 이 윤곽을 Path2D로 칠한다
(가변 축 값이 렌더·미리보기·브라우저 판과 상관없이 똑같이 나온다 — 렌더할 때마다 같은 글자 모양).

사용:
  python3 engine/glyphs.py spec.json out/glyphs.js
spec.json 예:
  {"fonts": {"UB": "assets/fonts/Unbounded[wght].ttf", "BS": "assets/fonts/BigShoulders[opsz,wght].ttf"},
   "uses": [{"font": "UB", "axes": {"wght": 700}, "text": "WAVE FORM"},
            {"font": "BS", "axes": {"opsz": 72, "wght": 700}, "text": "0123456789"}]}
출력: window.KG = {"UB_wght700": {"N": {"d": "M...", "adv": 0.83}, ...}, ...};  window.KGM = {inst: {upm, asc, desc, cap, xh}}
좌표: em 단위(1 = 서체 크기), 원점 = 기준선 위 펜 위치, y 아래로 +. 커닝(GPOS)은 넣지 않는다(키네틱 타이틀은 자간을 직접 정함).
필요: pip install fonttools
"""
import json, sys
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

_cache = {}


def ttf(path):
    if path not in _cache:
        _cache[path] = TTFont(path)
    return _cache[path]


def axes_vals(t, axes):
    if "fvar" not in t:
        return []
    out = []
    for a in t["fvar"].axes:
        v = float(axes.get(a.axisTag, a.defaultValue))
        out.append((a.axisTag, min(a.maxValue, max(a.minValue, v))))
    return out


def inst_key(key, t, axes):
    """인스턴스 이름: 서체 키 + 축(태그 알파벳 순) — JS의 KX.inst(key, axes)와 같은 규칙. 예: BS_opsz72_wght700"""
    vals = sorted(axes_vals(t, axes))
    return key + ("_" + "_".join(f"{tag}{v:g}" for tag, v in vals) if vals else "")


def outline(t, axes, ch):
    loc = dict(axes_vals(t, axes))
    gs = t.getGlyphSet(location=loc) if loc else t.getGlyphSet()
    gname = t.getBestCmap().get(ord(ch))
    if gname is None:
        raise KeyError(f"no glyph for {ch!r}")
    upm = t["head"].unitsPerEm
    pen = SVGPathPen(gs, ntos=lambda v: f"{v:.5g}")
    gs[gname].draw(TransformPen(pen, (1.0 / upm, 0, 0, -1.0 / upm, 0, 0)))
    return pen.getCommands(), gs[gname].width / upm


def metrics(t):
    upm = t["head"].unitsPerEm
    os2 = t["OS/2"]
    return {"upm": upm, "asc": t["hhea"].ascent / upm, "desc": t["hhea"].descent / upm,
            "cap": getattr(os2, "sCapHeight", 0) / upm, "xh": getattr(os2, "sxHeight", 0) / upm}


def main(spec_path, out_path):
    spec = json.load(open(spec_path))
    KG, KGM = {}, {}
    for u in spec["uses"]:
        path = spec["fonts"][u["font"]]
        t = ttf(path)
        key = inst_key(u["font"], t, u.get("axes", {}))
        KG.setdefault(key, {})
        KGM[key] = metrics(t)
        for ch in sorted(set(u["text"])):
            if ch == " " or ch in KG[key]:
                if ch == " " and " " not in KG[key]:
                    try:
                        KG[key][" "] = {"d": "", "adv": outline(t, u.get("axes", {}), " ")[1]}
                    except KeyError:
                        KG[key][" "] = {"d": "", "adv": 0.25}
                continue
            d, adv = outline(t, u.get("axes", {}), ch)
            KG[key][ch] = {"d": d, "adv": round(adv, 5)}
    with open(out_path, "w") as f:
        f.write("// engine/glyphs.py가 만든 글자 윤곽(em, y 아래로 +). 서체는 OFL — 출처는 design.json fonts\n")
        f.write("window.KG = " + json.dumps(KG, ensure_ascii=False, separators=(",", ":")) + ";\n")
        f.write("window.KGM = " + json.dumps(KGM, separators=(",", ":")) + ";\n")
    print("insts", list(KG), "glyphs", sum(len(v) for v in KG.values()))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
