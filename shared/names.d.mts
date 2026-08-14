/**
 * shared/names.mjs 의 타입 선언.
 *
 * 구현은 plain JS 로 두고(빌드 스크립트와 앱이 같은 코드를 공유해야 하므로)
 * 타입만 여기서 정확히 못박는다. JSDoc 추론에 맡기면 object 로 뭉개진다.
 */

export interface FormLookupTarget {
  savedName: string;
  formName: string;
  slug: string;
  showdownId: string;
  /** 호출부가 임의 필드를 더 실어 보내도 되게 열어둔다. */
  [key: string]: unknown;
}

export interface FormIndex {
  byKey: Map<string, FormLookupTarget>;
  byId: Map<string, FormLookupTarget>;
}

export declare function toId(value: unknown): string;

export declare function orderlessKey(value: string): string;

export declare function buildFormIndex(forms: FormLookupTarget[]): FormIndex;

export declare function resolveSmogonName(
  smogonName: string,
  index: FormIndex,
): FormLookupTarget | null;

export declare function matchesQuery(
  query: string,
  haystacks: (string | null | undefined)[],
): boolean;

export declare const ALIASES: Record<string, string>;

export declare const KNOWN_ABSENT: Set<string>;
