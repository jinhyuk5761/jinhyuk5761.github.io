/**
 * shared/names.mjs 를 앱 쪽에서 쓰기 위한 재수출.
 *
 * 구현을 여기 복사하지 않는 이유: 빌드 스크립트(node)와 앱이 매칭 규칙을
 * 반드시 같은 코드로 공유해야 하기 때문. 규칙이 갈라지면 빌드타임에 매칭된
 * 카운터가 런타임에 안 맞는 사고가 난다. 타입은 shared/names.d.mts 에 있다.
 */

export {
  buildFormIndex,
  matchesQuery,
  orderlessKey,
  resolveSmogonName,
  toId,
} from '../../shared/names.mjs';

export type { FormIndex, FormLookupTarget } from '../../shared/names.mjs';
