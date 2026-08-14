/**
 * ranking-service.mjs 의 타입 선언.
 */

export interface RankingSnapshot {
  payload: unknown;
  fetchedAt: number;
  stale: boolean;
}

/** node:http ServerResponse 중 이 서비스가 실제로 쓰는 부분만. */
export interface MinimalResponse {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(body?: string): void;
}

export declare function createRankingService(log?: (msg: string) => void): {
  /** 매 호출마다 환경변수를 다시 읽는다 — 런타임에 켜고 끌 수 있어야 하므로. */
  isEnabled(): boolean;
  get(): Promise<RankingSnapshot>;
  handle(res: MinimalResponse): Promise<void>;
};
