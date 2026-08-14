# 큐레이션 입력 데이터

이 폴더는 **사람이 채우는** 입력이다. 빌드 스크립트가 검증해서 `public/data/` 로 내보낸다.

## frozen-season.source.json (M5 동결 시즌 구축)

왜 자동 수집이 아닌가: 설계 문서 6절은 각 구축 항목에 **원문 출처 링크**를 강제한다.
그런데 대상 사이트들(champs.pokedb.tokyo, 구축 기사 호스트)은 2026-08 확인 시점에
자동 요청에 403 을 돌려준다. 크롤링을 우회하는 대신, 사람이 읽고 옮긴 내용을
출처와 함께 여기에 적는 방식을 택했다.

비어 있으면 M5 화면은 "출처가 확인된 동결 시즌 구축이 아직 없습니다" 로 정상 degrade 한다.
나머지 기능(M1~M4, M6)에는 아무 영향이 없다.

### 스키마

```jsonc
[
  {
    "id": "m4-singles-balance",         // 고유 문자열. 생략하면 자동 생성
    "title": "M4 싱글 밸런스 구축",       // 필수
    "season": "M4",                     // 시즌 라벨
    "format": "Singles",                // "Singles" | "Doubles"
    "pokemon": ["Garchomp", "Mimikyu"], // Champions 표시명 또는 savedName
    "items": ["Focus Sash"],
    "moves": ["Earthquake"],
    "note": "짧은 설명",
    "sourceUrl": "https://example.com/article",  // 필수. 없으면 항목이 버려진다
    "sourceLabel": "note.com — 작성자명",
    "translated": true                  // 번역본이면 true → UI 에 "참고용 번역" 라벨
  }
]
```

### 규칙 (스크립트가 강제한다)

- `sourceUrl` 없는 항목은 **버려진다.** 출처 없는 구축은 표시하지 않는다.
- `x.com` / `twitter.com` / `youtube.com` / `youtu.be` 호스트는 **버려진다.**
  설계 문서 M5 의 "X/YouTube 링크는 본문 탑재 제외" 규칙.
- `pokemon` 에 적은 이름은 Champions 로스터와 대조된다. 못 찾으면 경고만 내고
  링크 없는 칩으로 표시된다(오타 조기 발견용).

반영: `npm run data:builds`
