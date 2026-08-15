import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    /*
     * 기본값 5초로는 렌더 테스트가 머신 부하에 따라 무작위로 하나씩 터진다.
     * 한 건이 `mountApp` → 어댑터 5종 대기 → 뷰 렌더까지 도는 무거운 테스트라
     * 같은 코드로도 실행마다 24초와 49초를 오간다(101건 합계).
     * 느려서 실패하는 것과 틀려서 실패하는 것을 섞지 않으려고 여유를 준다.
     */
    testTimeout: 20_000,
  },
});
