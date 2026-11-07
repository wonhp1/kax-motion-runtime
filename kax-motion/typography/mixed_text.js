/* KTypo — 한 줄 안의 한글·라틴·숫자 구간을 나눠 pairs.json 의 서체·배율·기준선·자간을 자동으로 입힌다.
 *
 * 브라우저 전역 스크립트(모듈 아님). HyperFrames 컴포지션·캔버스 엔진 어디서나 <script src> 로 쓴다.
 *   <script src="typography/pairs.js"></script>      // window.KTYPO_PAIRS = pairs.json 내용 (build_pairs_js 로 만듦)
 *   <script src="typography/mixed_text.js"></script>
 *   KTypo.load(window.KTYPO_PAIRS, "../");            // 두 번째 인자: pairs.json 의 서체 경로 앞에 붙일 기준 경로
 *   await KTypo.ready(["ui_title", "numeric"]);       // 쓰는 역할의 서체만 @font-face 등록 + 로드 대기 (렌더 전에 반드시)
 *   await KTypo.ready();                              // 인자 없음 = 모든 역할을 불러 본다(예전 호출 그대로). 파일이 없는 서체는 건너뜀
 *
 * 서체 파일(v0.6.4): 쓰는 역할의 서체만 작업 폴더 fonts/에 있으면 된다(KTypo.fontFiles(역할들) = 그 경로 목록).
 *   ready(역할들): 그 역할들의 서체만 등록·로드. 그 서체 파일이 없으면 ready가 '어느 파일'인지 적힌 오류로 거부.
 *                  ready에 넣지 않은 역할(서체)로 그리면 그 자리에서 오류(대체 서체로 몰래 그리지 않음). 여러 번 부르면 합침.
 *   ready():       모든 서체를 등록·로드해 보되, 404 등으로 못 읽은 서체는 건너뛰고 console.warn — 그 서체를 쓰는 역할로 그릴 때만 오류.
 *   오류에는 e.ktypo = true. KTypo.missing() = 못 읽은 서체 [{font, path}].
 *
 * DOM:    KTypo.dom(el, "Memo로 정리하는 일정", "ui_title", {size: 72})     → el 안에 구간별 <span>
 *         KTypo.dom(el, "UX로 만드는 화면", "kinetic_heavy", {size: 160, split: true}) → 글자마다 inline-block + 회전 중심
 * 캔버스: KTypo.canvas(ctx, "수 · 오후 3:00 회의", "numeric", x, y, 64, {align: "center"}) → 그린 폭 반환
 *         KTypo.layout(...) 은 그리지 않고 글자 목록(펜 위치·서체·회전 중심)만 돌려준다 — 글자 단위 애니메이션용.
 * kx 엔진: KTypo.d2Layout(KX, ...) / KTypo.patchD2(KXP) — README 참고.
 *
 * 값의 뜻(모두 pairs.json 의 measured):
 *   scale            같은 font-size 에서 한글 구간에 곱할 배율 (라틴 대문자/x높이에 한글 높이를 맞춤)
 *   baseline_shift_em 한글 구간을 올릴 양(+위), 라틴 font-size 기준 em
 *   tracking_em      구간별 자간(그 구간 font-size 기준 em) — CSS letter-spacing 과 같은 뜻
 *   glyph_center     [x, y] 글자 상자 가운데 = 펜(왼쪽 기준선) + (x × 글자 advance, -y em) — 키네틱 회전 중심
 */
(function (root) {
  "use strict";
  const K = {};
  let P = null, BASE = "";

  /* ---------- 문자 분류 ---------- */
  const isHangul = (cp) =>
    (cp >= 0xac00 && cp <= 0xd7a3) || (cp >= 0x1100 && cp <= 0x11ff) || (cp >= 0x3130 && cp <= 0x318f) || (cp >= 0xa960 && cp <= 0xa97f) || (cp >= 0xd7b0 && cp <= 0xd7ff);
  const isDigit = (ch) => /[0-9]/.test(ch);
  const isLatin = (ch) => /[A-Za-zÀ-ɏ]/.test(ch);
  // 숫자에 붙어 다니는 기호(3:00, 1,200, 12.5%, +30) — 숫자 구간으로 묶는다
  const NUM_GLUE = /[:.,%+\-−/×]/;

  K.classify = function (ch) {
    const cp = ch.codePointAt(0);
    if (isHangul(cp)) return "ko";
    if (isDigit(ch)) return "digit";
    if (isLatin(ch)) return "latin";
    if (/\s/.test(ch)) return "space";
    return "punct";
  };

  /* 구간 나누기: 숫자 사이의 :.,% 와 앞 부호(+30)는 숫자로, 한글 뒤 쉼표·마침표 등은 한글로, 공백은 늘 라틴 서체
   (Black Han Sans 같은 한글 서체는 공백이 0.3em 넘게 넓어 낱말 사이가 벌어진다 — 견본 판에서 확인). */
  K.segments = function (text) {
    const chars = Array.from(text);
    const cls = chars.map(K.classify);
    for (let i = 0; i < chars.length; i++) {
      if (cls[i] === "punct" && NUM_GLUE.test(chars[i])) {
        const prevD = i > 0 && cls[i - 1] === "digit", nextD = i + 1 < chars.length && cls[i + 1] === "digit";
        if (prevD && (nextD || chars[i] === "%")) cls[i] = "digit";
        else if (nextD && /[+\-−]/.test(chars[i]) && (i === 0 || cls[i - 1] === "space")) cls[i] = "digit"; // 부호(+30, -12)만. D-3 의 - 는 라틴
      }
    }
    // 공백·기타 부호: 양옆이 같은 문자 계열이면 그 계열, 아니면 라틴(라틴 서체의 공백·부호가 한글 서체 것보다 단정함)
    for (let i = 0; i < chars.length; i++) {
      if (cls[i] === "space" || cls[i] === "punct") {
        let L = null, R = null;
        for (let a = i - 1; a >= 0; a--) if (cls[a] !== "space" && cls[a] !== "punct") { L = cls[a]; break; }
        for (let b = i + 1; b < chars.length; b++) if (cls[b] !== "space" && cls[b] !== "punct") { R = cls[b]; break; }
        cls[i] = cls[i] === "space" ? "latin" : cls[i] === "punct" && L === "ko" && (R === "ko" || R === null) && !/[·•|\/]/.test(chars[i]) ? "ko" : "latin";
      }
    }
    const out = [];
    chars.forEach((ch, i) => {
      const last = out[out.length - 1];
      if (last && last.script === cls[i]) last.text += ch;
      else out.push({ text: ch, script: cls[i] });
    });
    return out;
  };

  /* ---------- 표 읽기 ---------- */
  // 서체 상태(v0.6.4): FACES = @font-face를 넣은 서체 키, LIMIT = ready(역할들)로 부른 서체 키(null = 제한 없음),
  // OPEN = 인자 없는 ready()를 부른 적 있음(그 뒤로는 제한 없음), BAD = 못 읽은 서체 키 → 경로
  const FACES = new Set();
  let LIMIT = null, OPEN = false, BAD = {}, NSTYLE = 0;
  K.load = function (pairs, base) {
    P = pairs;
    BASE = base || "";
    LIMIT = null;
    OPEN = false;
    BAD = {};
    return K;
  };
  K.role = function (name) {
    if (!P) throw new Error("KTypo.load(pairs) 먼저");
    const r = P.roles[name];
    if (!r) throw new Error("pairs.json 에 역할 없음: " + name);
    return r;
  };
  const FAMILY = (key) => "kt-" + key;

  /* 구간 계열 → 그릴 서체 스펙 {family, weight, scale, shift, tracking, features, center} (scale·shift 는 라틴 크기 기준).
     K.spec은 그 서체로 그릴 수 있는지(불러왔는지)도 본다 — 못 읽었거나 ready(역할들)에 없던 서체면 오류(e.ktypo).
     잰 값만 쓰는 곳(d2Layout — kx 엔진은 서체 윤곽 자료로 그림)은 specOf를 쓴다. */
  function fontError(msg) {
    const e = new Error(msg);
    e.ktypo = true;
    return e;
  }
  K.spec = function (roleName, script, afterDigit) {
    const s = specOf(roleName, script, afterDigit);
    if (BAD[s.font]) {
      throw fontError(`KTypo: 역할 '${roleName}'의 서체 '${s.font}'(${BAD[s.font]})를 못 읽었다 — 이 스킬 fonts/에서 작업 폴더로 복사하거나 KTypo.load의 기준 경로를 맞춘다`);
    }
    if (LIMIT && !LIMIT.has(s.font)) {
      throw fontError(`KTypo: 역할 '${roleName}'의 서체 '${s.font}'(${P.fonts[s.font] ? P.fonts[s.font].path : "?"})는 KTypo.ready([...])에 넣은 역할에 없어 안 불렀다 — ready에 '${roleName}'을 더한다`);
    }
    return s;
  };
  function specOf(roleName, script, afterDigit) {
    const r = K.role(roleName);
    const s = script === "ko" ? r.ko : script === "digit" ? r.digit || r.latin : r.latin;
    const m = (r.measured && r.measured[script === "ko" ? "ko" : script === "digit" ? "digit" : "latin"]) || {};
    let scale = m.scale || 1, shift = m.baseline_shift_em || 0, gapBefore = 0;
    // 숫자 바로 뒤 한글 단위(12,480명): ko_unit_scale 이 있으면 작게, 글자 바닥을 기준선에 붙임
    if (script === "ko" && afterDigit && r.ko_unit_scale) {
      scale *= r.ko_unit_scale;
      shift = -(m.bottom_em || 0) * scale;
      gapBefore = 0.06; // 숫자와 단위 사이 숨(라틴 em) — 견본 판에서 붙어 보여서
    }
    return {
      font: s.font,
      family: FAMILY(s.font),
      weight: s.wght || 400,
      axes: s.axes || null,
      style: s.style || "normal",
      scale,
      shift,
      gapBefore,
      tracking: m.tracking_em || 0,
      features: s.features || null,
      center: m.glyph_center || [0.5, 0.36],
    };
  }

  /* ---------- 서체 등록 ---------- */
  const roleList = (roles) => {
    if (!P) throw new Error("KTypo.load(pairs) 먼저");
    const names = roles == null ? Object.keys(P.roles) : Array.isArray(roles) ? roles.slice() : [roles];
    names.forEach((n) => K.role(n)); // 없는 역할 이름이면 여기서 바로 오류
    return names;
  };
  /* 역할들이 쓰는 서체 키(라틴·한글·숫자 칸 — 공백·기호도 라틴 서체로 그리므로 라틴은 늘 든다). 인자 없음 = 모든 역할 */
  K.fontKeys = function (roles) {
    const keys = [];
    for (const n of roleList(roles)) {
      const r = K.role(n);
      for (const s of [r.latin, r.ko, r.digit || r.latin]) if (s && keys.indexOf(s.font) < 0) keys.push(s.font);
    }
    return keys;
  };
  /* 역할들에 필요한 서체 파일(pairs.json 경로, 예: "fonts/Inter-var.ttf") — 작업 폴더에 복사할 목록 */
  K.fontFiles = (roles) => K.fontKeys(roles).map((k) => P.fonts[k].path);
  K.missing = () => Object.keys(BAD).map((k) => ({ font: k, path: BAD[k] }));
  /* @font-face 글. keys 없음 = pairs.json 서체 전부(예전과 같음) */
  K.fontFaceCSS = function (keys) {
    return (keys || Object.keys(P.fonts))
      .map((key) => {
        const f = P.fonts[key];
        const w = f.wght_range ? `${f.wght_range[0]} ${f.wght_range[1]}` : "400";
        const st = f.wdth_range ? `font-stretch:${f.wdth_range[0]}% ${f.wdth_range[1]}%;` : "";
        return `@font-face{font-family:"${FAMILY(key)}";src:url("${BASE}${f.path.replace(/\[/g, "%5B").replace(/\]/g, "%5D")}");font-weight:${w};${st}font-style:${f.style || "normal"};font-display:block;}`;
      })
      .join("\n");
  };
  // 아직 안 넣은 서체만 <style>로 넣는다(이미 넣은 규칙은 다시 쓰지 않음 — 다시 쓰면 실린 서체가 '안 실림'으로 돌아감)
  function register(keys) {
    if (!FACES.size && document.getElementById("ktypo-faces")) Object.keys(P.fonts).forEach((k) => FACES.add(k)); // 페이지에 이미 있던 표(예전 꼴)
    const add = keys.filter((k) => !FACES.has(k));
    if (!add.length) return;
    const st = document.createElement("style");
    st.id = NSTYLE++ ? "ktypo-faces-" + NSTYLE : "ktypo-faces";
    st.textContent = K.fontFaceCSS(add);
    document.head.appendChild(st);
    add.forEach((k) => FACES.add(k));
  }
  /* ready(역할들 | 역할 | 없음) — 위 머리 주석 '서체 파일'. 렌더(첫 프레임) 전에 await 한다 */
  K.ready = async function (roles) {
    const names = roleList(roles);
    const keys = K.fontKeys(names);
    if (roles == null) { OPEN = true; LIMIT = null; }
    else if (!OPEN) { LIMIT = LIMIT || new Set(); keys.forEach((k) => LIMIT.add(k)); }
    register(roles == null ? Object.keys(P.fonts) : keys);
    const fail = {}; // 서체 키 → 처음 오류 글
    const loads = [];
    for (const name of names) {
      for (const sc of ["latin", "ko", "digit"]) {
        const s = specOf(name, sc);
        loads.push(document.fonts.load(`${s.style === "italic" ? "italic " : ""}${s.weight} 40px "${s.family}"`, sc === "ko" ? "가" : "A0")
          .then(null, (e) => { if (!fail[s.font]) fail[s.font] = String((e && e.message) || e); }));
      }
    }
    await Promise.all(loads);
    await document.fonts.ready;
    const bad = keys.filter((k) => fail[k]);
    bad.forEach((k) => { BAD[k] = P.fonts[k].path; });
    if (!bad.length) return;
    const who = (k) => names.filter((n) => K.fontKeys([n]).indexOf(k) >= 0);
    const list = bad.map((k) => `${P.fonts[k].path}(역할 ${who(k).join("·")})`).join(", ");
    if (roles != null) throw fontError(`KTypo.ready: 서체 파일을 못 읽음 — ${list}. 이 스킬 fonts/에서 작업 폴더로 복사하거나 KTypo.load의 기준 경로를 맞춘다`);
    console.warn(`KTypo.ready: 못 읽은 서체는 건너뜀 — ${list}. 그 역할로 그리면 오류가 난다. 쓰는 역할만 부르려면 KTypo.ready(["ui_title", …])`);
  };

  const variation = (s) => (s.axes ? Object.entries(s.axes).map(([k, v]) => `"${k}" ${v}`).join(",") : "normal");
  const featureCSS = (s) => (s.features ? s.features.map((f) => `"${f}" 1`).join(",") : "normal");

  /* ---------- DOM ----------
     opt: {size(px, 라틴 기준; 없으면 부모 font-size), split(글자마다 inline-block), color, tracking(추가 em), lineHeight} */
  K.dom = function (el, text, roleName, opt) {
    opt = opt || {};
    el.textContent = "";
    if (opt.size) el.style.fontSize = opt.size + "px";
    const r = K.role(roleName);
    el.style.lineHeight = opt.lineHeight || (r.measured && r.measured.line_height) || 1.2;
    el.style.whiteSpace = el.style.whiteSpace || "pre";
    const glyphs = [];
    let prev = null;
    for (const seg of K.segments(text)) {
      const s = K.spec(roleName, seg.script, prev === "digit");
      prev = seg.script;
      const span = document.createElement("span");
      span.className = "kt-" + seg.script;
      Object.assign(span.style, {
        fontFamily: `"${s.family}"`,
        fontWeight: s.weight,
        fontStyle: s.style,
        fontVariationSettings: variation(s),
        fontFeatureSettings: featureCSS(s),
        fontSize: s.scale + "em",
        letterSpacing: s.tracking + (opt.tracking || 0) + "em",
        position: "relative",
        top: -(s.shift / s.scale) + "em",
        marginLeft: s.gapBefore ? s.gapBefore / s.scale + "em" : "",
      });
      if (opt.split) {
        for (const ch of Array.from(seg.text)) {
          const g = document.createElement("span");
          g.textContent = ch;
          g.style.display = ch === " " ? "inline" : "inline-block";
          g.dataset.cx = s.center[0];
          g.dataset.cy = s.center[1];
          span.appendChild(g);
          if (ch !== " ") glyphs.push(g);
        }
      } else span.textContent = seg.text;
      el.appendChild(span);
    }
    if (opt.split) K.setOrigins(el, glyphs);
    return glyphs;
  };

  /* 글자 span 마다 transform-origin = 글자 상자 가운데(서체 실측). 기준선은 0크기 inline-block 표식으로 잰다(CSS 줄 상자 모델에 기대지 않음). */
  K.setOrigins = function (el, glyphs) {
    glyphs = glyphs || Array.from(el.querySelectorAll("span[data-cx]"));
    for (const g of glyphs) {
      const mark = document.createElement("i");
      mark.style.cssText = "display:inline-block;width:0;height:0;vertical-align:baseline";
      g.appendChild(mark);
      const gr = g.getBoundingClientRect(), mr = mark.getBoundingClientRect();
      g.removeChild(mark);
      const fs = parseFloat(getComputedStyle(g).fontSize);
      // 변환(transform)을 걸기 전에 부른다(dom(..., {split:true}) 가 자동으로 부름). 부모에 scale 이 걸려 있으면 그 배율로 나눔.
      const k = el.getBoundingClientRect().width / (el.offsetWidth || 1) || 1;
      const ls = parseFloat(getComputedStyle(g).letterSpacing) || 0; // 글자 상자 안 오른쪽에 붙는 자간은 빼고
      const ox = +g.dataset.cx * (gr.width / k - ls);
      const oy = (mr.bottom - gr.top) / k - +g.dataset.cy * fs;
      g.style.transformOrigin = `${ox.toFixed(2)}px ${oy.toFixed(2)}px`;
    }
  };

  /* ---------- 캔버스 ----------
     layout: 그리지 않고 글자 목록. 반환 {items:[{ch, script, font(ctx.font 문자열), px, x, y(기준선), adv, center:[x,y](화면 px)}], width}
     opt: {align: left|center|right, tracking(추가 em), tabular(숫자를 같은 칸 폭으로)} */
  K.ctxFont = (s, px) => `${s.style === "italic" ? "italic " : ""}${s.weight} ${px.toFixed(3)}px "${s.family}"`;
  /* 캔버스 2D 는 font-variation-settings 가 없다. 폭(wdth) 축은 ctx.fontStretch 키워드로만 고를 수 있다
     → 캔버스에서 쓸 wdth 는 50·62.5·75·87.5·100·112.5·125 중 하나로(그 밖의 값은 가장 가까운 키워드). opsz 는 글자 크기로 자동. */
  const STRETCH = [[50, "ultra-condensed"], [62.5, "extra-condensed"], [75, "condensed"], [87.5, "semi-condensed"], [100, "normal"], [112.5, "semi-expanded"], [125, "expanded"], [150, "extra-expanded"]];
  K.ctxStretch = (s) => {
    const w = s.axes && s.axes.wdth;
    if (!w) return "normal";
    return STRETCH.reduce((a, b) => (Math.abs(b[0] - w) < Math.abs(a[0] - w) ? b : a))[1];
  };
  const setCtx = (ctx, s, px) => { ctx.font = K.ctxFont(s, px); if ("fontStretch" in ctx) ctx.fontStretch = K.ctxStretch(s); };
  K.layout = function (ctx, text, roleName, x, y, size, opt) {
    opt = opt || {};
    const items = [];
    let pen = 0;
    let prev = null;
    for (const seg of K.segments(text)) {
      const s = K.spec(roleName, seg.script, prev === "digit");
      prev = seg.script;
      const px = size * s.scale;
      pen += s.gapBefore * size;
      setCtx(ctx, s, px);
      const tr = (s.tracking + (opt.tracking || 0)) * px;
      const cell = opt.tabular && seg.script === "digit" ? Math.max(...Array.from("0123456789").map((d) => ctx.measureText(d).width)) : 0;
      const by = y - s.shift * size;
      for (const ch of Array.from(seg.text)) {
        const w = ctx.measureText(ch).width;
        const adv = cell && isDigit(ch) ? cell : w;
        const gx = pen + (adv - w) / 2;
        items.push({ ch, script: seg.script, font: K.ctxFont(s, px), stretch: K.ctxStretch(s), px, x: gx, y: by, adv: adv + tr, _tr: tr, center: [gx + s.center[0] * w, by - s.center[1] * px] });
        pen += adv + tr;
      }
    }
    // 폭 = 마지막 글자 뒤 자간은 빼고 잰다(가운데 정렬이 자간만큼 왼쪽으로 쏠리지 않게)
    const width = items.length ? pen - trailing(items) : 0;
    const off = opt.align === "center" ? -width / 2 : opt.align === "right" ? -width : 0;
    for (const it of items) { it.x += x + off; it.center[0] += x + off; }
    return { items, width };
  };
  // 마지막 글자 뒤에 붙은 자간 = 그 글자 adv 중 자간 몫. layout 이 adv 에 자간을 더해 두므로 따로 계산.
  function trailing(items) {
    const it = items[items.length - 1];
    return it._tr || 0;
  }
  K.canvas = function (ctx, text, roleName, x, y, size, opt) {
    const L = K.layout(ctx, text, roleName, x, y, size, opt);
    const save = ctx.textBaseline;
    ctx.textBaseline = "alphabetic";
    for (const it of L.items) {
      ctx.font = it.font;
      if ("fontStretch" in ctx) ctx.fontStretch = it.stretch;
      ctx.fillText(it.ch, it.x, it.y);
    }
    ctx.textBaseline = save;
    return L.width;
  };

  /* ---------- kx 글자 엔진 ----------
     d2Layout(KX, {latin: 라틴 인스턴스명, ko: 한글 인스턴스명, digit?}, text, size, x, y, opt)
     → KX.layoutWord 와 같은 items(글자마다 inst·pen·size)이되, 한글 글자는 size×scale, 기준선 이동, it.anchorEm 설정.
     KTypo.patchD2(KXP) 를 한 번 부르면 KXP.letterAnchor 가 it.anchorEm(글자 상자 가운데)을 쓴다.
     kx 엔진은 서체 윤곽 자료(glyphs.js)로 그리므로 잰 값만 읽는다 — 그 역할을 ready에 넣지 않아도 된다. */
  K.d2Layout = function (KX, insts, text, size, x, y, opt) {
    opt = opt || {};
    const role = opt.role || "kinetic_heavy";
    const segs = K.segments(text);
    const items = [];
    let pen = 0, k = 0;
    let prev = null;
    for (const seg of segs) {
      const sc = seg.script === "ko" ? "ko" : seg.script === "digit" && insts.digit ? "digit" : "latin";
      const s = specOf(role, sc, prev === "digit");
      prev = seg.script;
      const inst = sc === "ko" ? insts.ko : sc === "digit" ? insts.digit : insts.latin;
      pen += s.gapBefore * size;
      const em = size * s.scale;
      const tr = (s.tracking + (opt.tracking || 0)) * em;
      for (const ch of Array.from(seg.text)) {
        const adv = KX.adv(inst, ch) * em;
        if (ch !== " ") items.push({ id: (opt.idPrefix || "") + k, inst, ch, size: em, skew: opt.skew || 0, pen: [pen, y - s.shift * size], fill: opt.fill || null, adv, anchorEm: s.center, _tr: tr });
        pen += adv + tr;
        k++;
      }
    }
    const w = pen - (items.length ? (items[items.length - 1]._tr || 0) : 0);
    const off = x - (opt.align === "center" ? w / 2 : opt.align === "right" ? w : 0);
    for (const it of items) it.pen[0] += off;
    items.width = w;
    return items;
  };
  K.patchD2 = function (KXP) {
    const orig = KXP.letterAnchor;
    KXP.letterAnchor = (it) => (it.anchorEm ? [it.pen[0] + it.anchorEm[0] * it.adv, it.pen[1] - it.anchorEm[1] * it.size] : orig(it));
    return KXP;
  };

  root.KTypo = K;
  if (typeof module !== "undefined") module.exports = K;
})(typeof window !== "undefined" ? window : globalThis);
