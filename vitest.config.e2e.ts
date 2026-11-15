import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // E2E khởi động AppModule: không bao giờ dùng DATABASE_URL từ shell
    // (có thể là database production) — API chạy ở chế độ không có DB.
    env: { DATABASE_URL: '', ADMIN_USERNAME: '', ADMIN_PASSWORD: '' },
  },
});
