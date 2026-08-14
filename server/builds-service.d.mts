/**
 * builds-service.mjs 의 타입 선언.
 * 구현은 plain JS 로 둔다(서버는 빌드 단계 없이 node 로 바로 실행되므로).
 */

export interface ValidatedBuild {
  id: string;
  title: string;
  season: string;
  format: 'Singles' | 'Doubles';
  pokemon: string[];
  items: string[];
  moves: string[];
  note: string;
  sourceUrl: string;
  sourceLabel: string;
  translated: boolean;
}

export interface BuildsSnapshot {
  builds: ValidatedBuild[];
  /** 규칙 위반으로 버린 항목의 사유 목록 */
  rejected: string[];
  /** 큐레이션 파일의 최종 수정 시각. 없으면 파일이 아직 없다는 뜻. */
  updatedAt: string | null;
  mtimeMs: number;
}

export declare function validateBuilds(raw: unknown): {
  accepted: ValidatedBuild[];
  rejected: string[];
};

export declare function createBuildsService(rootDir: string): {
  get(): Promise<BuildsSnapshot>;
  sourceFile: string;
};
