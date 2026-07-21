# TETRIS 3D

브라우저에서 즐기는 3D 테트리스. 조각이 3D 우물(기본 5×5×20)로 떨어지고, **수평층 하나가 꽉 차면 그 층이 사라진다.** 신스웨이브 네온 스타일.

Vite + TypeScript + Three.js.

## 실행

```bash
npm install
npm run dev
```

## 조작

| 동작 | 키 |
|---|---|
| 이동 | 방향키 |
| 눕히기 | W / S |
| 좌우 회전 | A / D |
| 카메라 회전 | Q / E |
| 하드 드롭 | Space |
| 소프트 드롭 | Shift |
| 홀드 | C |
| 일시정지 | P / Esc |
| 재시작 | R |

이동과 회전은 모두 카메라 기준이다. 기본 카메라는 Face 뷰라 방향키가 화면 상하좌우와 일치하고, HUD의 COMPASS 패널이 현재 시점에서 각 방향키가 향하는 화면 방향을 보여준다. Corner 뷰는 SETTINGS에서 선택할 수 있다.

## 빌드

```bash
npm run build     # 타입체크 + 프로덕션 빌드 (dist/)
npm run preview   # 빌드 결과 미리보기
```

자세한 설계는 [3D_Tetris_GDD.md](3D_Tetris_GDD.md) 참고.
