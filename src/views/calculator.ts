/**
 * 대미지 계산기.
 *
 * 이 앱이 이미 갖고 있는 것들을 엮어 입력 부담을 줄이는 게 핵심이다:
 *   - 실수치: championsbattledata 가 레벨 50 실수치를 그대로 준다
 *   - 노력치·성격·특성·기술: 사용률 데이터의 상위 값을 기본으로 채운다
 *   - 기술 제원: 기술 도감의 위력·타입·분류
 *
 * **부분 갱신 원칙**: 입력을 건드릴 때 화면 전체를 다시 그리지 않는다.
 * 결과만 다시 계산해서 스크롤·포커스가 튀지 않게 한다. 폼 자체를 새로 만들어야 하는
 * 경우(포켓몬·폼 교체, 조건부 입력 등장)에만 해당 부분을 다시 그린다.
 */

import { fetchUsage } from '../adapters/championsBattleData';
import { fetchMoveDex, type MoveDex, type MoveInfo } from '../adapters/moveDex';
import { searchHaystack } from '../adapters/pokeApi';
import { abilityName, itemName, weightOf } from '../adapters/termDex';
import {
  NO_DAMAGE_EFFECT,
  UNSUPPORTED_ABILITIES,
  attackerAbility,
  defenderAbility,
  resolveAbilities,
  type AbilityContext,
} from '../core/abilities';
import { clear, el, notice } from '../core/dom';
import {
  ATTACKER_ITEMS,
  DEFENDER_ITEMS,
  UNSUPPORTED_ITEMS,
  findItem,
  itemDamageMultiplier,
  itemPowerMultiplier,
  type ItemEffect,
} from '../core/items';
import {
  MAX_STAT_POINTS,
  calculateDamage,
  effectiveHp,
  effectiveStat,
  isGrounded,
  stabMultiplier,
  terrainMultiplier,
  weatherDefenseMultiplier,
  type Nature,
  type Terrain,
  type Weather,
} from '../core/damage';
import { isMegaStoneName, megaStoneFor } from '../core/megaStones';
import { matchesQuery } from '../core/names';
import { isSpreadMove, traitsOf } from '../core/moveTraits';
import { effectiveness } from '../core/typechart';
import {
  applyEffectivenessQuirk,
  needsManualPower,
  resolveMoveType,
  resolvePower,
  sumPositiveBoosts,
  type PowerContext,
} from '../core/variablePower';
import type { Route } from '../router';
import { findPokemon, state } from '../store';
import type { Pokemon, PokemonForm, UsageReport } from '../types';
import { sectionTitle, sprite, typeBadge } from './components';

const BATTLE_STATS = ['atk', 'def', 'spa', 'spd', 'spe'] as const;
type BattleStat = (typeof BATTLE_STATS)[number];
const ALL_STATS = ['hp', ...BATTLE_STATS] as const;
type StatKey = (typeof ALL_STATS)[number];

const STAT_LABELS: Record<StatKey, string> = {
  hp: 'HP',
  atk: '공격',
  def: '방어',
  spa: '특수공격',
  spd: '특수방어',
  spe: '스피드',
};

const STAT_SLUG_TO_KEY: Record<string, BattleStat> = {
  attack: 'atk',
  defense: 'def',
  'special-attack': 'spa',
  'special-defense': 'spd',
  speed: 'spe',
};

const MOVE_SLOTS = 4;

/** 상태이상. 대미지 계산에 영향을 주는 것만 둔다. */
type Status = 'none' | 'burn' | 'poison' | 'toxic' | 'paralysis' | 'sleep' | 'freeze';

const STATUS_OPTIONS: [Status, string][] = [
  ['none', '없음'],
  ['burn', '화상'],
  ['poison', '독'],
  ['toxic', '맹독'],
  ['paralysis', '마비'],
  ['sleep', '잠듦'],
  ['freeze', '얼음'],
];

const WEATHER_OPTIONS: [Weather, string][] = [
  ['none', '없음'],
  ['sun', '쾌청'],
  ['rain', '비'],
  ['sand', '모래바람'],
  ['snow', '눈'],
];

const TERRAIN_OPTIONS: [Terrain, string][] = [
  ['none', '없음'],
  ['electric', '일렉트릭필드'],
  ['grassy', '그래스필드'],
  ['psychic', '사이코필드'],
  ['misty', '미스트필드'],
];

interface Side {
  showdownId: string;
  formSlug: string | null;
  points: Record<StatKey, number>;
  nature: string;
  stages: Record<BattleStat, number>;
  ability: string | null;
  /** 지닌 도구의 영문 도감 키. 빈 문자열이면 없음. */
  itemName: string;
  status: Status;
  /** 남은 HP 비율 (%) 1~100 */
  hpPercent: number;
}

function emptySide(): Side {
  return {
    showdownId: '',
    formSlug: null,
    points: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    nature: 'Hardy',
    stages: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    ability: null,
    itemName: '',
    status: 'none',
    hpPercent: 100,
  };
}

const attacker = emptySide();
const defender = emptySide();
const moveNames: string[] = new Array(MOVE_SLOTS).fill('');
let weather: Weather = 'none';
let terrain: Terrain = 'none';
let screen = false;
let critical = false;
let movesLast = false;
let fallenAllies = 0;
let genderRelation: 'same' | 'different' | 'unknown' = 'unknown';
const hitChoices = new Map<string, number>();
const manualPower = new Map<string, number>();

function defaultHits(range: [number, number]): number {
  const [min, max] = range;
  return min === max ? min : Math.min(max, Math.max(min, 3));
}

function hitsFor(move: MoveInfo, skillLink: boolean): number {
  if (!move.hits) return 1;
  const [min, max] = move.hits;
  if (skillLink) return max;
  return hitChoices.get(move.englishName) ?? defaultHits([min, max]);
}

function natureFor(side: Side, stat: BattleStat): Nature {
  const entry = state.terms?.natures.get(side.nature);
  if (!entry) return 'neutral';
  if (entry.up && STAT_SLUG_TO_KEY[entry.up] === stat) return 'up';
  if (entry.down && STAT_SLUG_TO_KEY[entry.down] === stat) return 'down';
  return 'neutral';
}

function statKeyFromText(raw: string | undefined): BattleStat | null {
  const map: Record<string, BattleStat> = {
    attack: 'atk',
    defense: 'def',
    'sp. atk': 'spa',
    'sp.atk': 'spa',
    'sp. def': 'spd',
    'sp.def': 'spd',
    speed: 'spe',
  };
  return map[(raw ?? '').trim().toLowerCase()] ?? null;
}

function applyUsageDefaults(side: Side, report: UsageReport | null): string[] {
  if (!report) return [];

  const spread = report.blocks.find((b) => b.category === 'stat_points')?.entries[0];
  if (spread?.points) side.points = { ...spread.points };

  const nature = report.blocks.find((b) => b.category === 'stat_alignment')?.entries[0];
  if (nature?.name) {
    if (state.terms?.natures.has(nature.name)) {
      side.nature = nature.name;
    } else {
      const up = statKeyFromText(nature.statUp);
      const down = statKeyFromText(nature.statDown);
      for (const [name, entry] of state.terms?.natures ?? []) {
        const entryUp = entry.up ? STAT_SLUG_TO_KEY[entry.up] : null;
        const entryDown = entry.down ? STAT_SLUG_TO_KEY[entry.down] : null;
        if (entryUp === up && entryDown === down) {
          side.nature = name;
          break;
        }
      }
    }
  }

  const ability = report.blocks.find((b) => b.category === 'ability')?.entries[0]?.name;
  if (ability) side.ability = ability;

  return (report.blocks.find((b) => b.category === 'move')?.entries ?? [])
    .map((e) => e.name)
    .filter(Boolean)
    .slice(0, MOVE_SLOTS);
}

function abilitiesOf(form: PokemonForm): string[] {
  const names = [...form.abilities];
  if (form.hiddenAbility && !names.includes(form.hiddenAbility)) names.push(form.hiddenAbility);
  return names;
}

function formOf(mon: Pokemon, slug: string | null): PokemonForm {
  return mon.forms.find((f) => f.slug === slug) ?? mon.primary;
}

/** 어느 쪽이든 이 특성을 고르고 있는가. 조건부 입력의 노출 여부를 정한다. */
function anySideHasAbility(name: string): boolean {
  return attacker.ability === name || defender.ability === name;
}

const isPoisoned = (status: Status) => status === 'poison' || status === 'toxic';

/** "적용된 보정" 줄에 넣을 도구 표기. 안 들었으면 null. */
function itemLabel(item: ItemEffect | null): string | null {
  return item ? `${itemName(state.terms, item.name)} (${item.note})` : null;
}

/** null 이면 아무것도 붙이지 않는다. */
function appendIf(parent: HTMLElement, child: HTMLElement | null): void {
  if (child) parent.appendChild(child);
}

/**
 * 기술의 성질 표기 — 광역 범위·접촉 여부·펀치·소리 등.
 *
 * 계산에는 이미 쓰고 있던 값인데 화면에 없어서, 왜 그 배율이 붙었는지 알 수 없었다.
 * 특히 광역기는 **상대만** 때리는지 **아군까지** 때리는지가 실전에서 완전히 다르다.
 */
function traitRow(move: MoveInfo): HTMLElement | null {
  const traits = traitsOf(move);
  if (traits.length === 0) return null;
  return el(
    'div',
    { class: 'calc__traits' },
    ...traits.map((trait) =>
      el(
        'span',
        {
          class:
            `calc__trait calc__trait--${trait.kind}` +
            // 접촉과 비접촉은 같은 자리에 오므로 눈으로 구분되게 나눈다.
            (trait.label === '비접촉' ? ' calc__trait--off' : ''),
        },
        trait.label,
      ),
    ),
  );
}

/** 나중에 행동하는지가 위력에 걸리는 기술. Showdown 기준. */
const LAST_MOVER_MOVES = new Set(['Payback']);

/**
 * 「공격측이 나중에 행동」 입력을 띄울 이유. 없으면 null 이라 입력 자체가 안 나온다.
 *
 * 늘 떠 있으면 대부분의 조합에서 아무 의미가 없는 체크박스가 된다.
 * 실제로 그 값을 읽는 특성·기술을 고른 경우에만 보여준다.
 */
function movesLastReason(dex: MoveDex | null): string | null {
  const reasons: string[] = [];
  if (anySideHasAbility('Analytic')) reasons.push(abilityName(state.terms, 'Analytic'));
  for (const name of moveNames) {
    if (name && LAST_MOVER_MOVES.has(name)) {
      reasons.push(dex?.get(name)?.displayName ?? name);
    }
  }
  return reasons.length > 0 ? reasons.join(' · ') : null;
}

/** 이 폼이 반드시 들어야 하는 메가스톤. 메가가 아니면 null. */
function requiredStone(mon: Pokemon | null, form: PokemonForm | null): string | null {
  if (!mon || !form || !state.terms) return null;
  return megaStoneFor(mon, form, state.terms.items.keys());
}

// ---------------------------------------------------------------------------
// 화면 구성
// ---------------------------------------------------------------------------

export function renderCalculator(container: HTMLElement, route: Route): void {
  clear(container);

  if (!state.ready) {
    container.appendChild(notice('loading', '불러오는 중…'));
    return;
  }

  const queryAttacker = route.query.get('a');
  const queryDefender = route.query.get('b');
  if (queryAttacker && queryAttacker !== attacker.showdownId) {
    Object.assign(attacker, emptySide(), { showdownId: queryAttacker });
    moveNames.fill('');
  }
  if (queryDefender && queryDefender !== defender.showdownId) {
    Object.assign(defender, emptySide(), { showdownId: queryDefender });
  }

  const page = el(
    'section',
    { class: 'calc' },
    el('h2', {}, '대미지 계산기'),
    el(
      'p',
      { class: 'calc__intro' },
      '레벨 50 기준입니다. 노력치·성격·특성·기술은 사용률 상위 값으로 자동으로 채워집니다.',
    ),
  );
  container.appendChild(page);

  const host = el('div');
  page.appendChild(host);
  host.appendChild(notice('loading', '데이터를 준비하는 중…'));

  const attackerMon = findPokemon(attacker.showdownId);
  const defenderMon = findPokemon(defender.showdownId);

  Promise.all([
    fetchMoveDex(),
    attackerMon ? fetchUsage(attackerMon.showdownId, state.format).catch(() => null) : null,
    defenderMon ? fetchUsage(defenderMon.showdownId, state.format).catch(() => null) : null,
  ]).then(([dexResult, attackerUsage, defenderUsage]) => {
    const dex = dexResult.status === 'ok' ? dexResult.data : null;

    if (attackerMon && Object.values(attacker.points).every((v) => v === 0)) {
      const topMoves = applyUsageDefaults(attacker, attackerUsage);
      topMoves.forEach((name, i) => {
        if (!moveNames[i]) moveNames[i] = name;
      });
    }
    if (defenderMon && Object.values(defender.points).every((v) => v === 0)) {
      applyUsageDefaults(defender, defenderUsage);
    }

    clear(host);
    buildForm(host, dex, attackerUsage);
  });
}

/**
 * 폼을 한 번만 짓고, 이후에는 필요한 조각만 다시 그린다.
 * 예전에는 입력 하나 건드릴 때마다 전체를 새로 그려서 새로고침처럼 보였다.
 */
function buildForm(host: HTMLElement, dex: MoveDex | null, initialUsage: UsageReport | null): void {
  // 공격측 사용률은 포켓몬이 바뀔 때마다 다시 받아야 한다.
  // 처음 값을 붙잡아 두면 포켓몬을 바꿔도 기술 목록이 그대로 남는다.
  let attackerUsage = initialUsage;

  const attackerPanel = el('div', { class: 'calc__side' });
  const defenderPanel = el('div', { class: 'calc__side' });
  host.appendChild(el('div', { class: 'calc__sides' }, attackerPanel, defenderPanel));

  const moveHost = el('div');
  const fieldHost = el('div');
  const resultHost = el('div');
  host.appendChild(moveHost);
  host.appendChild(fieldHost);
  host.appendChild(resultHost);

  /** 결과만 다시 계산한다. 대부분의 입력이 이것만 부른다. */
  const recalc = (): void => {
    clear(resultHost);
    const a = findPokemon(attacker.showdownId);
    const d = findPokemon(defender.showdownId);
    if (!a || !d) {
      resultHost.appendChild(notice('empty', '공격·방어 포켓몬을 각각 선택하세요.'));
      return;
    }
    resultHost.appendChild(renderResults(a, d, dex, recalc));
  };

  /** 특성이 바뀌면 조건부 입력(총대장·투쟁심)이 붙거나 빠진다. */
  const refreshField = (): void => {
    clear(fieldHost);
    fieldHost.appendChild(fieldSection(dex, recalc));
    recalc();
  };

  const refreshMoves = (): void => {
    clear(moveHost);
    const mon = findPokemon(attacker.showdownId);
    if (mon) moveHost.appendChild(moveSection(mon, dex, attackerUsage, recalc));
  };

  const refreshSide = (which: 'attacker' | 'defender'): void => {
    const side = which === 'attacker' ? attacker : defender;
    const panel = which === 'attacker' ? attackerPanel : defenderPanel;
    clear(panel);
    panel.appendChild(
      sidePanel(which === 'attacker' ? '공격' : '방어', side, findPokemon(side.showdownId), {
        onPokemonChange: () => {
          // 새 포켓몬의 사용률이 도착하기 전에 먼저 그린다.
          // 종족 정보(타입·실수치·특성·배울 수 있는 기술)는 인덱스에 이미 있어서
          // 네트워크를 기다릴 이유가 없다. 사용률은 도착하는 대로 덧입힌다.
          refreshSide(which);
          if (which === 'attacker') refreshMoves();
          refreshField();
          void loadUsageFor(which);
        },
        onFormChange: () => {
          refreshSide(which);
          if (which === 'attacker') refreshMoves();
          recalc();
        },
        onAbilityChange: () => {
          refreshSide(which);
          refreshField();
        },
        onInput: recalc,
      }),
    );
  };

  /**
   * 바뀐 포켓몬의 사용률을 받아 노력치·성격·특성·기술 기본값을 다시 채운다.
   *
   * 사용률은 종마다 따로 받아야 해서 포켓몬을 바꾸면 반드시 다시 요청해야 한다.
   * 실패하면 조용히 넘어간다 — 기본값이 안 채워질 뿐 계산 자체는 된다.
   */
  const loadUsageFor = async (which: 'attacker' | 'defender'): Promise<void> => {
    const side = which === 'attacker' ? attacker : defender;
    const requested = side.showdownId;
    const mon = findPokemon(requested);
    if (!mon) return;

    const usage = await fetchUsage(mon.showdownId, state.format).catch(() => null);
    // 기다리는 동안 사용자가 또 바꿨으면 늦게 온 응답을 버린다.
    if (side.showdownId !== requested) return;

    if (which === 'attacker') {
      attackerUsage = usage;
      const topMoves = applyUsageDefaults(side, usage);
      topMoves.forEach((name, i) => {
        moveNames[i] = name;
      });
      refreshMoves();
    } else {
      applyUsageDefaults(side, usage);
    }
    refreshSide(which);
    refreshField();
  };

  refreshSide('attacker');
  refreshSide('defender');
  refreshMoves();
  refreshField();
}

interface SideHandlers {
  onPokemonChange: () => void;
  onFormChange: () => void;
  onAbilityChange: () => void;
  onInput: () => void;
}

function sidePanel(
  title: string,
  side: Side,
  mon: Pokemon | null,
  handlers: SideHandlers,
): DocumentFragment {
  const frag = document.createDocumentFragment();
  frag.appendChild(el('h3', { class: 'calc__side-title' }, title));

  // 포켓몬 선택이 맨 위에 온다 — 가장 먼저 정하는 값이다.
  frag.appendChild(monPicker(side, mon, title, handlers.onPokemonChange));

  if (!mon) return frag;

  const form = formOf(mon, side.formSlug);
  frag.appendChild(
    el(
      'div',
      { class: 'calc__mon' },
      sprite(form),
      el(
        'div',
        {},
        el('p', { class: 'calc__mon-name' }, mon.displayName),
        el('div', { class: 'calc__mon-types' }, ...form.types.map(typeBadge)),
      ),
    ),
  );

  if (mon.forms.length > 1) {
    const select = el('select', { class: 'form-select', 'aria-label': `${title} 폼` });
    for (const candidate of mon.forms) {
      const option = el('option', { value: candidate.slug }, candidate.formName);
      if (candidate.slug === form.slug) option.setAttribute('selected', 'selected');
      select.appendChild(option);
    }
    select.addEventListener('change', () => {
      side.formSlug = select.value;
      handlers.onFormChange();
    });
    frag.appendChild(select);

    // 실수치·타입·특성은 폼마다 다르지만 사용률은 종 단위로만 집계된다.
    // 상류가 종당 CSV 하나만 내기 때문이다 (메가 라이츄 X·Y 가 같은 Raichu.csv 를 쓴다).
    // 밝히지 않으면 "X 와 Y 의 성격·노력치가 왜 같냐"는 오해가 생긴다.
    frag.appendChild(
      el(
        'p',
        { class: 'calc__form-note' },
        '실수치·타입·특성은 폼별 값입니다. 성격·노력치·기술 기본값은 사용률에서 오는데, ' +
          '사용률은 폼 구분 없이 종 단위로만 집계돼 폼을 바꿔도 같습니다.',
      ),
    );
  }

  frag.appendChild(hpSlider(side, form, title, handlers.onInput));
  frag.appendChild(natureSelect(side, title, handlers.onInput));
  frag.appendChild(statInputs(side, form, handlers.onInput));
  frag.appendChild(abilitySelect(side, form, title, handlers.onAbilityChange));
  frag.appendChild(
    itemSelect(side, side === attacker ? ATTACKER_ITEMS : DEFENDER_ITEMS, mon, form, handlers.onInput),
  );
  frag.appendChild(statusSelect(side, title, handlers.onInput));

  return frag;
}

/**
 * 남은 HP 를 끌어서 맞춘다.
 * 분화·기사회생·하드프레스·소금물의 위력과 멀티스케일·심록·옹골참 판정이 여기 걸린다.
 */
function hpSlider(side: Side, form: PokemonForm, title: string, onInput: () => void): HTMLElement {
  const maxHp = effectiveHp(form.stats.hp, side.points.hp);
  const readout = el('span', { class: 'calc__hp-value' });

  const paint = (): void => {
    const current = Math.max(1, Math.round((maxHp * side.hpPercent) / 100));
    readout.textContent = `${current} / ${maxHp} · ${side.hpPercent}%`;
  };

  const slider = el('input', {
    class: 'calc__hp-range',
    type: 'range',
    'aria-label': `${title} 남은 HP`,
  });
  slider.min = '1';
  slider.max = '100';
  slider.step = '1';
  slider.value = String(side.hpPercent);
  // 끄는 동안 계속 발생한다. 결과가 실시간으로 따라가되 폼은 그대로 남는다.
  slider.addEventListener('input', () => {
    side.hpPercent = Number(slider.value);
    paint();
    onInput();
  });

  paint();
  return el(
    'div',
    { class: 'calc__hp' },
    el('span', { class: 'calc__hp-label' }, '남은 HP'),
    slider,
    readout,
  );
}

function statusSelect(side: Side, title: string, onInput: () => void): HTMLElement {
  const select = el('select', { class: 'calc__select', 'aria-label': `${title} 상태이상` });
  for (const [value, label] of STATUS_OPTIONS) {
    const option = el('option', { value }, label);
    if (value === side.status) option.setAttribute('selected', 'selected');
    select.appendChild(option);
  }
  select.addEventListener('change', () => {
    side.status = select.value as Status;
    onInput();
  });
  return el('label', { class: 'calc__field' }, el('span', {}, '상태이상'), select);
}

function natureSelect(side: Side, title: string, onInput: () => void): HTMLElement {
  const natures = [...(state.terms?.natures ?? [])];
  if (natures.length === 0) {
    return el(
      'label',
      { class: 'calc__field' },
      el('span', {}, '성격'),
      el('span', { class: 'calc__nature-na' }, '성격 데이터 없음 (무보정으로 계산)'),
    );
  }

  natures.sort((a, b) => {
    const aNeutral = !a[1].up || a[1].up === a[1].down;
    const bNeutral = !b[1].up || b[1].up === b[1].down;
    if (aNeutral !== bNeutral) return aNeutral ? 1 : -1;
    return a[1].displayName.localeCompare(b[1].displayName, 'ko');
  });

  const select = el('select', { class: 'calc__nature-select', 'aria-label': `${title} 성격` });
  for (const [name, entry] of natures) {
    const up = entry.up ? STAT_SLUG_TO_KEY[entry.up] : null;
    const down = entry.down ? STAT_SLUG_TO_KEY[entry.down] : null;
    const suffix =
      up && down && up !== down ? ` (+${STAT_LABELS[up]} / −${STAT_LABELS[down]})` : ' (무보정)';
    const option = el('option', { value: name }, `${entry.displayName}${suffix}`);
    if (name === side.nature) option.setAttribute('selected', 'selected');
    select.appendChild(option);
  }

  select.addEventListener('change', () => {
    side.nature = select.value;
    // 실수치 열만 다시 칠한다. 표를 통째로 새로 만들지 않는다.
    repaintStats(select.closest('.calc__side'), side);
    onInput();
  });

  return el('label', { class: 'calc__field' }, el('span', {}, '성격'), select);
}

function monPicker(side: Side, mon: Pokemon | null, title: string, onPick: () => void): HTMLElement {
  const wrap = el('div', { class: 'calc__picker' });
  const input = el('input', {
    class: 'picker__input',
    type: 'search',
    placeholder: mon ? '다른 포켓몬으로 변경' : '포켓몬 검색',
    'aria-label': `${title} 포켓몬`,
  });
  const suggestions = el('div', { class: 'picker__suggestions' });

  input.addEventListener('input', () => {
    clear(suggestions);
    const query = input.value.trim();
    if (!query) return;
    const matches = (state.index?.pokemon ?? [])
      .filter((candidate) => matchesQuery(query, searchHaystack(candidate, state.locales)))
      .slice(0, 6);
    for (const candidate of matches) {
      const button = el('button', { class: 'picker__option', type: 'button' }, candidate.displayName);
      button.addEventListener('click', () => {
        const isAttacker = side === attacker;
        Object.assign(side, emptySide(), { showdownId: candidate.showdownId });
        if (isAttacker) moveNames.fill('');
        const next = new URLSearchParams(location.hash.split('?')[1] ?? '');
        next.set(isAttacker ? 'a' : 'b', candidate.showdownId);
        // 주소만 갈아끼운다. navigate 를 쓰면 라우터가 화면을 통째로 다시 그린다.
        history.replaceState(null, '', `#/calc?${next.toString()}`);
        onPick();
      });
      suggestions.appendChild(button);
    }
  });

  wrap.appendChild(input);
  wrap.appendChild(suggestions);
  return wrap;
}

/** 성격·노력치·랭크가 바뀌면 실수치 열만 갱신한다. */
function repaintStats(panel: Element | null, side: Side): void {
  const mon = findPokemon(side.showdownId);
  if (!panel || !mon) return;
  const form = formOf(mon, side.formSlug);

  for (const key of ALL_STATS) {
    const row = panel.querySelector(`[data-stat="${key}"]`);
    if (!row) continue;
    const isHp = key === 'hp';
    const nature = isHp ? 'neutral' : natureFor(side, key);
    const value = isHp
      ? effectiveHp(form.stats.hp, side.points.hp)
      : effectiveStat(form.stats[key], side.points[key], nature, side.stages[key]);

    const valueEl = row.querySelector('.calc__stat-value');
    if (valueEl) {
      valueEl.textContent = String(value);
      valueEl.className = `calc__stat-value calc__stat-value--${nature}`;
    }
    if (!isHp) {
      const markEl = row.querySelector('.calc__nature-mark');
      if (markEl) {
        markEl.textContent = nature === 'up' ? '▲' : nature === 'down' ? '▼' : '';
        markEl.className = `calc__nature-mark calc__nature-mark--${nature}`;
      }
    }
  }
}

function statInputs(side: Side, form: PokemonForm, onInput: () => void): HTMLElement {
  const table = el('div', { class: 'calc__stats' });
  table.appendChild(
    el(
      'div',
      { class: 'calc__stat calc__stat--head' },
      el('span', {}, ''),
      el('span', {}, '실수치'),
      el('span', {}, '노력'),
      el('span', {}, '성격'),
      el('span', {}, '랭크'),
    ),
  );

  for (const key of ALL_STATS) {
    const isHp = key === 'hp';
    const nature = isHp ? 'neutral' : natureFor(side, key);
    const value = isHp
      ? effectiveHp(form.stats.hp, side.points.hp)
      : effectiveStat(form.stats[key], side.points[key], nature, side.stages[key]);

    const points = el('input', {
      class: 'calc__points',
      type: 'number',
      value: String(side.points[key]),
      'aria-label': `${STAT_LABELS[key]} 노력치 포인트`,
    });
    points.min = '0';
    points.max = String(MAX_STAT_POINTS);
    points.addEventListener('change', () => {
      const parsed = Number(points.value);
      side.points[key] = Number.isFinite(parsed)
        ? Math.max(0, Math.min(MAX_STAT_POINTS, Math.round(parsed)))
        : 0;
      points.value = String(side.points[key]);
      repaintStats(points.closest('.calc__side'), side);
      onInput();
    });

    const stageCell = isHp
      ? el('span', { class: 'calc__nature-mark' }, '—')
      : (() => {
          const select = el('select', {
            class: `calc__stage${side.stages[key] > 0 ? ' calc__stage--up' : side.stages[key] < 0 ? ' calc__stage--down' : ''}`,
            'aria-label': `${STAT_LABELS[key]} 랭크`,
          });
          for (let v = 6; v >= -6; v -= 1) {
            const option = el('option', { value: String(v) }, v > 0 ? `+${v}` : String(v));
            if (v === side.stages[key]) option.setAttribute('selected', 'selected');
            select.appendChild(option);
          }
          select.addEventListener('change', () => {
            side.stages[key] = Number(select.value);
            select.className = `calc__stage${side.stages[key] > 0 ? ' calc__stage--up' : side.stages[key] < 0 ? ' calc__stage--down' : ''}`;
            repaintStats(select.closest('.calc__side'), side);
            onInput();
          });
          return select;
        })();

    table.appendChild(
      el(
        'div',
        { class: 'calc__stat', 'data-stat': key },
        el('span', { class: 'calc__stat-label' }, STAT_LABELS[key]),
        el('span', { class: `calc__stat-value calc__stat-value--${nature}` }, String(value)),
        points,
        el(
          'span',
          { class: `calc__nature-mark calc__nature-mark--${nature}` },
          isHp ? '' : nature === 'up' ? '▲' : nature === 'down' ? '▼' : '',
        ),
        stageCell,
      ),
    );
  }

  return table;
}

function abilitySelect(
  side: Side,
  form: PokemonForm,
  title: string,
  onChange: () => void,
): HTMLElement {
  const owned = abilitiesOf(form);
  const isAttacker = side === attacker;

  const select = el('select', { class: 'calc__ability', 'aria-label': `${title} 특성` });
  const none = el('option', { value: '' }, '— 없음 —');
  if (!side.ability) none.setAttribute('selected', 'selected');
  select.appendChild(none);

  for (const name of owned) {
    const def = isAttacker ? attackerAbility(name) : defenderAbility(name);
    const unsupported = UNSUPPORTED_ABILITIES.get(name);
    const korean = abilityName(state.terms, name);
    // 계산에 반영되는 것만 설명을 붙인다. 나머지는 이름만 둔다 —
    // "대미지 영향 없음" 같은 꼬리표를 다 달면 목록만 시끄러워진다.
    const suffix = def ? ` — ${def.note}` : unsupported ? ' — 미반영' : '';
    const option = el('option', { value: name }, `${korean}${suffix}`);
    if (name === side.ability) option.setAttribute('selected', 'selected');
    select.appendChild(option);
  }

  select.addEventListener('change', () => {
    side.ability = select.value || null;
    onChange();
  });

  const field = el('label', { class: 'calc__field' }, el('span', {}, '특성'), select);

  if (side.ability) {
    const unsupported = UNSUPPORTED_ABILITIES.get(side.ability);
    const harmless = NO_DAMAGE_EFFECT.get(side.ability);
    if (unsupported) {
      field.appendChild(
        el('span', { class: 'calc__ability-warn' }, `계산에 반영되지 않습니다 — ${unsupported}.`),
      );
    } else if (harmless) {
      field.appendChild(el('span', { class: 'calc__ability-note' }, harmless));
    }
  }

  return field;
}

/**
 * 도구 선택.
 *
 * 한국어 표기는 도감(`terms.json`)에서 가져온다. 손으로 적으면 '달인의띠'가
 * '전문가벨트'가 된다. 도감에 한국어가 없으면 영문명을 그대로 둔다 — 지어내지 않는다.
 */
function itemSelect(
  side: Side,
  options: ItemEffect[],
  mon: Pokemon,
  form: PokemonForm,
  onInput: () => void,
): HTMLElement {
  // 메가진화는 그 종의 메가스톤을 들어야만 성립한다.
  // 생명의구슬을 든 메가 한카리아스는 존재할 수 없으므로 아예 못 고르게 잠근다.
  const stone = requiredStone(mon, form);
  if (stone) {
    side.itemName = stone;
    const locked = el('select', { class: 'calc__modifier', 'aria-label': '도구' });
    const only = el('option', { value: stone }, itemName(state.terms, stone));
    only.setAttribute('selected', 'selected');
    locked.appendChild(only);
    locked.disabled = true;
    return el(
      'label',
      { class: 'calc__field' },
      el('span', {}, '도구'),
      locked,
      el('span', { class: 'calc__item-locked' }, '메가진화에 필요해 고정됩니다 (대미지 배율 없음)'),
    );
  }

  // 메가에서 일반 폼으로 돌아왔으면 들고 있던 돌을 내려놓는다.
  if (isMegaStoneName(side.itemName)) side.itemName = '';

  const select = el('select', { class: 'calc__modifier', 'aria-label': '도구' });

  const none = el('option', { value: '' }, '없음');
  if (!side.itemName) none.setAttribute('selected', 'selected');
  select.appendChild(none);

  // 타입별 도구(강화 도구·반감 열매)는 개수가 많아서 따로 묶는다.
  const general = options.filter((o) => !o.boostsType && !o.resistsType);
  const byType = options.filter((o) => o.boostsType ?? o.resistsType);

  const addOption = (item: ItemEffect, parent: HTMLElement) => {
    const node = el('option', { value: item.name }, `${itemName(state.terms, item.name)} — ${item.note}`);
    if (item.name === side.itemName) node.setAttribute('selected', 'selected');
    parent.appendChild(node);
  };

  for (const item of general) addOption(item, select);
  if (byType.length > 0) {
    const group = el('optgroup');
    group.label = side === attacker ? '타입 강화 도구' : '반감 열매';
    for (const item of byType) addOption(item, group);
    select.appendChild(group);
  }

  select.addEventListener('change', () => {
    side.itemName = select.value;
    onInput();
  });

  return el('label', { class: 'calc__field' }, el('span', {}, '도구'), select);
}

function moveSection(
  mon: Pokemon,
  dex: MoveDex | null,
  usage: UsageReport | null,
  onInput: () => void,
): HTMLElement {
  const section = el('section', { class: 'section' });
  section.appendChild(sectionTitle('기술', `${MOVE_SLOTS}개까지`));

  const topMoves = (usage?.blocks.find((b) => b.category === 'move')?.entries ?? [])
    .map((e) => e.name)
    .filter(Boolean);
  const rest = mon.learnableMoveNames.filter((name) => !topMoves.includes(name));

  const grid = el('div', { class: 'calc__moves' });

  for (let slot = 0; slot < MOVE_SLOTS; slot += 1) {
    const select = el('select', { class: 'calc__move', 'aria-label': `기술 ${slot + 1}` });

    const blank = el('option', { value: '' }, '— 비어 있음 —');
    if (!moveNames[slot]) blank.setAttribute('selected', 'selected');
    select.appendChild(blank);

    const addOption = (name: string, parent: HTMLElement) => {
      const move = dex?.get(name) ?? null;
      const label = move
        ? `${move.displayName}${move.power ? ` · 위력 ${move.power}` : ' · 변화'}`
        : name;
      const option = el('option', { value: name }, label);
      if (name === moveNames[slot]) option.setAttribute('selected', 'selected');
      parent.appendChild(option);
    };

    if (topMoves.length > 0) {
      const group = el('optgroup');
      group.label = '사용률 상위';
      for (const name of topMoves) addOption(name, group);
      select.appendChild(group);
    }
    const groupRest = el('optgroup');
    groupRest.label = '배울 수 있는 기술';
    for (const name of rest) addOption(name, groupRest);
    select.appendChild(groupRest);

    select.addEventListener('change', () => {
      moveNames[slot] = select.value;
      onInput();
    });

    grid.appendChild(el('div', { class: 'calc__move-slot' }, select));
  }

  section.appendChild(grid);
  return section;
}

function fieldSection(dex: MoveDex | null, onInput: () => void): HTMLElement {
  const section = el('section', { class: 'section' });
  section.appendChild(sectionTitle('필드 상황'));

  const grid = el('div', { class: 'calc__field-grid' });

  const dropdown = <T extends string>(
    label: string,
    options: [T, string][],
    current: T,
    onPick: (value: T) => void,
  ) => {
    const select = el('select', { class: 'calc__select', 'aria-label': label });
    for (const [value, text] of options) {
      const option = el('option', { value }, text);
      if (value === current) option.setAttribute('selected', 'selected');
      select.appendChild(option);
    }
    select.addEventListener('change', () => {
      onPick(select.value as T);
      onInput();
    });
    return el('label', { class: 'calc__field' }, el('span', {}, label), select);
  };

  grid.appendChild(dropdown('날씨', WEATHER_OPTIONS, weather, (v) => (weather = v)));
  grid.appendChild(dropdown('필드', TERRAIN_OPTIONS, terrain, (v) => (terrain = v)));

  const toggle = (label: string, value: boolean, onChange: (next: boolean) => void) => {
    const box = el('input', { type: 'checkbox' });
    if (value) box.setAttribute('checked', 'checked');
    box.addEventListener('change', () => {
      onChange(box.checked);
      onInput();
    });
    return el('label', { class: 'calc__check' }, box, el('span', {}, label));
  };

  grid.appendChild(toggle('리플렉터 / 빛의장막', screen, (v) => (screen = v)));
  grid.appendChild(toggle('급소', critical, (v) => (critical = v)));

  // 아래 항목들은 실제로 그 값을 쓰는 특성·기술을 골랐을 때만 나온다.
  // 관계 없는 입력이 늘 떠 있으면 무엇이 계산에 영향을 주는지 흐려진다.
  const lastMoverReason = movesLastReason(dex);
  if (lastMoverReason) {
    grid.appendChild(toggle(`공격측이 나중에 행동 (${lastMoverReason})`, movesLast, (v) => (movesLast = v)));
  }

  if (anySideHasAbility('Supreme Overlord')) {
    const fallen = el('select', { class: 'calc__select', 'aria-label': '쓰러진 아군 수' });
    for (let n = 0; n <= 5; n += 1) {
      const option = el('option', { value: String(n) }, `${n}마리`);
      if (n === fallenAllies) option.setAttribute('selected', 'selected');
      fallen.appendChild(option);
    }
    fallen.addEventListener('change', () => {
      fallenAllies = Number(fallen.value);
      onInput();
    });
    grid.appendChild(
      el('label', { class: 'calc__field' }, el('span', {}, '쓰러진 아군 (총대장)'), fallen),
    );
  }

  if (anySideHasAbility('Rivalry')) {
    grid.appendChild(
      dropdown(
        '성별 관계 (투쟁심)',
        [
          ['unknown', '무성 / 불명'],
          ['same', '같은 성별'],
          ['different', '다른 성별'],
        ] as ['same' | 'different' | 'unknown', string][],
        genderRelation,
        (v) => (genderRelation = v),
      ),
    );
  }

  section.appendChild(grid);
  section.appendChild(
    el(
      'p',
      { class: 'calc__note' },
      '목록에 없는 특성·도구는 계산에 반영되지 않습니다. 무엇이 적용됐는지는 결과 아래 「적용된 보정」에 그대로 적습니다.',
    ),
  );
  // 도구 목록은 Champions 에 실재하는 141종에서 추린 것이다. 그중 계산에서 뺀 것과
  // 그 이유를 밝힌다 — 조용히 빼면 "지원하는데 안 걸리는 건지" 알 수 없다.
  section.appendChild(
    el(
      'p',
      { class: 'calc__note calc__note--items' },
      `도구는 Champions 에 실제로 존재하는 것만 넣었습니다 (구애머리띠·구애안경·돌격조끼·진화의휘석은 없습니다). ` +
        `계산에서 뺀 도구: ${[...UNSUPPORTED_ITEMS]
          .map(([name, why]) => `${itemName(state.terms, name)} — ${why}`)
          .join(' · ')}.`,
    ),
  );
  return section;
}

// ---------------------------------------------------------------------------
// 계산
// ---------------------------------------------------------------------------

function renderResults(
  attackerMon: Pokemon,
  defenderMon: Pokemon,
  dex: MoveDex | null,
  onChange: () => void,
): HTMLElement {
  const section = el('section', { class: 'section calc__result' });
  section.appendChild(sectionTitle('결과'));

  const selected = moveNames.filter(Boolean);
  if (selected.length === 0) {
    section.appendChild(notice('empty', '기술을 하나 이상 선택하세요.'));
    return section;
  }

  const attackerForm = formOf(attackerMon, attacker.formSlug);
  const defenderForm = formOf(defenderMon, defender.formSlug);
  const attackerItem = findItem(ATTACKER_ITEMS, attacker.itemName);
  const defenderItem = findItem(DEFENDER_ITEMS, defender.itemName);

  const defenderMaxHp = effectiveHp(defenderForm.stats.hp, defender.points.hp);
  const defenderCurrentHp = Math.max(1, Math.round((defenderMaxHp * defender.hpPercent) / 100));

  section.appendChild(
    el(
      'p',
      { class: 'calc__matchup' },
      `${attackerMon.displayName} → ${defenderMon.displayName}`,
      el('span', { class: 'calc__matchup-hp' }, ` (남은 HP ${defenderCurrentHp} / ${defenderMaxHp})`),
    ),
  );

  for (const name of selected) {
    section.appendChild(
      moveResult(name, dex, attackerForm, defenderForm, attackerItem, defenderItem, {
        maxHp: defenderMaxHp,
        currentHp: defenderCurrentHp,
        onChange,
      }),
    );
  }

  const abilityLabel = (name: string | null, isAttacker: boolean) => {
    if (!name) return null;
    const def = isAttacker ? attackerAbility(name) : defenderAbility(name);
    return def ? `${abilityName(state.terms, name)} (${def.note})` : null;
  };
  const statusLabel = (side: Side, who: string) =>
    side.status === 'none' ? null : `${who} ${STATUS_OPTIONS.find(([s]) => s === side.status)?.[1]}`;

  const applied = [
    abilityLabel(attacker.ability, true),
    abilityLabel(defender.ability, false),
    itemLabel(attackerItem),
    itemLabel(defenderItem),
    statusLabel(attacker, '공격측'),
    statusLabel(defender, '방어측'),
    weather !== 'none' ? `날씨: ${WEATHER_OPTIONS.find(([w]) => w === weather)?.[1]}` : null,
    terrain !== 'none' ? `필드: ${TERRAIN_OPTIONS.find(([t]) => t === terrain)?.[1]}` : null,
    screen ? (critical ? '스크린 (급소로 무시됨)' : '스크린') : null,
    critical ? '급소 ×1.5' : null,
    state.format === 'Doubles' ? '더블 규칙' : null,
  ].filter(Boolean) as string[];

  section.appendChild(
    el(
      'p',
      { class: 'calc__applied' },
      applied.length > 0 ? `적용된 보정: ${applied.join(' · ')}` : '적용된 보정 없음',
    ),
  );

  return section;
}

interface DefenderHp {
  maxHp: number;
  currentHp: number;
  onChange: () => void;
}

function moveResult(
  name: string,
  dex: MoveDex | null,
  attackerForm: PokemonForm,
  defenderForm: PokemonForm,
  attackerItem: ItemEffect | null,
  defenderItem: ItemEffect | null,
  hp: DefenderHp,
): HTMLElement {
  const move = dex?.get(name) ?? null;
  const row = el('div', { class: 'calc__move-result' });

  if (!move) {
    row.appendChild(el('p', { class: 'calc__move-name' }, name));
    row.appendChild(el('p', { class: 'calc__move-note' }, '기술 제원을 찾을 수 없습니다.'));
    return row;
  }

  const category = move.damageClass;
  const header = el('p', { class: 'calc__move-name' });
  if (move.type) header.appendChild(typeBadge(move.type));
  header.appendChild(el('span', {}, move.displayName));

  if (!category || category === 'status' || !move.type) {
    row.appendChild(header);
    appendIf(row, traitRow(move));
    row.appendChild(el('p', { class: 'calc__move-note' }, '변화기술 — 대미지 없음'));
    return row;
  }
  if (!move.power && !move.variablePower) {
    row.appendChild(header);
    row.appendChild(el('p', { class: 'calc__move-note' }, '위력 정보가 없어 계산할 수 없습니다.'));
    return row;
  }

  const attackerStatused = attacker.status !== 'none';
  const defenderStatused = defender.status !== 'none';
  const burned = attacker.status === 'burn';
  // 심록 계열은 남은 HP 가 1/3 이하일 때 발동한다.
  const attackerLowHp = attacker.hpPercent * 3 <= 100;
  const defenderFullHp = defender.hpPercent >= 100;

  const context: AbilityContext = {
    moveType: move.type,
    movePower: move.power ?? 0,
    category,
    isRecoil: move.drain < 0,
    hasSecondaryEffect:
      move.ailmentChance > 0 ||
      move.flinchChance > 0 ||
      (move.statChance > 0 && move.statChance < 100),
    flags: move.flags,
    attackerTypes: attackerForm.types,
    defenderTypes: defenderForm.types,
    typeEffectiveness: effectiveness(move.type, defenderForm.types),
    weather,
    isCritical: critical,
    attackerLowHp,
    defenderFullHp,
    attackerBurned: burned,
    defenderStatused,
    movesLast,
    fallenAllies,
    genderRelation,
  };

  const abilities = resolveAbilities(attacker.ability, defender.ability, context);
  const resolved = abilities.attacker.removesContact
    ? resolveAbilities(attacker.ability, defender.ability, {
        ...context,
        flags: new Set([...move.flags].filter((f) => f !== 'contact')),
      })
    : abilities;

  const effectiveWeather =
    resolved.attacker.weatherOverride ?? resolved.defender.weatherOverride ?? weather;

  const powerContext: PowerContext = {
    fallenAllies,
    positiveBoosts: sumPositiveBoosts(attacker.stages),
    // 구애스카프는 대미지 배율이 없지만 스피드를 바꿔 자이로볼·일렉트릭볼의 위력을 흔든다.
    attackerSpeed: Math.floor(
      effectiveStat(
        attackerForm.stats.spe,
        attacker.points.spe,
        natureFor(attacker, 'spe'),
        attacker.stages.spe,
      ) * (attackerItem?.speedMultiplier ?? 1),
    ),
    defenderSpeed: Math.floor(
      effectiveStat(
        defenderForm.stats.spe,
        defender.points.spe,
        natureFor(defender, 'spe'),
        defender.stages.spe,
      ) * (defenderItem?.speedMultiplier ?? 1),
    ),
    defenderStatused,
    attackerHasItem: attacker.itemName !== '',
    terrain,
    defenderGrounded: isGrounded(defenderForm.types, defender.ability),
    attackerWeightKg: weightOf(state.terms, attackerForm.savedName),
    defenderWeightKg: weightOf(state.terms, defenderForm.savedName),
    weather: effectiveWeather,
    attackerStatused,
    defenderHasItem: defender.itemName !== '',
    attackerFormName: attackerForm.formName,
    attackerHpRatio: attacker.hpPercent / 100,
    defenderHpRatio: defender.hpPercent / 100,
    defenderPoisoned: isPoisoned(defender.status),
  };

  const moveType =
    resolved.attacker.moveTypeOverride ?? resolveMoveType(move, powerContext) ?? move.type;

  const scrappyApplies =
    resolved.attacker.ignoresGhostImmunity &&
    defenderForm.types.includes('Ghost') &&
    effectiveness(moveType, defenderForm.types) === 0;
  const effectiveDefenderTypes = scrappyApplies
    ? defenderForm.types.filter((t) => t !== 'Ghost')
    : defenderForm.types;

  const typeEff = applyEffectivenessQuirk(
    move,
    effectiveDefenderTypes,
    effectiveness(moveType, effectiveDefenderTypes),
    effectiveness,
  );

  const isCritical = critical && !resolved.defender.preventsCritical;

  if (resolved.defender.immune) {
    row.appendChild(header);
    row.appendChild(
      el(
        'p',
        { class: 'calc__move-note' },
        `${abilityName(state.terms, defender.ability ?? '')} 으로 무효화됩니다.`,
      ),
    );
    return row;
  }

  if (moveType !== move.type) {
    clear(header);
    header.appendChild(typeBadge(moveType));
    header.appendChild(el('span', {}, move.displayName));
    header.appendChild(el('span', { class: 'calc__type-changed' }, `(${move.type} → ${moveType})`));
  }
  row.appendChild(header);
  appendIf(row, traitRow(move));

  const skillLink = resolved.attacker.forcesMaxHits;
  const hits = hitsFor(move, skillLink);
  const computedPower = resolvePower(move, powerContext);
  const effectivePower = computedPower ?? manualPower.get(move.englishName) ?? move.power ?? 0;

  if (move.variablePower) {
    const line = el('div', { class: 'calc__varpow' });
    line.appendChild(el('span', { class: 'calc__varpow-label' }, '가변 위력'));
    line.appendChild(el('span', { class: 'calc__varpow-note' }, move.variablePowerNote ?? ''));

    if (needsManualPower(move)) {
      const input = el('input', {
        class: 'calc__varpow-input',
        type: 'number',
        value: String(effectivePower),
        'aria-label': `${move.displayName} 위력 직접 입력`,
      });
      input.min = '1';
      input.addEventListener('change', () => {
        const parsed = Number(input.value);
        if (Number.isFinite(parsed) && parsed > 0) manualPower.set(move.englishName, Math.round(parsed));
        hp.onChange();
      });
      line.appendChild(input);
    } else {
      line.appendChild(el('span', { class: 'calc__varpow-value' }, `현재 위력 ${effectivePower}`));
    }
    row.appendChild(line);
  }

  if (move.hits) {
    const [minHits, maxHits] = move.hits;
    const control = el('div', { class: 'calc__hits' });
    control.appendChild(el('span', { class: 'calc__hits-label' }, '타격 수'));

    if (skillLink || minHits === maxHits) {
      control.appendChild(
        el(
          'span',
          { class: 'calc__hits-fixed' },
          `${hits}회 고정`,
          skillLink ? el('span', { class: 'calc__hits-why' }, ' — 스킬링크') : null,
        ),
      );
    } else {
      const select = el('select', { class: 'calc__select', 'aria-label': `${move.displayName} 타격 수` });
      for (let n = minHits; n <= maxHits; n += 1) {
        const option = el('option', { value: String(n) }, `${n}회`);
        if (n === hits) option.setAttribute('selected', 'selected');
        select.appendChild(option);
      }
      select.addEventListener('change', () => {
        hitChoices.set(move.englishName, Number(select.value));
        hp.onChange();
      });
      control.appendChild(select);
    }
    row.appendChild(control);
  }

  const attackerStageIgnored = resolved.defender.ignoresOpponentBoosts;
  const defenderStageIgnored = resolved.attacker.ignoresOpponentBoosts;

  const attackKey: BattleStat = category === 'physical' ? 'atk' : 'spa';
  let attackStat = effectiveStat(
    attackerForm.stats[attackKey],
    attacker.points[attackKey],
    natureFor(attacker, attackKey),
    attackerStageIgnored ? 0 : attacker.stages[attackKey],
  );
  attackStat = Math.floor(attackStat * resolved.attacker.attackMultiplier);
  if (attackerItem?.attackMultiplier) {
    attackStat = Math.floor(attackStat * attackerItem.attackMultiplier);
  }

  const defenseKey: BattleStat = category === 'physical' ? 'def' : 'spd';
  let defenseStat = effectiveStat(
    defenderForm.stats[defenseKey],
    defender.points[defenseKey],
    natureFor(defender, defenseKey),
    defenderStageIgnored ? 0 : defender.stages[defenseKey],
  );
  defenseStat = Math.floor(defenseStat * resolved.defender.defenseMultiplier);
  if (defenderItem?.defenseMultiplier && (!defenderItem.specialDefenseOnly || category === 'special')) {
    defenseStat = Math.floor(defenseStat * defenderItem.defenseMultiplier);
  }
  const weatherDef = weatherDefenseMultiplier(effectiveWeather, defenderForm.types, category);
  if (weatherDef !== 1) defenseStat = Math.floor(defenseStat * weatherDef);

  const stab = resolved.attacker.stabOverride ?? stabMultiplier(moveType, attackerForm.types);

  const attackerGrounded = isGrounded(attackerForm.types, attacker.ability);
  const defenderGrounded = isGrounded(defenderForm.types, defender.ability);
  const powerModifier =
    resolved.attacker.powerMultiplier *
    resolved.defender.powerMultiplier *
    terrainMultiplier(terrain, moveType, move.englishName, attackerGrounded, defenderGrounded) *
    itemPowerMultiplier(attackerItem, moveType, category);

  const finalModifier =
    resolved.attacker.damageMultiplier *
    resolved.defender.damageMultiplier *
    resolved.attacker.critMultiplier *
    itemDamageMultiplier(attackerItem, moveType, typeEff) *
    itemDamageMultiplier(defenderItem, moveType, typeEff);

  const result = calculateDamage({
    power: effectivePower,
    powerModifier,
    hits,
    moveType,
    category,
    attack: attackStat,
    defense: defenseStat,
    // 비율 표시는 최대 HP 기준(관례), 확정/난수 판정은 남은 HP 기준이다.
    defenderHp: hp.maxHp,
    defenderCurrentHp: hp.currentHp,
    attackerTypes: attackerForm.types,
    defenderTypes: effectiveDefenderTypes,
    typeEffectivenessOverride: typeEff,
    stab,
    isCritical,
    weather: effectiveWeather,
    screen,
    // 광역기는 더블에서 0.75배가 된다. 싱글에서는 대상이 하나뿐이라 줄지 않는다.
    isSpread: state.format === 'Doubles' && isSpreadMove(move),
    isDoubles: state.format === 'Doubles',
    burned: burned && !resolved.attacker.ignoresBurn,
    otherModifier: finalModifier,
    enduresAtFullHp:
      defenderFullHp && (resolved.defender.enduresAtFullHp || defenderItem?.endures === true),
  });

  row.appendChild(
    el(
      'p',
      { class: 'calc__damage' },
      `${result.min} ~ ${result.max}`,
      el('span', { class: 'calc__percent' }, ` (${result.minPercent}% ~ ${result.maxPercent}%)`),
    ),
  );
  row.appendChild(el('p', { class: 'calc__ko' }, result.koText));
  if (hits > 1) {
    row.appendChild(
      el(
        'p',
        { class: 'calc__perhit' },
        `1회 타격 ${result.rolls[0] ?? 0} ~ ${result.rolls[result.rolls.length - 1] ?? 0} · ${hits}회 연속`,
      ),
    );
  }
  row.appendChild(
    el(
      'p',
      { class: 'calc__breakdown' },
      `${category === 'physical' ? '물리' : '특수'} 위력 ${effectivePower} · ` +
        `공격 ${attackStat} / 방어 ${defenseStat} · ` +
        `상성 ×${result.typeEffectiveness}${stab !== 1 ? ` · 자속 ×${stab}` : ''}`,
    ),
  );

  return row;
}
