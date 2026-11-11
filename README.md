# Xe Chuyên Dụng — Server API

REST API viết bằng NestJS/TypeScript, cung cấp nội dung công khai, API quản trị
nhiều tài khoản và tiếp nhận yêu cầu liên hệ. Dữ liệu được lưu trong PostgreSQL
bằng thư viện `pg` và các migration SQL trong `migrations/`. Hợp đồng OpenAPI
được duy trì tại [`openapi.yaml`](./openapi.yaml).

Client Next.js nằm ở repository
[`xechuyendung_project`](https://github.com/NguyenDinhNam28803/xechuyendung_project).
Sơ đồ hệ thống, người dùng, luồng dữ liệu và quy trình nghiệp vụ:
[`docs/architecture.md`](./docs/architecture.md).

## Kiến trúc

```text
Next.js client (port 3000)
  ├─ public content ───────────────> NestJS (port 4000) ──> PostgreSQL
  ├─ contact proxy ────────────────> POST /contact-submissions
  └─ admin proxy + bearer token ───> /auth/*, /admin/*

NestJS modules: auth, admin-users, vehicles, articles, legal-resources,
contact-submissions, content-import, activity, maintenance, security, health,
database
```

Client chuyển tiếp request qua Next.js; trình duyệt không gọi API NestJS trực
tiếp.

### Xác thực và phân quyền

- Tài khoản quản trị lưu trong bảng `admin_users`; mật khẩu băm bằng **scrypt**
  (N=2^15, r=8, p=1, salt 16 byte), tối thiểu 12 ký tự.
- Đăng nhập trả về **token ngẫu nhiên 256 bit**; database chỉ lưu SHA-256 của
  token trong `admin_sessions`. Phiên sống 8 giờ và **thu hồi được ngay**:
  đăng xuất, khóa tài khoản, đổi vai trò hoặc đặt lại mật khẩu đều vô hiệu
  hóa phiên tương ứng.
- Vai trò:
  - `admin`: toàn quyền, gồm quản lý tài khoản (`/admin/users`).
  - `editor`: quản lý nội dung, hộp thư liên hệ, xem lịch sử.
- Không thể tự khóa hoặc tự đổi vai trò; hệ thống luôn giữ ít nhất một
  `admin` đang hoạt động.
- Audit log ghi `actor` (tên đăng nhập) và `actor_id` của người thực hiện.

**Đánh đổi:** so với token HMAC stateless trước đây, mỗi request quản trị tốn
thêm một truy vấn PostgreSQL theo khóa UNIQUE. Đổi lại có thể thu hồi phiên
tức thì và biết chính xác ai thao tác.

**Tài khoản đầu tiên:** khi bảng `admin_users` trống, server tạo một tài
khoản `admin` từ `ADMIN_USERNAME`/`ADMIN_PASSWORD` lúc khởi động. Sau đó hai
biến này không còn tác dụng — đổi mật khẩu trong trang quản trị.

## Yêu cầu và cấu hình

Yêu cầu Node.js 22/npm và PostgreSQL (đã kiểm thử với 16). Tạo `.env` (không
commit file này) theo `.env.example`:

```dotenv
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DATABASE
DATABASE_SSL=true
ADMIN_USERNAME=admin
ADMIN_PASSWORD=replace-with-a-strong-unique-password
PORT=4000
TRUST_PROXY=0
ACTIVITY_RETENTION_DAYS=
```

- `DATABASE_URL`: connection string PostgreSQL; giữ bí mật.
- `DATABASE_SSL=true`: bật TLS và xác thực chứng chỉ database.
- `ADMIN_USERNAME`, `ADMIN_PASSWORD`: chỉ dùng để tạo quản trị viên đầu tiên.
- `PORT`: mặc định `4000`.
- `TRUST_PROXY`: mặc định tắt. Khi chạy sau reverse proxy, đặt đúng số hop
  hoặc subnet tin cậy để rate limit nhận IP client thật.
- `ACTIVITY_RETENTION_DAYS`: tùy chọn, số nguyên ≥ 30; bỏ trống để giữ lịch
  sử vĩnh viễn.
- `ADMIN_AUTH_SECRET` của phiên bản cũ **không còn cần thiết**.

## Chạy local

```bash
npm install
npm run db:migrate
npm run start:dev
```

API mặc định tại `http://localhost:4000`. `GET /health/live` kiểm tra process,
`GET /health/ready` kiểm tra thêm kết nối PostgreSQL. Khởi chạy client trong
terminal khác với `CONTENT_API_URL=http://localhost:4000/api/v1`.

## API

### Công khai

| Method | Đường dẫn                          | Mô tả                                        |
| ------ | ---------------------------------- | -------------------------------------------- |
| `GET`  | `/api/v1/vehicles`                 | Xe đã công khai; phân trang khi có `page`    |
| `GET`  | `/api/v1/vehicles/:slug`           | Chi tiết xe đã công khai                     |
| `GET`  | `/api/v1/articles`                 | Bài viết đã công khai; phân trang khi có `page` |
| `GET`  | `/api/v1/articles/:slug`           | Chi tiết bài viết đã công khai               |
| `GET`  | `/api/v1/legal-resources?type=...` | Tài liệu đã công khai; type tùy chọn         |
| `POST` | `/api/v1/contact-submissions`      | Lưu yêu cầu liên hệ hợp lệ                   |
| `POST` | `/api/v1/auth/login`               | Đăng nhập quản trị                           |

Danh sách công khai giữ tương thích ngược: không truyền `page`/`limit` thì trả
mảng như cũ; có `page` hoặc `limit` thì trả `{ items, pagination }` (mặc định
12 mục, hỗ trợ `q`).

### Cần `Authorization: Bearer <token>`

| Method            | Đường dẫn                                      | Vai trò | Mô tả                           |
| ----------------- | ---------------------------------------------- | ------- | ------------------------------- |
| `POST`            | `/api/v1/auth/logout`                          | mọi     | Thu hồi phiên hiện tại          |
| `GET`             | `/api/v1/auth/me`                              | mọi     | Thông tin tài khoản đang đăng nhập |
| `POST`            | `/api/v1/admin/account/password`               | mọi     | Đổi mật khẩu, đăng xuất thiết bị khác |
| `GET`, `POST`     | `/api/v1/admin/users`                          | admin   | Liệt kê/tạo tài khoản           |
| `PATCH`           | `/api/v1/admin/users/:id`                      | admin   | Sửa, khóa/mở, đặt lại mật khẩu  |
| `GET`, `POST`     | `/api/v1/admin/vehicles`                       | mọi     | Liệt kê/tạo xe                  |
| `PATCH`, `DELETE` | `/api/v1/admin/vehicles/:id`                   | mọi     | Sửa/xóa xe                      |
| `GET`, `POST`     | `/api/v1/admin/articles`                       | mọi     | Liệt kê/tạo bài viết            |
| `PATCH`, `DELETE` | `/api/v1/admin/articles/:id`                   | mọi     | Sửa/xóa bài viết                |
| `POST`            | `/api/v1/admin/import-defaults`                | mọi     | Thêm nội dung mẫu còn thiếu (bản nháp) |
| `GET`, `POST`     | `/api/v1/admin/legal-resources`                | mọi     | Liệt kê/tạo tài liệu pháp lý    |
| `PATCH`, `DELETE` | `/api/v1/admin/legal-resources/:id`            | mọi     | Sửa/xóa tài liệu                |
| `GET`             | `/api/v1/admin/activity`                       | mọi     | Lịch sử hoạt động               |
| `GET`             | `/api/v1/admin/contact-submissions`            | mọi     | Danh sách phân trang            |
| `POST`            | `/api/v1/admin/contact-submissions/search`     | mọi     | Tìm contact, từ khóa trong body |
| `PATCH`           | `/api/v1/admin/contact-submissions/:id/status` | mọi     | Cập nhật trạng thái             |
| `DELETE`          | `/api/v1/admin/contact-submissions/:id`        | mọi     | Xóa yêu cầu và dữ liệu liên hệ  |

Danh sách admin hỗ trợ `page` (từ 1), `limit` (mặc định 25, tối đa 100) và `q`
(tối đa 100 ký tự). Kết quả dạng `{ items, pagination: { page, limit, total,
totalPages } }`. Contact search nhận `{ "search": "..." }` trong body để dữ
liệu cá nhân không xuất hiện trên URL/log truy cập.

### Rate limit

| Endpoint                             | Giới hạn                                   |
| ------------------------------------ | ------------------------------------------ |
| `POST /api/v1/auth/login`            | 5 request/IP/15 phút và 10 lần/tài khoản/15 phút |
| `POST /api/v1/contact-submissions`   | 10 request/IP/giờ                          |

Bộ đếm lưu trong bảng UNLOGGED `rate_limits` bằng **một câu upsert nguyên tử**,
nên dùng chung giữa mọi instance. Khóa được băm SHA-256 (không lưu IP thô).
Khi chưa cấu hình hoặc PostgreSQL tạm lỗi, server dùng bộ đếm trong RAM của
từng process (ưu tiên tính sẵn sàng). Đánh đổi so với Redis: thêm một lệnh
ghi PostgreSQL cho mỗi request được giới hạn, nhưng không cần thêm hạ tầng.
Vẫn nên đặt WAF/rate limit ở reverse proxy để chặn tấn công lưu lượng lớn.

### Tìm kiếm

Tìm kiếm không phân biệt hoa thường; `%` và `_` được so khớp theo nghĩa đen.
Migration 006 tạo index GIN `pg_trgm` trên biểu thức gộp các cột cần tìm
(khai báo trong `src/common/search.ts`), giúp `ILIKE '%từ khóa%'` không phải
quét toàn bảng. Nếu tài khoản migration không có quyền `CREATE EXTENSION`,
migration bỏ qua phần index — tìm kiếm vẫn đúng nhưng chậm hơn.

### Validation và dữ liệu

- Xe, bài viết và tài liệu pháp lý được kiểm tra kiểu/trường và giới hạn độ
  dài; trường không hỗ trợ bị từ chối. Slug có unique constraint.
- Ảnh xe lưu dưới dạng danh sách đường dẫn/URL; server chưa nhận upload file.
- `isPublished=false` giữ nội dung ở chế độ nháp; endpoint công khai chỉ trả
  nội dung đã xuất bản.
- Import mẫu chạy trong transaction, tối đa 200 mục, bỏ qua slug đã tồn tại,
  không ghi đè và **luôn lưu ở trạng thái nháp** để người quản trị duyệt.
- Yêu cầu liên hệ cần tên, số điện thoại hợp lệ, danh mục xe hợp lệ và
  consent. Nội dung consent do server quy định. Trạng thái gồm `new`,
  `in_progress`, `contacted`, `closed`, `spam`.
- Mọi thay đổi dữ liệu và audit tương ứng được ghi trong cùng transaction.
  Audit của yêu cầu liên hệ không chứa thông tin nhận dạng.
- `updated_at` được trigger `set_updated_at` cập nhật tự động.

### Tác vụ bảo trì định kỳ

`MaintenanceService` chạy khi khởi động và mỗi 24 giờ. Mỗi tác vụ chạy dưới
`pg_try_advisory_xact_lock` riêng, nên khi có nhiều instance chỉ một instance
thực hiện:

1. Xóa yêu cầu liên hệ quá **90 ngày** (thời hạn doanh nghiệp đã duyệt) và ghi
   một activity tổng hợp do `system` tạo.
2. Xóa phiên hết hạn/thu hồi quá 30 ngày và bộ đếm rate limit đã hết hạn.
3. Nếu đặt `ACTIVITY_RETENTION_DAYS`, xóa lịch sử cũ hơn số ngày đó.

Xóa khỏi database đang chạy không xóa dữ liệu trong backup; cần cấu hình
retention backup tương ứng.

## PostgreSQL và migrations

Migration chạy theo thứ tự tên file, ghi nhận trong `schema_migrations`, mỗi
file trong một transaction và được bảo vệ bằng advisory lock.

| Migration                                  | Nội dung                                              |
| ------------------------------------------ | ----------------------------------------------------- |
| `001_content_tables.sql`                   | Bảng xe và bài viết                                   |
| `002_legal_resources_and_activity.sql`     | Tài liệu pháp lý và audit log                         |
| `003_initial_policy_placeholders.sql`      | Một số nội dung chính sách mẫu                        |
| `004_contact_submissions.sql`              | Hộp thư liên hệ                                       |
| `005_admin_users_sessions_rate_limits.sql` | Tài khoản, phiên, rate limit, `actor_id`, trigger `updated_at` |
| `006_search_trigram_indexes.sql`           | Index `pg_trgm` cho tìm kiếm                          |

Nâng cấp từ phiên bản cũ: chạy `npm run db:migrate`, đảm bảo
`ADMIN_USERNAME`/`ADMIN_PASSWORD` (mật khẩu ≥ 12 ký tự) có trong môi trường
lần khởi động đầu tiên để tạo quản trị viên, rồi tạo thêm tài khoản cho từng
người trong trang quản trị. Token cũ (HMAC) không còn hợp lệ; người dùng cần
đăng nhập lại. Luôn backup database trước khi đổi schema trên production.

## Phát triển và kiểm thử

```bash
npm run start:dev        # Chạy API ở chế độ watch
npm run build            # Biên dịch NestJS
npm run lint             # Oxlint
npm test                 # Unit tests (Vitest)
npm run test:e2e         # HTTP/auth/validation e2e tests
npm run test:cov         # Coverage
npm run db:migrate       # Áp dụng migration
npm run test:integration # PostgreSQL integration; cần opt-in bên dưới
```

Integration test chỉ chạy khi có `TEST_DATABASE_URL` và
`RUN_POSTGRES_INTEGRATION=true`; database đích phải khác database ứng dụng và
có tên chứa `test`. Suite chạy migrations rồi kiểm tra: CRUD và retention của
contact, trigger `updated_at`, đăng nhập/thu hồi phiên, khóa tài khoản, bảo vệ
quản trị viên cuối, audit theo người thực hiện, escape tìm kiếm, rate limit
dùng chung và sự tồn tại của index trigram. Không dùng production hoặc
database có dữ liệu khách hàng.

### CI

`.github/workflows/ci.yml` chạy trên mỗi push vào `main` và mỗi pull request:
lint, build, unit, e2e, lint OpenAPI (Redocly) và integration test trên service
container PostgreSQL 16.

## Chạy production

```bash
npm ci
npm run db:migrate
npm run build
npm run start:prod
```

### Checklist triển khai và khôi phục

1. Cấu hình secrets trong secret store của môi trường deploy; xác minh
   `DATABASE_SSL` và `TRUST_PROXY` theo đúng nhà cung cấp.
2. Backup PostgreSQL trước migration. Chạy `npm run db:migrate`, sau đó
   build/start server và Next.js với `CONTENT_API_URL` trỏ đến API.
3. Kiểm tra `GET /health/live`, `GET /health/ready`, đăng nhập admin, gửi form
   thử trên staging, kiểm tra log bằng request ID.
4. Theo dõi lỗi 5xx, độ trễ API và PostgreSQL; cấu hình alert/WAF.
5. Nếu phát hành lỗi, khôi phục phiên bản ứng dụng trước. Migration phải tương
   thích ngược; chỉ restore backup sau khi đánh giá ảnh hưởng dữ liệu.

## Giới hạn còn lại

- Chống bot ở form chỉ có honeypot và rate limit; cân nhắc CAPTCHA nếu bị spam.
- Chưa có API upload ảnh.
- Chưa có xác thực hai lớp (2FA) cho tài khoản quản trị.
- Tìm kiếm chưa bỏ dấu tiếng Việt (cần extension `unaccent` và hàm wrapper
  IMMUTABLE nếu muốn tìm "xe cuu ho" ra "xe cứu hộ").
- Metrics/alerting và diễn tập restore cần cấu hình ở hạ tầng.

README này mô tả hiện trạng mã nguồn; không thay thế đánh giá pháp lý, threat
model, kiểm thử tải hoặc rà soát bảo mật trước khi phục vụ người dùng thật.
