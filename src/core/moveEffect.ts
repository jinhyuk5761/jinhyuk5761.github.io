/**
 * 게임 내 설명의 모호한 표현을 숫자로 바꾼다.
 *
 * 공식 텍스트는 "공격을 크게 올린다" / "때때로 마비시킨다" 처럼 정도를 말로 쓴다.
 * PokéAPI 는 같은 내용을 숫자로 갖고 있으므로(stat_changes, ailment_chance …)
 * 그걸로 "공격 +2랭크" / "10% 확률로 마비" 같은 줄을 만든다.
 *
 * 원칙: **없는 값은 만들지 않는다.**
 * 배북(+6)이나 역린의 지속턴처럼 PokéAPI 에 구조화되지 않은 정보가 있다.
 * 그런 건 이 함수가 침묵하고, 공식 설명 문장이 그대로 그 역할을 한다.
 */

import type { MoveInfo } from '../adapters/moveDex';

const STAT_KO: Record<string, string> = {
  attack: '공격',
  defense: '방어',
  'special-attack': '특수공격',
  'special-defense': '특수방어',
  speed: '스피드',
  accuracy: '명중률',
  evasion: '회피율',
};

/**
 * 상태이상 한국어 명칭.
 *
 * PokéAPI 의 move-ailment 는 **한국어 이름을 제공하지 않는다**(22종 전부 없음).
 * 그래서 이 표만은 손으로 관리한다 — 국내 정식 명칭 기준이다.
 * 여기 없는 값이 오면 원문 slug 를 그대로 내보낸다(잘못 옮기느니 영문이 낫다).
 */
const AILMENT_KO: Record<string, string> = {
  paralysis: '마비',
  sleep: '잠듦',
  freeze: '얼음',
  burn: '화상',
  poison: '독',
  'bad-poison': '맹독',
  confusion: '혼란',
  infatuation: '헤롱헤롱',
  trap: '바인드',
  nightmare: '악몽',
  torment: '트집',
  disable: '사슬묶기',
  yawn: '하품',
  'heal-block': '회복봉인',
  'leech-seed': '씨뿌리기',
  embargo: '잠금',
  'perish-song': '멸망의노래',
  ingrain: '뿌리박기',
  'tar-shot': '타르샷',
  'no-type-immunity': '타입 무효 해제',
};

/** 랭크 변화 한 줄. 예: "공격 +2랭크", "방어 −1랭크 · 특수방어 −1랭크" */
function statChangeText(changes: [string, number][]): string {
  return changes
    .map(([stat, change]) => {
      const label = STAT_KO[stat] ?? stat;
      // 음수 부호는 하이픈이 아니라 마이너스 기호를 쓴다(숫자와 붙었을 때 읽기 쉽다).
      const sign = change > 0 ? '+' : '−';
      return `${label} ${sign}${Math.abs(change)}랭크`;
    })
    .join(' · ');
}

/**
 * 기술의 정밀 효과 줄 목록. 보여줄 게 없으면 빈 배열.
 */
export function moveEffectLines(move: MoveInfo): string[] {
  const lines: string[] = [];

  if (move.statChanges.length > 0) {
    const text = statChangeText(move.statChanges);
    // statChance 가 0 이거나 100 이면 확정이다. 그 사이 값일 때만 확률로 적는다.
    lines.push(
      move.statChance > 0 && move.statChance < 100
        ? `${move.statChance}% 확률로 ${text}`
        : text,
    );
  }

  if (move.ailment) {
    const label = AILMENT_KO[move.ailment] ?? move.ailment;
    lines.push(
      move.ailmentChance > 0 && move.ailmentChance < 100
        ? `${move.ailmentChance}% 확률로 ${label}`
        : `${label} 상태로 만든다`,
    );
  }

  if (move.flinchChance > 0) {
    // flinch 의 국내 정식 명칭은 '풀죽음' 이다.
    lines.push(`${move.flinchChance}% 확률로 풀죽음`);
  }

  if (move.critRate > 0) {
    lines.push(`급소율 +${move.critRate}단계`);
  }

  if (move.drain > 0) {
    lines.push(`입힌 데미지의 ${move.drain}% 회복`);
  } else if (move.drain < 0) {
    lines.push(`입힌 데미지의 ${Math.abs(move.drain)}% 반동`);
  }

  if (move.healing > 0) {
    lines.push(`최대 HP의 ${move.healing}% 회복`);
  }

  if (move.hits) {
    const [min, max] = move.hits;
    lines.push(min === max ? `${min}회 연속 공격` : `${min}~${max}회 연속 공격`);
  }

  if (move.turns) {
    const [min, max] = move.turns;
    lines.push(min === max ? `${min}턴 지속` : `${min}~${max}턴 지속`);
  }

  return lines;
}
