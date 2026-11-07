// 카드·목록 부품(캔버스 그리기 함수): 이미지 생성 카드(KM.drawGenCard), 작업 목록(KM.ListScroll), 큰 단어 슬롯(KM.drawSlot),
// 바탕색 바꿈 연결 화면(KM.ConnectScreen). 모두 '그리기만' 한다 — 언제 무엇을 그릴지는 장면 render(f)가 프리셋 곡선으로 정한다.
(function () {
  // ---------- 이미지 생성 카드 (image_gen_card) ----------
  // st: { R:[x0,y0,x1,y1] 바깥 틀, P:[x0,y0,x1,y1] 사진 창, img(이미지 또는 캔버스, 없으면 회색), photoScale(0.98→1 팝),
  //       s(배율, 손잡이·귀퉁이 크기용), alpha(틀 층 불투명도), label:"Generating image…", labelFont }
  // (옵션 — 모두 기본 꺼짐, 안 주면 기본 그림 그대로. 공용 부품 ui.result_card(카탈로그의 엔진 옵션)와 같은 움직임 — 결과 카드)
  //   reveal: { p 0~1 카드가 아래에서부터 드러남(위 가장자리 자르기), glow 0~1 + glowCol 카드 뒤 빛 피기, fill 카드 몸 바탕색(없으면 투명 — 기본 틀),
  //             cover 1→0 색 덮개 띠가 아래에서 위로 걷힘 + coverCol·coverA(불투명, 기본 1)·coverSoft(띠 부드러운 폭, 카드 높이 배수 0.13),
  //             title·titleP 0~1(앞 글자부터 타자) + titleFont('600 {S} "Inter"' 꼴, {S} = 56×s px)·titleCol·titleXY([x, 기준선 y], 기본 틀 왼쪽 위 −80×s) }
  //   photoStrip: { imgs:[그림|캔버스], off(px, 줄이 왼쪽으로 밀린 양), gap(px, 기본 24×s), r(px, 기본 40×s), h(창 높이 배수, 기본 1) }
  //             사진 창 안을 한 장 대신 둥근 사진 줄로(가로로 흐름). 있으면 img는 안 씀.
  //   잰 곡선(초 단위 bezier, 60fps에서 잼)은 engine/km/README.md의 엔진 옵션.
  const GC = { band: 0.068, corner: 61, handle: 12, handleCol: "#fa5f1b", tickCol: "rgb(208,162,100)", tickW: 2, tickLen: 25, tickGap: 15, labelCol: "rgb(66,63,59)" };
  const GLOW = {}; // 빛 판 미리 그림(색마다 한 번, 400×400 기준) — 매 프레임 shadowBlur 흔들림 없음, 카드 크기에 맞춰 늘려 붙임
  function glowSprite(col) {
    if (GLOW[col]) return GLOW[col];
    const m = 140, cv = document.createElement("canvas");
    cv.width = 400 + 2 * m; cv.height = 400 + 2 * m;
    const g = cv.getContext("2d", { willReadFrequently: true });
    g.filter = "blur(59px)"; g.fillStyle = col;
    g.beginPath(); g.roundRect(m, m, 400, 400, 48); g.fill();
    return (GLOW[col] = { cv, m });
  }
  function drawGenCard(c, st) {
    const [X0, Y0, X1, Y1] = st.R, [x0, y0, x1, y1] = st.P;
    const s = st.s || 1, a = st.alpha === undefined ? 1 : st.alpha;
    const rv = st.reveal || null;
    c.save();
    if (rv) {
      // 카드 뒤 빛 피기
      if (rv.glow > 0.002) {
        const G = glowSprite(rv.glowCol || "rgb(31,128,251)");
        c.save(); c.globalAlpha = Math.min(1, rv.glow) * a;
        const k = 0.9 + 0.1 * Math.min(1, rv.glow), cx = (X0 + X1) / 2, cy = (Y0 + Y1) / 2;
        const sx = (X1 - X0) / 400, sy = (Y1 - Y0) / 400;
        c.translate(cx, cy); c.scale(k * sx, k * sy); c.drawImage(G.cv, -G.cv.width / 2, -G.cv.height / 2); c.restore();
      }
      // 아래에서부터 드러남: 틀 위 가장자리를 자름(틀 밖 꺾쇠·라벨도 같이)
      const rp = rv.p === undefined ? 1 : Math.max(0, Math.min(1, rv.p));
      c.beginPath(); c.rect(X0 - 200 * s, Y1 - (Y1 - Y0) * rp, X1 - X0 + 400 * s, (Y1 - Y0) * rp + 200 * s); c.clip();
      if (rv.fill) { c.save(); c.globalAlpha = a; c.fillStyle = rv.fill; c.fillRect(X0, Y0, X1 - X0, Y1 - Y0); c.restore(); } // 카드 몸 바탕(빛이 비치지 않게)
    }
    // 사진(창 안, 가운데 기준 photoScale)
    c.save();
    c.beginPath(); c.rect(x0, y0, x1 - x0, y1 - y0); c.clip();
    if (st.photoStrip) {
      // 둥근 사진 줄: 창 높이에 맞춘 사진을 gap 간격으로, off만큼 왼쪽으로
      const ps = st.photoStrip, ph = (y1 - y0) * (ps.h || 1), gap = ps.gap === undefined ? 24 * s : ps.gap, r = ps.r === undefined ? 40 * s : ps.r;
      c.fillStyle = "#d9d5cd"; c.fillRect(x0, y0, x1 - x0, y1 - y0);
      let px = x0 - (ps.off || 0);
      const py = y0 + ((y1 - y0) - ph) / 2;
      for (let i = 0; i < 64 && px < x1; i++) {
        const im = ps.imgs[i % ps.imgs.length];
        const iw = im.width || im.naturalWidth, ih = im.height || im.naturalHeight, pw = ph * (iw / ih);
        if (px + pw > x0) {
          c.save(); c.beginPath(); c.roundRect(px, py, pw, ph, r); c.clip();
          c.drawImage(im, px, py, pw, ph); c.restore();
        }
        px += pw + gap;
      }
    } else if (st.img) {
      const ps = st.photoScale || 1, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      const iw = st.img.width || st.img.naturalWidth, ih = st.img.height || st.img.naturalHeight;
      const k = Math.max((x1 - x0) / iw, (y1 - y0) / ih) * ps; // cover
      c.drawImage(st.img, cx - (iw * k) / 2, cy - (ih * k) / 2, iw * k, ih * k);
    } else { c.fillStyle = "#d9d5cd"; c.fillRect(x0, y0, x1 - x0, y1 - y0); }
    c.restore();
    // 틀 띠(검정 6.8%) + 귀퉁이 사각형 한 겹 더
    c.fillStyle = `rgba(0,0,0,${(GC.band * a).toFixed(4)})`;
    c.beginPath(); c.rect(X0, Y0, X1 - X0, Y1 - Y0); c.rect(x0, y0, x1 - x0, y1 - y0); c.fill("evenodd");
    const cs = GC.corner * s;
    c.beginPath(); c.rect(X0, Y0, cs, cs); c.rect(X1 - cs, Y0, cs, cs); c.rect(X0, Y1 - cs, cs, cs); c.rect(X1 - cs, Y1 - cs, cs, cs); c.fill();
    // 손잡이(사진 창 네 귀퉁이)
    c.globalAlpha = a;
    c.fillStyle = GC.handleCol;
    const h = GC.handle * s;
    for (const [hx, hy] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]]) c.fillRect(hx - h / 2, hy - h / 2, h, h);
    // 자르기 꺾쇠 8개(틀 귀퉁이마다 세로·가로 하나씩, 틀에서 15px 떨어져 바깥으로)
    c.fillStyle = GC.tickCol;
    const w = Math.max(1.4, GC.tickW * s), L = GC.tickLen * s, g = GC.tickGap * s;
    for (const [cx, cy, sx, sy] of [[X0, Y0, -1, -1], [X1, Y0, 1, -1], [X0, Y1, -1, 1], [X1, Y1, 1, 1]]) {
      const yA = sy < 0 ? cy - g - L : cy + g, xA = sx < 0 ? cx - g - L : cx + g;
      c.fillRect(cx - w / 2, yA, w, L); // 세로
      c.fillRect(xA, cy - w / 2, L, w); // 가로
    }
    // 라벨(주황 둥근 네모 아이콘 + 글자), 틀 위 왼쪽
    if (st.label) {
      const ly = Y0 - 38 * s, lx = X0 + 20 * s;
      c.fillStyle = GC.handleCol;
      c.beginPath(); c.roundRect(lx, ly + 2 * s, 16 * s, 16 * s, 3.2 * s); c.fill();
      KM.fitText(c, st.label, st.labelFont || '400 {S} "Schibsted Grotesk"', lx + 26 * s, ly, lx + 26 * s + (st.labelW || 233) * s, ly + 26 * s, GC.labelCol, a);
    }
    if (rv) {
      // 색 덮개 띠: 덮개 아래 가장자리가 아래에서 위로 올라가며 걷힘(부드러운 띠 coverSoft)
      const cv = rv.cover === undefined ? 0 : rv.cover;
      if (cv > 0.002) {
        const H = Y1 - Y0, soft = (rv.coverSoft === undefined ? 0.13 : rv.coverSoft) * H, edge = Y0 + H * cv;
        const col = rv.coverCol || "rgb(31,128,251)", ca = (rv.coverA === undefined ? 1 : rv.coverA) * a;
        const g = c.createLinearGradient(0, edge - soft, 0, edge);
        g.addColorStop(0, col); g.addColorStop(1, "rgba(0,0,0,0)");
        c.save(); c.globalAlpha = ca;
        c.beginPath(); c.rect(X0, Y0, X1 - X0, H); c.clip();
        c.fillStyle = col; c.fillRect(X0, Y0, X1 - X0, Math.max(0, edge - soft - Y0));
        c.fillStyle = g; c.fillRect(X0, Math.max(Y0, edge - soft), X1 - X0, Math.min(edge, Y1) - Math.max(Y0, edge - soft));
        c.restore();
      }
    }
    c.restore();
    if (rv && rv.title && rv.titleP > 0) {
      // 제목 타자: 앞 글자부터 n글자(자르기 밖 — 드러남과 상관없이)
      const ch = Array.from(rv.title), n = Math.round(Math.max(0, Math.min(1, rv.titleP)) * ch.length);
      if (n > 0) {
        const xy = rv.titleXY || [X0, Y0 - 80 * s];
        c.save(); c.globalAlpha = a; c.fillStyle = rv.titleCol || "rgb(33,39,48)";
        c.font = (rv.titleFont || '600 {S} "Inter"').replace("{S}", (56 * s).toFixed(1) + "px");
        c.textBaseline = "alphabetic"; c.textAlign = "left";
        c.fillText(ch.slice(0, n).join(""), xy[0], xy[1]);
        c.restore();
      }
    }
  }

  // ---------- 작업 목록 (task_list_scroll) ----------
  // rows: [{ verb:"Wrote", path:"src/app.tsx", thumb(이미지 선택) }]. draw(ctx, offsetPx, currentIdx)
  // 줄 간격 170px, 칩 높이 79 반경 22 #ece9e6, 지금 줄은 검정·지난 줄은 #c1beba
  // (옵션 — 모두 기본 꺼짐, 안 주면 기본 그림 그대로. 부품 ui.checklist_steps와 같은 움직임)
  //   check:true      파일 아이콘 대신 체크 상자(지난 줄은 체크가 그려짐 — st.checkP[i] 0~1)
  //   doneGrey:true   지금 줄 뒤(아직 안 생긴 줄)는 그리지 않음 — 지난 줄 회색 · 지금 줄 검정만
  //   pushUp:true     지금 줄이 아래에서 떠오름(st.appear 0~1: 39px·불투명)
  //   wheel:true      지금 줄에서 먼 줄일수록 옅고 작게(바퀴 목록, 줄마다 −28% · −6%)
  //   draw(ctx, rows, off, cur, st) — st는 선택. ls.steps(f, rowF) → {off, cur, appear, checkP} 를 그대로 st로(행 시작 프레임 배열 rowF, 29.97fps)
  // (옵션 — 모두 기본 꺼짐. rowKind를 주면 아래 '흐르는 목록' 그리기로 가고, 안 주면 위 기본 그리기가 한 줄도 안 바뀜.
  //  상품 목록·종목 목록처럼 쉬지 않고 흐르는 목록 — 잰 값은 engine/km/README.md의 엔진 옵션)
  //   rowKind:"thumb_text"  행 = 썸네일 판(thumb: 그림|캔버스, 없으면 코드 그림 자리표시) + 제목(title) + 설명(sub)
  //   rowKind:"sparkline"   행 = 이름(name)·설명(sub) + 작은 꺾은선(values[], st.lineP[i] 0~1만큼 그려 나감) + 값(value)·▲▼(up)
  //   arc:{yc, R, mid, edge} 행이 오른쪽으로 불룩한 원호를 따라 흐름(가운데 y=yc에서 가장 오른쪽·mid배, 위아래로 갈수록 왼쪽·edge배)
  //   thumbSize:[w,h]        썸네일 판 크기(기본 211×209), pitch는 그대로 행 간격
  //   st.appear가 배열이면 행마다 아래에서 떠오름(staggerIn.dy px, 기본 160), st.blurY = 세로 움직임 흐림 길이 px(행을 여러 장 겹쳐 그림)
  //   ls.flow(f, {f0, every, stepDur, drift, stagger, lineDelay, lineDur}) → {off, cur, appear[], lineP[], blurY}: 쉬지 않고 한 칸씩 휙 넘어가며
  //   위로 흐르는 목록(잰 값: 0.546초마다 한 칸, bezier .825 .32 0 .548, 사이 흐름 0.95px/프레임) + 행 엇갈려 떠오름(settle .22 .8)
  // (R13 움직임 번짐 모양) blurCap: 세로 흐림 길이 상한 = blurCap × 행 높이(thumb_text 썸네일 높이, sparkline pitch×0.5) — 기본 0(없음).
  //   흐림 사본은 지금 자리 앞뒤로 반씩(−0.5 ~ +0.5, 움직임 방향 가운데 기준)이라 가운데 기준 옵션은 따로 없다.
  function ListScroll(opt) {
    const o = Object.assign({ x: 560, y0: 88, pitch: 170, font: "Inter", chipW: 384, thumbX: 1520 }, opt);
    function icon(c, x, y, col) {
      c.save(); c.strokeStyle = col; c.lineWidth = 3; c.lineJoin = "round"; c.lineCap = "round";
      c.beginPath(); c.moveTo(x + 4, y); c.lineTo(x + 22, y); c.lineTo(x + 34, y + 12); c.lineTo(x + 34, y + 44); c.lineTo(x + 4, y + 44); c.closePath(); c.stroke();
      c.beginPath(); c.moveTo(x + 14, y + 22); c.lineTo(x + 9, y + 28); c.lineTo(x + 14, y + 34); c.moveTo(x + 24, y + 22); c.lineTo(x + 29, y + 28); c.lineTo(x + 24, y + 34); c.stroke();
      c.restore();
    }
    // 체크 상자 + 체크(진행 p) — 테 3.3px 둥근 6px
    function checkBox(c, x, y, col, p) {
      c.save(); c.strokeStyle = col; c.lineWidth = 3.3; c.lineJoin = "round"; c.lineCap = "round";
      c.beginPath(); c.roundRect(x + 1.65, y + 1.65, 40.7, 40.7, 6); c.stroke();
      if (p > 0) {
        const P = [[x + 9.5, y + 22.5], [x + 18.5, y + 31.5], [x + 34.5, y + 12.5]];
        const l1 = Math.hypot(9, 9), l2 = Math.hypot(16, 19), L = (l1 + l2) * Math.min(1, p);
        c.lineWidth = 4; c.beginPath(); c.moveTo(P[0][0], P[0][1]);
        if (L <= l1) c.lineTo(P[0][0] + 9 * (L / l1), P[0][1] + 9 * (L / l1));
        else { c.lineTo(P[1][0], P[1][1]); const k = (L - l1) / l2; c.lineTo(P[1][0] + 16 * k, P[1][1] - 19 * k); }
        c.stroke();
      }
      c.restore();
    }
    function draw(c, rows, off, cur, st) {
      if (o.rowKind) { drawFlow(c, rows, off, cur, st); return; } // 기본 그리기는 아래 그대로
      rows.forEach((r, i) => {
        if (o.doneGrey && i > cur) return;
        let y = o.y0 + i * o.pitch - off;
        let a = 1, sc = 1;
        if (o.pushUp && i === cur && st && st.appear !== undefined) { y += 39 * (1 - st.appear); a = Math.min(1, st.appear * 2); }
        if (o.wheel) { const d = Math.abs(i - cur + (st && st.wheelFrac || 0)); a *= Math.max(0, 1 - 0.28 * d); sc = 1 - 0.06 * Math.min(d, 3); }
        if (y < -200 || y > 1280 || a <= 0.002) return;
        const tf = a !== 1 || sc !== 1;
        if (tf) { c.save(); c.globalAlpha *= a; c.translate(o.x, y + 40); c.scale(sc, sc); c.translate(-o.x, -(y + 40)); }
        const col = i === cur ? "#111" : "#c1beba";
        if (o.check) checkBox(c, o.x - 4, y + 18, col, i < cur ? (st && st.checkP ? st.checkP[i] : 1) : 0);
        else icon(c, o.x, y + 17, col);
        c.font = `500 34px ${o.font}`; c.fillStyle = col; c.textBaseline = "middle";
        c.fillText(r.verb, o.x + 58, y + 40);
        const vx = o.x + 58 + c.measureText(r.verb).width + 18;
        c.fillStyle = "#ece9e6"; c.beginPath(); c.roundRect(vx, y, o.chipW, 79, 22); c.fill();
        c.fillStyle = i === cur ? "#4a4744" : "#c1beba"; c.font = `400 30px ${o.font}`;
        c.fillText(r.path, vx + 22, y + 40);
        if (r.thumb) c.drawImage(r.thumb, o.thumbX, y - 30, 200, 140);
        if (tf) c.restore();
      });
    }
    // 행 시작 프레임 rowF(29.97fps)로 밀림·떠오름·체크 진행을 한 번에: 새 행이 생기면 위 행이 거의 한 프레임에 한 칸(settle .93 .5),
    // 새 행은 39px 아래에서 떠오름(settle .56 .6), 지난 행 체크는 1프레임 뒤부터 6프레임. 반환 off는 첫 행이 y0에 있을 때 0
    function steps(f, rowF) {
      const S = (n, a, r) => (n <= 0 ? 0 : n < 1 ? a * n : 1 - (1 - a) * Math.pow(r, n - 1));
      let cur = -1, off = 0;
      rowF.forEach((rf, i) => { if (f >= rf) cur = i; if (i > 0) off += o.pitch * S(f - rf, 0.93, 0.5); });
      const appear = cur >= 0 ? S(f - rowF[cur], 0.56, 0.6) : 0;
      const checkP = rowF.map((rf, i) => (i + 1 < rowF.length ? Math.max(0, Math.min(1, (f - rowF[i + 1] - 1) / 6)) : 0));
      return { off, cur: Math.max(0, cur), appear, checkP };
    }
    // ---------- 흐르는 목록: thumb_text · sparkline + 원호 · 엇갈려 떠오름 · 세로 흐림 ----------
    const TS = o.thumbSize || [211, 209];
    function arcAt(y) {
      if (!o.arc) return [0, 1];
      const A = Object.assign({ yc: 540, R: 571, mid: 1.05, edge: 0.82 }, o.arc);
      const d = Math.min(Math.abs(y - A.yc), A.R), k = Math.sqrt(1 - (d / A.R) * (d / A.R));
      return [-(A.R - Math.sqrt(A.R * A.R - d * d)), A.edge + (A.mid - A.edge) * k];
    }
    function placeholder(c, x, y, w, h, i) {
      c.fillStyle = "#f2f1ef"; c.fillRect(x, y, w, h);
      const hu = (i * 67) % 360; // 코드 그림: 가운데 둥근 덩어리(옷·물건 자리) — 사진 없이 코드로 그림
      c.fillStyle = `hsl(${hu},12%,${28 + (i % 3) * 18}%)`;
      c.beginPath(); c.roundRect(x + w * 0.24, y + h * 0.22, w * 0.52, h * 0.58, w * 0.08); c.fill();
    }
    function rowThumb(c, r, i, x, y, sc, cur) {
      const w = TS[0] * sc, h = TS[1] * sc, x0 = x, y0 = y - h / 2;
      if (r.thumb) { c.fillStyle = "#f2f1ef"; c.fillRect(x0, y0, w, h); c.drawImage(r.thumb, x0, y0, w, h); } else placeholder(c, x0, y0, w, h, i);
      const fs = 25.2 * sc, tx = x0 + 231 * sc;
      c.textBaseline = "alphabetic";
      c.font = `400 ${fs.toFixed(2)}px ${o.font}`; c.fillStyle = o.ink || "#1f1f1f"; c.fillText(r.title || "", tx, y0 + 39.76 * sc + fs * 0.36);
      c.fillStyle = o.sub || "#8b8b8b"; c.fillText(r.sub || "", tx, y0 + 79.25 * sc + fs * 0.36);
    }
    function rowSpark(c, r, i, x, y, sc, st) {
      const up = r.up !== false, col = up ? (o.upCol || "#1fa463") : (o.downCol || "#e5483b");
      c.textBaseline = "middle";
      c.font = `600 ${(32 * sc).toFixed(2)}px ${o.font}`; c.fillStyle = o.ink || "#111111"; c.fillText(r.name || "", x, y - 16 * sc);
      c.font = `400 ${(24 * sc).toFixed(2)}px ${o.font}`; c.fillStyle = o.sub || "#8b8b8b"; c.fillText(r.sub || "", x, y + 22 * sc);
      const v = r.values || [], n = v.length;
      const lp = st && st.lineP ? Math.max(0, Math.min(1, st.lineP[i] === undefined ? 1 : st.lineP[i])) : 1;
      if (n > 1 && lp > 0) {
        const lo = Math.min.apply(null, v), hi = Math.max.apply(null, v), gx = x + 330 * sc, gw = 260 * sc, gh = 64 * sc;
        const P = v.map((q, k) => [gx + gw * k / (n - 1), y + gh / 2 - gh * (q - lo) / ((hi - lo) || 1)]);
        const m = lp * (n - 1), kk = Math.floor(m), fr = m - kk;
        const Q = P.slice(0, kk + 1);
        if (kk < n - 1) Q.push([P[kk][0] + (P[kk + 1][0] - P[kk][0]) * fr, P[kk][1] + (P[kk + 1][1] - P[kk][1]) * fr]);
        c.beginPath(); c.moveTo(Q[0][0], y + gh / 2); Q.forEach((q) => c.lineTo(q[0], q[1])); c.lineTo(Q[Q.length - 1][0], y + gh / 2); c.closePath();
        c.globalAlpha *= 0.14; c.fillStyle = col; c.fill(); c.globalAlpha /= 0.14;
        c.beginPath(); Q.forEach((q, k) => (k ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1])));
        c.strokeStyle = col; c.lineWidth = 3 * sc; c.lineJoin = "round"; c.lineCap = "round"; c.stroke();
      }
      if (r.value) {
        const vx = x + 640 * sc;
        c.font = `600 ${(30 * sc).toFixed(2)}px ${o.font}`; c.fillStyle = o.ink || "#111111"; c.fillText(r.value, vx, y - 14 * sc);
        c.fillStyle = col; c.beginPath();
        const ty = y + 24 * sc, s2 = 9 * sc;
        if (up) { c.moveTo(vx, ty + s2 * 0.6); c.lineTo(vx + s2, ty + s2 * 0.6); c.lineTo(vx + s2 / 2, ty - s2 * 0.6); }
        else { c.moveTo(vx, ty - s2 * 0.6); c.lineTo(vx + s2, ty - s2 * 0.6); c.lineTo(vx + s2 / 2, ty + s2 * 0.6); }
        c.fill();
        if (r.change) { c.font = `500 ${(22 * sc).toFixed(2)}px ${o.font}`; c.fillText(r.change, vx + 18 * sc, ty); }
      }
    }
    function drawFlow(c, rows, off, cur, st) {
      const dy0 = (o.staggerIn && o.staggerIn.dy) || 160;
      let by = st && st.blurY > 0.75 ? st.blurY : 0;
      if (by && o.blurCap > 0) by = Math.min(by, o.blurCap * (o.rowKind === "sparkline" ? o.pitch * 0.5 : TS[1])); // 상한(배율 전 행 높이)
      const K = by ? Math.min(9, Math.max(3, Math.ceil(by / 3))) : 1;
      rows.forEach((r, i) => {
        let y = o.y0 + i * o.pitch - off, a = 1;
        const ap = st && Array.isArray(st.appear) ? st.appear[i] : undefined;
        if (ap !== undefined) { if (ap <= 0) return; y += dy0 * (1 - ap); a = Math.min(1, ap * 2); }
        if (y < -300 || y > 1380) return;
        const [ax, sc] = arcAt(y);
        const x = o.x + ax;
        const ak = K > 1 ? 1 - Math.pow(1 - Math.min(a, 0.999), 1 / K) : a;
        for (let k = 0; k < K; k++) {
          const t = K > 1 ? k / (K - 1) - 0.5 : 0;
          c.save(); c.globalAlpha *= ak; c.translate(0, by * t);
          if (o.rowKind === "sparkline") rowSpark(c, r, i, x, y, sc, st); else rowThumb(c, r, i, x, y, sc, cur);
          c.restore();
        }
      });
    }
    // 흐르는 목록 진행: f·f0은 29.97fps 프레임. every 초마다 한 칸(pitch) 휙 + 사이 흐름 drift px/프레임
    function flow(f, q) {
      q = Object.assign({ f0: 0, every: 0.546, stepDur: 0.534, drift: 0.95, steps: 99, stagger: 1, lineDelay: 6, lineDur: 18, first: 0.4 }, q);
      const FPS = 30000 / 1001, n = f - q.f0, P = q.every * FPS, D = q.stepDur * FPS;
      const B = (u) => { // bezier(.825,.32,0,.548) — 잰 곡선
        u = Math.max(0, Math.min(1, u)); let t = u;
        for (let j = 0; j < 20; j++) { const x = 3 * (1 - t) * (1 - t) * t * 0.825 + t * t * t - u, d = 3 * (1 - t) * (1 - t) * 0.825 - 6 * (1 - t) * t * 0.825 + 3 * t * t; t = Math.max(0, Math.min(1, t - x / (Math.abs(d) < 1e-6 ? 1e-6 : d))); }
        return 3 * (1 - t) * (1 - t) * t * 0.32 + 3 * (1 - t) * t * t * 0.548 + t * t * t;
      };
      const offAt = (m) => { let v = q.drift * Math.max(0, m); for (let k = 0; k < q.steps; k++) { const s0 = q.first * FPS + k * P; if (m <= s0) break; v += o.pitch * B((m - s0) / D); } return v; };
      const S = (m) => (m <= 0 ? 0 : m < 1 ? 0.22 * m : 1 - 0.78 * Math.pow(0.8, m - 1));
      const off = offAt(n), v = Math.abs(off - offAt(n - 1));
      const appear = [], lineP = [];
      for (let i = 0; i < 64; i++) { appear.push(S(n - i * q.stagger)); lineP.push(Math.max(0, Math.min(1, (n - i * q.stagger - q.lineDelay) / q.lineDur))); }
      return { off, cur: 0, appear, lineP, blurY: v * 0.5 };
    }
    return { draw, pitch: o.pitch, steps, flow };
  }

  // ---------- 큰 단어 슬롯 (slot_words) ----------
  // words: 대문자 단어 배열, off: 남은 거리 px(motion.slot_words.offset_table_px), hi: 강조 인덱스, hiCol: 강조 색
  function drawSlot(c, words, cx, cy, off, hi, hiCol, opt) {
    const o = Object.assign({ pitch: 121, font: '700 {S} Geist', cap: 85, col: "#3b3b3a" }, opt);
    words.forEach((w, i) => {
      const y = cy + (i - hi) * o.pitch + off;
      if (y < -150 || y > 1230) return;
      const m = KM.inkMetric(c, w, o.font);
      const k = o.cap / Math.max(1, m.a);
      const W = (m.l + m.r) * k;
      KM.fitText(c, w, o.font, cx - W / 2, y - o.cap / 2, cx + W / 2, y + o.cap / 2 + m.d * k, i === hi ? hiCol : o.col);
    });
  }

  // ---------- 바탕색 바꿈 연결 화면 (color_swap_connect) ----------
  // sections: [{ bg:[r,g,b], circle:[r,g,b], iconHTML, lines:["제목","설명"] }], 16프레임마다 바뀜
  // (옵션 — 기본 꺼짐, 안 주면 기본 DOM·그림 그대로. 공용 부품 fx.icon_photo_match_plane(아이콘 ↔ 원형 사진 짝, 카탈로그의 엔진 옵션))
  //   pair_mode: true | { dots: 12, gap: 216, d: 21.6, push: 97, pushPre: 9, pushDur: 36, together: [44, 57], togetherDur: 14, nameFs: 80, subFs: 36, palette: [...], tileBg: null(타일 바탕 — null이면 기본 #fd6119) }
  //     sections 칸: { bg:[r,g,b], photo(<canvas>·<img>·"url" — 원 안을 가운데 맞춰 꽉 채움), circle([r,g,b] 사진 뒤 바탕, 선택), name, sub, dots([색...] 그 구간 점 색, 선택) }
  //     · 타일(앱 아이콘)과 원(사진)이 처음 togetherDur 프레임 동안 각자 44·57px 바깥에서 가운데로 모임(settle .17 .74)
  //     · 색 점이 화면 가운데 줄을 따라 오른쪽으로 흐르고(타일·원 뒤로 지나감), 구간이 바뀔 때마다 pushPre 프레임 앞부터 push px 휙 밀림(측정 표)
  //     · 아래 글: 이름(굵게 nameFs) + 부제(subFs, 92%) — lines 대신. 바탕·사진·글·점 색은 구간마다 바뀜(기본처럼 툭)
  //   set(f, circleX, scale)는 그대로(원 가운데 x는 장면이 줌 — 모임 이동은 그 위에 더함). 잰 값은 engine/km/README.md의 엔진 옵션.
  function ConnectScreen(parent, opt) {
    const o = Object.assign({ tileHTML: "", f0: 0, every: 16, font: "Familjen Grotesk" }, opt);
    const u = KM.U;
    const bg = u.el("div", "full", "", parent);
    const grp = u.el("div", "full", "transform-origin:960px 540px", parent);
    const tile = u.el("div", "ab", "width:302px;height:302px;top:388px;left:562px;border-radius:63px;background:#fd6119;display:flex;align-items:center;justify-content:center", grp, o.tileHTML);
    const circ = u.el("div", "ab", "width:304px;height:304px;top:387px;border-radius:50%;display:flex;align-items:center;justify-content:center", grp);
    const dots = [0, 1, 2, 3].map(() => u.el("div", "ab", "width:22px;height:22px;border-radius:50%;top:528px", grp));
    const cap = u.el("div", "ab", `left:0;width:1920px;top:770px;text-align:center;color:#fff;font-family:"${o.font}";font-size:40px;line-height:52px`, grp);
    const PM = o.pair_mode ? pairModeOf(u, o, grp, tile, circ, dots, cap, bg) : null;   // 없으면 아래 set이 기본 그대로(한 줄도 안 다름)
    if (PM) return { set: PM.set, pair: PM };
    let lastSec = -1;
    function set(f, circleX, scale) {
      const sec = Math.max(0, Math.min(o.sections.length - 1, Math.floor((f - o.f0) / o.every)));
      const S = o.sections[sec];
      if (sec !== lastSec) {
        bg.style.background = `rgb(${S.bg.join(",")})`;
        circ.style.background = `rgb(${S.circle.join(",")})`;
        circ.innerHTML = S.iconHTML || "";
        cap.innerHTML = S.lines.join("<br>");
        lastSec = sec;
      }
      circ.style.left = (circleX - 152).toFixed(1) + "px";
      grp.style.transform = `scale(${scale || 1})`;
      // 점: 타일 오른쪽 끝(864)과 원 왼쪽 사이를 같은 간격으로, 프레임마다 한 칸씩 흐름
      const a = 864 + 30, b = circleX - 152 - 30;
      dots.forEach((d, i) => {
        const t = ((i + ((f - o.f0) % 8) / 8) / dots.length);
        d.style.left = (a + (b - a) * t - 11).toFixed(1) + "px";
        d.style.background = `rgba(255,255,255,${(0.35 + 0.5 * Math.sin(Math.PI * t)).toFixed(2)})`;
      });
    }
    return { set };
  }

  // ConnectScreen pair_mode — 위 ConnectScreen 머리 주석. 값은 실측 곡선(68프레임 구간)
  function pairModeOf(u, o, grp, tile, circ, dots, cap, bg) {
    const Q = Object.assign({ dots: 12, gap: 216, d: 21.6, push: 97, pushPre: 9, pushDur: 36, together: [44, 57], togetherDur: 14, nameFs: 80, subFs: 36,
      palette: ["#aaff75", "#e7dead", "#e0abe8", "#f6f0e8", "#e7e6ab", "#69da1a", "#d34ede", "#3467f6", "#a4bceb"], tileBg: null }, o.pair_mode === true ? {} : o.pair_mode);
    if (Q.tileBg) tile.style.background = Q.tileBg;
    const PUSH = [0, 0.0515, 0.1546, 0.7722, 0.8866, 0.9351, 0.9629, 0.9753, 0.9856, 0.9887, 0.9918, 0.9959, 1];   // 구간 바뀜 둘레 점 밀림(정규화 표, 36프레임)
    const tab = (v) => { v = Math.max(0, Math.min(1, v)) * (PUSH.length - 1); const i = Math.min(PUSH.length - 2, Math.floor(v)); return PUSH[i] + (PUSH[i + 1] - PUSH[i]) * (v - i); };
    const settle = (n) => (n <= 0 ? 0 : n < 1 ? 0.17 * n : 1 - 0.83 * Math.pow(0.74, n - 1));   // 모임(아이콘·사진 x 실측 곡선, rms 0.019)
    dots.forEach((d) => (d.style.display = "none"));
    const row = u.el("div", "ab", `left:0;top:0;width:1920px;height:1080px`, null);
    grp.insertBefore(row, tile);   // 점은 타일·원 뒤로 지나감
    const pd = Array.from({ length: Q.dots }, () => u.el("div", "ab", `width:${Q.d}px;height:${Q.d}px;border-radius:50%;top:${540 - Q.d / 2}px`, row));
    circ.style.overflow = "hidden";
    const n0 = o.sections.length;
    const photoEl = (src) => {
      if (src && src.tagName === "CANVAS") {
        const c = document.createElement("canvas"); c.width = 304; c.height = 304;
        const k = Math.max(304 / src.width, 304 / src.height);
        c.getContext("2d").drawImage(src, (304 - src.width * k) / 2, (304 - src.height * k) / 2, src.width * k, src.height * k);
        c.setAttribute("style", "display:block;width:304px;height:304px"); return c;
      }
      if (src) { const im = document.createElement("img"); im.setAttribute("src", typeof src === "string" ? src : src.getAttribute("src")); im.setAttribute("alt", ""); im.setAttribute("style", "display:block;width:304px;height:304px;object-fit:cover"); return im; }
      return null;
    };
    const photos = o.sections.map((S) => photoEl(S.photo));   // 사진은 처음에 한 번 만들어 두고 구간마다 붙임
    let lastSec = -1;
    function set(f, circleX, scale) {
      const sec = Math.max(0, Math.min(n0 - 1, Math.floor((f - o.f0) / o.every)));
      const S = o.sections[sec];
      if (sec !== lastSec) {
        bg.style.background = `rgb(${S.bg.join(",")})`;
        circ.style.background = S.circle ? `rgb(${S.circle.join(",")})` : "transparent";
        circ.innerHTML = "";
        if (photos[sec]) circ.appendChild(photos[sec]);
        cap.innerHTML = `<div style="font-weight:600;font-size:${Q.nameFs}px;line-height:${Math.round(Q.nameFs * 1.15)}px">${S.name || ""}</div>` +
          `<div style="font-weight:400;font-size:${Q.subFs}px;line-height:${Math.round(Q.subFs * 1.3)}px;opacity:0.92">${S.sub || ""}</div>`;
        const pal = S.dots || Q.palette;
        pd.forEach((d, i) => (d.style.background = pal[(i + sec * 3) % pal.length]));
        lastSec = sec;
      }
      const g = settle(f - o.f0);
      tile.style.transform = `translateX(${(-Q.together[0] * (1 - g)).toFixed(2)}px)`;
      circ.style.left = (circleX - 152 + Q.together[1] * (1 - g)).toFixed(1) + "px";
      grp.style.transform = `scale(${scale || 1})`;
      // 점 흐름: 구간이 바뀔 때마다(pushPre 프레임 앞부터 pushDur 동안) push px — 화면 폭 + 한 칸에서 되풀이
      let off = 0;
      for (let k = 1; k < n0; k++) off += Q.push * tab((f - (o.f0 + k * o.every - Q.pushPre)) / Q.pushDur);
      const span = Q.gap * Q.dots;
      pd.forEach((d, i) => {
        const x = ((((i * Q.gap + off) % span) + span) % span) - Q.gap;
        d.style.left = (x - Q.d / 2).toFixed(1) + "px";
      });
    }
    return { set, row };
  }

  window.KM = window.KM || {};
  Object.assign(KM, { drawGenCard, ListScroll, drawSlot, ConnectScreen, GENCARD: GC });
})();
