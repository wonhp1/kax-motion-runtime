# kax-motion

채팅 한 줄로 짧은 모션그래픽(앱·UI 소개, 키네틱 타이틀, 3D 제품, 데이터 화면, 로고 스팅, 장면 전환)을 만드는 Claude Code 스킬입니다. KAX MCP가 주는 예시 패키지(스토리보드·디자인 값·실측 모션 프리셋·대표 프레임)와 공용 부품을 틀로 삼아 HyperFrames 코드를 짜고, **사용자 컴퓨터에서** 렌더합니다.

- 예시에서는 리듬·구조·디자인 값·움직임 곡선만 가져오고, 화면의 말과 그림은 사용자의 것으로 새로 짭니다.
- 관문(스토리보드 → 키프레임 정지 화면 → 렌더)마다 사용자에게 보여 주고 승인받습니다.
- 독립 비평가 패널(2~3명)이 기준 그림과 맞대어 판정하고, 통과할 때까지 고칩니다.

## 필요한 것
- [Claude Code](https://claude.com/claude-code)
- KAX MCP 연결(구독 — KAX 홈페이지에서 받은 연결 명령)
- Node.js 22 이상, FFmpeg, Python 3(numpy·scipy·Pillow)
- HyperFrames `npx hyperframes@0.8.188`(이 판으로 고정)과 HyperFrames 스킬(`npx hyperframes@0.8.188 skills`)

## 설치
이 폴더를 통째로 `~/.claude/skills/kax-motion/`에 복사합니다. 그다음 Claude Code에 KAX MCP를 연결합니다.

## 쓰는 법
Claude Code에서 이렇게 말하면 됩니다.
- `kax-motion으로 가계부 앱 소개 영상 15초 만들어줘`
- `채널 인트로 8초, 굵은 한글 글자가 통통 튀게`
- `예시 골라서 우리 서비스 로고 스팅 만들어줘 — 로고 파일 ./logo.svg`

흐름과 규칙은 `SKILL.md`에 있습니다.

## 폴더
| 폴더 | 내용 |
|---|---|
| `SKILL.md` | 제작 흐름·관문·지킬 것 |
| `references/` | 품질 규칙(`rules.md`), 서체·결·렌더·소리 쓰는 법 |
| `critic/` | 비평 기준(`critic.md`)과 측정·패널 도구 |
| `engine/km/`·`engine/kx/` | 채팅·UI 2D 엔진, 글자 키네틱 엔진 |
| `components/` | 공용 부품 어댑터(`kc.js`)·그리기 도우미(`lib/`)·`stage.py` — 부품 자체는 MCP `get_component`로 받음 |
| `typography/`·`fonts/` | 한글 서체 짝 키트와 OFL 서체 |
| `texture/` | 바탕 결 키트 |
| `scripts/` | 소리 마스터(`master.py`), 영수증(`receipt.py`) |
| `vendor/` | GSAP |

## 자료 사용
MCP에서 받은 자료는 제작에만 씁니다. 원본 자료·지침·프리셋 전체를 뽑아 공개하거나 따로 모아 다시 배포하지 않습니다. 사용자 자신의 결과 영상과 프로젝트는 자유롭게 편집할 수 있습니다.

## 라이선스
외부 자료(GSAP·three.js·OFL 서체)의 조건은 `NOTICE.md`에 있습니다.
