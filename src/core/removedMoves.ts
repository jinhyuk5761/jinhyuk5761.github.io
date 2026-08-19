/**
 * Champions 에서 삭제된 기술.
 *
 * 상류(championsbattledata)의 학습 목록에 남아 있지만 게임에는 없는 기술이 있다.
 * 옛 세대 학습 데이터가 그대로 딸려 온 것으로 보인다 — 실제로 `Hail` 은
 * **236종 중 2종**(Mr. Rime, Sharpedo)에만 붙어 있고, 대체 기술인
 * `Snowscape`·`Chilly Reception` 은 34회 나온다.
 *
 * 상류 데이터로는 이걸 가려낼 수 없다. "학습 목록에 있다" 는 사실만 주고
 * "게임에 있다" 는 말은 하지 않기 때문이다. 그래서 도구 목록과 같은 방식으로
 * **손으로 적은 제외 목록**을 둔다 (DEVIATIONS 13절과 같은 성격).
 *
 * 없는 기술을 남겨두면 성립하지 않는 조합의 대미지를 계산하게 되고,
 * 기술 탭에서도 쓸 수 없는 기술을 뒤지게 된다.
 *
 * 키는 상류·도감이 쓰는 영문명이다. 한국어는 여기 적지 않는다 —
 * 표기는 `moves.json` 에서 온다.
 */
export const REMOVED_MOVES = new Set<string>([
  // 싸라기눈. 9세대에서 눈날씨(Snowscape)로 대체됐다.
  'Hail',
]);

/** 이 기술이 Champions 에 존재하는가. */
export function isPlayableMove(englishName: string): boolean {
  return !REMOVED_MOVES.has(englishName);
}
