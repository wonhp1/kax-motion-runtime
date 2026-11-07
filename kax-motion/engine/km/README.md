# km 엔진 — 채팅·UI 2D

HyperFrames 컴포지션 안에서 도는 순수 JS(빌드 없음, 전역 `window.KM`). 채팅 입력창·커서·상태 줄·메뉴·카드·목록·연결 화면·빛나는 끝 카드를 장면 모듈로 그린다. 예시 `meta.engine`이 `km`이면 이 엔진을 쓴다. 곡선 값은 예시 `motion.json`의 프리셋과 같다.

## 넣는 법
1. 이 폴더(`engine/km/`)를 통째로 작업 폴더 `engine/`으로 복사한다(`fonts/` 포함). GSAP은 이 스킬 `vendor/gsap.min.js`를 작업 폴더 `vendor/`로(렌더 중 네트워크 금지 — GSAP 자리는 하나, `references/render.md` 1장).
2. 예시 `motion.json`을 스크립트로 감싼다(브라우저가 file://에서 JSON을 못 읽음): `(printf "window.MOTION="; cat example/motion.json; printf ";") > motion.js`
3. `index.html` 뼈대 — 루트 속성, `#stage`, `#fdefs`, CSS 클래스 `.full`·`.sc`·`.ab`·`.nw`(엔진이 씀), 맨 끝의 `window.__timelines["main"] = tl` 줄이 있어야 한다.

```html
<!doctype html>
<html lang="ko"><head><meta charset="UTF-8">
<script src="vendor/gsap.min.js"></script>
<style>
  @font-face { font-family: "Inter"; src: url("engine/fonts/Inter-var.ttf"); font-weight: 100 900; }
  @font-face { font-family: "Pretendard"; src: url("fonts/PretendardVariable.ttf"); font-weight: 45 930; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 1920px; height: 1080px; overflow: hidden; background: #f3efe8; }
  #root { position: relative; width: 1920px; height: 1080px; overflow: hidden; background: #f3efe8; font-family: Inter, Pretendard, sans-serif; }
  .full { position: absolute; left: 0; top: 0; width: 1920px; height: 1080px; }
  .sc { position: absolute; left: 0; top: 0; width: 1920px; height: 1080px; display: none; overflow: hidden; }
  .ab { position: absolute; left: 0; top: 0; transform-origin: 0 0; }
  .nw { white-space: nowrap; }
</style></head>
<body>
<div id="root" data-composition-id="main" data-start="0" data-duration="4" data-fps="30000/1001" data-width="1920" data-height="1080">
  <div id="stage" class="full"></div>
  <!-- 쓰는 서체를 미리 부른다(캔버스 글자는 서체가 실린 뒤에 잰다) -->
  <div style="position:absolute;opacity:0;font-size:20px"><span style="font-family:Inter;font-weight:500">a</span><span style="font-family:Pretendard">가</span></div>
  <svg width="0" height="0" style="position:absolute"><defs id="fdefs"></defs></svg>
</div>
<script src="motion.js"></script>
<script src="engine/core.js"></script><script src="engine/curves.js"></script><script src="engine/text.js"></script>
<script src="engine/ui.js"></script><script src="engine/cards.js"></script><script src="engine/endcard.js"></script>
<script>
  const C = KM.curve, U = KM.U;
  KM.add({ id: "s1", f0: 0, f1: 119,
    build(el) {
      this.w = U.el("div", "ab", "width:1920px;height:1080px", el);
      this.p = KM.PromptBox(this.w, { x: 521, y: 446, line1: "이번 달 지출을", model: "기본", mode: "정리", font: "Pretendard" });
      this.typ = KM.typing.schedule("항목별로 묶어 줘", 20, "ui", 3);
    },
    render(f) {
      const fi = Math.floor(f + 1e-3);
      const [s] = U.step(this.typ, fi);
      this.w.style.transform = `translateX(${-196 * (1 - C.named.slideIn(fi))}px)`;   // 감속 진입
      this.p.set({ typed: s, caret: true, press: 1, glow: 0, arrowDeg: 0 });
    } });
  const tl = KM.mount({ duration: 4, fps: 30000 / 1001 });
  window.__timelines["main"] = tl;
</script>
</body></html>
```
- `KM.mount`가 이미 등록해도 `window.__timelines["main"] = tl` 줄은 **HTML 안에 글자 그대로** 둔다(`lint`가 HTML 글자에서 찾는다).
- 렌더 전 `npx hyperframes@0.8.188 lint` 오류 0. 렌더·소리 함정은 스킬의 `references/render.md`.
- 브라우저에서 직접 시크할 때는 `__timelines.main.seek(t, false)`(기본 `seek(t)`는 onUpdate를 막아 화면이 안 바뀐다).

## 쓰는 원칙
- **장면 하나 = 모듈 하나.** `render(f)`가 프레임 번호만 보고 모든 스타일을 정한다. GSAP 트윈을 여러 개 걸지 않는다(드라이버 트윈 하나를 `KM.mount`가 만든다).
- `f`는 컴포지션 프레임 번호(소수 가능, 30000/1001fps 기준). 장면은 `f0`~`f1`(포함)에서만 보인다.
- 움직임 값은 예시 `motion.json` 프리셋에서 가져온다: `C.fromPreset(MOTION.presets[이름], N)` 또는 `C.named.*`. 손으로 고른 ease(back·elastic)는 쓰지 않는다.
- 글자 자리는 잉크 상자로 정한다(`KM.Words`·`KM.inkBox`). 서체 줄 높이 때문에 승인된 키프레임과 자리가 흔들리지 않는다.
- 자동 모션 블러(`data-motion-blur`)는 끈다. 번짐은 `U.mblur`로 직접 준다: σ ≈ 0.35 × 그 프레임 이동 px, 가운데 대칭.
- 사진 재료는 사용자가 준 그림이나 코드로 그린 그림만 쓴다.
- 캔버스에 직접 그리는 부품(`ListScroll`·`drawSlot`·`drawGenCard` 제목)은 `font` 옵션(기본 Inter)으로 그린다 — 한글이면 `@font-face`로 등록한 한글 서체 가족을 `font`에 준다. 한글·라틴이 섞인 줄은 `KTypo`가 낫다(`references/typography.md`).
- 밝히기 층(`#lift` 요소 + `KM.mount({lift: [[0, "rgb(2,2,2)"]]})`, plus-lighter)은 bt709를 밝혀 풀어 잰 뒤에도 어두울 때만 쓴다. 순수 검정 장면에는 걸지 않는다(`references/render.md` 5장).

## API

| 파일 | 함수 | 입력·출력(요약) |
|---|---|---|
| `core.js` | `KM.add({id, f0, f1, build(el, U), render(f, U)})` | 장면 등록 |
| | `KM.mount({duration, fps, lift, id})` → 타임라인 | GSAP 드라이버 트윈 하나로 `render(t)`. `index.html` 끝에서 한 번 |
| | `KM.rng(seed)` | 시드 난수 |
| | `U.tab(rows, f)` · `U.step(rows, f)` | 표 선형 보간 · 계단 표(타자·스왑·on_twos). `rows = [[f, v1, v2 …]]` |
| | `U.el(tag, cls, css, parent, html)` · `U.svg(markup, cls, css, parent)` | 요소 만들기 |
| | `U.mblur(el, id, σx, σy)` | 방향 흐림(SVG feGaussianBlur). `#fdefs`가 있어야 한다 |
| `curves.js` | `C.settle(n, a, r)` | 감속 정착: 첫 프레임에 a만큼, 뒤로 남은 거리 r배씩(넘침 0) |
| | `C.accel(n, N, g)` | 가속 퇴장: 프레임당 이동이 g배씩, N에서 1(그 뒤 하드컷) |
| | `C.table(progress, n, N)` · `C.bezier(x1, y1, x2, y2)` · `C.hold(n, k)` | 정규화 표를 N프레임으로 · cubic-bezier · k프레임마다만 바뀜 |
| | `C.fromPreset(preset, N)` | 예시 `motion.json` 프리셋 하나 → `(n) => 진행` |
| | `C.named.*` | 잰 곡선: 감속 `slideIn`·`cursorIn`·`pushIn`·`cardZoom`·`windowRise`·`circleRise`·`endcardIn`, 가속 `exitUp`·`scrollExit`·`cursorOut`·`widen`·`edgeWipe`·`pullback`·`endcardOut`(가속은 `(n, N)`) |
| | `C.PRESS` | 버튼 눌림 배율 표 12프레임(1 → 0.813, 되튐 없음) |
| | `KM.anim(f, f0, N, from, to, fn)` | 값 하나를 곡선으로 옮기기 |
| `text.js` | `KM.Words(parent, w, h).draw([[text, font, x0, y0, x1, y1, color, alpha, blurX, perCharColors]])` | 캔버스에 낱말을 잉크 상자 맞춤으로. `font`는 `"500 {S} Inter"`처럼 `{S}`가 크기 자리 |
| | `KM.fitText(ctx, …)` · `KM.inkBox(ctx, text, font, size, x, top)` | 한 낱말 · 크기와 윗선으로 잉크 상자. 처음 배치는 inkBox로, 그 뒤는 상자로 고정 |
| | `KM.typing.schedule(text, f0, "brand" \| "ui", seed)` → `[[f, 보이는 글자, 새 글자 번호]]` · `KM.typing.del(text, f0, 4)` | brand: 3~5프레임/글자, ui: 대개 1프레임/글자 · 앞 글자부터 지우기 |
| | `KM.scramble(text, f0, frames, {keepPrefix, changeEvery, seed})` → `(f) => 문자열` · `KM.glitchWord(word, f, seed, amount)` | 왼쪽부터 정리되는 흐트러짐 · 3프레임 글리치 |
| `ui.js` | `KM.PromptBox(parent, {x, y, w, line1, font, weight, fs, pitch, ink, markHTML, model, mode, accent})` → `.set({typed, caret, press, glow, arrowDeg, worldScale})`, `.buttonCenter` | 채팅 입력창(테두리 없이 바탕 위에 뜬 꼴). 옵션은 아래 |
| | `KM.Cursor(parent, size)` → `.set(x, y, scale, deg)` | 끝점이 (x, y). `set(null)`이면 숨김. 확대 장면은 size 150 |
| | `KM.StatusLine(parent, {label, font, fs, color, ball, markHTML})` → `.set({ballX, ballY, ballD, labelX, labelY, f})` | 공 + 라벨 + 점 3개 물결. 옵션 `rewrite`는 아래 |
| | `KM.MenuCard(parent, {rows: [{iconHTML, text}], x, y, w, h, font, dim})` → `.set({hl, inset, dy, dim, hlColor})` | 어두운 막(46.4%) + 흰 카드 + 강조 줄 |
| | `KM.Pill(parent, {x, y, h, text, iconHTML, font})` → `.set(y, scale)` | 작은 도구 알약 |
| `cards.js` | `KM.drawGenCard(ctx, {R, P, img, photoScale, s, alpha, label, labelFont})` | 이미지 생성 카드(띠 틀·귀퉁이·손잡이·꺾쇠·라벨). 옵션 `reveal`·`photoStrip`은 아래 |
| | `KM.ListScroll({x, y0, pitch, font})` → `.draw(ctx, rows, off, cur, st)`, `.steps(f, rowF)` | 작업 목록(줄 간격 170). `rows = [{verb, path, thumb}]`. 옵션은 아래 |
| | `KM.drawSlot(ctx, words, cx, cy, off, hi, hiColor, {pitch, font, cap, col})` | 큰 낱말 슬롯 |
| | `KM.ConnectScreen(parent, {sections: [{bg, circle, iconHTML, lines}], tileHTML, f0, every: 16})` → `.set(f, circleX, scale)` | 구간마다 바탕색이 바뀌는 연결 화면. 옵션 `pair_mode`는 아래 |
| `endcard.js` | `KM.GlowEndcard(parent, {text, font, weight, size, tracking, bg, cx, cy})` → `.set({s, bx, by, g}, n)` | 글자 알파 ⊗ 가우시안 13개 합 글로우 끝 카드 |
| | `KM.EndcardMotion(n, N, {zoom})` | 기본 움직임: 배율 3.03 → 1.03 감속 정착, 흐림 걷힘, 글로우 0.30 → 0.82, 마지막 11프레임 가속 퇴장. `{zoom: false}`면 들어오는 확대 없이(등장은 `entry`가 맡음) |
| `fonts/` | Inter·Manrope·Geist·Familjen Grotesk·Schibsted Grotesk(가변, OFL) + `OFL.txt` | `@font-face`로 등록 |

## 엔진 옵션
모두 기본은 꺼짐이다. 안 주면 예전과 같은 그림이다. 잰 곡선 값은 장면 `render(f)`가 프레임마다 진행(0~1)으로 바꿔 넣는다.

### `KM.PromptBox` 옵션
| 옵션 | 뜻 |
|---|---|
| `theme: "dark"` | 어두운 판(글자·아이콘 밝게, 캐럿 흰색). 바탕은 장면이 깐다 |
| `attachments: [{iconHTML, text}]` | 첫 줄 위 첨부 칩. `set({attach: 0~1})` 나타남 진행 |
| `chips: [{iconHTML, text}]` | 아랫줄 모델 이름 뒤 회색 알약 |
| `splitButton: ["가", "나"]` | 아랫줄 왼쪽 분할 단추(첫 칸 켜짐). 있으면 마크·모델 글자는 그 뒤로 밀림 |
| `sendMorph: true` | 보내기 단추가 알약(→)에서 둥근 네모(↑)로. `set({morph: 0~1})` |
| `autogrow: true` | 둘째 줄이 폭을 넘으면 줄바꿈하고 아랫줄이 그만큼 내려감 |

- `sendMorph`이면 단추가 알약일 때 왼쪽으로 넓어진다(오른쪽 끝 고정). `buttonCenter`는 다 줄어든 단추 가운데다.
- 칩·분할 단추 줄은 폭이 고정이 아니다. `w`가 좁으면 오른쪽 모드 글자와 겹칠 수 있다(`w` ≥ 600 권장).

### `KM.StatusLine` 옵션 `rewrite` — 점 고리가 지나가며 고쳐 쓰기
공 대신 점 고리(점 5개 원)가 공 자리에 있다가 `rewrite.f0`부터 라벨 줄을 따라 새 문구 끝(+ 고리 반지름 1.6배)까지 간다. 고리가 지난 옛 글자는 지워지고, 고리 뒤로 새 글자가 나타나 옅은 색(`tint`)에서 라벨 색으로 진해진다. 끝에 고리는 새 글 뒤에 남아 돈다(점 물결은 숨김). `set()`은 그대로.

| 칸 | 기본 | 뜻 |
|---|---|---|
| `text` | — | 새로 쓸 글 |
| `f0` | 0 | 고리가 움직이기 시작하는 `f` |
| `dur`·`fps` | 1.234초 · 30000/1001 | 고리가 끝까지 가는 시간(37프레임) |
| `ring` | `{n: 5, d: fs×0.2, r: fs×0.36, color: 라벨 색}` | 점 수·점 지름·고리 반지름(px) |
| `tint` | 없음 | 새 글자 처음 색(없으면 불투명도만) |
| `lag`·`fade`·`erase` | 3 · 10 · 4프레임 | 새 글자가 고리 뒤 나타나기까지 · 진해지기까지 · 옛 글자가 지워지기까지 |
| `spin`·`roll`·`grow` | 1.2°/프레임 · 200° · 0.16 | 쉬는 동안 돎 · 가는 동안 더 도는 각 · 가는 동안 커지는 몫 |
| `blurCap` | 0.2 | 고리 가로 번짐 σ ≤ 고리 지름 × 이 값(가운데 대칭 `U.mblur`, σ = 프레임당 이동 × 0.35) |

잰 값: 고리 x 진행 bezier [0.768, 0.029, 0.019, 0.97] 37프레임(가장 빠를 때 약 98px/프레임), 크기 1 → 1.16, 돎은 쉬는 1.2°/프레임 + 가는 동안 200°, 옛 글자는 고리 오른쪽 끝이 닿고 4프레임에 지워짐, 새 글자는 고리 왼쪽 끝이 지나고 3프레임 뒤 + 10프레임에 진해짐.

### `KM.ConnectScreen` 옵션 `pair_mode` — 아이콘 ↔ 원형 사진 + 사이 색 점
타일(아이콘)과 원(사진)이 처음 14프레임 동안 바깥에서 가운데로 모이고, 색 점이 화면 가운데 줄을 따라 흐른다(타일·원 뒤로). 구간이 바뀔 때마다(바탕·사진·이름·점 색이 툭 바뀜) 점이 휙 밀린다. 아래 글은 이름(굵게) + 부제. `set(f, circleX, scale)` 그대로.

| 칸 | 기본 | 뜻 |
|---|---|---|
| `pair_mode` | 없음(꺼짐) | `true` 또는 아래 칸 객체 |
| `sections[k]` | — | `{bg: [r, g, b], photo(캔버스·그림·"주소"), circle([r, g, b], 선택), name, sub, dots([색…], 선택)}` |
| `dots`·`gap`·`d` | 12 · 216px · 21.6px | 점 수·간격·지름 |
| `push`·`pushPre`·`pushDur` | 97px · 9 · 36프레임 | 구간 바뀜 `pushPre` 프레임 앞부터 `pushDur` 동안 점이 `push`만큼 밀림 |
| `together`·`togetherDur` | [44, 57]px · 14프레임 | 타일·원이 바깥에서 모이는 거리·길이(settle 0.17, 0.74) |
| `nameFs`·`subFs` | 80 · 36px | 이름·부제(이름:부제 2.2 이상) |
| `palette` | 파스텔 9색 | 점 색(구간마다 3칸씩 돌려 씀) |
| `tileBg` | 없음 | 타일 바탕 |

- 사진은 구간마다 미리 만든 요소를 붙여 바꾼다. 한 줄 점이 이어 흐르고 색만 구간마다 돌린다.

### `KM.drawGenCard` 옵션 `reveal`·`photoStrip` — 결과 카드 드러내기
- `reveal: {p, glow, glowCol, fill, cover, coverCol, coverA, coverSoft, title, titleP, titleFont, titleCol, titleXY}` — 카드가 아래에서부터 드러남(`p` 0~1), 카드 뒤 빛 피기(`glow`), 카드 몸 바탕(`fill`), 색 덮개 띠가 아래에서 위로 걷힘(`cover` 1→0, 부드러운 폭 `coverSoft` 기본 카드 높이 × 0.13), 제목 타자(`titleP` 0~1, `titleFont`는 `'600 {S} "Inter"'` 꼴).
- `photoStrip: {imgs, off, gap, r, h}` — 사진 창 안을 둥근 사진 줄로(가로로 흐름). 있으면 `img`는 안 쓴다.
- 카드 아래 칸 글(제목·별점·본문)은 장면이 그린다. 빛 판은 색마다 한 번(400×400 기준) 구워 카드 크기로 늘려 붙인다 — 아주 납작한 카드(가로세로비 3 넘음)는 빛도 납작해진다.

| 칸 | bezier | 길이(초) | 메모 |
|---|---|---|---|
| 카드 올라옴(장면이 `R`을 옮김) | [0, 0.662, 0, 0.948] | 1.2 | 카드 높이의 0.214배만큼, 배율 1.12 → 0.99 |
| `reveal.p` 드러남 | [0.045, 0.574, 0.102, 0.864] | 0.367 | |
| `reveal.cover` 덮개 걷힘(1 − 진행) | 같은 곡선, 2프레임(29.97fps) 늦게 | 0.367 | |
| 덮개 옅어짐(`coverA`, 선택) | [0.187, 0.459, 1.0, 0.182] | 0.167 | 1 → 0.18 |
| `photoStrip.off` 사진 줄 | [0, 0.304, 1.0, 1.095] | 1.267 | |
| `reveal.titleP` 제목 | [0, 0.037, 0.442, 0.746] | 0.25 | |

### `KM.ListScroll` 옵션
| 옵션 | 뜻 |
|---|---|
| `check: true` | 파일 아이콘 대신 체크 상자(지난 줄 체크 진행 `st.checkP[i]`) |
| `doneGrey: true` | 아직 안 생긴 줄은 그리지 않음 — 지난 줄 회색, 지금 줄 검정 |
| `pushUp: true` | 지금 줄이 39px 아래에서 떠오름(`st.appear` 0~1) |
| `wheel: true` | 지금 줄에서 먼 줄일수록 옅고 작게(줄마다 −28% · −6%) |

- `ls.steps(f, rowF)`(행 시작 프레임 배열, 29.97fps) → `{off, cur, appear, checkP}`를 그대로 `st`로 넘긴다. 새 행이 생기면 위 행이 거의 한 프레임에 한 칸(settle 0.93, 0.5), 새 행은 떠오름(settle 0.56, 0.6), 지난 행 체크는 1프레임 뒤부터 6프레임.
- **흐르는 목록** `rowKind: "thumb_text" | "sparkline"`: 행 = 썸네일 판 + 제목·설명, 또는 이름·설명 + 작은 꺾은선(`values[]`) + 값·▲▼. `arc: {yc, R, mid, edge}`(행이 오른쪽으로 불룩한 원호를 따라 흐름), `thumbSize`, 색 `ink`·`sub`·`upCol`·`downCol`, `blurCap`(세로 흐림 ≤ 행 높이 × 값, 기본 0).
  - `ls.flow(f, {f0, every, stepDur, drift, steps, first, stagger, lineDelay, lineDur})` → `{off, cur, appear[], lineP[], blurY}`. `steps: 0, drift: 0`이면 흐르지 않고 엇갈려 떠오르기만.
  - 잰 값: 한 칸 휙 넘어감 bezier [0.825, 0.32, 0, 0.548] 0.534초를 0.546초마다(pitch 214), 사이 흐름 0.95px/프레임, 엇갈려 떠오름 settle(0.22, 0.8)·처음 160px 아래·행 사이 1프레임, 원호 R 571·yc 540·크기 가운데 1.05·가장자리 0.82, 세로 흐림 = 프레임당 이동 × 0.5.
  - 원호는 오른쪽 불룩만 된다.

### `KM.GlowEndcard` 옵션 `entry` — 끝 카드 등장
`KM.GlowEndcard(el, {…, entry, entry_dur, fps})`, `render(f) { const n = f - f0; e.set(KM.EndcardMotion(n, N, {zoom: false}), n); }` — `set`의 둘째 인자 `n`(샷 시작부터 프레임)이 있어야 등장이 돈다.

| `entry` | 등장 | 기본 길이 |
|---|---|---|
| `focus_pull` | 흐린 글자가 밝아지다 '딱' 초점(가우스 σ 38 → 0) + 아래에서 조금 올라옴, 글로우는 늦게 천천히 | 0.4초 |
| `radial_hit` | 화면보다 크게(`entry_scale` 3.2) 방사형 줌 흐림(글자 사본 여러 장)으로 때리고 줄어듦 | 0.4초 |
| `center_fill` | 가장자리 날카로운 채 반투명에서 가운데부터 차오름(원형 투명도) | 0.25초 |

- 더 줄 수 있는 값: `entry_blur`(38, 글자 100px 기준 σ), `entry_dy`(0.3 × size), `entry_scale`(3.2), `fill_r`([1.2, 4.5] × size, center_fill 안·밖 반지름).
- `radial_hit` 번짐 모양: `entry_blur_center` `"space"`(기본 — 사본을 지금 배율 둘레에 앞뒤 반씩, 움직임 방향 가운데 기준) 또는 `"behind"`(지나온 쪽에만 — 뒤쪽 꼬리). `entry_blur_cap` 0.5(기본 — 먼 모서리 번짐 ≤ 0.5 × 글자 높이) 또는 0(상한 없음).

## 엔진에 없는 것
위 부품 밖의 화면(웹페이지 조립, 달력 격자, 브라우저 창, 게시물 카드 등)은 공용 부품(`search_components`)에서 찾아 `KC.toKM`으로 장면에 넣고(`components/README.md`), 없으면 새로 짠다. 값은 예시 `design.json`, 움직임은 `motion.json` 프리셋.
