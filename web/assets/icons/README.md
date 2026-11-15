# 앱 아이콘 원본(SVG)

워드마크의 "반반 나뉜 원"(두 사람의 시간이 반반)을 아이콘으로 옮겼다. 색은 `src/app/globals.css` 토큰만 쓴다
(ink `#16201b`, surface `#ffffff`, platform `#eef1f0`, safety `#f5c518`).

| 파일                  | 쓰임                                       |
| --------------------- | ------------------------------------------ |
| `mark-a-platform.svg` | 시안 A: 승강장 회색 바탕                   |
| `mark-b-ink.svg`      | 시안 B: 잉크 바탕, 오른쪽 반이 안전선 노랑 |
| `mark-c-safety.svg`   | 시안 C: 안전선 노랑 바탕 (**적용**)        |

각 시안은 `<g id="mark">` 하나와 바탕 하나로 되어 있고, 생성 스크립트가 용도별로 바탕 모양과 마크 크기만 바꾼다.

- 탭 아이콘(`favicon.ico` 16·32·48, `icon.svg`): 둥근 사각형 바탕, 마크는 지름 약 70%(작은 크기에서도 알아보게 크게).
- 홈 화면(`apple-icon.png` 180, manifest `any` 192·512): 꽉 찬 사각형(iOS·안드로이드가 모서리를 자른다).
- manifest `maskable` 192·512: 꽉 찬 바탕, 마크는 안전 영역(가운데 지름 80%) 안.

다시 만들기: `pnpm gen:icons` (적용 시안을 바꾸려면 `ICON_VARIANT=a|b|c pnpm gen:icons`).
시안 비교 이미지: `pnpm gen:icons --preview` → `docs/setup/u1-screens/icon-{a,b,c}.png`.
