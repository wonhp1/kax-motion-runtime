// 글자 부품: 잉크 상자 맞춤 캔버스(KM.Words), 타이핑 일정(KM.typing), 기호 흐트러짐(KM.scramble).
(function () {
  const REF = 100;

  // ---------- 잉크 상자 맞춤 ----------
  // 낱말의 '실제 잉크 경계'(measureText actualBoundingBox)를 원하는 상자 (x0,y0,x1,y1)에 맞춰(가로·세로 배율 따로) 그린다.
  // 서체 줄 높이·여백과 상관없이 잉크가 정확히 그 자리에 온다 → 키프레임 정지 화면(승인본)과 대조할 때 자리가 안 흔들린다.
  // font 문자열의 크기 자리는 {S}: 예 "italic 800 {S} Inter"
  function inkMetric(ctx, text, font, cache) {
    const k = font + "|" + text;
    let v = cache && cache[k];
    if (!v) {
      const fs = font.replace("{S}", REF + "px");
      ctx.font = fs;
      const m = ctx.measureText(text);
      v = { l: m.actualBoundingBoxLeft, r: m.actualBoundingBoxRight, a: m.actualBoundingBoxAscent, d: m.actualBoundingBoxDescent, w: m.width };
      let ok = true;
      try { ok = document.fonts.check(fs, text); } catch (e) { ok = true; }
      if (ok && cache) cache[k] = v; // 서체가 아직 안 실렸으면 캐시하지 않는다(다음 프레임에 다시 잰다)
    }
    return v;
  }
  // 한 낱말 그리기. 상자 대신 '크기 + 기준점'으로 그리고 싶으면 KM.inkBox로 상자를 먼저 만든다.
  function fitText(ctx, text, font, x0, y0, x1, y1, color, alpha, blurPx, cache) {
    if (!text) return;
    const m = inkMetric(ctx, text, font, cache);
    const kx = (x1 - x0) / Math.max(1e-3, m.l + m.r);
    const ky = (y1 - y0) / Math.max(1e-3, m.a + m.d);
    ctx.save();
    ctx.globalAlpha = alpha === undefined ? 1 : alpha;
    ctx.filter = blurPx ? `blur(${blurPx}px)` : "none";
    ctx.fillStyle = color || "#000";
    ctx.font = font.replace("{S}", REF + "px");
    ctx.translate(x0 + m.l * kx, y0 + m.a * ky);
    ctx.scale(kx, ky);
    ctx.fillText(text, 0, 0);
    ctx.restore();
  }
  // 글자 크기 px와 잉크 왼쪽·윗선(x, capTop)으로 잉크 상자를 계산(배율 1:1). 레이아웃을 처음 잡을 때 쓴다.
  function inkBox(ctx, text, font, sizePx, x, top, cache) {
    const m = inkMetric(ctx, text, font, cache);
    const k = sizePx / REF;
    return [x, top, x + (m.l + m.r) * k, top + (m.a + m.d) * k];
  }

  // 화면 전체 캔버스 하나에 여러 낱말을 그리는 층.
  // items: [[text, font, x0, y0, x1, y1, color, alpha, blurX, perCharColors], ...]
  function Words(parent, w, h) {
    const W = w || 1920, H = h || 1080;
    const cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    cv.className = "ab";
    cv.style.width = W + "px"; cv.style.height = H + "px";
    parent.appendChild(cv);
    const ctx = cv.getContext("2d");
    const cache = {};
    function draw(items) {
      ctx.clearRect(0, 0, W, H);
      for (const it of items) {
        const [text, font, x0, y0, x1, y1, color, alpha, bx, cols] = it;
        if (!text) continue;
        fitText(ctx, text, font, x0, y0, x1, y1, color, alpha, bx, cache);
        if (cols) {
          // 글자별 색: 같은 변환으로 그 글자만 덧칠(타이핑의 '새 글자 색' 등)
          const m = inkMetric(ctx, text, font, cache);
          const kx = (x1 - x0) / Math.max(1e-3, m.l + m.r), ky = (y1 - y0) / Math.max(1e-3, m.a + m.d);
          ctx.save();
          ctx.globalAlpha = alpha === undefined ? 1 : alpha;
          ctx.font = font.replace("{S}", REF + "px");
          ctx.translate(x0 + m.l * kx, y0 + m.a * ky);
          ctx.scale(kx, ky);
          for (let i = 0; i < text.length; i++) {
            if (!cols[i]) continue;
            ctx.fillStyle = cols[i];
            ctx.fillText(text[i], ctx.measureText(text.slice(0, i)).width, 0);
          }
          ctx.restore();
        }
      }
    }
    return { el: cv, ctx, draw, metric: (t, f) => inkMetric(ctx, t, f, cache) };
  }

  // ---------- 타이핑 일정 ----------
  // 반환: [[frame, 보이는 문자열, 새 글자 인덱스], ...] (U.step으로 읽는다)
  // mode "brand": 3~5프레임에 한 글자(type_char_colored, 평균 3.8) / mode "ui": 대개 1프레임에 한 글자, 공백 뒤·몇 글자마다 2프레임(type_ui)
  function typingSchedule(text, f0, mode, seed) {
    const R = KM.rng(seed || 7);
    const rows = [[f0 - 1, "", -1]];
    let f = f0;
    for (let i = 1; i <= text.length; i++) {
      rows.push([f, text.slice(0, i), i - 1]);
      if (mode === "brand") f += [4, 4, 5, 3, 3][(i - 1) % 5];
      else f += text[i - 1] === " " || R() < 0.22 ? 2 : 1;
    }
    return rows;
  }
  // 앞에서부터 지우기(delete_from_front): 4프레임마다 한 글자
  function deleteSchedule(text, f0, every) {
    const rows = [];
    for (let i = 0; i <= text.length; i++) rows.push([f0 + i * (every || 4), text.slice(i), -1]);
    return rows;
  }

  // ---------- 기호 흐트러짐 → 왼쪽부터 정리 (scramble_resolve) ----------
  // 반환: (f) => 문자열. resolveFrames 동안 왼쪽부터 바른 글자로, 아직 안 된 자리는 기호(1~2프레임마다 바뀜) 또는 공백
  const SYMS = "φω\\[^`@+=$#!039&]≥{}<>~%*?/qzxvjkWYZ";
  function scrambler(text, f0, resolveFrames, opt) {
    const o = opt || {};
    const keep = o.keepPrefix || 0; // 처음부터 바른 앞부분 글자 수(예: 첫 낱말)
    const seed = o.seed || 11;
    return function (f) {
      const n = f - f0;
      if (n >= resolveFrames) return text;
      const p = Math.max(0, n) / resolveFrames;
      const done = keep + Math.floor((text.length - keep) * p);
      const tick = Math.floor(Math.max(0, n) / (o.changeEvery || 2));
      const R = KM.rng(seed * 1000 + tick);
      let s = text.slice(0, done);
      for (let i = done; i < text.length; i++) {
        if (text[i] === " ") { s += " "; continue; }
        const r = R();
        s += r < 0.25 ? " " : r < 0.55 ? text[i] : SYMS[Math.floor(R() * SYMS.length)];
      }
      return s;
    };
  }
  // 글리치(glitch_symbols): 낱말 몇 글자만 기호로, 3프레임 유지
  function glitchWord(word, f, seed, amount) {
    const R = KM.rng((seed || 3) * 97 + Math.floor(f / 3));
    let s = "";
    for (const ch of word) s += ch !== " " && R() < (amount || 0.4) ? SYMS[Math.floor(R() * SYMS.length)] : ch;
    return s;
  }

  window.KM = window.KM || {};
  Object.assign(KM, { Words, fitText, inkBox, inkMetric, typing: { schedule: typingSchedule, del: deleteSchedule }, scramble: scrambler, glitchWord });
})();
