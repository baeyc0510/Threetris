# 인수인계 (원격 세션 → 로컬 세션)

## 목표
3D 테트리스(Threetris)의 **조작감 개선**. 사용자가 지적한 문제: (1) 이동 방향이 헷갈림, (2) 회전이 헷갈림.

## 이미 완료된 변경 (patch로 제공됨: `control-feel.patch`)
`src/input/Input.ts`, `src/ui/UI.ts` 두 파일 수정. 내용:

1. **회전을 카메라 상대로 변경** (핵심)
   - 기존: W→rotate("x"), A→rotate("y"), S→rotate("z",1), D→rotate("z",-1). 보드 고정축이라 카메라를 Q/E로 돌리면 같은 키가 화면상 다른 방향으로 회전 → 예측 불가. 게다가 S/D가 둘 다 z축(중복).
   - 변경: **W/S = 화면 기준 앞뒤로 눕히기**(카메라-오른쪽 축 기준, yaw를 90°로 스냅해서 결정), **A/D = 수직축 좌/우 회전**(시점 무관). `Input.ts`에 `boardAxes()`, `tumble()` 헬퍼 추가.

2. **이동 매핑 안정화**
   - `mapToBoard`가 카메라 yaw를 가장 가까운 90°로 스냅한 뒤 축 결정 → 네 방향키가 항상 4개의 서로 다른 보드 축으로 매핑. (기존은 45° 코너에서 부동소수점 tie-break에 의존하던 불안정 매핑.)

3. `UI.ts` CONTROLS 패널 문구: 회전 → "눕히기 W/S · 좌우 회전 A/D".

검증: `npm run typecheck`, `npm run build` 통과. 원격에서 실제 구동 + 입력 테스트 에러 없음.

## 아직 미결정 (사용자 선택 대기)
코너(다이아몬드◇ = 기본 카메라) 시점에서는 보드 축이 화면과 45° 틀어져 있어, 방향키를 누르면 블록이 **화면상 대각선**으로 움직인다. 이건 코너 시점의 구조적 특성이라 위 매핑 변경으로도 안 없어짐. 해결 옵션 셋 중 사용자 결정 필요:
1. **기본 카메라를 Face 모드로** (추천) — `CameraRig.ts`의 `private mode: CameraMode = "corner"` → `"face"`, 또는 기본 설정/`storage.ts` 기본값 조정. 판이 화면과 나란해져 방향키가 화면 상하좌우와 일치.
2. **코너 유지 + 화면에 방향 나침반(compass) HUD 추가** — 각 방향키가 어디로 가는지 실시간 표시.
3. **회전 개선만 하고 이동은 현 상태 유지.**

## 코드 요점 (참고)
- 로직 좌표: x,y = 수평, **z = 수직(위)**. 낙하는 z 감소.
- 회전 `rotateCell(axis,dir)`: dir=+1은 +축을 내려다볼 때 CCW. x=y-z평면, y=z-x평면, z=x-y평면.
- 카메라: `CameraRig`가 Q/E로 yaw 90° 스냅. 코너=yaw offset π/4, Face=0. `getYaw()`로 현재 yaw 제공.

## 남은 작업 (로컬 세션이 할 것)
1. (선택 반영) 위 1/2/3 중 사용자가 고른 이동 개선 구현.
2. `control-feel.patch`가 아직 적용 안 됐으면: 리포 루트에서 `git apply control-feel.patch`.
3. `npm run typecheck && npm run build` 통과 확인, 실제 구동 테스트.
4. 스테이지 → 커밋 → 푸시. (로컬 자격증명이면 push 가능; 원격 세션은 kosse03 통합 토큰이라 baeyc0510 레포에 403이었음.)
5. CLAUDE.md 절차: SOURCE_MAP.md 갱신(source-map-reconciler 스킬), save-chat-log 스킬, WORKSPACE_STATUS.md 기록 후 push.
