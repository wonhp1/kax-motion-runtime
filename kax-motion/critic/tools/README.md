# critic/tools — 비평 측정 도구

결과 영상을 재서 **숫자와 그림만 낸다. 판정은 비평가가 한다**(판정 규칙은 `critic/critic.md`).
필요한 것: python3(numpy·scipy·Pillow), ffmpeg/ffprobe. 무거운 계산은 스레드 2개(`OMP_NUM_THREADS=2`, ffmpeg `-threads 2`).
FFmpeg 5.1 이상이면 프레임을 그대로 뽑는 옵션으로 `-fps_mode passthrough`를 쓰고, 그보다 옛 판에서만 `-vsync 0`을 쓴다(FFmpeg 9에는 `-vsync`가 없다). `texture/measure_texture.py`도 같다.
도구는 작업 폴더(영상 프로젝트 뿌리)에서 `python3 -I <스킬>/critic/tools/…`로 부른다.

| 파일 | 하는 일 | 관문·항목 |
|---|---|---|
| `measure_motion.py` | `--pace` `--text` `--sync` `--entries` `--contact` `--margins` `--sfx` (`--all`) → `measure.json` + 그림 | G1·G2·G3, Q3·Q5·Q8 근거 |
| `pair_board.py` | 결과 프레임 ↔ 기준 그림 같은 높이 나란히 판(+ 360px 줄). `--scale` = 15%·40% 안내선 + 주인공 높이(추정)·단계 | 맞대기, R11(짝의 화면 크기) |
| `panel.py` | 비평가 2~3명의 `critic.json`을 패널 규칙대로 묶음 → `panel.json`·`panel.md` | 판정 절차 |
| `fix_gate.py` | 다시 판정받기 전 확인 관문: 앞 패널의 고칠 것 → `review/fix_r<n>/고칠것.md` 표(`init`), 같은 프레임 전·후 띠(`strip`), 다 채웠는지 확인(`check`, 끝 코드 0/1) | 판정 사이 고침 |
| `exemplar_board.py` | 채점 예시 표(`exemplars.json`) 점수 채우기 + 판 그림 | 채점 예시 |

## 기본 자리 (`kax_paths.json`)

도구가 기본으로 찾는 자리는 스킬 뿌리의 `kax_paths.json`에 있다(인자로 주면 그것이 먼저).

| 칸 | 공개 기본(작업 폴더 기준) | 쓰는 도구 |
|---|---|---|
| `refs` | `review/refs/` — `get_critic_refs`로 받은 기준 그림 `<id>.webp`(또는 `.png`)와 그 목록 `anchors.json` | `pair_board.py`(`--anchors`), `panel.py`(기준 그림 id 확인), `measure_motion.py --contact`·`texture/measure_texture.py`(짝 그림 빈 면), `typography/tools/specimen.py` |
| `exemplars` · `exemplars_spec` | `review/refs/exemplars/`(판 그림 `<id>.png`) · `review/refs/exemplars/exemplars.json` | `exemplar_board.py` |

`anchors.json` 꼴: `{"types": {"<유형>": {"desc": "…", "count": n}}, "anchors": [{"id", "type", "type_desc", "q": ["Q1", …], "why", "motion", "file"}]}` — `get_critic_refs` 결과의 `anchors` 칸에 그림 파일 이름(`file`)을 더해 적는다.

## measure_motion.py

```bash
python3 -I <스킬>/critic/tools/measure_motion.py out/final.mp4 --out review/measure \
    --shots storyboard/shots.json [--events audio/events.json] --all     # --all = 일곱 가지 전부
```
같은 `--out`에 따로 돌리면 `measure.json`에 항목별로 합쳐진다(같은 영상일 때).

판정에 쓰는 기본 키와, 정의가 바뀌기 전 값을 남긴 꼬리표 키:

| 무엇 | 기본 키 | 예전 정의 키 |
|---|---|---|
| `--pace` 정지 | `static_runs_s`·`static_ratio`·`static_longest_s` = 8×8 칸 **어디도** 안 바뀜 | `static_runs_s_mean`·`static_ratio_mean`·`static_longest_s_mean` (화면 평균 차 < 0.35) |
| `--text` | 한글 음절 묶기 + 큰 글자(화면 높이 50%까지) | `n_lines_v04`·`n_lines_under20_v04`·`largest_cap_1920_v04` |
| `--sync` 계획 모드 | `audio_on_visual_*` = 솟음, 착지 계열 사건은 착지(급감)도 | `audio_on_visual_*_rise`, 줄마다 `audio_vs_rise_frames` |
| `measure_texture.py --temporal` | `flick_*` = 프레임마다 마스크, 두 프레임 합집합 제외 | `flick_*_f0mask` |
| 빈 면 | `empty_diff_vs_anchor`(+ 더 빔 / − 더 참), `empty_side` (`--contact`, `measure_texture.py --anchor/--shots`) | `empty`는 그대로 |
| `panel.py` | `need_third` = 3번째가 결과를 바꿀 수 있을 때만 | `need_third_rule`(셋째 비평가 조건만) |

### --pace (G1)
- 움직임: 30fps로 맞춘 128px 회색 프레임 평균 차(0~255). `first_move_s`(차 > 0.35 첫 프레임), `first_content_s`(윤곽 픽셀 0.05% 넘는 첫 프레임 — '빈 화면이 아닌 첫 순간'일 뿐, 첫 글자·주인공인지는 눈으로), `first_1s_motion`, `motion_mean`·`motion_by_second`, `bg_changes`(가장자리 띠 색이 바뀐 횟수).
- **정지** = '화면 어디도 안 바뀜'. 320px 회색(원래 fps)을 8×8 칸으로 나눠 칸마다 프레임 차 평균을 내고(`--sync`와 같은 값), **그 최댓값이 0.10 미만**인 프레임이 0.4초 이상 이어진 구간 → `static_runs_s`, `static_ratio`(그 합 ÷ 길이), `static_longest_s`(E7 '1초 넘는 정지'는 이것으로 본다). 화면 평균 차 < 0.35로 잰 예전 정의는 `static_runs_s_mean`·`static_ratio_mean`·`static_longest_s_mean`(참고 영상 중앙값 약 0.13은 이 예전 정의 값).
  - 왜 칸 최댓값인가: 화면 전체 평균이면 끝 카드의 느린 흐름(1.00→1.02)이나 절제된 UI 화면의 작은 움직임(작은 글자 튐, 막대 숨쉬기)이 정지로 잡히고, 그 값을 넘기려 화면 전체를 2~4px/프레임 미는 일이 생긴다.
  - 문턱 0.10의 근거(칸 평균 차, 0~255): 같은 프레임을 반복해 x264 crf18로 만든 3.5초 = 칸 최댓값 0.013 이하(인코딩 잡음). 실제 렌더의 바탕 칸(결 포함) = 0.00~0.05. 1.00→1.02/3.5초 흐름 = 0.20~0.45, 1.00→1.01/3.5초 = 0.11~0.27, 밝은 바탕 위 20px 점이 1px/프레임 = 0.125. 잡음 최댓값의 2배 위, 가장 느린 흐름의 아래에 둔다.
  - 참고 `slow_runs_s`: 칸 최댓값 < 0.5(아주 느린 흐름·숨쉬기만 있는 구간). 정지가 아니므로 E7에 쓰지 않는다.
  - 한계: 결이 깜빡이면(flick 0.3 넘음) 바탕 칸이 0.1을 넘어 정지가 안 잡힐 수 있다(그건 G4 결함이라 `--temporal`로 따로 본다). 아주 작은 요소(1920 폭 10px 미만)가 아주 느리게(0.5px/프레임 미만) 움직이면 정지로 나올 수 있다.
- 컷: 270px 회색 차 > 1.0 이고 앞뒤 3프레임 중앙값의 4배 → `cuts_detected`, `cut_gaps_frames`, 평균·최소·최대 간격, `--shots`가 있으면 계획 컷 적중(±1).
- 한계: 글리치·번쩍임·1프레임 줌도 컷으로 잡혀 컷 간격이 짧게 나온다(계획 10컷에 검출 26개가 나온 일이 있다). 서서히 바뀌는 디졸브·모프 컷은 못 잡는다.

### --text (G2 근거)
- 프레임마다: 바탕(16배 줄인 그림의 화면 높이 20% 창 중앙값)과 RGB 최대 차 40 넘는 픽셀 덩어리 → 높이·채움 비율로 글자 후보 → 같은 줄(세로 50% 겹침 + 가운데 높이 근접 + 높이 비 1.8 안 + 간격 글자 높이 1.2배 안)로 묶음 → **줄의 덩어리 높이 80백분위 = 대문자 높이 추정**.
- `cap_1920` = 원본 px × 1920/영상 폭. 폰 폭 360px에 같은 크기로 보이는 1920 폭 환산이라 세로·정사각 영상도 같은 기준(28·20)으로 본다. `phone360_px`도 함께.
- 프레임: `--frames 30,120` 또는 `--shots`의 key 프레임, 없으면 1초마다. 프레임마다 `<out>/text/fNNNN.jpg` 겹침 그림(초록 ≥28, 주황 20~28, 빨강 <20, 숫자 = 줄 번호:cap_1920).
- **한글 음절 묶기**: 줄로 묶기 전에, 위아래로 쌓인 자모 조각(수 = ㅅ+ㅜ, 월 = ㅇㅝ+ㄹ, 금 = ㄱ+ㅁ)을 음절 하나로 묶는다. 조건: 가로로 좁은 쪽 폭의 30% 이상 겹침, 세로 틈 ≤ 큰 조각 높이 × 0.35, 높이 비 2.2 안, 합친 폭 ≤ 넓은 쪽 × 1.15, 합친 상자 폭/높이 0.55~1.6(틈 작은 쌍부터). 그래서 위아래 두 줄, 글자 + 밑줄 막대, 요일 + 아래 날짜 동그라미는 묶이지 않는다. 조각 2개 이상으로 된 홀로 있는 음절(요일 '월')도 줄로 친다(`single_syllable: true`).
- **큰 글자**: 덩어리 높이 상한은 화면 높이 50%. 22% 넘는 덩어리는 채움 0.15~0.75·폭/높이 0.15~3만 받아 테두리·고리(채움 적음)와 판(꽉 참)을 뺀다. 그런 줄은 `big: true`.
- 예전 방식 값: 프레임마다 `n_lines_v04`·`n_lines_under20_v04`·`largest_cap_1920_v04`.
- 한계(완벽하지 않다 — 근거 자료다):
  - 흐린 글자, 사진 위 글자, 바탕과 색 차가 작은 글자(예: 캘린더의 옅은 회색 요일)는 놓친다. 화면 높이 20%보다 큰 글자는 바탕 창(화면 높이 20%)에 안쪽이 흡수돼 획 가장자리만 잡혀 작게 나올 수 있다.
  - 줄 간격이 아주 좁은 두 줄(틈 < 글자 높이 35%)의 조각, 여러 조각으로 된 아이콘은 음절로 묶일 수 있다. 겹침 그림으로 확인.
  - 아이콘 줄·점 줄·표 선·반원 같은 도형이 줄로 잡힐 수 있다. `single_blob: true`(덩어리 하나짜리 줄)는 글로우로 붙은 단어이거나 도형일 수 있다. **장식·배경 글자, 도형 줄은 비평가가 겹침 그림을 보고 뺀다.**
  - 소문자만 있는 줄은 x높이 쪽으로 작게 나오고, 줄 간격이 좁아 위아래 줄이 붙으면 줄이 쪼개지거나 디센더까지 들어가 크게 나올 수 있다(±20~30%).
  - 한글 음절·필기체는 덩어리 높이가 대문자 높이보다 크다(한글은 em에 가까움) → 한글은 실제보다 약간 크게 나온다.
  - 그래서 28·20 경계 근처(±4px) 값은 360px 사본(`--contact`의 `phone360.png`)으로 눈 확인한다.

### --sync (G3)
- **계획 모드(`--events`, 권장)**: 효과음 계획 파일(`audio/events.json` — 사건마다 `frame` 또는 `time_s`, 또는 `k`/`type`)의 사건마다
  ① `audio_vs_plan_frames`: 계획 시각 ±45ms 창 안 소리 에너지 급등, ② `audio_vs_visual_frames`: 그 소리 시작점 ±3프레임 안의 두드러진 화면 변화 중 가장 가까운 것까지 차이. **G3에 쓰는 값은 ②의 ±1 비율**(`audio_on_visual_within_1frame`).
- **자동 모드(계획 파일 없음)**: 소리에서 강한 시작점(고역 강조 스펙트럼 플럭스 봉우리 중 두드러짐 상위 25%, `--onset-top`)을 찾아 같은 방식으로 화면 변화와 대조.
- 화면 변화 = 320px 회색을 8×8 칸으로 나눈 칸별 프레임 차의 최댓값이 앞 3프레임 평균보다 솟은 정도(작은 글자 하나가 생겨도 잡힘). 창(±3) 안 극대이면서 창 최댓값의 35% 이상인 프레임 중 가장 가까운 것.
- **착지(속도 급정지)**: 빠르게 떨어지던 글자가 멈추는 순간은 화면 변화가 솟지 않고 줄어든다. 칸마다 둘레 3×3·5×5 칸 최댓값이 **둘 다** 앞 2프레임 평균의 50% 미만으로 처음 줄어든 프레임(앞 평균 ≥ 6)을 찾고, 그 **앞 프레임**(마지막으로 크게 움직여 자리에 닿은 프레임)을 착지 후보로 둔다(`land_frames`, `sync.png`의 파랑 눈금). 5×5도 함께 줄어야 하므로 움직임이 옆 칸으로 옮겨 가는 '지나감'은 빠진다.
  - 계획 모드에서 사건이 착지·멈춤 계열이면(`type`·이름·설명에 착지/앉/멈춤/정착/닿/land/settle/stop/thud, 또는 사건에 `"visual": "land"`; 줄마다 `land_like`·`land_why`) 솟음과 착지 중 더 가까운 쪽으로 잰다(`visual_kind`). 기본 키 `audio_on_visual_*`가 이 값, 솟음만 본 값은 `audio_on_visual_*_rise`, 착지 계열만 따로 `land_like_within_1frame`(`_rise`).
  - 우연 값 `chance_audio_on_visual`도 같은 방식(착지 계열은 착지까지)으로 잰다 — 착지 후보를 더하면 우연 값도 오른다. 실제 비율을 반드시 이것과 함께 본다.
  - 한계: 튀어 오르는 착지(바로 다시 솟음)는 속도가 0이 되지 않아 급감이 약하다. 촘촘한 튐(2프레임 간격)은 앞 2프레임 평균이 섞여 놓친다. 빠른 퇴장·컷 직후도 급감으로 잡힐 수 있다(착지 계열 사건만 대조하므로 다른 사건엔 영향 없음).
- `chance_*`: 같은 시작점을 7·9·13프레임 옮겨 잰 맞음 비율(우연 수준, 보통 0.2~0.4). 옮긴 시각에서 정확히 0프레임으로 맞은 경우도 맞음으로 센다. **실제 비율이 이것보다 충분히 높을 때만 싱크 근거**다.
- `sync.png`: 위 = 화면 변화, 아래 = 소리(초록 ±1 안, 빨강 밖).
- 한계: 자동 모드는 음악 박자·잔향도 시작점으로 잡아 근거가 약하다(효과음과 음악을 나눌 수 없음). 서서히 커지는 등장(이징이 부드러운 키네틱)은 '솟는' 프레임이 없어 어긋나게 나오고, 여러 요소가 동시에 움직이면 다른 요소의 변화에 걸릴 수 있다. 정지 화면 위에 놓인 효과음은 화면 짝이 없다. 빨강 표시는 프레임을 직접 넘겨 보며 확인한다.

### --entries (Q3 근거)
- 정의: `progress` = (값−시작)/(끝−시작), `first_jump` = 첫 프레임 진행, `ratio_median` = 남은 거리의 프레임당 비율 중앙값(지수 감속이면 일정, 작을수록 빨리 섬), `overshoot_pct/px`, `arrive80_frames`, `frames_to_settle`. 퇴장(`mode: exit`)은 프레임당 이동 배율 `g_median`·`g_fit`.
- **정밀 모드 `--entry-spec spec.json`** (권장): 요소마다 상자·색·축을 준다.
  ```json
  [{"name": "샷2 입력창 진입", "f0": 45, "f1": 59, "box": [0,0,1600,1080], "color": [0,0,0], "tol": 50, "stat": "left"},
   {"name": "샷8 원 진입", "f0": 254, "f1": 269, "box": [940,400,1920,680], "color": [255,255,255], "tol": 20, "stat": "x", "start_offset": 139},
   {"name": "끝 카드 퇴장", "f0": 438, "f1": 449, "color": [255,255,255], "tol": 55, "stat": "w", "mode": "exit"}]
  ```
  `stat`: x·y(가운데), w·h, left·right·top·bottom. `color`를 빼면 상자 가장자리 색과 다른 픽셀 전체. `start`/`start_offset`: 첫 프레임에 이미 일부 와 있는 등장의 출발값(설계값).
- **자동 모드(`--shots`만)**: 샷마다 첫 24프레임, 480px에서 바탕과 다른 픽셀 전체 상자의 가장 많이 변한 축. **거칠다** — 여러 요소가 섞이고, 카메라 이동·컷 등장·정지 구간(비율 1.0)도 그대로 들어간다. 어느 샷을 정밀 측정할지 고르는 데만 쓴다.

### --contact
- `contact.png`: `--shots`의 key 프레임(없으면 `--every` 0.5초마다), 가로 6칸·세로 영상 8칸, 라벨 `#번호 f프레임 시각 s샷`.
- `phone360.png`: 같은 프레임(또는 `--phone-frames`)을 폰 폭 360px로 줄인 판. 1920 폭의 28px 대문자 = 여기서 약 5.3px.
- **빈 면 ↔ 짝 기준 그림**: 스토리보드 샷에 `anchor`가 있으면 샷 key 프레임의 `empty`(`texture/measure_texture.py`와 같은 정의)와 짝 그림(기준 그림 폴더의 `<id>.webp`)의 `anchor_empty`, **부호 있는 차 `empty_diff_vs_anchor` = 프레임 − 짝**(+ = 짝보다 더 빔, − = 더 참: 층·내용이 많음), `empty_side`(±0.10 밖이면 더 빔/더 참) → `contact.empty_vs_anchor`, 요약 `empty_out_of_band`(`more_empty`·`more_full` 샷 번호). 어느 쪽을 상한으로 막을지는 critic 문서 Q1이 정한다.

### --margins (Q5 상한)
- 6프레임마다(`--margin-step`, `--shots`가 있으면 샷 범위 안) 폭 480px로 줄여 **바탕과 다른 덩어리**의 상자를 찾는다. 바탕 추정은 `--text`와 같다(4배 줄인 그림에서 화면 높이 20% 창 중앙값, RGB 최대 차 40).
- 뺀다: ① 화면 폭·높이 85% 넘는 덩어리(전면 판, 테두리, 가로지르는 선·격자) ② 같은 줄에 늘어서 화면 폭(높이) 85% 넘게 이어진 작은 덩어리 6개 이상(파형 막대·점 줄·눈금) ③ 모서리 두 변에 닿은 작은 조각(둥근 판 바깥 귀퉁이·비네트) ④ 8px(작업 크기) 미만 잡티. 결·그레인은 줄이면서 대부분 사라진다.
- 프레임마다 네 변 여백 = 가장 가까운 상자까지 거리 ÷ 짧은 변. **5%(`--margin-thr`) 미만**인 표본이 있으면 앞뒤 표본 사이를 한 프레임씩 다시 재서, **7프레임(`--margin-min-run`) 이상** 이어진 구간만 `margin_violations`로 낸다(전환 중 6프레임 이하는 예외라는 규칙).
- 구간마다: `side`, `f0`·`f1`, `min_ratio`·`min_px`(원본 px), `min_frame`, `kind`(닿음 = 화면 밖으로 잘림·넘침 / 가까움), `box`, `boxes_under`(그 프레임에서 같은 변 기준을 어긴 상자 전부), `box_area_ratio`, 근거 그림 `<out>/margins/fNNNN.jpg`(초록 = 내용 상자, 빨강 = 어긴 상자, 회색 = 바탕·장식으로 뺀 것, 노랑 점선 = 5% 선).
- **의도한 넘침 예외**: `--shots`의 샷에 `"bleed": true`가 있으면 그 샷 안의 구간은 `margin_violations_excused`로 따로 두고 `margin_violations`(Q5 상한 판단)에서 뺀다. 구간은 bleed 샷 경계에서 끊는다(경계에 걸친 구간은 나뉘고, 나뉜 조각이 7프레임 미만이면 사라진다). `bleed_shots`에 그 샷 번호.
- 한계(솔직하게):
  - '글자·주인공'인지 모른다. 바탕과 색 차 40 넘는 덩어리는 다 내용으로 본다 → 공·도형·흐린 카드·커서 같은 소품도 잡히고, 바탕과 색 차가 작은 흐린 글자는 빠진다.
  - 화면 높이 20%보다 큰 글자·판은 안쪽이 바탕으로 흡수되어 가장자리 조각만 잡힌다(`--text`와 같은 한계).
  - 줌 통과·밀기 같은 **전환**과 **일부러 화면 밖으로 넘긴 큰 글자(블리드)**도 '닿음'으로 나온다. 화면 10% 넘는 덩어리 구간(`box_area_ratio ≥ 0.1`)은 전환·블리드일 가능성이 크다. 주요 글자·주인공인지, 전환 중인지는 근거 그림을 보고 비평가가 정하고, 뺀 것은 `other_notes`에 적는다.
  - 6프레임 간격 표본 사이에 숨은 6프레임 이하 위반은 못 본다(규칙상 예외라 괜찮다).

### --sfx (Q8 상한)
- 사건 시각: `--events`(효과음 계획, `--sync`와 같은 형식: `frame`/`k`/`time_s`)가 있으면 그것, 없으면 `--sync` 자동 시작점(`--onset-top`).
- 사건마다(t = 사건 시각):
  ① `level_dbfs` = 사건 창 [t−30ms, t+90ms](120ms) 안 20ms RMS의 최댓값(dBFS)
  ② `centroid_hz` = 그 창의 스펙트럼 중심(50Hz~16kHz). 바로 앞 200ms의 스펙트럼을 빼고 남은 몫으로 잰다(음악이 모든 사건 중심을 한쪽으로 끌지 않게). 남은 몫이 10% 미만이면 빼지 않은 값(`buried: true`). 빼지 않은 값은 `centroid_raw_hz`.
  ③ `over_bed_db` = level − 바로 앞 200ms [t−230ms, t−30ms]의 20ms RMS 20백분위(사건 사이 바탕)
  참고 값: `over_music_db` = 앞 1초에서 다른 사건 창을 뺀 '음악 바탕만' 대비 차, `masked_by` = 8dB 못 미친 사건이 **음악**에 묻혔는지 **앞 효과음**(촘촘한 사건)에 묻혔는지.
- 음색 수 `n_timbres`: 스펙트럼 중심을 로그 축에서 낮은 쪽부터 묶는다 — 묶음의 첫 값에서 1.3배(`--timbre-ratio`) 안이면 같은 음색(묶음 안 어느 두 사건도 1.3배 넘게 떨어지지 않음).
- 크기 위계 `hierarchy`: 사건 등급은 **`tier` 칸(signature / first / normal / detail)을 먼저** 읽는다. `tier`가 없을 때만 대체로 `role`·`class`·`importance` 키, 그것도 없으면 이름·설명(`what`·`note`·`id`)에 '시그니처/signature', '첫 사건/first'가 있는지 본다(사건마다 `role_source`에 어디서 읽었는지). 위계 = signature·first 중앙값 − **normal** 중앙값. detail(일부러 작게 둔 반짝·휘익)은 일반에 넣지 않는다(normal이 없을 때만 detail로). 등급이 하나도 없으면 첫 사건과 가장 큰 사건 − 나머지 중앙값.
  `tier`가 없는 계획은 설명 글로 찾으므로 등급이 틀릴 수 있다(예: 착지 사건이 normal로 들어감) — 계획에 `tier`를 붙인다.
- `q8_conditions`: Q8 ① 음색 ≥ 4 ② 시그니처·첫 사건이 일반보다 +4dB 이상(모두) ③ 바탕보다 +8dB 이상인 사건 비율 ≥ 0.8 — 각각 `ok: true/false`. `q8_cap` = **하나·둘 못 채우면 7, 셋 다 못 채우면 6**(상한 후보 — 판단은 비평가).
- 소리 없는 영상은 `has_audio: false`와 메모만 내고 끝.
- 한계: 믹스된 한 줄 소리에서 잰다 — 같은 프레임의 두 사건은 같은 값이 나오고, 음악 박자가 창에 걸리면 섞인다. 스펙트럼 중심 하나로만 나누므로 중심이 비슷한 다른 소리(톡과 딸깍)는 한 음색, 음높이만 바꾼 같은 소리는 두 음색이 될 수 있다. 촘촘한 사건(3프레임 간격)은 ③에서 앞 사건 꼬리를 바탕으로 본다(`masked_by`로 구분). 자동 모드는 음악 박자도 사건으로 잡는다. 귀로 듣는 판단을 대신하지 않는다.

### --sfx 조건 ④ 등급 순서 (R12 효과음 등급 순서)
- `tier_order`: 조건 ②와 **같은 사건 크기**(`level_dbfs` = 사건 창 [t−30ms, t+90ms]의 20ms RMS 최댓값)로 등급별 중앙값을 낸다 — `median_dbfs.detail` / `normal` / `first_signature`(first와 signature를 한 묶음), 사건 수 `n`.
  - `detail_minus_normal_db` = detail 중앙값 − normal 중앙값(0.1dB로 반올림한 중앙값끼리). **`ok` = 이 차가 −2dB 이하**(detail이 normal보다 2dB 이상 작음). `order`에 '뒤집힘(detail ≥ normal)'인지 '2dB 이상 작지 않음'인지 한 줄.
  - detail이나 normal 사건이 없으면 `ok: null`과 `why`(해당 없음). 사건에 `tier` 칸이 없거나 자동 모드(계획 없음)면 등급이 없어 늘 해당 없음이다.
  - `head_minus_normal_db` = first·signature 중앙값 − normal 중앙값(참고, 판정은 조건 ②).
  - `louder_details`: normal 중앙값 − 2dB보다 큰 detail 사건(프레임·이름·크기)과 `shares_window_with`(시작이 −120~+90ms 안에 있어 사건 창을 나눠 쓰는 다른 사건). **믹스 한 줄에서 재므로 큰 착지 1~2프레임 뒤의 작은 튐은 앞 소리 크기를 읽는다.**
  - `alone`(참고): 창을 나눠 쓰지 않는 사건만으로 낸 같은 값. `ok`와 다르면 겹친 사건 때문이니 `louder_details`를 보고 판단한다.
- `q8_v06`: ①~④의 `conditions_ok`, `failed`, `cap`(하나·둘 못 채우면 7, 셋 이상 6, ④가 null이면 세지 않음). `q8_conditions`·`q8_failed`·`q8_cap`은 ①~③만 센 값이다(덧붙이기만 함). 요약 줄에는 `tier_order`(세 중앙값·차·ok)와 `cap_v06`이 붙는다.

### scripts/master.py 등급 순서 경고 (R12)
- `--events`가 있으면 마스터 뒤(리미터 결과) 사건 크기로 등급별 중앙값을 한 줄 더 찍는다: `등급 순서(마스터 뒤, 사건 크기 중앙값): detail … · normal … · first·signature … dBFS — detail−normal …dB → 맞음/뒤집힘/차가 모자람`. `--report`에는 `tier_order.after_limiter`·`linear_gain_only`(리미터 전).
- detail 중앙값이 normal보다 **2dB 이상 작지 않으면 경고 + 종료 코드 2**(같은 사건 창·같은 기준이라 `--sfx` `tier_order`와 맞는다). 경고 글이 리미터 전에도 그랬는지(→ 믹스에서 detail을 내리거나 normal을 올림), 리미터가 뒤집었는지(→ 큰 normal 사건을 믹스에서 줄임)를 나눠 알린다. detail이나 normal이 없으면 '해당 없음'만 찍고 경고하지 않는다.
- (v0.6.4) 입력 믹스가 0 dBFS에서 잘려 있으면(전 눈금에서 같은 값이 3표본 넘게 이어짐 — 16비트 WAV에 넘친 믹스를 쓴 흔적) 경고 + 종료 코드 2. `--report`의 `input.sample_peak_dbfs`·`clipped_runs`·`clipped_samples`. 0 dBFS로 맞춘 봉우리나 float WAV의 넘침(이웃 표본 값이 다름)은 세지 않는다. 마스터 전 믹스는 봉우리 −3 dBFS 안팎(`references/sound.md` 5장).

## panel.py (판정 절차)

```bash
python3 -I <스킬>/critic/tools/panel.py review/critic_A review/critic_B [review/critic_C] --out review/panel [--shots storyboard/shots.json]
```
- 폴더마다 `critic.json`(critic 문서의 결과 양식)과 있으면 `critic.md`를 읽는다. 옛 양식의 키 차이(`pairs` / `pairing.rows`, `fixes` / `fixes_top3` / `fix_top3`, `critic` / `critic_id`, 시그니처 표시가 pairs 줄의 `signature`·`role` / `pairing.signature_first_last` / `pairs_summary.signature_shotN`, quality 안의 `min`·`mean` 칸)는 `normalize()` 하나가 맞춘다. 고칠 것이 JSON에 없으면 `critic.md`의 '고칠 것' 번호 목록을 읽는다. `cap`을 넘는 score는 cap으로 읽고 메모한다.
- 스토리보드: `--shots`, 없으면 비평 폴더 위쪽의 `storyboard/shots.json`(`<작업 폴더>/review/critic_A` 배치), 그다음 `critic.json`의 video 경로로 찾는다. 시그니처·첫·끝 샷은 스토리보드가 정한다(없으면 비평가가 적은 것의 합집합).
- 계산:
  - 품질: 항목별 점수 표, **중앙값**(2명이면 두 점수의 가운데 = 평균), 중앙값의 평균. 조건 = 중앙값 모두 7 이상 + 평균 8.0 이상.
  - 관문: 다수결. 2명이 갈리면 '갈림'(G2·G4 = C를 띄움, G1·G3·G5 = 도구 값을 다시 봄).
  - 맞대기: 같은 샷에 **2명 이상** '못하다'일 때만 못하다. 같다 이상 80% 이상 + 핵심 샷(시그니처·첫·끝)에 못하다 없음. 스토리보드에 `anchor`가 있으면 기준 그림 규칙(기준 그림이 없거나 기준 그림 폴더의 `anchors.json`에 없는 id인 샷 = 못하다)도 적용하고, 스토리보드와 다른 기준 그림을 쓴 비평가를 표시한다. anchor가 없는 스토리보드에는 이 규칙을 적용하지 않는다.
  - `need_third_rule`: **앞 두 명(A·B)** 으로 셋째 비평가 조건 4개(항목 2점 이상 차 / A·B 통과 여부 다름 — 각자 점수를 지금 규칙으로 다시 계산 / 두 명 평균 7.75~8.25 / 핵심 샷에 한 명만 못하다) + 관문 G2·G4 갈림. 비평가를 3명 이상 주면 false(이미 C가 있음)이고 A·B 기준 이유만 남긴다.
  - **`need_third`** = 위 조건이 걸리고 **3번째가 결과를 바꿀 수 있을 때만** true. 가상 3번째가 가장 좋게(모든 항목 10·관문 합격·맞대기 모두 낫다) / 가장 나쁘게(모든 항목 1·관문 불합격·맞대기 모두 못하다) 매긴 두 경우를 같은 규칙으로 묶어(`third_scenarios`), 통과 여부가 같으면 `need_third: false`, `third_cannot_change: true`, 이유 `need_third_why`(예: "모든 항목 10점을 줘도 불통과(중앙값 평균 최대 7.875)"), `status`는 그 결과(통과/불통과). 두 명이 같은 점수를 준 항목은 3번째가 와도 중앙값이 그대로라서 생기는 경우다.
  - 같은 작품인지: `critic.json`의 `video`(양식은 작업 폴더 기준 `out/final.mp4`)를 비평 폴더에서 위로 올라가며 찾아 그 영상의 작업 폴더(`out/` 위)를 정한다. 절대 경로는 그대로, 어디에도 없으면 경로 글자의 `out/` 위 폴더 이름(저장소 기준 옛 꼴). 작업 폴더 이름이 둘 이상이면 `warning`, `video`가 비었거나 영상을 못 찾으면 `video_note`("영상을 못 찾음 … 작품 비교에서 뺌") 안내만 낸다(판정에는 안 씀).
  - 고칠 것 후보: 비평가마다 '고칠 것'의 항목(Q·G 번호)을 모아 **2명 이상이 짚은 항목 먼저**, 그다음 중앙값 낮은 순. 묶어서 3개로 고르는 것은 패널을 돌리는 쪽이 한다.
- 결과: `panel.json`(전부), `panel.md`(표). `status` = 통과 / 불통과 / 보류(3번째 필요).
- 한계: 고칠 것의 항목은 글 앞머리의 Q·G 번호로만 묶는다(번호 없이 쓴 고칠 것은 '기타'). 같은 항목이라도 다른 문제를 짚었을 수 있으니 글을 읽고 묶는다(예: Q5 — 한 명은 라벨 축 정리, 다른 한 명은 라벨 위 여백).

## fix_gate.py (판정 전 확인 관문)

판정은 세 번뿐이다. 고친 것을 확인하기 전에는 다시 판정받지 않는다 — 이 도구의 `check`가 끝 코드 0일 때만 비평가를 다시 띄운다.

```bash
python3 -I <스킬>/critic/tools/fix_gate.py init review/panel --out review/fix_r1/고칠것.md        # 앞 판정 panel 폴더 → 표
python3 -I <스킬>/critic/tools/fix_gate.py strip <고치기 전 영상> --frame 104 --out review/fix_r1/f104_before.jpg
python3 -I <스킬>/critic/tools/fix_gate.py strip out/final.mp4 --frame 104 --out review/fix_r1/f104_after.jpg
python3 -I <스킬>/critic/tools/fix_gate.py check review/fix_r1/고칠것.md --video out/final.mp4   # 0 = 다시 판정 가능, 1 = 빠진 것 출력
```
- `init`: `panel.json`의 `fix_candidates`(2명 이상이 짚은 것 먼저 → 1명) + 불합격·갈린 관문 + 맞대기 최종 '못하다' 샷을 한 줄씩. 칸 = 번호·항목(Q/관문, `(2명)`·`(1명)`)·지적(비평가별 '무엇' 부분)·프레임(지적 글의 `f<번호>`, 없으면 그 항목 `quality.frames`; 맞대기 줄은 비평가가 적은 대표 프레임)·고친 방법·전 띠·후 띠·측정 전→후·상태. 표 아래에 지적 원문. 머리 주석에 앞 `panel.json` 경로·sha256·시각을 적는다. 이미 있으면 `--force`로만 덮어쓴다. 비평가 폴더는 패널 폴더 옆(`round<n>/critic_A`처럼 옮겨 둔 배치)을 먼저, 그다음 `panel.json`의 `folder`(작업 폴더 기준)로 찾는다.
- `strip`: 그 프레임 앞뒤 `--span`(기본 3) 프레임을 1프레임 간격으로 가로로 이은 띠 한 장(한 장 폭 `--width` 360). ffmpeg만 쓴다. 띠 옆에 출처 `<띠>.json`(영상 경로·sha256·수정 시각·프레임)을 함께 쓴다 — `check`가 후 띠가 어느 영상에서 나왔는지 이것으로 본다(v0.6.6). 고치기 전 영상은 다시 렌더하기 전에 `review/fix_r<n>/before.mp4`로 복사해 둔다.
- `check`가 보는 것(줄마다):
  - 상태: `확인됨`, 또는 `못 고침: <사유>`(사유 없으면 빠짐). `미룸`은 `(1명)` 줄에만. `할 것`·빈칸은 빠짐.
  - `확인됨` 줄: 고친 방법이 있고, 전 띠·후 띠 그림 파일이 실제로 있음(경로는 작업 폴더·표 폴더 기준 둘 다 찾음). 두 그림이 똑같은 파일 내용이면 빠짐, 파일 이름의 `f<번호>`가 서로 다르면 빠짐, 후 띠가 앞 `panel.json`보다 먼저 만든 파일이면 빠짐. 전·후를 한 장에 그렸으면 같은 경로를 두 칸에 적어도 된다(참고로만 알림).
  - 맞대기 '못하다' 샷 줄: 고친 방법에 `다시 짬`, 그리고 줄 어딘가에 `pair_board.py` 결과 `pair_f<프레임>__<기준 그림 id>.png`(또는 `pairs_sheet.png`) 경로가 있고 그 파일이 앞 판정 뒤에 만든 것.
  - **확인 항목(v0.6.6 — 시간 조건 대신)**: `확인됨` 줄의 후 띠는 ① `strip`으로 만든 것(옆 `.json`이 없으면 빠짐), ② 전 띠와 **다른 영상**(sha256)에서, ③ 앞 `panel.json` **뒤에 렌더된** 영상에서 나온 것, ④ `--video <다시 판정받을 영상>`을 주면 모두 **그 영상**에서 나온 것이어야 한다. `측정 전→후`에 `0.62→0.95`처럼 숫자 짝이 있으면 전·후가 모두 같을 때 빠짐(일부만 같으면 참고).
  - 표 전체: 앞 판정의 2명 이상 항목·관문·'못하다' 샷 줄이 지워지지 않았는지(머리 주석의 `panel.json`으로 다시 만들어 대조). `--min-minutes N`(예전 시간 조건, 기본 0)을 주면 앞 판정 뒤 N분이 안 지났을 때도 빠짐 — 배포판 시험 3에서 고침이 7분·5분에 끝나 기다림만 생겨, 위 확인 항목이 그 일을 맡는다(기본은 지난 시간만 알림).
  - `측정 전→후`가 빈 `확인됨` 줄은 참고로만 알린다(잴 것이 없으면 `–`).
- 한계: 그림이 있고 칸이 채워졌는지만 본다. 고친 것이 충분한지는 다음 판정의 비평가가 본다. 띠 그림의 내용(정말 그 지적을 고쳤는지)은 보지 않는다.

## exemplar_board.py (채점 예시)

```bash
python3 -I <스킬>/critic/tools/exemplar_board.py                 # 채점 예시 표(kax_paths.json exemplars_spec) 전부 다시
python3 -I <스킬>/critic/tools/exemplar_board.py --only <id>,<id>  # 쉼표로 여러 개
```
- 표의 예시마다 `sources`(비평 폴더)를 panel.py와 같은 읽기로 읽어 `scores`(여러 명 = 중앙값, 한 명 = 그 점수 + `one_critic: true`)·`per_critic`·`mean`·`verdict`를 채우고, 판 그림 `<exemplars 폴더>/<id>.png`를 그린다: 샷마다 key 프레임 한 장(★ 시그니처, 빨강 = 맞대기 못하다), 아래에 항목 점수 줄(괄호 = 비평가별로 갈린 점수)과 공통 지적.
- `common_notes`는 사람이 `critic.md`를 읽고 적는다(2명 이상이 짚은 것만, 한 명 채점이면 그 사람의 주요 지적).
- 새 영상을 판정하면 예시를 더하고 다시 돌린다. 예시에 든 영상을 다시 매길 때는 그 예시를 빼고 준다.
- 판에는 영상 프레임이 그대로 들어가니 작업 폴더 안의 기록으로만 쓴다.

## pair_board.py

```bash
python3 -I <스킬>/critic/tools/pair_board.py --list                       # 기준 그림 id·유형·Q·이유
python3 -I <스킬>/critic/tools/pair_board.py out/final.mp4 --out review/pairs --shots storyboard/shots.json \
    --pair 90=<기준 그림 id> --pair 160=<기준 그림 id> --phone --sheet
python3 -I <스킬>/critic/tools/pair_board.py out/final.mp4 --out review/pairs --frame 90 --type chat_input   # 그 유형 전부와
```
- 같은 높이(`--height`, 기본 540)로 왼쪽 결과·오른쪽 기준을 붙이고, 위에 샷 번호·크기·동작과 기준 그림의 유형·Q 항목·이유·움직임을 적는다. `--phone`은 두 그림의 폭 360px 사본 줄을 덧붙인다. `--sheet`는 모든 판을 세로로 이은 `pairs_sheet.png`.
- 정지 한 장끼리의 비교다. 움직임 곡선(Q3)·디테일 중 움직이는 것(Q4)은 `--entries` 값과 영상을 함께 본다.

### --scale (R11 짝의 화면 크기)
```bash
python3 -I <스킬>/critic/tools/pair_board.py out/final.mp4 --out review/pairs --shots storyboard/shots.json --scale \
    --pair 66=<기준 그림 id> --pair 200=<기준 그림 id>
```
- 두 그림(이번 프레임 / 기준 그림)에 **화면 높이 15%(하늘색)·40%(분홍) 안내선**을 긋는다. 주인공 상자 가운데 높이를 중심으로 위아래 점선 두 쌍(사이 간격 = 화면 높이의 15%·40%), 화면 폭 전체. 주인공 상자(노랑)가 15% 점선 안이면 wide, 40% 점선 밖으로 나가면 close.
- **주인공 높이(추정)**: 폭 480으로 줄인 그림에 `measure_motion.py`의 `content_boxes`(`--margins`와 같은 바탕 추정·RGB 차 40)를 돌려 **상자 넓이가 가장 큰 내용 상자**. `content_boxes`가 '화면 폭·높이 85% 넘음'으로 빼는 덩어리도 화면 전체 판(폭·높이 모두 95% 이상)·가는 선(짧은 쪽이 짧은 변 4% 미만)·성긴 격자/윤곽(채움 5% 미만)이 아니면 후보에 넣는다(화면을 넘치는 큰 글자·도넛). 상자끼리 **겹치면 한 물체로 합친다**(하이라이트·그림자로 갈라진 물체; 떨어져 있으면 합치지 않음 — 여유를 두고 합치면 글줄·장식 점이 붙어 단계가 이리저리 뒤집힌다). 높이 ÷ 화면 높이 → `close` ≥ 40% / `medium` 15~40% / `wide` < 15%(반올림한 값으로 단계를 정한다).
- 판: 두 그림 위 머리글에 `주인공 높이(추정) 29.3% medium`, 그림 위 노란 상자·라벨, 판 아래 한 줄 `단계 같음/단계 다름: 결과 … ↔ 기준 … · 높이 비(결과÷기준)` — **단계 다름이면 빨간 줄**. 화면 출력에도 같은 줄, `<out>/scale.json`에 쌍마다 `result`·`anchor_est`(pct·stage·box(원본 px)·src·candidates 상위 3)·`same_stage`·`height_ratio`. `pct`는 비(0~1)다(판 글자의 29.3% = 0.293).
- 스토리보드 `anchor_scale`(R11, 꼴은 `references/rules.md` R11)로 옮길 때: `anchor_est.pct` → `anchor_pct`, 쌍마다 `{frame, pct: result.pct, height_ratio, by: "tool"}` → `measured`. 노란 상자가 주인공이 아니라 눈으로 다시 쟀으면 그 줄은 `by: "eye"` + `why`.
- `--scale` 없이 부르면 안내선 없는 기본 판이다(numpy·measure_motion도 `--scale`일 때만 불러온다).
- **한계 — 추정이다:**
  - 기준 그림 30장에 돌려 눈으로 본 단계와 비교하면 23장 맞음, 4장 틀림, 3장은 무엇이 주인공인지부터 갈렸다.
    - 틀림 ① 바탕과 색 차가 작은 판(밝은 바탕 위 흰 입력창·카드·알약)은 상자로 안 잡혀 커서·아바타가 주인공이 된다(카드 대신 커서, 화면을 넘는 알약 대신 커서, 말풍선 대신 아바타).
    - 틀림 ② 한 물체가 띄어진 조각으로 갈라지면 조각 하나만 잰다(기기 전체 약 60% close → 윗부분 29.3% medium).
    - 맞은 것도 상자가 다른 물체를 잡은 것이 있다(로고 마크 대신 옆 낱자) — 단계만 같다.
  - 글자는 이어진 덩어리(낱자, 붙은 글자)마다 상자라 글자 화면은 **글자 높이**를 잰다. 그림자·빛 고리가 바탕과 40 넘게 다르면 상자에 들어가 크게 나온다(눈으로 약 15%인 알약이 그림자 포함 19.3%).
  - 3px 고리 같은 얇은 윤곽은 채움 5% 미만이라 후보에서 빠진다(끝 카드 고리 대신 안쪽 글자를 잼).
  - 노란 상자가 주인공이 아니면 점선 간격으로 눈으로 본다.
  - 주인공 높이가 15% 경계 근처를 오가는 샷(누름·받아쓰기 중 wide, 끝 무렵 그림자 포함 medium)은 어느 프레임을 고르느냐로 단계가 뒤집힌다 — 그럴 때는 단계보다 **배율**(기준의 주인공이 결과보다 몇 배 큰지, 화면 밖으로 넘치는지)을 본다.
