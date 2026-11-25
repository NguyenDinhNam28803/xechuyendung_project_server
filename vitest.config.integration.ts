import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['test/**/*.integration-spec.ts'],
    // Mọi file integration dùng CHUNG một database và có test khẳng định
    // chênh lệch của số liệu toàn bảng (ví dụ thống kê liên hệ 7 ngày). Chạy
    // song song, file này có thể ghi dữ liệu xen vào giữa hai lần đo của file
    // kia. Chạy lần lượt để kết quả không phụ thuộc thứ tự thời gian.
    fileParallelism: false,
  },
});
