# 렌더·소리 입히기 함정

HyperFrames로 렌더하고 소리를 입힐 때 실제로 걸린 함정과 피하는 법이다. 컴포지션 계약 자체는 HyperFrames 스킬(`/hyperframes-core`, `/hyperframes-cli`)을 따른다.

## 1. 판과 준비
- HyperFrames는 **`npx hyperframes@0.8.188`로 고정**한다. 아래 함정은 이 판에서 확인했다. 판이 다르면 동작이 다를 수 있다.
- 렌더·스냅숏은 **`--workers 2`**(일꾼 하나가 브라우저 하나, 메모리 약 256MB). Python은 스레드 2개(`OMP_NUM_THREADS=2`). 무거운 계산은 하나씩, 프로세스는 PID로만 끈다.
- **FFmpeg**: 5.1 이상은 `-vsync` 대신 **`-fps_mode passthrough`**를 쓴다(FFmpeg 9에는 `-vsync`가 없다). FFmpeg 9 빌드에 따라 **`drawtext` 필터가 없다** → 그림에 글자를 적을 때는 Pillow로. 이 스킬의 측정 도구(`critic/tools/`, `texture/`)는 판을 보고 알아서 고른다.
- **렌더 중 네트워크 금지**: GSAP은 `vendor/gsap.min.js` 로컬 사본(CDN 주소를 쓰지 않는다. 스킬에도 작업 폴더에도 이 한 자리뿐이다 — 부품 `requires.script_order` 첫 줄과 km·kx 엔진 README의 `<script>`가 모두 `vendor/gsap.min.js`다. 부품 데모 HTML에 남은 옛 GSAP 줄(components/vendor 아래 gsap-3.14.2 폴더)은 같은 파일이라 `stage.py`가 이것으로 찾는다. GSAP을 두 번 부르지 않는다), 서체는 `fonts/`, JSON 자료는 HTML 안에 넣거나 `.js`로 감싼다(`window.MOTION = …;` — 브라우저가 file://에서 JSON을 못 읽는다).

## 2. 컴포지션 함정
- **루트**: `data-composition-id="main"`, `data-fps`, `data-width`, `data-height`, `data-duration`. 멈춘(paused) 타임라인 하나를 `window.__timelines["main"] = tl`로 등록한다. 이 줄은 **HTML 안에 글자 그대로** 적는다 — 엔진이 등록해도 `lint`는 HTML 글자에서 이 줄을 찾는다.
- **결정성**: 그리기는 프레임 번호만 보고 정한다. 실제 시계(`Date.now()`·`performance.now()`), 시드 없는 `Math.random()`, 타이머·`requestAnimationFrame`, 스스로 도는 CSS `transition`·`animation`, 끝없는 반복(`repeat: -1`), 네트워크를 쓰지 않는다. 난수는 시드 고정(`KC.rng(seed)`·`KM.rng(seed)`).
- **자동 모션 블러(`data-motion-blur`)는 끈다.** 움직이는 자식이 부모의 `overflow:hidden`·둥근 모서리 클립 밖에 따로 칠해질 수 있다. 번짐은 직접 만든다: 엔진·부품 번짐(R13), CSS `filter: blur()`, 방향 흐림은 SVG `<feGaussianBlur stdDeviation="X 0">`(km 엔진 `U.mblur`).
  - 그래도 켜야 한다면: 움직이는 요소는 DOM 차례와 상관없이 멈춘 요소 **위에** 칠해진다(화면을 덮는 큰 마스크·움직이는 장식 빛에는 `data-motion-blur="off"`). SVG 요소와 크기 0 감싸개는 번지지 않는다(div로 감싼다). 보이는 요소의 크기·위치를 `tl.set`으로 순간 바꾸면 그 프레임에 옛 자세도 칠해진다(나타나기는 투명도로). WebGL 캔버스·3D 뒤집기·뿌리 요소 변환이 있으면 저절로 꺼진다.
- **글꼴 목록**(`font-family`)에는 `@font-face`로 넣은 서체와 일반 이름(`sans-serif`·`monospace`)만 적는다. 시스템 서체 이름을 적으면 컴파일러가 그 서체 파일을 통째로 HTML에 박는다(수십 MB). `check`·렌더 출력에 `System font "…" is large … embedding anyway` 또는 `Embedded system font`가 보이면 그 이름을 뺀다.
- **인라인 SVG 안에 `foreignObject`를 쓰지 않는다.** 컴파일에서 그 뒤 층이 통째로 사라진다. 브라우저로 파일을 직접 열면 정상이라 렌더에서야 드러난다. 그라데이션 버튼 같은 것은 CSS 요소나 코드로 그린 그림으로.
- 장면 안 요소에 **`visibility: visible`을 쓰지 않는다.** 부모 장면이 숨어도 남아서 다음 장면을 덮는다. 켤 때는 `inherit`.
- **GSAP**
  - 문자열로 트윈하는 값(`clip-path`·`filter`·그림자)의 숫자는 **브라우저가 돌려주는 꼴**로 쓴다(`-38.0px`가 아니라 `-38px` — `String(Math.round(v * 10) / 10) + "px"`). 아니면 렌더에서만 시작값에 멈춘다. 정지 화면은 끝값으로 건너뛰어 맞아 보이므로, 이런 트윈은 **렌더 초안 프레임**으로 확인한다.
  - 타임라인 0초의 `tl.set`은 재생 위치가 정확히 0일 때 그려지지 않는다(lint `gsap_timeline_set_initial_hide`). 처음 상태는 타임라인 밖 `gsap.set`으로 둔다.
  - 앞에서 이미 보였던 요소에 나중에 `fromTo`를 걸지 않는다(되감을 때 시작값이 남는다). 그 프레임에 `tl.set`으로 지금 자세를 놓고 `tl.to`로 움직인다.
  - 같은 속성을 쓰는 트윈 두 개가 시간상 겹치지 않게 한다(`check`의 `gsap_tween_tail`). 짧은 뜀을 되풀이하면 keyframes 한 줄로.
  - 자리는 `x`·`y`(변환)로 움직인다. `left`·`top` 트윈은 정수 px로 끊겨 lint 오류(`gsap_non_transform_motion`)가 난다.
  - 프레임마다 바뀌는 글자(숫자·타자)는 `onUpdate`로 바꾸지 않고 프레임마다 `tl.set`으로 박는다(건너뛰어 재생하면 빠진다).
  - 선 그리기는 선의 실제 길이(`getTotalLength()`)와 `autoRound: false`로. 길이를 1로 정규화하면 `strokeDashoffset`이 정수로 반올림돼 선이 한 번에 나타난다.
  - 모양이 바뀌는 컨테이너의 바탕색은 불투명한 색끼리 잇는다. 반투명 색끼리 보간하면 중간에 회색 덩어리가 번쩍인다.
- 화면보다 큰 요소에는 CSS `filter`·SVG 필터를 걸지 않는다(보이는 영역만 필터에 들어가 가장자리가 투명해진다). 화면 크기 바탕에 `filter: blur`를 걸면 화면 끝에 페이지 밑색이 번진다 → `html, body` 배경을 그 바탕과 같은 색으로.
- 캔버스 글자는 서체가 실린 뒤에 잰다(`await KTypo.ready([쓰는 역할들])`, `document.fonts` 대기 — `references/typography.md` 2장).
- 브라우저에서 직접 시크해 볼 때는 `__timelines.main.seek(t, false)`. 기본값 `seek(t)`는 onUpdate를 막아 화면이 안 바뀐다.

## 3. 렌더
- **fps는 예시와 같게**, 루트 `data-fps`와 렌더 `--fps`를 같은 값으로 쓴다.
  - 29.97fps는 분수로: `data-fps="30000/1001"`, `--fps 30000/1001`. 소수 `29.97`은 오류가 난다.
  - 24fps는 정확히 `24`. 23.976이나 `30000/1001`을 섞지 않는다(프레임 번호가 밀린다).
  - `data-duration` = 프레임 수 ÷ fps. 렌더 기본 fps는 30이라 `--fps`를 빼면 안 된다.
- 차례(작업 폴더에서):
  ```bash
  npx hyperframes@0.8.188 lint                       # 고칠 때마다 — 오류 0
  npx hyperframes@0.8.188 check                      # 렌더 전 마지막에
  npx hyperframes@0.8.188 render --workers 2 --quality draft --fps 30000/1001 --output out/draft.mp4
  npx hyperframes@0.8.188 render --workers 2 --quality delivery --crf 16 --fps 30000/1001 --output out/video.mp4 2>&1 | tee review/render.log
  ```
- **품질 옵션**(0.8.188, `render --help`의 'delivery is high'): `delivery`는 `high`의 다른 이름이다 — x264 `slow`·CRF 15. `--crf 16`은 CRF만 바꾼다. 그래서 위 최종 렌더 = `--quality high --crf 16`(두 렌더의 영상 흐름이 같은 바이트로 확인). 기본값 `looks` = `medium`·CRF 16(= `standard --crf 16`), `standard` = `medium`·CRF 18, `draft` = `ultrafast`·CRF 28. 최종본은 위 줄 그대로 쓰고, `--quality`를 빼지 않는다(빼면 `looks`).
- **`snapshot`을 부를 때는 늘 `--describe false`.** 붙이지 않으면 분석 키가 있을 때 프레임을 밖으로 보낸다.
  - 정지 화면 PNG는 다음 실행 때 지워진다 → 찍자마자 `review/` 아래로 옮긴다. 파일 번호는 0부터라 시각으로 짝짓는다.
- `drawElement self-verification failed … re-rendering via screenshot` 경고는 무시해도 된다(결과 정상).
- `check` 경고 가운데 검사 착시가 있다. 이유를 적어 두고 넘어간다(진짜 결함은 고친다).
  - 타자하려고 글자를 한 칸씩 나누면 글자 하나를 한 낱말로 센다.
  - 숫자 굴림 칸은 `line_unread`가 지나가는 숫자마다 짧다고 경고한다(마지막 값이 머무는 시간을 적어 둔다).
  - 결·장치 요소(종이 결, 흐르는 눈금)는 겹침·넘침·대비 경고를 낸다 → 그 요소에 `data-layout-ignore`.

## 4. 소리 입히기
- 최종본 소리는 렌더 영상의 소리를 쓰지 않고, 마스터한 `audio/mix.wav`(`references/sound.md` 5장)를 **다시 입힌다.** HyperFrames는 렌더할 때 소리를 AAC 192k로 굳히고 트루피크가 −1 dBTP를 넘으면 소리 전체를 낮춘다(렌더 기록의 `Audio lowered by X dB`). 컴포지션에 `<audio>`를 넣어 미리 듣는 것은 괜찮다.
  ```bash
  ffmpeg -i out/video.mp4 -i audio/mix.wav -map 0:v -map 1:a -c:v copy -c:a aac -b:a 256k -af apad -shortest out/final.mp4
  ```
  - **`-af apad`를 꼭 넣는다.** 소리가 영상보다 몇 ms 짧으면 `-shortest`만으로는 마지막 프레임이 잘린다.
  - 소리 시작점은 0이다. 1프레임도 밀지 않는다.
- 끝나면 프레임 수가 렌더 영상과 같은지 본다(5장).

## 5. 재기·확인
- **프레임 수·길이·fps**: `ffprobe -v error -count_frames -select_streams v:0 -show_entries stream=nb_read_frames,r_frame_rate,duration -of default=nw=1 out/final.mp4` — 의도한 값과 같아야 한다(관문 G5).
- **음량**: `ffmpeg -hide_banner -nostats -i out/final.mp4 -af ebur128=peak=true -f null -` → 통합 음량 −14 ±1 LUFS, 트루피크 −1 dBTP 이하(G5).
- **프레임 띠 뽑기**(시그니처 검사 E1): `ffmpeg -i out/draft.mp4 -vf "select='between(n\,120\,160)*not(mod(n\,2))'" -fps_mode passthrough review/strip/f%04d.png` — 120~160프레임을 2프레임 간격으로.
- **색을 잴 때**(키프레임 대조·밝기)는 bt709 tv 범위를 밝혀 풀어야 RGB가 회색(Y)과 맞는다: `-vf "scale=in_range=tv:in_color_matrix=bt709:flags=accurate_rnd+full_chroma_int+bitexact"`(flags까지 붙여야 맞는다). 기본 디코드는 RGB가 약 2.3 어둡게 나온다. '렌더가 어두워진다'고 본 것도 대부분 이 디코드 차이였다(밝혀 풀면 렌더 인코딩 차는 ±0.7 안). 그러니 색을 미리 밝히지 말고 먼저 이렇게 재 본다. 밝히기를 넣더라도 순수 검정(0) 장면에는 걸지 않는다.

## 6. 영상·정지 화면 재료
- 영상 재료를 `<video data-start>`로 넣을 때 시작 시각은 (시작 프레임 − 0.5) ÷ fps로 적는다. 아니면 1프레임 늦는다.
- `<video>`를 잘라 보이려면 타이밍 없는 감싸개(`overflow: hidden`) 안에 넣는다(타이밍 있는 요소 안은 lint 오류). 넘침 표시에는 `data-layout-allow-overflow`.
- 영상이 끝나고 같은 프레임의 정지 화면이 이어지면 그 자리에서 밝기가 한 번 떨어질 수 있다. 정지 화면을 ffmpeg로 바로 뽑지 않는다 — ffmpeg PNG에 붙는 색 표시(cICP·gAMA) 때문에 브라우저가 더 어둡게 그린다. 렌더본에서 그 프레임을 잘라 재고, 색 표시 없이(Pillow) 저장해 다시 렌더한다. 이음새는 렌더본으로 잰다: 이웃 프레임 평균 차 0.5단계 이하.
- 재료 속 그림이 정지 사진이 아니라 움직이는 영상일 수 있다(프레임 차로 확인). 그때는 프레임별 그림 띠로 쓴다.
