# Pokémon Champions 메타·통계 앱

공개 집계 통계를 보여주는 **메타 뷰어**. 개인 계정 전적은 다루지 않는다 (설계 문서 0절).

Vite + TypeScript, 프레임워크 없음. 표시 언어는 한국어 단일이고, **검색은 한/일/영 모두** 걸린다.

Node 서버를 상시 띄우는 배포를 전제로 한다. 서버가 있으면 **새 데이터가 생길 때 재배포 없이 화면에 붙는다.**

---

## 빠른 시작

```bash
npm install
npm run data      # 빌드타임 데이터 초기 생성 (최초 1회)
npm run dev
```

### 프로덕션

```bash
npm run build
npm run serve     # http://localhost:5173
```

---

## 실시간 데이터 반영

이 앱의 기능 가용 여부는 빌드타임 flag 가 아니라 **서버의 `/api/config` 응답**이 결정한다.
클라이언트는 60초마다 이 응답을 확인하고, 버전이 바뀌면 화면을 다시 그린다.
데이터 URL 에 버전이 실려 있어 캐시는 자연히 비켜간다 — 별도 퍼지 로직이 없다.

반영 경로는 세 가지다.

| 무엇이 생기면 | 어떻게 반영되나 | 필요한 조치 |
|---|---|---|
| **M5 구축 자료** | `data/frozen-season.source.json` 을 고치면 다음 요청이 바로 읽는다 | 없음 (서버 재시작 불필요) |
| **Smogon 새 달 통계** | 서버가 6시간 주기로 확인해 새 달·새 규정이 보이면 카운터를 재생성 | 없음 |
| **M6 랭킹 URL** | 환경변수를 설정하고 서버를 재시작하면 랭킹 탭이 자동으로 나타난다 | 서버 재시작 |

재생성된 카운터는 `var/data/` 에 쓴다. `dist/` 를 건드리지 않으므로 다음 배포가 덮어쓰지 않는다.
읽을 때는 `var/data` → `dist/data` → `public/data` 순으로 폴백한다.

서버 없이 정적 호스팅에 올려도 M1~M5 는 동작한다 (`/api/config` 가 없으면 번들 동봉 파일을 쓴다).
다만 위의 자동 반영은 서버가 있어야 한다.

### M5 구축 자료 추가하기

`data/frozen-season.source.json` 에 항목을 적으면 끝이다. 스키마는 [data/README.md](data/README.md) 참고.

서버가 설계 문서 6절 규칙을 요청 시점에 강제한다:
- `sourceUrl` 없는 항목은 **버려진다.**
- `x.com` / `twitter.com` / `youtube.com` / `youtu.be` 링크는 **버려진다.**
- 편집 중 JSON 이 깨져도 직전 성공본을 계속 서빙한다 (화면이 비지 않는다).

### M6 트레이너 랭킹 켜기

```bash
CHAMPIONS_RANKING_ENABLED=1 \
CHAMPIONS_RANKING_URL=https://.../ranking.json \
npm run serve
```

빌드 flag 는 필요 없다 — 서버가 켜졌다고 알리면 클라이언트가 탭을 띄운다.
URL 을 코드에 박아두지 않은 이유는 [DEVIATIONS.md](DEVIATIONS.md) 9절 참고.

클라이언트는 공식 도메인을 **직접 호출하지 않는다.** 항상 `/api/ranking` 만 부르고,
서버가 30분 TTL 캐시 + 지수 백오프 + stale 유지를 담당한다.

---

## 스크립트

| 명령 | 하는 일 |
|---|---|
| `npm run dev` | 개발 서버 (프로덕션과 동일한 `/api` 핸들러 포함) |
| `npm run build` | 타입체크 후 프로덕션 번들 |
| `npm run serve` | `dist/` 서빙 + `/api/*` 런타임 데이터 계층 |
| `npm run data` | 아래 3개를 순서대로 실행 |
| `npm run data:locales` | PokéAPI → `public/data/locales.json` (한/일 명칭) |
| `npm run data:moves` | PokéAPI → `public/data/moves.json` (기술 한국어명·제원·설명·정밀 효과) |
| `npm run data:terms` | PokéAPI → `public/data/terms.json` (타입·도구·특성·성격 한국어명) |
| `npm run data:counters` | Smogon chaos → `public/data/counters-*.json` (C&C) |
| `npm run data:builds` | 큐레이션 입력 검증 → `public/data/builds.json` (정적 폴백용) |
| `npm run test` | vitest (이름 매칭 · 어댑터 · 서버 · 렌더 스모크) |

`data:*` 는 `.cache/` 에 원본을 캐시하므로 재실행이 빠르다. 신선한 데이터를 원하면 `.cache/` 를 지운다.

### 왜 빌드타임 데이터도 함께 두는가

Smogon chaos JSON 은 한 달치가 싱글 4MB / 더블 18MB 다. 클라이언트에 그대로 보낼 수 없어
C&C 만 뽑고 폼 이름을 Champions 표기로 매칭해 압축한다 (309KB / 656KB).
PokéAPI 도 236종을 런타임에 조회하면 레이트리밋에 걸린다.

빌드 산출물은 **초기값이자 정적 배포용 폴백**이고, 이후 갱신은 서버가 맡는다.
추출 로직은 `scripts/lib/counters.mjs` 하나뿐이라 CLI 결과와 서버 자동 갱신 결과가 갈라지지 않는다.

---

## 구조

```
src/
  adapters/          소스별 격리 계층. 서로를 모른다.
    appConfig.ts             런타임 기능 감지 (/api/config) + 버전 붙은 데이터 URL
    championsBattleData.ts   A · 인덱스, 사용률, 실수치, 타입, 스프라이트  (1차 소스)
    pokeApi.ts               A · 한/일 포켓몬 명칭 (종족값은 절대 안 가져온다)
    moveDex.ts               A · 기술 한국어명 + 위력/PP/명중률 + 게임 내 설명
    termDex.ts               A · 타입·도구·특성·성격 한국어명
    smogonCounters.ts        A · Checks & Counters
    showdownLearnset.ts      A · learnset (인덱스에 동봉된 값을 가공)
    frozenSeason.ts          B · 동결 시즌 구축 (출처 없으면 버린다)
    officialRanking.ts       C · 트레이너 랭킹 (서버 경유, 런타임 감지)
  core/
    http.ts            타임아웃 + TTL 캐시 + stale-while-revalidate
    names.ts           shared/names.mjs 재수출
    stats.ts           실수치 ↔ 종족값 환산 (아래 참고)
    typechart.ts       타입 상성표
    damage.ts          본가 대미지 공식 + 난수 분포 합성으로 확정/난수 판정
    abilities.ts       대미지에 관여하는 특성 (위력 단계 / 최종 단계를 구분한다)
    items.ts           대미지에 관여하는 도구 — Champions 에 실재하는 것만
    megaStones.ts      메가 폼 ↔ 메가스톤 (이름으로 잇고 전수 테스트로 확인)
    moveTraits.ts      광역 범위·접촉·펀치·소리 표기
    variablePower.ts   상황에 따라 위력·타입이 바뀌는 기술
    moveEffect.ts      "크게 올린다" 같은 모호한 설명을 랭크·확률 수치로
    dom.ts             최소 DOM 헬퍼
  views/               화면
  store.ts             인덱스·로케일·포맷 상태 + config 폴링
  router.ts            해시 라우터
shared/names.mjs       이름 정규화 — 빌드 스크립트와 앱이 공유
scripts/lib/counters.mjs  Smogon 추출 — CLI 와 서버가 공유
server/
  api.mjs                  /api/* 라우터 (dev·prod 공용)
  builds-service.mjs       M5 큐레이션 파일 라이브 읽기 + 규칙 검증
  counters-service.mjs     Smogon 월간 자동 갱신
  ranking-service.mjs      M6 프록시 + 캐시 + 백오프
  index.mjs                프로덕션 정적 서버
data/                  사람이 채우는 큐레이션 입력
```

### 설계 원칙 세 가지

**어댑터 하나가 죽어도 앱은 산다.** 카운터 소스가 실패하면 카운터 탭만 "데이터 없음"이 되고
나머지는 정상 동작한다. 로케일이 실패하면 영문 검색으로 열화한다. 서버가 없으면 정적 파일로 폴백한다.
인덱스(1차 소스)만 전면 안내를 띄운다. 이 동작들은 `test/render.test.ts` 로 고정돼 있다.

**같은 규칙은 한 번만 쓴다.** 이름 매칭은 `shared/names.mjs`, Smogon 추출은 `scripts/lib/counters.mjs`,
구축 검증은 `server/builds-service.mjs` 하나씩만 존재한다. 규칙이 갈라지면 "수동 생성 결과 ≠ 자동 갱신 결과"
같은 추적 불가능한 사고가 난다.

**가용 여부는 런타임이 정한다.** 빌드타임 flag 로 기능을 켜고 끄면 데이터가 생겨도 재배포해야 붙는다.

**입력 하나에 화면 전체를 다시 그리지 않는다.** 계산기는 폼을 한 번만 짓고 이후에는
결과만 다시 계산한다(`recalc`). 폼 자체를 새로 만드는 건 포켓몬·폼 교체, 그리고 특성이 바뀌어
조건부 입력이 붙고 빠질 때뿐이다(`refreshSide` / `refreshField`). 전체 재렌더는 스크롤과 포커스를
날려서 슬라이더를 끄는 동안 화면이 계속 새로고침되는 것처럼 보인다.

### 이름 매칭이 왜 어려운가

Smogon 과 Champions 가 폼 이름을 다르게 적는다.

```
Gyarados-Mega    →  Mega Gyarados
Ninetales-Alola  →  Alolan Ninetales
Gourgeist-Large  →  Gourgeist Large Variety
Aegislash        →  Aegislash Shield Forme
```

하드코딩된 1:1 표 대신 **정렬 토큰 키**로 맞춘다. `{Gyarados, Mega}` 와 `{Mega, Gyarados}` 는
정렬하면 같아진다. 여기에 지역폼 어미 통일(`alolan`→`alola`)과 분류 명사 제거
(`Variety`/`Trim`/`Pattern`/`Forme`)를 얹고, 그래도 남는 11건만 `ALIASES` 에 명시했다.

현재 **미매칭 0건** (싱글 303종 / 더블 301종). 빌드 스크립트와 서버 자동 갱신이 미매칭을 항상
보고하므로 상류 데이터가 바뀌면 바로 드러난다.

---

## 수치에 대해 — 종족값이 아니다

championsbattledata 가 주는 `hp`/`attack`/... 은 종족값이 아니라
**레벨 50 · 개체값 31 · 노력치 0 · 무보정 성격 기준 실수치**다.

본가 공식에 그 조건을 넣으면 floor 가 깔끔히 떨어져 상수 덧셈이 된다:

```
실수치 = 종족값 + 20      (HP 만 종족값 + 75)
```

한카리아스 공격 130 → 150, HP 108 → 183. 실수치 합 775 ↔ 본가 종족값 합 600.

역환산이 손실 없이 정확하므로 화면에는 **둘 다** 보여준다. 공식과 근거는
[src/core/stats.ts](src/core/stats.ts) 에, 검증은 [test/stats.test.ts](test/stats.test.ts) 에 있다.

---

## 언어

화면 표시는 **한국어 단일**이다. 한국어 명칭이 없으면 영문으로 폴백한다.

검색은 다국어를 유지한다 — "한카리아스" / "garchomp" / "ガブリアス" 가 모두 같은 결과를 낸다
(설계 문서 M1 완료 기준). 폼 수식어 없는 종 명칭으로도 걸린다: "나인테일" → 알로라 나인테일.

---

## 법적 고지

앱의 모든 화면 푸터와 `/sources` 라우트에 상시 노출된다.

> Pokémon and all respective names are Trademark and © of Nintendo 1996–2026,
> Creatures Inc. and GAME FREAK inc.
>
> This site is not affiliated with or endorsed by Nintendo, The Pokémon Company,
> or GAME FREAK inc.

Smogon 데이터를 보여주는 자리에는 "Showdown 래더 통계이며 Switch 랭크전과 다르다"는
경고가 항상 함께 나온다.

---

## 참고 문서

- [DEVIATIONS.md](DEVIATIONS.md) — 설계 문서 대비 변경점과 근거 (실응답 검증 결과)
- [data/README.md](data/README.md) — M5 큐레이션 입력 스키마
