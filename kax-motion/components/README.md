# 공용 부품 쓰는 법

공용 부품은 화면 한 조각(앱 화면 틀·대화·데이터 카드·카드 목록·전환·글자 연출·유리·3D·루프·지도)을 그리는 JS 모듈이다. 같은 부품을 km·kx 엔진 안에서도, 엔진 없이 HyperFrames에서도 쓴다.

- **찾기·받기**: KAX MCP `search_components`(검색어·분류·`shot_type`·renderer)로 찾고 `get_component(id)`로 받는다. 받은 파일은 `path` 그대로 작업 폴더 `components/<분류>/<이름>/`에 쓴다. `requires.parts`가 있으면 그 부품도 받는다.
- **도우미 복사**: 부품을 하나라도 쓰면 이 스킬의 `components/kc.js`·`components/lib/`(3D 부품이면 `components/vendor/`도)를 작업 폴더 `components/` 아래 같은 자리로 복사한다. 부품 파일이 이 자리를 기준으로 서로 부른다. GSAP은 이 스킬 `vendor/gsap.min.js`를 작업 폴더 `vendor/`로.
- **부품마다**: 입력 표·쓰는 예·사건·한계는 그 부품 `README.md`, 곡선 값은 `presets.json`. `<script>`는 `get_component`의 `requires.script_order` 차례 그대로 둔다(키트·`kc.js`·lib·먼저 받을 부품·엔진 파일까지 든 차례). 맨 앞 GSAP 줄은 `vendor/gsap.min.js`다(작업 폴더 GSAP 자리는 하나, `references/render.md` 1장 — 부품 데모 HTML의 옛 GSAP 줄(components/vendor 아래 gsap-3.14.2 폴더)도 같은 파일이고 `stage.py`가 이것으로 찾는다). 부품이 쓰는 서체 역할은 `requires.font_roles` → `KTypo.ready([...])`에 넣고 그 서체 파일만 복사한다(`references/typography.md` 2장).
- 부품 `requires.kc_version`이 이 스킬 `KC.version`보다 높으면 쓰지 않고 스킬을 새로 받으라고 안내한다.

## 1. 부품 쓰기

```html
<script src="vendor/gsap.min.js"></script>
<script src="components/kc.js"></script>                          <!-- 부품보다 먼저 -->
<script src="components/fx/path_draw/path_draw.js"></script>       <!-- 쓸 부품마다 -->
```
```js
const env = { fps: 30000 / 1001, width: 1920, height: 1080 };   // 엔진 fps를 꼭 넘긴다(kx 엔진은 24)
const line = KC.make("fx.path_draw", { f0: 8, path: { type: "rrect", box: [640, 330, 1280, 650], r: 56 } }, env);
```

붙이는 곳은 셋 중 하나:

| 어디에 | 한 줄 | 메모 |
|---|---|---|
| 엔진 없이 HyperFrames | `const hf = KC.toHF([a, b], rootEl, {duration: 4, bg, under, over});` 다음 줄 `window.__timelines["main"] = hf.timeline;` | 드라이버 트윈 하나. canvas2d 부품은 캔버스 하나에 z 차례로, dom 부품은 z-index로 겹친다. `under`·`over` = `(ctx, f) => …` 부품 밑·위 그리기(바탕 결 등) |
| km 엔진 | `KC.toKM(a, {id: "ring", f0: 0, f1: 119});` (`KM.mount` 전에) | 장면 하나로 등록. f는 km 프레임 그대로 |
| kx 엔진 | `KC.toKX(a, 5);` 또는 `KC.toKX(a, {z: 5})` (`KX.init` 뒤에) | canvas2d → KX 층(움직임 번짐·화면 blur를 받는다 — 단 자기 번짐이 있는 부품은 겹치지 않음, 아래 '번짐 겹침'). dom·webgl → 캔버스 위에 겹친 요소 |

- **시간**: `f0`·`f1`은 **프레임**(컴포지션 프레임), `dur`·`at` 같은 길이는 **초**. 곡선 값은 각 부품 `presets.json`.
- **효과음 사건**: `KC.events([a, b])` → `[{f, type, tier, onset, land, hint, id}]` — 렌더 사건 프레임이다. 부품 tier는 `normal`·`detail`뿐이고, 영상 전체의 first·signature는 `KC.retier(사건들, {first, signature})`로 하나씩 고른다. 휙 소리는 `onset`, 착지·누름은 `land`에 둔다(규칙 R12, `references/sound.md`). 페이지 밖에서 값을 받으려면 작업 폴더에서 `python3 -I <이 스킬>/scripts/events_dump.py --plan audio/events_draft.json` — `index.html`을 헤드리스 크롬으로 열어 만든 부품 전부의 `events()`(+ `KC.retier`, `--first`·`--signature`)를 JSON으로 쓴다(`references/sound.md` 1장).
- **여백 점검**: `a.bounds(f)` → 그 프레임 내용 상자.
- 부품 README '출력'에 적힌 다른 칸(`nEnd`·`state(f)`·`rowY(i)`·`ownBlur` 등)은 `KC.make` 인스턴스에서 바로 읽는다.
- **세로(9:16) 영상**: 부품 대부분은 좌표를 세로에 맞게 직접 줘야 한다(자동 재배치 없음 — 부품 README의 '세로 영상' 줄).
- **결정성**: 부품은 프레임 번호 f(소수 가능)만 보고 그린다. `window.KC_DEV = 1`(개발 모드)이면 부품이 `Date`·`performance.now`·`Math.random`·타이머·네트워크를 쓰는 순간 오류가 난다.
- **그리기 오류**: `KC.toHF`·`toKM`·`toKX`는 부품을 그리다 오류가 나면 화면 위에 빨간 띠('KC 그리기 오류 …')를 그리고 `window.KC_DRAW_ERROR`에 남긴다. 렌더 전에 정지 화면에서 띠가 없는지 본다.
- **데모로 미리 보기**: `get_component(id, include_demo: true)`로 데모까지 받아, 작업 폴더에서 `python3 -I <이 스킬>/components/tools/stage.py components/<분류>/<이름> --lint`(+ `--render`). 데모를 HyperFrames 폴더로 옮겨 lint·렌더한다.

### 번짐 겹침 (kx 엔진)
- 자기 번짐이 있는 canvas2d 부품은 인스턴스 `ownBlur`가 참이다. `KC.toKX`(기본 `mb: "auto"`)는 그 층을 KX 서브프레임 표본마다 **그 프레임 시각**으로 그려 KX 번짐을 겹치지 않는다. 겹치면 부품 번짐 + KX 번짐으로 두 번 번진다.
- 해당 부품(괄호 = 번짐이 생기는 조건):
  - 전환: `transition.zoom_through`(shutter > 0)·`whip_slide`(shutter > 0)·`shape_morph`(motion_blur)·`glitch_burst`(늘 — 의도한 잔상)·`grid_stair_collapse`(올라오는 동안, shutter > 0)·`liquid_blob_morph`(blur_s > 0)·`icon_morph_whip`(shutter > 0)
  - 효과: `fx.orbit_collect`(samples > 1)·`iridescent_icon_bloom`(늘 — 나갈 때 번짐)·`ring_flip_ellipses`(늘 — 사이 상태 잔상)·`glow_streak_disc`(늘 — 빛 꼬리)
  - 유리: `glass.lens_iris`(shutter > 0 — 회전 번짐)
  - 글자: `type.word_reveal`·`words_regroup`·`logo_lockup`(smear를 쓸 때)·`speed_slide`(trail > 0)·`gap_slide`(나갈 때, shutter > 0)
  - UI: `ui.calendar_week`(smear)·`avatar_stack`·`card_grid`(motion_blur)·`phone_frame`·`tab_underline`·`toggle_switch`(blur_k)·`dial_ticks_spin`(늘 — 회전 번짐)·`input_to_picker`(shutter > 0)·`map`(핀이 있고 pin_blur > 0)
  - 루프: `loop.auth_scan_loop`(haze > 0)
- `ownBlur: false`를 일부러 적은 것: `transition.swirl_collage`(dom)·`loop.icon_line_morph`(번짐 없음).
- KX 번짐으로 하고 싶으면 부품 번짐을 끄고 `KC.toKX(a, {z, mb: "kx", speed: (F) => 이 층 최고 속도 px/프레임})`. KX는 그리기 층의 빠르기를 몰라 `speed`를 안 주면 표본이 모자라 계단이 진다. `mb: "own"`은 `ownBlur`가 없어도 프레임 시각으로 그린다.
- dom·webgl 부품은 원래 KX 번짐을 안 받는다.

## 2. 도구

| 도구 | 하는 일 |
|---|---|
| `kc.js` | `KC.def`·`KC.make`·`KC.rng`·`KC.ease`·`KC.curve`·`KC.color`/`rgba`·`KC.toKM`·`KC.toKX`·`KC.toHF`·`KC.events`·`KC.retier`(영상의 first·signature 고르기)·`KC.evAt`(부품 사건 onset·land 셈)·`KC.ctxReset`(다시 쓰는 화면 밖 캔버스의 그리기 상태를 처음 값으로 — 쓰는 쪽 콜백을 부르기 전에)·`KC.ctxFrom`(처음 값 + ctx의 칠·선·글꼴·그림자만 옮김, v0.6.7)·`KC.smearFn`(그리는 콜백을 화면 밖 판에 한 번 그려 같은 무게로 번짐, v0.6.7)·`KC.smearMax`(글자 px → 번짐 길이 상한 0.2 × px, v0.6.7). dom 도우미 `KC.normalize`·`KC.prime`·`KC.vis`·`KC.styleKey` |
| `lib/b*.js` | 부품끼리 나눠 쓰는 그리기 도우미(각 파일 머리 주석에 목록, 부품 README '읽는 순서'가 어느 것을 부를지 알려 줌). 움직임 번짐(R13)은 사본을 직접 덮어 그리지 말고 `KCB6.smearImage`(그림 하나)·`KCB3.smearDraw`(장면 층)·`KCB2.drawWord`(낱말)·`KC.smearFn`/`KCB6.smear`(그리는 콜백 — 글자마다 알파가 다른 묶음 등)를 쓴다 — 같은 무게 평균, 사본 간격 1px 이하, 가운데 기준. v0.6.7부터 `KCB2.drawWord`·`KCB6.smear`·`type.logo_lockup` 위로 퇴장도 덮어 그리기(알파 1−(1−a)^(1/K)로 K장 — 꼬리까지 진한 돌출 그림자)가 아니라 한 번 그려 평균한다(v0.6.7; `drawWord`의 `smear_n` 잔상만 예외). v0.6.6부터 사본은 float16 판(`KC.fbuf`·`KC.avgN`·`KC.halve`·`KC.smearLine`, kc.js)에 더해 한 번만 8비트로 내린다 — 부품이 직접 사본 평균을 낼 때도 8비트 캔버스에 'lighter' 1/n으로 더하지 말고 이 도우미를 쓴다(SPEC 26). 글자가 실린 것의 번짐 길이는 글자 높이 × 0.25 이하(v0.6.7 '바코드' 막기): `KCB2.drawWord`는 이것이 기본(글자 높이 0.8em, `smear_n` 잔상만 예외), 글자가 실린 그림·층은 도우미 기본(max 없음) 그대로이고 부르는 쪽이 `max: KC.smearMax(가장 작은 글자 px)`(= 0.2 × px)를 넘긴다 — 화면 크기 전환(`transition.whip_slide` 등)은 예외. 회전 번짐은 `KCB15.spin`·`KCB17.spinDraw`(아래 두 줄 — 방법은 같고 받는 그림 꼴만 다름) |
| `lib/b15_fx.js`(`KCB15`) | `sprite(w, h)` 화면 밖 CPU 캔버스 · `fit(c, w, h)` 다시 쓰는 캔버스를 128px 단위로 키움(크기는 실제 `c.canvas.width`로) + 그리기 상태 되돌림·통째로 지움 · `Field(x0, y0, w, h, cell)` 격자 점 화소를 직접 셈 → 쌍선형 확대(그라데이션 흔들림 없이) · `lin`·`enc` sRGB ↔ 선형 · **`spin(ctx, img, cx, cy, ang, alpha, opt)` 회전 번짐** — 정사각 그림을 가운데 둘레로 −ang/2 ~ +ang/2 같은 무게 평균(사본 2^n장, 바깥 호 간격 ≤ 1px) |
| `lib/b16_kit.js`(`KCB16`) | `cpu`·`fit`·`clear`(`KC.ctxReset` + 통째로 지움) · `rr` 둥근 사각 경로 · `paint` 칸 내용(색 · 그림 · `(ctx, w, h, f)` 콜백) · `text`·`textW` KTypo 역할 한 줄 · `appIcon` 코드로 그린 앱 아이콘(선 기호) · `blurInto` CPU 흐림(흔들림 없음) · 데모만: `photo(seed, w, h, kind)` 코드로 그린 중립 '사진' 10종 |
| `lib/b17_morph.js`(`KCB17`) | `cpu`·`fit(slot, w, h)`·`clear` · `Noise(seed)` 2D 기울기 잡음(`n2`·`fbm`) · `sdBox` 둥근 사각까지 거리 · **`spinDraw(ctx, src, sw, sh, cx, cy, ang, alpha, rad)` 회전 번짐** — 아무 크기 그림(가운데 = 회전 중심), 가운데 기준 같은 무게 평균(사본 간격 ≤ 1px) · `mix3`·`rgb`·`rrect` |
| `lib/` 그 밖 | `B1`(모양·버튼·로고 — 스프링 곡선) · `KCB2`(낱말 조판·그리기) · `KCB3`(전환 — 장면 원천·번짐) · `B4`(앱 화면 틀) · `B5`(AI·대화·입력 — 선 아이콘) · `KCB6`(데이터 카드 — KTypo 글자·번짐) · `KCB7`(카드·목록·스캔) · `KCB8`(유리 2D·알림·스티커) · `KC3`(3D, three.js — `b9_three.js`·`b13_three.js`) · `KCG`(유리 WebGL) · `KCB11M`(금속 칠) · `KCB3Demo`(전환 부품 데모 전용 중립 장면 — 부품은 부르지 않음) |
| `tools/stage.py` | 부품 데모를 HyperFrames 작업 폴더로 옮김(+ `--lint`, `--render`, `--selftest`). 작업 폴더에서 부르면 `get_component`로 받은 부품을 쓴다 |
| `vendor/` | three.js r186(`vendor/three-r186/`, 3D 부품용). GSAP은 스킬 뿌리 `vendor/gsap.min.js` 한 자리(공개본 v0.6.6 — 저작자 저장소의 데모용 GSAP 폴더 gsap-3.14.2도 같은 파일) |
