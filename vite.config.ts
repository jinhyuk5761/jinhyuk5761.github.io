import path from 'node:path';
import { defineConfig } from 'vite';
import { createViteApiMiddleware } from './server/api.mjs';

/**
 * 개발 서버에도 프로덕션과 같은 /api 핸들러를 붙인다.
 * 그래야 "데이터가 생기면 재배포 없이 붙는다"를 개발 중에도 그대로 확인할 수 있다.
 */
/**
 * 배포 경로.
 *
 * 사용자 사이트(`<계정>.github.io`)면 루트라 '/' 이고,
 * 프로젝트 저장소면 '/<저장소명>/' 아래에 놓인다.
 * manifest 와 서비스워커는 이미 상대경로(`./`, `BASE_URL`)를 쓰므로 이 값만 맞추면 된다.
 */
const base = process.env.BASE_PATH ?? '/';

export default defineConfig({
  base,
  plugins: [
    {
      name: 'champions-api',
      configureServer(server) {
        server.middlewares.use(
          '/api',
          createViteApiMiddleware(path.resolve(import.meta.dirname), (msg: string) =>
            server.config.logger.info(msg),
          ),
        );
      },
    },
  ],
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
