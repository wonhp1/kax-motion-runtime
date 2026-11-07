/* kax-motion 바탕 결(질감) 생성기 — window.KMTex
 *
 * HyperFrames 안에서 도는 순수 JS(빌드·네트워크·Math.random·Date 없음). 같은 시드 + 같은 시각 = 같은 그림.
 * 결은 처음 한 번 시드 난수로 타일(캔버스)에 만들어 두고, 프레임마다 그 타일을 시각 t로만 정한 자리에 그린다.
 *
 *   const bg = KMTex.create(document.getElementById('bg'), {
 *     width: 1920, height: 1080, base: '#f3ede3', seed: 7,
 *     layers: [ {kind: 'paper', tex: 1.4}, {kind: 'glow', span: 8, x: 0.72, y: 0.28} ],
 *   });
 *   bg.render(t);          // t = 초. KM 엔진이면 render(f, U) 안에서 bg.render(f / fps)
 *
 * 종류(kind)            세기 지정                         메모
 *   grain   미세 그레인   tex | tex360 | amp               타일 512, 정지(기본). boil로 아주 느린 바뀜 가능
 *   paper   종이 섬유+그레인 tex | tex360 | amp            짧은 섬유 + 그레인 + 아주 옅은 얼룩(blotch)
 *   cloth   천 결         tex | tex360 | amp               씨실·날실 무늬(period px) + 그레인 + 부드러운 주름
 *   grid    옅은 격자·사선 line(선 밝기 차, 0~255) | tex    cell px 간격, width px 굵기(기본 1), hatch px면 45° 사선,
 *                                                            lines:'h'|'v'|'none'(격자 끄고 사선만)
 *   glow    부드러운 빛 번짐 span(가장 밝은 곳 + 밝기, 0~255)  빛만 더한다(어둡게 하지 않음 = 비네트 아님)
 *
 * 세기: tex = measure_texture.py 의 tex(긴 변 1280, 고역 s=3) 목표값. tex360 = 폰 360px 목표값.
 *       둘 다 주면 둘 다 넘는 쪽(큰 진폭)을 쓴다. amp = 직접 진폭(밝기 표준편차, 0~255).
 *       보정 표 CAL 은 렌더(crf 16) 뒤 측정으로 만든 '진폭 1당 측정값'이다(references/texture.md).
 * 흐름(정지 중에도): flow = 큰 결(얼룩·주름·빛)이 움직이는 속도 px/초(기본 6). 고운 결(그레인·섬유·씨실)은
 *       기본 정지 — 매 프레임 바뀌는 그레인은 깜빡임 결함이다. drift = [vx, vy] px/초를 주면 고운 결도 같이 흐른다
 *       (소수 자리 이동, subpixel:false면 정수 px로 끊겨 1px마다 결이 통째 바뀐다 → 쓰지 않는다).
 *       카메라에 붙일 때는 offset(x, y)를 프레임마다 넘긴다. boil: N(초) = 그레인이 N초에 걸쳐 다른 그레인으로
 *       천천히 바뀜(A·cos + B·sin 섞기라 세기는 그대로).
 */
(function () {
  'use strict';

  // ---- 보정 표: 진폭 1(밝기 표준편차 1 = 0~255 단위)일 때 measure_texture.py 측정값. 1920x1080 렌더 기준.
  //      결 견본 렌더 + measure_texture.py 로 다시 만든다(값·기록: texture/calibration.json)
  var CAL = {
    // 2026-10-27 측정: 결 견본 렌더, 1920x1080, crf 16, 밝은 #f3ede3·어두운 #141416 평균(둘 차이 ±4% 안)
    grain: { tex: 0.89, tex360: 0.415 },
    paper: { tex: 0.83, tex360: 0.35 },
    cloth: { tex: 0.865, tex360: 0.19 },    // 씨실 주기 5px는 폰 사본에서 거의 사라진다(남는 건 그레인 몫)
    grid:  { tex: 0.111, tex360: 0.060 },   // line(선 밝기 차) 1당, cell 48. 사선만(cell 96, hatch 32): 0.163 / 0.079
  };
  var AMP_MAX = { grain: 9, paper: 9, cloth: 8, grid: 40, glow: 40 };

  function rng(seed) {             // mulberry32
    var a = (seed >>> 0) || 1;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function gaussArr(n, R) {
    var a = new Float32Array(n);
    for (var i = 0; i < n; i += 2) {
      var u = Math.max(R(), 1e-9), v = R();
      var m = Math.sqrt(-2 * Math.log(u));
      a[i] = m * Math.cos(6.283185307 * v);
      if (i + 1 < n) a[i + 1] = m * Math.sin(6.283185307 * v);
    }
    return a;
  }
  // 감싸는(wrap) 상자 흐림 1회, 가로·세로 반지름 따로
  function boxWrap(src, w, h, rx, ry) {
    var tmp = new Float32Array(w * h), out = new Float32Array(w * h), x, y, k, s;
    if (rx > 0) {
      var nx = 2 * rx + 1;
      for (y = 0; y < h; y++) {
        var row = y * w; s = 0;
        for (k = -rx; k <= rx; k++) s += src[row + ((k % w) + w) % w];
        for (x = 0; x < w; x++) {
          tmp[row + x] = s / nx;
          s += src[row + (x + rx + 1) % w] - src[row + ((x - rx) % w + w) % w];
        }
      }
    } else tmp.set(src);
    if (ry > 0) {
      var ny = 2 * ry + 1;
      for (x = 0; x < w; x++) {
        s = 0;
        for (k = -ry; k <= ry; k++) s += tmp[(((k % h) + h) % h) * w + x];
        for (y = 0; y < h; y++) {
          out[y * w + x] = s / ny;
          s += tmp[((y + ry + 1) % h) * w + x] - tmp[(((y - ry) % h + h) % h) * w + x];
        }
      }
    } else out.set(tmp);
    return out;
  }
  function blur(a, w, h, r, ry) {   // 상자 3회 ≈ 가우시안
    if (ry === undefined) ry = r;
    for (var i = 0; i < 3; i++) a = boxWrap(a, w, h, r, ry);
    return a;
  }
  function normalize(a) {
    var n = a.length, m = 0, v = 0, i;
    for (i = 0; i < n; i++) m += a[i];
    m /= n;
    for (i = 0; i < n; i++) { a[i] -= m; v += a[i] * a[i]; }
    v = Math.sqrt(v / n) || 1;
    for (i = 0; i < n; i++) a[i] /= v;
    return a;
  }
  function addTo(dst, src, k) { for (var i = 0; i < dst.length; i++) dst[i] += src[i] * k; return dst; }

  function parseColor(c) {
    if (Array.isArray(c)) return c.slice(0, 3);
    var m = /^#?([0-9a-f]{6})$/i.exec(c);
    if (!m) throw new Error('KMTex: base 는 #rrggbb 또는 [r,g,b]');
    var n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  // ---- 고운 결 타일(표준편차 1로 맞춘 부호 있는 밝기 편차)
  function fineField(kind, S, R, o) {
    var g, f;
    if (kind === 'grain') {
      g = gaussArr(S * S, R);
      if ((o.grainSize || 0.7) >= 0.5) g = boxWrap(g, S, S, 1, 1);   // 1px 상자 1회 = 고운 덩어리(σ≈0.8)
      return normalize(g);
    }
    if (kind === 'paper') {
      // 섬유: 가는 선 다발을 무작위 각도로(짧고 살짝 휜), 밝은 것·어두운 것 반반
      var fib = new Float32Array(S * S), nF = Math.round(S * S / 260 * (o.fibers || 1));
      for (var i = 0; i < nF; i++) {
        var x = R() * S, y = R() * S, ang = R() * Math.PI, len = 4 + R() * 12, sign = R() < 0.5 ? -1 : 1;
        var amp = 0.5 + R(), bend = (R() - 0.5) * 0.04;
        for (var t = 0; t < len; t += 0.7) {
          ang += bend;
          x += Math.cos(ang) * 0.7; y += Math.sin(ang) * 0.7;
          var xi = ((Math.floor(x) % S) + S) % S, yi = ((Math.floor(y) % S) + S) % S;
          fib[yi * S + xi] += sign * amp;
        }
      }
      fib = normalize(boxWrap(fib, S, S, 0, 0));
      g = normalize(boxWrap(gaussArr(S * S, R), S, S, 1, 1));
      f = new Float32Array(S * S);
      addTo(f, fib, 0.75); addTo(f, g, 0.66);
      return normalize(f);
    }
    if (kind === 'cloth') {
      var P = o.period || 5, wx = normalize(blur(gaussArr(S * S, R), S, S, 2)), wy = normalize(blur(gaussArr(S * S, R), S, S, 2));
      // 타일이 감기도록 주기를 S의 약수 근처로 맞춘다
      var Px = S / Math.round(S / P);
      f = new Float32Array(S * S);
      for (var yy = 0; yy < S; yy++) for (var xx = 0; xx < S; xx++) {
        var k = yy * S + xx;
        f[k] = Math.sin(6.283185 * xx / Px + wx[k] * 0.45) * Math.sin(6.283185 * yy / Px + wy[k] * 0.45);
      }
      normalize(f);
      g = normalize(boxWrap(gaussArr(S * S, R), S, S, 1, 1));
      addTo(f, g, 0.45);
      return normalize(f);
    }
    throw new Error('KMTex: fine kind ' + kind);
  }

  // ---- 큰 결(얼룩·주름) 낮은 해상도 필드: 화면 1/8 크기, 감싸는 타일
  function lowField(kind, S, R, o) {
    var a = normalize(blur(gaussArr(S * S, R), S, S, Math.max(2, Math.round(S / 14))));
    if (kind === 'cloth') {   // 길고 부드러운 주름 몇 줄을 더한다
      var f = new Float32Array(S * S);
      for (var n = 0; n < 4; n++) {
        var ang = R() * Math.PI, c = R() * S, wdt = 1.5 + R() * 2.5, sg = R() < 0.5 ? -1 : 1;
        for (var y = 0; y < S; y++) for (var x = 0; x < S; x++) {
          var d = (x * -Math.sin(ang) + y * Math.cos(ang) - c);
          d = d - S * Math.round(d / S);
          f[y * S + x] += sg * Math.exp(-(d * d) / (wdt * wdt));
        }
      }
      addTo(a, normalize(blur(f, S, S, 1)), 0.8);
      normalize(a);
    }
    return a;
  }

  function fieldToCanvas(field, S, base, amp, alphaMode) {
    var cv = document.createElement('canvas'); cv.width = cv.height = S;
    var cx = cv.getContext('2d'), im = cx.createImageData(S, S), d = im.data;
    for (var i = 0; i < S * S; i++) {
      var v = field[i] * amp, j = i * 4;
      if (alphaMode) {               // 큰 결: 흰색/검정 + 알파(바탕 위에 덮어 그림)
        // 밝은 쪽은 'lighter'로 더하므로 알파 = v/255, 어두운 쪽은 검정 덮기라 알파 = v/바탕밝기
        var a = Math.min(1, Math.abs(v) / (v > 0 ? 255 : Math.max(1, base.lum)));
        var c = v > 0 ? 255 : 0;
        d[j] = d[j + 1] = d[j + 2] = c; d[j + 3] = Math.round(a * 255);
      } else {
        d[j] = clamp(base.rgb[0] + v); d[j + 1] = clamp(base.rgb[1] + v); d[j + 2] = clamp(base.rgb[2] + v); d[j + 3] = 255;
      }
    }
    cx.putImageData(im, 0, 0);
    return cv;
  }
  function clamp(v) { return v < 0 ? 0 : v > 255 ? 255 : Math.round(v); }

  function ampFor(L, scaleFix) {
    var c = CAL[L.kind] || {};
    if (L.amp != null) return L.amp;
    var a = 0;
    if (L.kind === 'grid') return L.line != null ? L.line : (L.tex != null ? L.tex / c.tex : 8);
    if (L.tex != null && c.tex) a = Math.max(a, L.tex / c.tex);
    if (L.tex360 != null && c.tex360) a = Math.max(a, L.tex360 / c.tex360 * scaleFix);
    if (!a) a = 1.5;
    return a;
  }

  function create(parent, opt) {
    opt = opt || {};
    var W = opt.width || 1920, H = opt.height || 1080, seed = opt.seed == null ? 1 : opt.seed;
    var rgb = parseColor(opt.base || '#f3ede3');
    var base = { rgb: rgb, lum: 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2] };
    // 세로·정사각 영상: 측정은 긴 변 1280 기준, 폰은 폭 360 기준이라 같은 결이 폰에서 다르게 남는다 → 폭 비율 보정
    var scaleFix = Math.sqrt((W / H) / (16 / 9));
    var cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    cv.style.cssText = 'position:absolute;left:0;top:0;width:' + W + 'px;height:' + H + 'px;' + (opt.style || '');
    if (parent) parent.appendChild(cv);
    var ctx = cv.getContext('2d');
    var LL = opt.layers || [{ kind: 'paper', tex: 1.2 }];
    var isFine = function (k) { return k === 'grain' || k === 'paper' || k === 'cloth'; };
    // 고운 결 층이 여럿이면 한 타일에 더해 그린다(타일은 불투명이라 따로 그리면 뒤 층이 앞 층을 덮는다 — 견본 r4에서 확인)
    var FS = 0;
    LL.forEach(function (L) { if (isFine(L.kind)) FS = Math.max(FS, L.tile || (L.kind === 'paper' ? 768 : 512)); });
    var layers = LL.map(function (L, li) {
      var R = rng(seed * 1009 + li * 7919 + 13), o = Object.assign({}, L);
      o.ampUsed = Math.min(ampFor(L, scaleFix), AMP_MAX[L.kind] || 40);
      if (isFine(L.kind)) {
        o.fA = fineField(L.kind, FS, R, L);
        if (L.boil) o.fB = fineField(L.kind, FS, R, L);   // 아주 느린 바뀜: A·cosθ + B·sinθ (세기 유지), θ는 시각으로만
        if (L.kind !== 'grain' && L.low !== 0) {
          var LS = 256, low = lowField(L.kind, LS, R, L);
          var lowAmp = (L.low != null ? L.low : (L.kind === 'cloth' ? 1.2 : 1.0)) * Math.max(1, o.ampUsed / 2);
          var pos = new Float32Array(low.length), neg = new Float32Array(low.length);
          for (var q = 0; q < low.length; q++) { if (low[q] > 0) pos[q] = low[q]; else neg[q] = low[q]; }
          o.lowPos = fieldToCanvas(pos, LS, base, lowAmp, true);
          o.lowNeg = fieldToCanvas(neg, LS, base, lowAmp, true);
          o.lowCv = o.lowPos;
          o.lowScale = Math.max(W, H) / LS * 1.6;
        }
      } else if (L.kind === 'grid') {
        o.cell = L.cell || 48;
        o.hatch = L.hatch || 0;
        o.sign = L.sign || (base.lum > 128 ? -1 : 1);   // 밝은 바탕엔 어두운 선, 어두운 바탕엔 밝은 선
      } else if (L.kind === 'glow') {
        o.span = L.span != null ? L.span : 10;
        o.gx = L.x != null ? L.x : 0.7; o.gy = L.y != null ? L.y : 0.3;
        o.gr = L.r != null ? L.r : 0.55;
        o.color = L.color ? parseColor(L.color) : [255, 255, 255];
      }
      o.R = R;
      return o;
    });
    var ox = 0, oy = 0, lastT = null;
    // 고운 결 합치기: 고정 몫 + 바뀌는 몫(boil)
    var fine = null, boilP = 0;
    if (FS) {
      var N = FS * FS, stat = new Float32Array(N), bA = null, bB = null;
      layers.forEach(function (L) {
        if (!L.fA) return;
        if (L.fB) {
          if (!bA) { bA = new Float32Array(N); bB = new Float32Array(N); boilP = Math.max(2, L.boil); }
          addTo(bA, L.fA, L.ampUsed); addTo(bB, L.fB, L.ampUsed);
        } else addTo(stat, L.fA, L.ampUsed);
        L.fA = L.fB = null;
      });
      fine = { cv: fieldToCanvas(stat, FS, base, 1, false), stat: stat, bA: bA, bB: bB };
      if (bA) { fine.ctx = fine.cv.getContext('2d'); fine.im = fine.ctx.createImageData(FS, FS); }
    }

    function drawTiled(img, dx, dy, alpha) {
      var S = img.width;
      dx = ((dx % S) + S) % S; dy = ((dy % S) + S) % S;
      ctx.globalAlpha = alpha == null ? 1 : alpha;
      if (!img._pat) img._pat = ctx.createPattern(img, 'repeat');   // 패턴: 타일 이음매 없이 소수 자리 이동
      ctx.save();
      ctx.translate(-dx, -dy);
      ctx.fillStyle = img._pat;
      ctx.fillRect(0, 0, W + S, H + S);
      ctx.restore();
      ctx.globalAlpha = 1;
    }

    function render(t) {
      t = +t || 0;
      if (t === lastT) return;
      lastT = t;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.fillStyle = 'rgb(' + rgb.join(',') + ')';
      ctx.fillRect(0, 0, W, H);
      var drift = opt.drift || [0, 0], flow = opt.flow == null ? 6 : opt.flow;
      if (fine) {
        var dx = drift[0] * t + ox, dy = drift[1] * t + oy;
        if (opt.subpixel === false) { dx = Math.round(dx); dy = Math.round(dy); }
        if (fine.bA) {
          var th = 1.5707963 * t / boilP, ca = Math.cos(th), sb = Math.sin(th);
          var dd = fine.im.data, A = fine.bA, B = fine.bB, St = fine.stat, r0 = rgb[0], g0 = rgb[1], b0 = rgb[2];
          for (var p = 0, q = 0; p < A.length; p++, q += 4) {
            var v = St[p] + A[p] * ca + B[p] * sb;
            dd[q] = clamp(r0 + v); dd[q + 1] = clamp(g0 + v); dd[q + 2] = clamp(b0 + v); dd[q + 3] = 255;
          }
          fine.ctx.putImageData(fine.im, 0, 0);
          fine.cv._pat = null;   // 패턴은 만든 때의 사본이라 다시 만든다
        }
        drawTiled(fine.cv, dx, dy, 1);
      }
      layers.forEach(function (L) {
        if (L.lowCv) {
          var a = 6.283185 * t / 37, s = L.lowScale;
          var lx = Math.cos(a) * flow * 37 / 6.283185 + ox + L.lowCv.width * s * 0.25, ly = Math.sin(a * 0.7) * flow * 26 / 6.283185 + oy + L.lowCv.width * s * 0.25;
          ctx.save();
          ctx.translate(-lx, -ly); ctx.scale(s, s);
          var S2 = L.lowCv.width, nx = Math.ceil((W + Math.abs(lx)) / (S2 * s)) + 1, ny = Math.ceil((H + Math.abs(ly)) / (S2 * s)) + 1;
          ctx.globalCompositeOperation = 'lighter';
          for (var j = -1; j < ny; j++) for (var i = -1; i < nx; i++) ctx.drawImage(L.lowPos, i * S2, j * S2);
          ctx.globalCompositeOperation = 'source-over';
          for (j = -1; j < ny; j++) for (i = -1; i < nx; i++) ctx.drawImage(L.lowNeg, i * S2, j * S2);
          ctx.restore();
        }
        if (L.kind === 'grid') {
          var c = L.sign > 0 ? 255 : 0, ref = L.sign > 0 ? 255 - base.lum : base.lum;
          ctx.strokeStyle = 'rgba(' + c + ',' + c + ',' + c + ',' + Math.min(1, L.ampUsed / Math.max(1, ref)).toFixed(4) + ')';
          ctx.lineWidth = L.width || 1;
          var gdx = (((drift[0] * t + ox) % L.cell) + L.cell) % L.cell, gdy = (((drift[1] * t + oy) % L.cell) + L.cell) % L.cell;
          gdx = Math.round(gdx); gdy = Math.round(gdy);
          ctx.beginPath();
          if (L.lines !== 'h') for (var x = -gdx + 0.5; x < W; x += L.cell) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
          if (L.lines !== 'v') for (var y = -gdy + 0.5; y < H; y += L.cell) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
          if (L.hatch) for (var d = -H; d < W + H; d += L.hatch) { ctx.moveTo(d - gdx, 0); ctx.lineTo(d - gdx + H, H); }
          ctx.stroke();
        }
        if (L.kind === 'glow') {
          // 빛만 더한다. 가운데가 화면 밖으로 너무 나가지 않게 0.15~0.85 안에서 아주 느리게 돈다(주기 23초)
          var b = 6.283185 * t / 23, gx = (L.gx + 0.04 * Math.sin(b)) * W, gy = (L.gy + 0.04 * Math.cos(b * 0.8)) * H;
          // 'lighter'(더하기) 합성: 밑의 결 대비를 줄이지 않는다(덮어 그리면 빛 아래 결이 흐려진다 — 견본 r1에서 확인)
          var r = L.gr * Math.max(W, H), al = Math.min(1, L.span / 255);
          var gr = ctx.createRadialGradient(gx, gy, 0, gx, gy, r), col = L.color.join(',');
          // 가우시안에 가까운 빛(가장자리 계단 없게 여러 단)
          for (var q = 0; q <= 8; q++) {
            var u = q / 8;
            gr.addColorStop(u, 'rgba(' + col + ',' + (al * Math.exp(-4.5 * u * u)).toFixed(5) + ')');
          }
          ctx.globalCompositeOperation = 'lighter';
          ctx.fillStyle = gr;
          ctx.fillRect(0, 0, W, H);
          ctx.globalCompositeOperation = 'source-over';
        }
      });
    }

    return {
      canvas: cv,
      render: render,
      offset: function (x, y) { ox = x || 0; oy = y || 0; lastT = null; },
      info: function () {
        return layers.map(function (L) { return { kind: L.kind, amp: +L.ampUsed.toFixed(3), tex: L.tex, tex360: L.tex360 }; });
      },
    };
  }

  window.KMTex = { create: create, CAL: CAL, AMP_MAX: AMP_MAX, rng: rng };
})();
