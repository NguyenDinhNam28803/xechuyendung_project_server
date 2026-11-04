# Xe Chuyên Dụng — Server API

REST API viết bằng NestJS/TypeScript, cung cấp nội dung công khai, API quản trị
và tiếp nhận yêu cầu liên hệ. Dữ liệu được lưu trong PostgreSQL bằng thư viện
`pg` và các migration SQL trong `migrations/`.

## Kiến trúc

```text
Next.js client (port 3000)
  ├─ public content ───────────────> NestJS (port 4000) ──> PostgreSQL
  ├─ contact proxy ────────────────> POST /contact-submissions
  └─ admin proxy + bearer token ───> /admin/*

NestJS modules: auth, vehicles, articles, legal-resources,
contact-submissions, activity, database
```

Client chuyển tiếp request qua Next.js; trình duyệt không cần gọi API NestJS
trực tiếp. API admin yêu cầu bearer token. Login dùng một tài khoản được cấu
hình bằng environment variables; server ký token HMAC-SHA256 có thời hạn 8 giờ.
Token được Next.js giữ trong cookie `HttpOnly`.

## Yêu cầu và cấu hình

Yêu cầu Node.js/npm và một PostgreSQL database có thể truy cập từ server.
Tạo `server/.env` (không commit file này) với các biến:

```dotenv
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DATABASE
DATABASE_SSL=true
ADMIN_USERNAME=admin
ADMIN_PASSWORD=replace-with-a-strong-unique-password
ADMIN_AUTH_SECRET=replace-with-a-random-secret-at-least-32-characters
PORT=4000
```

- `DATABASE_URL`: connection string PostgreSQL; giữ bí mật, không đưa xuống
  client hoặc commit vào repository.
- `DATABASE_SSL=true`: bật TLS và xác thực chứng chỉ database. Dùng theo yêu
  cầu của nhà cung cấp PostgreSQL.
- `ADMIN_AUTH_SECRET`: bắt buộc dài ít nhất 32 ký tự.
- `PORT`: mặc định `4000`.

Ứng dụng và migration runner đều nạp biến từ `.env`. Nếu thiếu `DATABASE_URL`,
server có thể khởi động nhưng thao tác database sẽ trả lỗi dịch vụ chưa khả
dụng.

## Chạy local

```powershell
npm install
npm run db:migrate
npm run start:dev
```

API mặc định tại `http://localhost:4000`; root `GET /` trả `Hello World!`.
Khởi chạy client trong terminal khác và đặt `CONTENT_API_URL` thành
`http://localhost:4000/api/v1`. Xem [README client](../client/README.md).

## API

### Công khai

| Method | Đường dẫn                          | Mô tả                                |
| ------ | ---------------------------------- | ------------------------------------ |
| `GET`  | `/api/v1/vehicles`                 | Danh sách xe đã công khai            |
| `GET`  | `/api/v1/vehicles/:slug`           | Chi tiết xe đã công khai             |
| `GET`  | `/api/v1/articles`                 | Danh sách bài viết đã công khai      |
| `GET`  | `/api/v1/articles/:slug`           | Chi tiết bài viết đã công khai       |
| `GET`  | `/api/v1/legal-resources?type=...` | Tài liệu đã công khai; type tùy chọn |
| `POST` | `/api/v1/contact-submissions`      | Lưu yêu cầu liên hệ hợp lệ           |
| `POST` | `/api/v1/auth/login`               | Đăng nhập admin                      |

### Quản trị — cần `Authorization: Bearer <token>`

| Method            | Đường dẫn                                      | Mô tả                          |
| ----------------- | ---------------------------------------------- | ------------------------------ |
| `GET`, `POST`     | `/api/v1/admin/vehicles`                       | Liệt kê/tạo xe                 |
| `PATCH`, `DELETE` | `/api/v1/admin/vehicles/:id`                   | Sửa/xóa xe                     |
| `GET`, `POST`     | `/api/v1/admin/articles`                       | Liệt kê/tạo bài viết           |
| `PATCH`, `DELETE` | `/api/v1/admin/articles/:id`                   | Sửa/xóa bài viết               |
| `POST`            | `/api/v1/admin/import-defaults`                | Thêm nội dung mẫu còn thiếu    |
| `GET`, `POST`     | `/api/v1/admin/legal-resources`                | Liệt kê/tạo tài liệu pháp lý   |
| `PATCH`, `DELETE` | `/api/v1/admin/legal-resources/:id`            | Sửa/xóa tài liệu               |
| `GET`             | `/api/v1/admin/activity`                       | Các hoạt động gần đây          |
| `GET`             | `/api/v1/admin/contact-submissions`            | Tối đa 200 yêu cầu mới nhất    |
| `PATCH`           | `/api/v1/admin/contact-submissions/:id/status` | Cập nhật trạng thái            |
| `DELETE`          | `/api/v1/admin/contact-submissions/:id`        | Xóa yêu cầu và dữ liệu liên hệ |

Login nhận `{ "username": "...", "password": "..." }`, trả
`accessToken` và `expiresIn` (giây). Trang quản trị dùng Next.js API proxy để
giữ token trong cookie `HttpOnly`; không lưu token trong `localStorage`.

### Validation và dữ liệu

- Xe, bài viết và tài liệu pháp lý được kiểm tra kiểu/trường và giới hạn độ dài;
  trường không hỗ trợ bị từ chối. Slug có unique constraint trong PostgreSQL.
- Ảnh xe lưu dưới dạng danh sách đường dẫn/URL; server không nhận upload file.
- `isPublished=false` giữ nội dung ở chế độ nháp; endpoint công khai chỉ trả
  nội dung đã xuất bản.
- Import mẫu chạy trong transaction, bỏ qua slug đã tồn tại và không ghi đè nội
  dung. Qua admin client, dữ liệu mẫu được nhập ở trạng thái công khai.
- Yêu cầu liên hệ cần tên, số điện thoại hợp lệ, danh mục xe hợp lệ và consent.
  `location`, `message` và `vehicleSlug` là tùy chọn. Trạng thái gồm `new`,
  `in_progress`, `contacted`, `closed`, `spam`.
- Cập nhật/xóa nội dung và hoạt động tương ứng được ghi trong transaction.
  Audit log của yêu cầu liên hệ không ghi thông tin nhận dạng hoặc nội dung
  tin nhắn.

## PostgreSQL và migrations

Các migration số thứ tự được chạy theo tên file và ghi nhận trong bảng
`schema_migrations`. Mỗi file mới chạy trong transaction; chạy lại
`npm run db:migrate` sẽ bỏ qua migration đã áp dụng.

| Migration                              | Nội dung                             |
| -------------------------------------- | ------------------------------------ |
| `001_content_tables.sql`               | Bảng xe và bài viết                  |
| `002_legal_resources_and_activity.sql` | Tài liệu pháp lý và audit log        |
| `003_initial_policy_placeholders.sql`  | Một số nội dung chính sách mẫu       |
| `004_contact_submissions.sql`          | Hộp thư liên hệ và loại activity mới |

Trên môi trường mới, xác nhận connection string/environment rồi chạy
`npm run db:migrate` trước khi phát hành server. Migration 003 tạo placeholders
được công khai; cần duyệt/sửa nội dung trong admin trước khi dùng cho khách
hàng. Luôn backup database trước các thay đổi schema trên production.

## Phát triển và kiểm thử

```bash
npm run start:dev   # Chạy API ở chế độ watch
npm run build       # Biên dịch NestJS
npm run lint        # Oxlint
npm test            # Unit tests (Vitest)
npm run test:e2e    # HTTP/auth/validation e2e tests
npm run test:cov    # Coverage
npm run db:migrate  # Áp dụng migration
```

Các test hiện kiểm tra validation nội dung, auth token, quyền truy cập admin
và một số HTTP routes. E2E suite chưa xác minh đầy đủ CRUD PostgreSQL thật;
luồng database nên tiếp tục được kiểm thử trên database staging riêng.

## Chạy production

```bash
npm ci
npm run db:migrate
npm run build
npm run start:prod
```

Đặt các biến môi trường ở secret store của nền tảng deploy. Server phải truy
cập được PostgreSQL; Next.js phải truy cập được URL NestJS được khai báo trong
`CONTENT_API_URL`. Nếu database yêu cầu TLS, bật `DATABASE_SSL=true`. Dùng
HTTPS cho các kết nối bên ngoài và không expose PostgreSQL trực tiếp ra Internet.

## Giới hạn và việc cần hoàn thiện trước production

- Chưa có rate limiting ở ứng dụng cho form liên hệ hoặc đăng nhập; đặt giới
  hạn ở reverse proxy/WAF trước khi public.
- Chống bot ở form chỉ là honeypot cơ bản, không thay thế rate limit hoặc biện
  pháp chống abuse.
- Admin hiện dùng một tài khoản/mật khẩu dùng chung qua environment; chưa có
  quản lý nhiều người dùng, phân quyền theo vai trò, đổi mật khẩu hoặc thu hồi
  token trước hạn 8 giờ.
- Chưa có retention/purge tự động cho contact submissions. Cần xác định thời
  hạn lưu, người chịu trách nhiệm và quy trình xử lý yêu cầu xóa/truy cập dữ
  liệu cá nhân.
- Chưa có endpoint health/readiness riêng, metrics/alerting hoặc hướng dẫn
  restore backup. Root endpoint chỉ là route mẫu, không xác nhận database sẵn
  sàng.
- Chưa có API upload ảnh, phân trang đầy đủ cho các danh sách quản trị hoặc
  kiểm thử tích hợp PostgreSQL trong CI.

README này mô tả hiện trạng mã nguồn; không thay thế đánh giá pháp lý, threat
model, kiểm thử tải hoặc rà soát bảo mật trước khi phục vụ người dùng thật.
