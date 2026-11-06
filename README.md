# Xe Chuyên Dụng — Server API

REST API viết bằng NestJS/TypeScript, cung cấp nội dung công khai, API quản trị
và tiếp nhận yêu cầu liên hệ. Dữ liệu được lưu trong PostgreSQL bằng thư viện
`pg` và các migration SQL trong `migrations/`. Hợp đồng OpenAPI được duy trì
tại [`openapi.yaml`](./openapi.yaml).

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
TRUST_PROXY=0
```

- `DATABASE_URL`: connection string PostgreSQL; giữ bí mật, không đưa xuống
  client hoặc commit vào repository.
- `DATABASE_SSL=true`: bật TLS và xác thực chứng chỉ database. Dùng theo yêu
  cầu của nhà cung cấp PostgreSQL.
- `ADMIN_AUTH_SECRET`: bắt buộc dài ít nhất 32 ký tự.
- `PORT`: mặc định `4000`.
- `TRUST_PROXY`: mặc định tắt. Sau deploy sau reverse proxy, đặt thành đúng
  số hop hoặc subnet tin cậy; không tin proxy do người dùng có thể bypass.
- Server giới hạn JSON request ở 64 KiB; form liên hệ qua Next.js đặt giới hạn
  request nhỏ hơn.

Ứng dụng và migration runner đều nạp biến từ `.env`. Nếu thiếu `DATABASE_URL`,
server có thể khởi động nhưng thao tác database sẽ trả lỗi dịch vụ chưa khả
dụng.

## Chạy local

```powershell
npm install
npm run db:migrate
npm run start:dev
```

API mặc định tại `http://localhost:4000`; root `GET /` vẫn là route mẫu
`Hello World!`. Dùng `GET /health/live` để kiểm tra process và
`GET /health/ready` để kiểm tra thêm kết nối PostgreSQL.
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

`POST /api/v1/auth/login` giới hạn 5 request mỗi IP trong 15 phút;
`POST /api/v1/contact-submissions` giới hạn 10 request mỗi IP mỗi giờ. Đây là
rate limiter trong bộ nhớ của từng process, không thay thế rate limit phân tán
ở WAF/reverse proxy. Đặt `TRUST_PROXY` chính xác để server nhận IP client thật.

### Quản trị — cần `Authorization: Bearer <token>`

| Method            | Đường dẫn                                      | Mô tả                           |
| ----------------- | ---------------------------------------------- | ------------------------------- |
| `GET`, `POST`     | `/api/v1/admin/vehicles`                       | Liệt kê/tạo xe                  |
| `PATCH`, `DELETE` | `/api/v1/admin/vehicles/:id`                   | Sửa/xóa xe                      |
| `GET`, `POST`     | `/api/v1/admin/articles`                       | Liệt kê/tạo bài viết            |
| `PATCH`, `DELETE` | `/api/v1/admin/articles/:id`                   | Sửa/xóa bài viết                |
| `POST`            | `/api/v1/admin/import-defaults`                | Thêm nội dung mẫu còn thiếu     |
| `GET`, `POST`     | `/api/v1/admin/legal-resources`                | Liệt kê/tạo tài liệu pháp lý    |
| `PATCH`, `DELETE` | `/api/v1/admin/legal-resources/:id`            | Sửa/xóa tài liệu                |
| `GET`             | `/api/v1/admin/activity`                       | Các hoạt động gần đây           |
| `GET`             | `/api/v1/admin/contact-submissions`            | Danh sách phân trang            |
| `POST`            | `/api/v1/admin/contact-submissions/search`     | Tìm contact, từ khóa trong body |
| `PATCH`           | `/api/v1/admin/contact-submissions/:id/status` | Cập nhật trạng thái             |
| `DELETE`          | `/api/v1/admin/contact-submissions/:id`        | Xóa yêu cầu và dữ liệu liên hệ  |

Login nhận `{ "username": "...", "password": "..." }`, trả
`accessToken` và `expiresIn` (giây). Trang quản trị dùng Next.js API proxy để
giữ token trong cookie `HttpOnly`; không lưu token trong `localStorage`.

Các danh sách admin hỗ trợ `page` (bắt đầu từ 1), `limit` (mặc định 25, tối
đa 100) và `q` (tối đa 100 ký tự). Activity mặc định trả tối đa 100 mục. Kết
quả có dạng `{ items, pagination: { page, limit, total, totalPages } }`;
contact search nhận `{ "search": "..." }` trong body để tránh đưa dữ liệu cá
nhân lên URL/log truy cập. Danh sách nội dung public hiện chưa phân trang.

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
- Theo thời hạn đã được doanh nghiệp duyệt là **90 ngày**, server xóa contact
  cũ hơn 90 ngày khi khởi động và sau đó mỗi 24 giờ. Mỗi lần xóa có activity
  tổng hợp do `system` tạo, không kèm dữ liệu cá nhân. Xóa khỏi database đang
  hoạt động không tự xóa dữ liệu trong backup; lịch backup/retention cần được
  cấu hình tương ứng.

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
npm run test:integration # PostgreSQL integration; requires explicit opt-in below
```

Các test hiện kiểm tra validation nội dung, auth token, quyền truy cập admin,
pagination, rate limit, health controller và một số HTTP routes. E2E suite
chưa xác minh đầy đủ CRUD PostgreSQL thật; luồng database nên tiếp tục được
kiểm thử trên database staging riêng.

Integration test chỉ chạy khi có `TEST_DATABASE_URL` và
`RUN_POSTGRES_INTEGRATION=true`; database đích phải khác database ứng dụng và
có tên chứa `test`. Suite chạy migrations lên database đích rồi tạo/xóa dữ
liệu kiểm thử và kiểm tra retention/audit. Chỉ bật cờ này với database
disposable riêng; không dùng production hoặc database có dữ liệu khách hàng.
Không đưa connection string vào command history hay gửi trong chat.

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

### Checklist triển khai và khôi phục

1. Cấu hình secrets trong secret store của môi trường deploy; xác minh
   `DATABASE_SSL` và `TRUST_PROXY` theo đúng nhà cung cấp. Không chép `.env`
   thật vào log, ticket hoặc repository.
2. Tạo/kiểm tra backup PostgreSQL trước migration. Deploy API, chạy
   `npm run db:migrate` trong quy trình phát hành, sau đó build/start server và
   Next.js với `CONTENT_API_URL` trỏ đến API có thể truy cập từ máy chạy
   Next.js.
3. Kiểm tra `GET /health/live`, `GET /health/ready`, đăng nhập admin, xem danh
   sách phân trang, gửi form thử trên staging và kiểm tra log bằng request ID.
   Không dùng dữ liệu khách hàng thật khi smoke test.
4. Theo dõi lỗi HTTP 5xx, độ trễ API và trạng thái PostgreSQL qua nền tảng
   giám sát; cấu hình alert/WAF và rate limit tại reverse proxy. Không tin
   `X-Forwarded-For` nếu `TRUST_PROXY` không khớp topology thực tế.
5. Nếu phát hành lỗi, dừng rollout và khôi phục phiên bản ứng dụng trước.
   Migration phải tương thích ngược; không tự động chạy rollback SQL. Chỉ
   restore backup sau khi đánh giá ảnh hưởng dữ liệu và chọn đúng restore
   point. Diễn tập quy trình này trên staging trước khi production.

Retention 90 ngày áp dụng cho database đang chạy; backup có vòng đời riêng.
Doanh nghiệp cần xác nhận retention/ủy quyền truy cập backup và diễn tập restore
định kỳ, vì xóa một submission khỏi database không xóa bản sao backup đã tạo.

## Giới hạn và việc cần hoàn thiện trước production

- Rate limit ứng dụng hiện lưu state trong RAM, chỉ áp dụng trong từng process;
  cần rate limit phân tán tại WAF/reverse proxy khi chạy nhiều instance.
- Chống bot ở form chỉ là honeypot cơ bản, không thay thế rate limit hoặc biện
  pháp chống abuse.
- Admin hiện dùng một tài khoản/mật khẩu dùng chung qua environment; chưa có
  quản lý nhiều người dùng, phân quyền theo vai trò, đổi mật khẩu hoặc thu hồi
  token trước hạn 8 giờ.
- Retention 90 ngày đã được duyệt và purge tự động đã được thêm cho dữ liệu
  live; vẫn cần cấu hình/xác nhận thời hạn lưu backup và quy trình quyền riêng tư.
- `/health/live` và `/health/ready` đã có; metrics/alerting và diễn tập restore
  vẫn cần cấu hình ở hạ tầng.
- Chưa có API upload ảnh hoặc kiểm thử tích hợp PostgreSQL trong CI.
- Client/server build, lint, unit và HTTP e2e đã được xác minh; chưa được xem
  là sign-off production khi chưa có kiểm thử PostgreSQL trên database riêng,
  staging smoke test, restore rehearsal và kiểm tra WAF/proxy.

README này mô tả hiện trạng mã nguồn; không thay thế đánh giá pháp lý, threat
model, kiểm thử tải hoặc rà soát bảo mật trước khi phục vụ người dùng thật.
