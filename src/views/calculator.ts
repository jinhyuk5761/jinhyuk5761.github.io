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
  resolveAbilities,
  type AbilityContext,
} from '../core/abilities';
import { clear, el, notice } from '../core/dom';
import {
  ATTACKER_ITEMS,
  DEFENDER_ITEMS,
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
import { formDisplayName } from '../core/formNames';
import { isMegaStoneName, megaStoneFor } from '../core/megaStones';
import { matchesQuery } from '../core/names';
import { isSpreadMove, traitsOf } from '../core/moveTraits';
import { effectiveness } from '../core/typechart';
import {
  applyEffectivenessQuirk,
  needsManualPower,
  resolveMoveType,
  escalatingPowers,
  isEscalating,
  resolvePower,
  sumPositiveBoosts,
  type PowerContext,
} from '../core/variablePower';
import { href, type Route } from '../router';
import { findPokemon, state } from '../store';
import type { Pokemon, PokemonForm, UsageReport } from '../types';
import { sectionTitle, sprite, typeBadge } from './components';
import { searchSelect, type SearchOption } from './searchSelect';

const BATTLE_STATS = ['atk', 'def', 'spa', 'spd', 'spe'] as const;
type BattleStat = (typeof BATTLE_STATS)[number];
const ALL_STATS = ['hp', ...BATTLE_STATS] as const;
type StatKey = (typeof ALL_STATS)[number];

/**
 * 계산기의 스탯 이름은 축약형을 쓴다.
 * '특수공격' 은 좁은 열에서 두 줄로 쪼개진다 — 대전에서 통용되는 '특공' 이 낫다.
 * (상세 화면은 읽는 용도라 전체 이름을 그대로 둔다.)
 */
const STAT_LABELS: Record<StatKey, string> = {
  hp: 'HP',
  atk: '공격',
  def: '방어',
  spa: '특공',
  spd: '특방',
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

/**
 * 상태이상은 화상만 둔다.
 *
 * 대미지가 달라지는 것은 화상(물리 ×0.5)뿐이다. 나머지는 "상태이상이기만 하면"
 * 되는 판정(객기·이상한비늘·근성)이라 화상으로 똑같이 켜진다. 독을 따로 보는
 * 베놈쇼크 계열은 Champions 기술 목록에 없어 고를 이유가 없다.
 */
type Status = 'none' | 'burn';

const STATUS_OPTIONS: [Status, string][] = [
  ['none', '없음'],
  ['burn', '화상'],
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
/** 전기로바꾸기 — 맞은 뒤에 발동하므로 계산기가 알 수 없다. 사람이 켠다. */
let attackerCharged = false;
let fallenAllies = 0;
let genderRelation: 'same' | 'different' | 'unknown' = 'unknown';
const hitChoices = new Map<string, number>();
const manualPower = new Map<string, number>();
/**
 * 변환자재·리베로의 자속을 적용할 기술.
 *
 * 이 특성은 등장 후 **한 번만** 타입을 바꾼다. 그 턴에 쓴 기술에만 자속이 붙으므로
 * 어느 기술에 걸 것인지는 사람이 정해야 한다 — 계산기가 알 수 없다.
 */
const proteanStab = new Set<string>();

/** 타입을 바꿔 자속을 얻는 특성. */
const CONVERTING_ABILITIES = new Set(['Protean', 'Libero']);

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
  );
  container.appendChild(page);

  // 팝업 화면(작은 창)에서는 껍데기를 벗은 전용 경로를 쓴다.
  // 이미 그 화면이면 링크를 또 보여줄 필요가 없다.
  if (route.path !== '/mini') {
    page.appendChild(
      el(
        'p',
        { class: 'calc__minilink' },
        el('a', { class: 'link', href: href('/mini') }, '팝업 화면용 계산기 →'),
      ),
    );
  }

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
 * 좌우로 넘겨 보는 장 구성.
 *
 * CSS 스크롤 스냅을 쓴다 — 손가락 제스처를 직접 처리하면 관성·되돌아감·
 * 접근성 스크롤을 전부 다시 만들어야 하는데, 브라우저가 이미 다 갖고 있다.
 * 넓은 화면에서는 스냅을 끄고 한 줄로 펼친다(아래 CSS).
 *
 * **여기서 만든 노드를 다시 만들지 않는다.** 부분 갱신이 이 노드들을 붙잡고 있으므로
 * 장을 옮겨 담기만 한다.
 */
function pager(pages: { label: string; nodes: HTMLElement[] }[]): HTMLElement {
  const track = el('div', { class: 'calc__pager' });
  const tabs = el('div', { class: 'calc__pagertabs', role: 'tablist' });
  const pageEls: HTMLElement[] = [];

  pages.forEach((page, i) => {
    const section = el('section', { class: 'calc__page', 'aria-label': page.label }, ...page.nodes);
    pageEls.push(section);
    track.appendChild(section);

    const tab = el(
      'button',
      { class: `calc__pagertab${i === 0 ? ' calc__pagertab--active' : ''}`, type: 'button' },
      page.label,
    );
    tab.addEventListener('click', () => {
      // scrollIntoView 는 가로뿐 아니라 **세로도** 움직인다. 장을 바꿀 때마다
      // 화면이 아래로 끌려 내려가므로, 가로 스크롤만 직접 지정한다.
      const left = section.offsetLeft - track.offsetLeft;
      if (typeof track.scrollTo === 'function') track.scrollTo({ left, behavior: 'smooth' });
      else track.scrollLeft = left;
    });
    tabs.appendChild(tab);
  });

  // 손가락으로 넘겼을 때도 탭 표시가 따라가야 한다.
  track.addEventListener(
    'scroll',
    () => {
      const middle = track.scrollLeft + track.clientWidth / 2;
      let active = 0;
      pageEls.forEach((section, i) => {
        if (section.offsetLeft <= middle) active = i;
      });
      [...tabs.children].forEach((tab, i) => {
        tab.classList.toggle('calc__pagertab--active', i === active);
      });
    },
    { passive: true },
  );

  return el('div', { class: 'calc__pagerwrap' }, tabs, track);
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
  const moveHost = el('div');
  const fieldHost = el('div');
  const resultHost = el('div');

  // 폰에서는 공격 / 방어 / 결과를 한 장씩 넘겨 본다.
  // 기술은 공격측의 것이라 공격 장에, 필드 상황은 조정하며 결과를 봐야 해서 결과 장에 둔다.
  host.appendChild(
    pager([
      { label: '공격', nodes: [attackerPanel, moveHost] },
      { label: '방어', nodes: [defenderPanel] },
      { label: '결과', nodes: [fieldHost, resultHost] },
    ]),
  );

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
    frag.appendChild(
      searchSelect({
        options: mon.forms.map((candidate) => ({
          value: candidate.slug,
          label: formDisplayName(mon, candidate, state.index?.pokemon ?? []),
        })),
        value: form.slug,
        placeholder: '폼 선택',
        ariaLabel: `${title} 폼`,
        className: 'form-select',
        onPick: (slug) => {
          side.formSlug = slug;
          handlers.onFormChange();
        },
      }),
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
  return el(
    'label',
    { class: 'calc__field' },
    el('span', {}, '상태이상'),
    searchSelect({
      options: STATUS_OPTIONS.map(([value, label]) => ({ value, label })),
      value: side.status,
      placeholder: '없음',
      ariaLabel: `${title} 상태이상`,
      className: 'calc__select',
      onPick: (value) => {
        side.status = value as Status;
        onInput();
      },
    }),
  );
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

  const options: SearchOption[] = natures.map(([name, entry]) => {
    const up = entry.up ? STAT_SLUG_TO_KEY[entry.up] : null;
    const down = entry.down ? STAT_SLUG_TO_KEY[entry.down] : null;
    return {
      value: name,
      label: entry.displayName,
      hint: up && down && up !== down ? `+${STAT_LABELS[up]} / −${STAT_LABELS[down]}` : '무보정',
      haystack: [entry.displayName, name],
    };
  });

  const field = el('label', { class: 'calc__field' }, el('span', {}, '성격'));
  field.appendChild(
    searchSelect({
      options,
      value: side.nature,
      placeholder: '성격 선택',
      ariaLabel: `${title} 성격`,
      className: 'calc__nature-select',
      onPick: (name) => {
        side.nature = name;
        // 실수치 열만 다시 칠한다. 표를 통째로 새로 만들지 않는다.
        repaintStats(field.closest('.calc__side'), side);
        onInput();
      },
    }),
  );
  return field;
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
          const stageClass = (stage: number) =>
            `calc__stage${stage > 0 ? ' calc__stage--up' : stage < 0 ? ' calc__stage--down' : ''}`;
          const picker = searchSelect({
            options: Array.from({ length: 13 }, (_, i) => {
              const v = 6 - i;
              return { value: String(v), label: v > 0 ? `+${v}` : String(v) };
            }),
            value: String(side.stages[key]),
            placeholder: '0',
            ariaLabel: `${STAT_LABELS[key]} 랭크`,
            className: stageClass(side.stages[key]),
            onPick: (raw) => {
              side.stages[key] = Number(raw);
              picker.className = `sselect ${stageClass(side.stages[key])}`;
              const label = picker.querySelector('.sselect__value');
              if (label) label.textContent = side.stages[key] > 0 ? `+${side.stages[key]}` : String(side.stages[key]);
              repaintStats(picker.closest('.calc__side'), side);
              onInput();
            },
          });
          return picker;
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

  // '없음' 은 두지 않는다. 특성 없는 포켓몬은 대전에 나오지 않으므로
  // 그것을 고를 수 있게 두면 실재하지 않는 조합을 계산하게 된다.
  // 아직 안 정했거나 다른 폼의 특성이 남아 있으면 첫 번째 것으로 맞춘다.
  if (owned.length > 0 && (!side.ability || !owned.includes(side.ability))) {
    side.ability = owned[0]!;
  }

  // 이름만 둔다. 효과 설명은 「특성」 탭에서 본다 — 계산기에서는 목록만 시끄러워진다.
  const options: SearchOption[] = owned.map((name) => ({
    value: name,
    label: abilityName(state.terms, name),
    haystack: [abilityName(state.terms, name), name],
  }));

  return el(
    'label',
    { class: 'calc__field' },
    el('span', {}, '특성'),
    searchSelect({
      options,
      value: side.ability ?? '',
      // 도감에 특성이 하나도 없는 폼일 때만 보인다.
      placeholder: '정보 없음',
      ariaLabel: `${title} 특성`,
      className: 'calc__ability',
      onPick: (name) => {
        side.ability = name || null;
        onChange();
      },
    }),
  );
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
    // 고를 수 없으므로 드롭다운이 아니라 값만 보여준다.
    return el(
      'label',
      { class: 'calc__field' },
      el('span', {}, '도구'),
      el('span', { class: 'calc__locked-value' }, itemName(state.terms, stone)),
      el('span', { class: 'calc__item-locked' }, '메가진화에 필요해 고정됩니다 (대미지 배율 없음)'),
    );
  }

  // 메가에서 일반 폼으로 돌아왔으면 들고 있던 돌을 내려놓는다.
  if (isMegaStoneName(side.itemName)) side.itemName = '';

  // 타입 강화 도구·반감 열매까지 합치면 40개가 넘는다. 검색으로 찾는다.
  const toOption = (item: ItemEffect): SearchOption => ({
    value: item.name,
    label: itemName(state.terms, item.name),
    hint: item.note,
    haystack: [itemName(state.terms, item.name), item.name],
  });
  const general = options.filter((o) => !o.boostsType && !o.resistsType);
  const byType = options.filter((o) => o.boostsType ?? o.resistsType);

  return el(
    'label',
    { class: 'calc__field' },
    el('span', {}, '도구'),
    searchSelect({
      options: [
        { value: '', label: '없음' },
        ...general.map(toOption),
        ...byType.map(toOption),
      ],
      value: side.itemName,
      placeholder: '없음',
      ariaLabel: '도구',
      className: 'calc__modifier',
      onPick: (name) => {
        side.itemName = name;
        onInput();
      },
    }),
  );
}

function moveSection(
  mon: Pokemon,
  dex: MoveDex | null,
  usage: UsageReport | null,
  onInput: () => void,
): HTMLElement {
  const section = el('section', { class: 'section' });
  section.appendChild(sectionTitle('기술'));

  const topMoves = (usage?.blocks.find((b) => b.category === 'move')?.entries ?? [])
    .map((e) => e.name)
    .filter(Boolean);
  const rest = mon.learnableMoveNames.filter((name) => !topMoves.includes(name));

  const grid = el('div', { class: 'calc__moves' });

  // 배울 수 있는 기술이 수백 개다. 사용률 상위를 앞에 두고, 나머지는 검색으로 찾는다.
  const toOption = (name: string): SearchOption => {
    const move = dex?.get(name) ?? null;
    return {
      value: name,
      label: move?.displayName ?? name,
      hint: move ? (move.power ? `위력 ${move.power}` : '변화') : '',
      // 한국어·영어·일본어 어느 쪽으로 쳐도 찾히게 한다.
      haystack: [move?.displayName ?? name, name, move?.koreanName ?? '', move?.japaneseName ?? ''],
    };
  };
  const moveOptions: SearchOption[] = [
    { value: '', label: '— 비어 있음 —' },
    ...topMoves.map(toOption),
    ...rest.map(toOption),
  ];

  for (let slot = 0; slot < MOVE_SLOTS; slot += 1) {
    const picker = searchSelect({
      options: moveOptions,
      value: moveNames[slot] ?? '',
      placeholder: '— 비어 있음 —',
      ariaLabel: `기술 ${slot + 1}`,
      className: 'calc__move',
      onPick: (name) => {
        moveNames[slot] = name;
        onInput();
      },
    });
    grid.appendChild(el('div', { class: 'calc__move-slot' }, picker));
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
    return el(
      'label',
      { class: 'calc__field' },
      el('span', {}, label),
      searchSelect({
        options: options.map(([value, text]) => ({ value, label: text })),
        value: current,
        placeholder: '없음',
        ariaLabel: label,
        className: 'calc__select',
        onPick: (value) => {
          onPick(value as T);
          onInput();
        },
      }),
    );
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

  // 전기로바꾸기는 '맞은 뒤' 상태라 계산기가 스스로 알 수 없다.
  if (attacker.ability === 'Electromorphosis') {
    grid.appendChild(
      toggle('충전됨 (전기로바꾸기)', attackerCharged, (v) => (attackerCharged = v)),
    );
  }

  if (anySideHasAbility('Supreme Overlord')) {
    grid.appendChild(
      el(
        'label',
        { class: 'calc__field' },
        el('span', {}, '쓰러진 아군 (총대장)'),
        searchSelect({
          options: Array.from({ length: 6 }, (_, n) => ({ value: String(n), label: `${n}마리` })),
          value: String(fallenAllies),
          placeholder: '0마리',
          ariaLabel: '쓰러진 아군 수',
          className: 'calc__select',
          onPick: (raw) => {
            fallenAllies = Number(raw);
            onInput();
          },
        }),
      ),
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
    attackerCharged,
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
    // 독 상태를 따로 보는 기술(베놈쇼크 계열)이 Champions 에 없어 고를 수단을 두지 않았다.
    defenderPoisoned: false,
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
  }

  row.appendChild(header);
  appendIf(row, traitRow(move));

  const skillLink = resolved.attacker.forcesMaxHits;
  const hits = hitsFor(move, skillLink);
  const computedPower = resolvePower(move, powerContext);
  const effectivePower = computedPower ?? manualPower.get(move.englishName) ?? move.power ?? 0;
  const hasConvertingAbility = attacker.ability !== null && CONVERTING_ABILITIES.has(attacker.ability);

  // 위력·분류를 기술 이름 옆에 붙인다. 계산식 줄을 없앤 대신 여기서 바로 보이게 한다.
  const shownPower = isEscalating(move)
    ? escalatingPowers(move, hits).reduce((a, b) => a + b, 0)
    : effectivePower;
  header.appendChild(
    el(
      'span',
      { class: 'calc__move-spec' },
      `${category === 'physical' ? '물리' : '특수'} ${shownPower}`,
    ),
  );

  // 변환자재·리베로는 **한 번만** 타입이 바뀐다. 그 턴에 쓴 기술에만 자속이 붙으므로
  // 어느 기술에 걸 것인지 사용자가 정해야 한다.
  if (hasConvertingAbility) {
    const on = proteanStab.has(move.englishName);
    const toggle = el(
      'button',
      {
        class: `calc__stabtoggle${on ? ' calc__stabtoggle--on' : ''}`,
        type: 'button',
        title: '변환자재 자속 적용 여부',
      },
      on ? '자속 ON' : '자속 OFF',
    );
    toggle.addEventListener('click', () => {
      if (on) proteanStab.delete(move.englishName);
      else proteanStab.add(move.englishName);
      hp.onChange();
    });
    header.appendChild(toggle);
  }



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

    // 트리플악셀은 3회 고정 기술이지만 빗나가면 거기서 끊긴다.
    // 타격마다 위력이 20/40/60 으로 달라서, 몇 대 맞혔는지가 대미지를 크게 가른다.
    const escalating = isEscalating(move);

    if (!escalating && (skillLink || minHits === maxHits)) {
      control.appendChild(
        el(
          'span',
          { class: 'calc__hits-fixed' },
          `${hits}회 고정`,
          skillLink ? el('span', { class: 'calc__hits-why' }, ' — 스킬링크') : null,
        ),
      );
    } else {
      const first = escalating ? 1 : minHits;
      control.appendChild(
        searchSelect({
          options: Array.from({ length: maxHits - first + 1 }, (_, i) => ({
            value: String(first + i),
            label: `${first + i}회`,
          })),
          value: String(hits),
          placeholder: `${hits}회`,
          ariaLabel: `${move.displayName} 타격 수`,
          className: 'calc__select',
          onPick: (raw) => {
            hitChoices.set(move.englishName, Number(raw));
            hp.onChange();
          },
        }),
      );
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
  /** 방어 실수치 전 과정. 랭크만 바꿔가며 다시 부를 수 있어야 한다(지구력). */
  const defenseAtStage = (stage: number): number => {
    let value = effectiveStat(
      defenderForm.stats[defenseKey],
      defender.points[defenseKey],
      natureFor(defender, defenseKey),
      defenderStageIgnored ? 0 : stage,
    );
    value = Math.floor(value * resolved.defender.defenseMultiplier);
    if (defenderItem?.defenseMultiplier && (!defenderItem.specialDefenseOnly || category === 'special')) {
      value = Math.floor(value * defenderItem.defenseMultiplier);
    }
    const weatherDef = weatherDefenseMultiplier(effectiveWeather, defenderForm.types, category);
    if (weatherDef !== 1) value = Math.floor(value * weatherDef);
    return value;
  };
  const baseDefenseStage = defender.stages[defenseKey];
  const defenseStat = defenseAtStage(baseDefenseStage);

  /**
   * 지구력 — 맞을 때마다 방어가 1랭크 오른다.
   * 연속기에서는 2타·3타가 더 단단한 방어를 상대하므로 타격마다 다시 계산해야 한다.
   * 방어가 오르는 것이라 특수기에는 영향이 없다.
   */
  const stamina = defender.ability === 'Stamina' && category === 'physical' && !defenderStageIgnored;
  const perHitDefenses = stamina
    ? Array.from({ length: hits }, (_, i) => defenseAtStage(baseDefenseStage + i))
    : undefined;

  /*
   * 자속.
   *
   * 변환자재·리베로는 특성 자체가 stabOverride(1.5)를 주지만, 실제로는 등장 후
   * **한 번만** 타입이 바뀐다. 그러니 네 기술 전부에 자속을 붙이면 과대평가가 된다.
   * 사용자가 켠 기술에만 적용하고, 끈 기술은 원래 타입 기준으로 되돌린다.
   */
  const stab = hasConvertingAbility
    ? proteanStab.has(move.englishName)
      ? (resolved.attacker.stabOverride ?? 1.5)
      : stabMultiplier(moveType, attackerForm.types)
    : (resolved.attacker.stabOverride ?? stabMultiplier(moveType, attackerForm.types));

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
    // 타격마다 위력이 커지는 기술은 타격별 위력을 넘긴다 (트리플악셀 20/40/60).
    perHitPowers: isEscalating(move) ? escalatingPowers(move, hits) : undefined,
    perHitDefenses,
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
        // 타격마다 위력이 다르면 한 줄로 뭉뚱그릴 수 없다 — 타별로 적는다.
        isEscalating(move)
          ? result.perHitRanges.map(([lo, hi], i) => `${i + 1}타 ${lo}~${hi}`).join(' · ')
          : `1회 타격 ${result.rolls[0] ?? 0} ~ ${result.rolls[result.rolls.length - 1] ?? 0} · ${hits}회 연속`,
      ),
    );
  }
  return row;
}
