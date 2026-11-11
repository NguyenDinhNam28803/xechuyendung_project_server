# Kiến trúc hệ thống Xe Chuyên Dụng

Tài liệu mô tả hệ thống sau đợt nâng cấp nhiều tài khoản quản trị, rate limit
dùng chung và tách module trang quản trị. Mọi sơ đồ viết bằng Mermaid nên
GitHub hiển thị trực tiếp và được cập nhật cùng mã nguồn.

| Repository                                                                                   | Vai trò                                      |
| -------------------------------------------------------------------------------------------- | -------------------------------------------- |
| [`xechuyendung_project`](https://github.com/NguyenDinhNam28803/xechuyendung_project)               | Next.js 16: website công khai + trang quản trị (BFF) |
| [`xechuyendung_project_server`](https://github.com/NguyenDinhNam28803/xechuyendung_project_server) | NestJS 12 REST API + PostgreSQL              |

Mục lục:

1. [Sơ đồ hệ thống](#1-sơ-đồ-hệ-thống)
2. [Sơ đồ người dùng và phân quyền](#2-sơ-đồ-người-dùng-và-phân-quyền)
3. [Sơ đồ luồng dữ liệu](#3-sơ-đồ-luồng-dữ-liệu)
4. [Các bước nghiệp vụ](#4-các-bước-nghiệp-vụ)
5. [Mô hình dữ liệu](#5-mô-hình-dữ-liệu)

---

## 1. Sơ đồ hệ thống

### 1.1 Kiến trúc tổng thể

Trình duyệt **không bao giờ gọi trực tiếp** NestJS. Next.js đóng vai trò
Backend-for-Frontend (BFF): render trang công khai phía server, nhận form liên
hệ và làm proxy có xác thực cho trang quản trị. Token phiên chỉ nằm trong cookie
`HttpOnly` giữa trình duyệt và Next.js.

```mermaid
flowchart LR
  subgraph Clients["Người dùng"]
    V["Khách truy cập"]
    E["Biên tập viên"]
    A["Quản trị viên"]
  end

  subgraph Next["Next.js 16 — xechuyendung_project (cổng 3000)"]
    PX["proxy.ts<br/>• /admin/* chưa có cookie → /admin/login<br/>• chặn POST/PATCH/DELETE khác origin"]
    PUB["Trang công khai (Server Components)<br/>/, /xe, /tin-tuc, /chinh-sach, /phap-ly, /lien-he"]
    ADM["Trang quản trị (Client Components)<br/>/admin/*"]
    RC["/api/contact<br/>honeypot, giới hạn 8 KB"]
    RA["/api/admin/session/*<br/>/api/admin/content/*<br/>whitelist đường dẫn + cookie HttpOnly"]
    SAMPLE[("Dữ liệu mẫu tĩnh<br/>app/data")]
  end

  subgraph Nest["NestJS 12 — xechuyendung_project_server (cổng 4000)"]
    G["Guards<br/>AdminAuthGuard + @Roles<br/>RateLimitGuard"]
    M1["Public API<br/>vehicles, articles,<br/>legal-resources, contact"]
    M2["Admin API<br/>CRUD nội dung, contact inbox,<br/>activity, users, account, import"]
    AU["Auth<br/>login / logout / me"]
    MT["MaintenanceService<br/>job 24h + advisory lock"]
    H["/health/live · /health/ready"]
  end

  DB[("PostgreSQL 16<br/>pg_trgm")]

  V --> PUB
  V --> RC
  E --> ADM
  A --> ADM
  ADM --> PX --> RA
  RC --> PX
  PUB -- "GET /api/v1/* (timeout 5s)" --> M1
  PUB -. "API không kết nối được" .-> SAMPLE
  RC -- "POST /api/v1/contact-submissions" --> G
  RA -- "Bearer token" --> G
  G --> M1
  G --> M2
  G --> AU
  M1 --> DB
  M2 --> DB
  AU --> DB
  MT --> DB
  H --> DB
```

### 1.2 Thành phần NestJS

```mermaid
flowchart TB
  APP["AppModule"] --> DBM["DatabaseModule (global)<br/>pg Pool, withTransaction, runExclusive"]
  APP --> SEC["SecurityModule<br/>RateLimitService (PostgreSQL + fallback RAM)"]
  APP --> AUTH["AuthModule<br/>AdminAuthService, AdminAuthGuard"]
  APP --> USERS["AdminUsersModule<br/>/admin/users, /admin/account"]
  APP --> VEH["VehiclesModule"]
  APP --> ART["ArticlesModule"]
  APP --> LEG["LegalResourcesModule"]
  APP --> CON["ContactSubmissionsModule"]
  APP --> IMP["ContentImportModule<br/>/admin/import-defaults"]
  APP --> ACT["ActivityModule<br/>insertActivity()"]
  APP --> MAI["MaintenanceModule"]
  APP --> HEA["HealthModule"]

  AUTH --> SEC
  USERS --> AUTH
  VEH --> AUTH
  ART --> AUTH
  LEG --> AUTH
  CON --> AUTH
  CON --> SEC
  IMP --> AUTH
  MAI --> CON

  subgraph Common["src/common"]
    PQ["paged-query.ts"]
    SR["search.ts (biểu thức trigram, escape LIKE)"]
    UB["update-builder.ts (whitelist cột)"]
    DE["database-errors.ts"]
  end
  VEH -.-> Common
  ART -.-> Common
  LEG -.-> Common
  CON -.-> Common
  USERS -.-> Common
```

### 1.3 Triển khai

```mermaid
flowchart LR
  U["Trình duyệt"] -- HTTPS --> RP["Reverse proxy / WAF<br/>TLS, rate limit lớp mạng"]
  RP --> N1["Next.js instance 1..n"]
  N1 -- "CONTENT_API_URL (mạng nội bộ)" --> S1["NestJS instance 1..n<br/>TRUST_PROXY = số hop tin cậy"]
  S1 -- "DATABASE_URL (TLS)" --> PG[("PostgreSQL<br/>backup + restore định kỳ")]
  GH["GitHub Actions CI<br/>lint · typecheck · test · build<br/>integration PostgreSQL 16"] -. "kiểm tra mỗi push/PR" .-> N1
  GH -.-> S1
```

Mọi trạng thái dùng chung (phiên, rate limit, khóa job) nằm trong PostgreSQL,
nên có thể chạy nhiều instance NestJS mà không cần sticky session hay Redis.

---

## 2. Sơ đồ người dùng và phân quyền

### 2.1 Tác nhân và chức năng (use case)

```mermaid
flowchart LR
  V(["👤 Khách truy cập"])
  E(["👤 Biên tập viên<br/>role = editor"])
  A(["👤 Quản trị viên<br/>role = admin"])
  S(["⚙ Hệ thống<br/>MaintenanceService"])

  subgraph Public["Website công khai"]
    UC1["Xem danh mục xe, lọc, tìm kiếm"]
    UC2["Xem chi tiết xe"]
    UC3["Đọc bài viết kiến thức"]
    UC4["Xem chính sách, quy định, pháp lý"]
    UC5["Gửi yêu cầu tư vấn (có đồng ý xử lý dữ liệu)"]
  end

  subgraph Admin["Trang quản trị"]
    UC10["Đăng nhập / đăng xuất"]
    UC11["Đổi mật khẩu của mình"]
    UC12["CRUD xe, bài viết"]
    UC13["CRUD chính sách, quy định, hướng dẫn"]
    UC14["Nhập nội dung mẫu (bản nháp)"]
    UC15["Xử lý yêu cầu liên hệ: đổi trạng thái, xóa"]
    UC16["Xem tổng quan và lịch sử hoạt động"]
    UC17["Quản lý tài khoản: tạo, đổi vai trò,<br/>khóa/mở, đặt lại mật khẩu"]
  end

  subgraph Jobs["Tác vụ tự động (24h)"]
    UC20["Xóa yêu cầu liên hệ quá 90 ngày"]
    UC21["Dọn phiên hết hạn và bộ đếm rate limit"]
    UC22["Xóa lịch sử cũ (nếu bật ACTIVITY_RETENTION_DAYS)"]
  end

  V --- UC1 & UC2 & UC3 & UC4 & UC5
  E --- UC10 & UC11 & UC12 & UC13 & UC14 & UC15 & UC16
  A --- UC10 & UC11 & UC12 & UC13 & UC14 & UC15 & UC16 & UC17
  S --- UC20 & UC21 & UC22
```

### 2.2 Ma trận quyền

| Chức năng                                    | Khách | Editor | Admin | Kiểm soát ở                         |
| -------------------------------------------- | :---: | :----: | :---: | ----------------------------------- |
| Xem nội dung đã công khai                    |  ✅   |   ✅   |  ✅   | `is_published = TRUE` trong truy vấn |
| Gửi yêu cầu tư vấn                           |  ✅   |   ✅   |  ✅   | Rate limit 10/IP/giờ, honeypot       |
| Đăng nhập, đổi mật khẩu của mình             |   –   |   ✅   |  ✅   | Rate limit 5/IP + 10/tài khoản/15 phút |
| Xem bản nháp, CRUD nội dung, nhập mẫu        |   –   |   ✅   |  ✅   | `AdminAuthGuard`                    |
| Xem/xử lý yêu cầu liên hệ                    |   –   |   ✅   |  ✅   | `AdminAuthGuard`                    |
| Xem lịch sử hoạt động                        |   –   |   ✅   |  ✅   | `AdminAuthGuard`                    |
| Quản lý tài khoản quản trị                   |   –   |   –    |  ✅   | `@Roles('admin')` → 403             |
| Tự khóa / tự đổi vai trò / bỏ admin cuối     |   –   |   –    |  ❌   | Kiểm tra trong `AdminUsersService`  |

---

## 3. Sơ đồ luồng dữ liệu

### 3.1 DFD mức 1

Quy ước: hình chữ nhật bo góc là **tiến trình**, hình trụ là **kho dữ liệu**,
hình chữ nhật là **tác nhân ngoài**.

```mermaid
flowchart LR
  V["Khách truy cập"]
  AD["Biên tập viên /<br/>Quản trị viên"]
  CLK["Đồng hồ hệ thống"]

  P1("P1. Cung cấp nội dung công khai")
  P2("P2. Tiếp nhận yêu cầu tư vấn")
  P3("P3. Xác thực và quản lý phiên")
  P4("P4. Quản lý nội dung")
  P5("P5. Xử lý yêu cầu liên hệ")
  P6("P6. Quản lý tài khoản")
  P7("P7. Ghi nhận hoạt động (audit)")
  P8("P8. Bảo trì và lưu trữ dữ liệu")

  D1[("D1 vehicles · articles ·<br/>legal_resources")]
  D2[("D2 contact_submissions")]
  D3[("D3 admin_users")]
  D4[("D4 admin_sessions")]
  D5[("D5 activity_logs")]
  D6[("D6 rate_limits")]

  V -- "yêu cầu trang" --> P1
  D1 -- "nội dung đã công khai" --> P1
  P1 -- "HTML trang" --> V

  V -- "họ tên, SĐT, nhu cầu, đồng ý" --> P2
  P2 -- "kiểm tra hạn mức (IP băm)" --> D6
  P2 -- "yêu cầu + consent_text + consent_at" --> D2

  AD -- "tên đăng nhập, mật khẩu" --> P3
  D3 -- "password_hash scrypt" --> P3
  P3 -- "SHA-256(token), hạn 8h" --> D4
  P3 -- "cookie HttpOnly" --> AD
  P3 -- "LOGIN / LOGOUT" --> P7

  AD -- "thêm/sửa/xóa, công khai/nháp" --> P4
  P4 <--> D1
  P4 -- "CREATE/UPDATE/DELETE/IMPORT" --> P7

  AD -- "tìm kiếm, đổi trạng thái, xóa" --> P5
  P5 <--> D2
  P5 -- "chỉ id + trạng thái, KHÔNG có PII" --> P7

  AD -- "tạo, đổi vai trò, khóa, đặt lại mật khẩu" --> P6
  P6 <--> D3
  P6 -- "thu hồi phiên" --> D4
  P6 --> P7

  P7 -- "actor, actor_id, hành động, nhãn" --> D5
  D5 -- "lịch sử" --> AD

  CLK -- "mỗi 24h" --> P8
  P8 -- "xóa > 90 ngày" --> D2
  P8 -- "xóa phiên hết hạn" --> D4
  P8 -- "xóa bộ đếm hết hạn" --> D6
  P8 -- "bản ghi tổng hợp do system tạo" --> P7
```

### 3.2 Luồng gửi yêu cầu tư vấn

```mermaid
sequenceDiagram
  autonumber
  actor K as Khách truy cập
  participant B as Trình duyệt
  participant N as Next.js /api/contact
  participant R as RateLimitGuard
  participant C as ContactSubmissionsService
  participant DB as PostgreSQL

  K->>B: Điền form, tích đồng ý, bấm Gửi
  B->>N: POST /api/contact (JSON)
  N->>N: Kiểm tra kích thước ≤ 8 KB, JSON hợp lệ
  alt Honeypot companyWebsite có giá trị
    N-->>B: 200 ok (âm thầm bỏ qua bot)
  else Hợp lệ
    N->>R: POST /api/v1/contact-submissions
    R->>DB: UPSERT rate_limits (SHA-256 của IP)
    alt Quá 10 yêu cầu/giờ
      R-->>N: 429 + Retry-After
      N-->>B: Thông báo thử lại sau
    else Trong hạn mức
      R->>C: parseContactSubmission()
      C->>C: Kiểm tra tên, SĐT, danh mục, consent = true
      C->>DB: INSERT contact_submissions<br/>(consent_text do server quy định, consent_at = NOW())
      DB-->>C: id
      C-->>N: 201 { ok, id }
      N-->>B: 200 { ok }
      B-->>K: Hiển thị đã gửi thành công
    end
  end
```

### 3.3 Luồng đăng nhập và một thao tác quản trị

```mermaid
sequenceDiagram
  autonumber
  actor U as Biên tập viên
  participant B as Trình duyệt
  participant P as proxy.ts
  participant N as Next.js route handlers
  participant G as AdminAuthGuard
  participant S as Service NestJS
  participant DB as PostgreSQL

  U->>B: Mở /admin/vehicles
  B->>P: GET /admin/vehicles
  P-->>B: 307 → /admin/login?next=/admin/vehicles (chưa có cookie)
  U->>B: Nhập tài khoản, mật khẩu
  B->>P: POST /api/admin/session/login
  P->>P: Origin khớp host?
  P->>N: chuyển tiếp
  N->>S: POST /api/v1/auth/login
  S->>DB: UPSERT rate_limits (IP và tên đăng nhập)
  S->>DB: SELECT admin_users WHERE lower(username)
  S->>S: verify scrypt (băm giả nếu không có tài khoản)
  S->>DB: INSERT admin_sessions(SHA-256 token)<br/>+ activity LOGIN (cùng transaction)
  S-->>N: { accessToken, expiresIn, user }
  N-->>B: Set-Cookie xe_admin_session (HttpOnly, SameSite=Lax)
  B->>B: router.replace(next an toàn)

  U->>B: Sửa xe, bấm Lưu
  B->>P: PATCH /api/admin/content/vehicles/{id}
  P->>N: Origin hợp lệ
  N->>N: isAllowedPath() + đọc cookie
  N->>G: PATCH /api/v1/admin/vehicles/{id} (Bearer)
  G->>DB: SELECT phiên còn hạn, chưa thu hồi, tài khoản đang hoạt động
  G->>S: request.admin = { id, username, role }
  S->>DB: BEGIN · UPDATE vehicles · INSERT activity_logs(actor, actor_id) · COMMIT
  S-->>B: 200 bản ghi đã cập nhật
```

### 3.4 Luồng đọc nội dung công khai (có dự phòng)

```mermaid
flowchart TD
  R["Yêu cầu trang /xe"] --> F["fetch CONTENT_API_URL/vehicles<br/>timeout 5 giây, no-store"]
  F -->|"Kết nối thất bại"| S["Dùng dữ liệu mẫu tĩnh app/data<br/>+ ghi log lỗi"]
  F -->|"HTTP lỗi (4xx/5xx)"| E["Báo lỗi trang<br/>(không che giấu lỗi thật)"]
  F -->|"200"| D["Dữ liệu từ PostgreSQL<br/>chỉ bản ghi is_published = TRUE"]
  S --> H["Render HTML"]
  D --> H
```

---

## 4. Các bước nghiệp vụ

### 4.1 Quy trình tiếp nhận và xử lý yêu cầu tư vấn

```mermaid
flowchart TD
  subgraph KH["Khách hàng"]
    A1["Xem xe / bài viết"] --> A2["Mở trang Liên hệ hoặc nút tư vấn trên trang xe"]
    A2 --> A3["Điền họ tên, SĐT, dòng xe quan tâm,<br/>khu vực, nhu cầu"]
    A3 --> A4{"Đồng ý lưu và<br/>xử lý thông tin?"}
    A4 -- "Không" --> A3
    A4 -- "Có" --> A5["Gửi yêu cầu"]
  end

  subgraph HT["Hệ thống"]
    B1{"Hợp lệ và trong<br/>hạn mức?"}
    B2["Lưu yêu cầu, trạng thái = Mới,<br/>lưu nội dung + thời điểm đồng ý"]
    B3["Báo lỗi / yêu cầu thử lại"]
  end

  subgraph NV["Biên tập viên"]
    C1["Mở Hộp thư yêu cầu liên hệ<br/>(tìm theo tên, SĐT, khu vực)"]
    C2["Đổi trạng thái → Đang xử lý"]
    C3["Gọi điện tư vấn (link tel:)"]
    C4{"Liên hệ được?"}
    C5["Trạng thái → Đã liên hệ"]
    C6["Gửi báo giá / hẹn xem xe<br/>(ngoài hệ thống)"]
    C7["Trạng thái → Hoàn tất"]
    C8["Đánh dấu Spam hoặc xóa<br/>(khách yêu cầu xóa dữ liệu)"]
  end

  A5 --> B1
  B1 -- "Không" --> B3 --> A3
  B1 -- "Có" --> B2 --> C1 --> C2 --> C3 --> C4
  C4 -- "Có" --> C5 --> C6 --> C7
  C4 -- "Không / không hợp lệ" --> C8
  C7 --> Z["Tự động xóa sau 90 ngày<br/>(audit chỉ ghi số lượng)"]
  C8 --> Z
```

### 4.2 Vòng đời trạng thái yêu cầu liên hệ

```mermaid
stateDiagram-v2
  [*] --> new: Khách gửi form hợp lệ
  new --> in_progress: Nhân viên nhận xử lý
  new --> spam: Không phải yêu cầu thật
  in_progress --> contacted: Đã gọi/nhắn cho khách
  in_progress --> spam
  contacted --> closed: Hoàn tất tư vấn
  contacted --> in_progress: Cần xử lý thêm
  closed --> in_progress: Mở lại
  spam --> new: Đánh dấu nhầm
  new --> [*]: Xóa thủ công
  in_progress --> [*]: Xóa thủ công
  contacted --> [*]: Xóa thủ công
  closed --> [*]: Xóa thủ công / tự xóa sau 90 ngày
  spam --> [*]: Xóa thủ công / tự xóa sau 90 ngày
```

API cho phép chuyển giữa mọi trạng thái; sơ đồ trên là quy trình khuyến nghị.
Mỗi lần đổi trạng thái hoặc xóa đều ghi audit gắn với tài khoản thực hiện,
không kèm tên, số điện thoại hay nội dung tin nhắn.

### 4.3 Quy trình biên tập và xuất bản nội dung

```mermaid
flowchart TD
  S1["Tạo mới xe / bài viết / tài liệu pháp lý"] --> S2["Lưu dạng Bản nháp<br/>(mặc định isPublished = false)"]
  IM["Nhập nội dung mẫu<br/>(chỉ slug chưa có, tối đa 200 mục)"] --> S2
  S2 --> S3["Xem chi tiết, kiểm tra thông số,<br/>ảnh, nguồn tham khảo"]
  S3 --> S4{"Tài liệu pháp lý?"}
  S4 -- "Có" --> S5["Xác minh với đơn vị chịu trách nhiệm<br/>(không thay thế tư vấn pháp luật)"]
  S4 -- "Không" --> S6
  S5 --> S6{"Đạt yêu cầu?"}
  S6 -- "Chưa" --> S7["Sửa nội dung"] --> S3
  S6 -- "Đạt" --> S8["Bật Hiển thị công khai"]
  S8 --> S9["Xuất hiện trên website<br/>(API công khai chỉ trả bản đã công khai)"]
  S9 --> S10{"Cần thay đổi?"}
  S10 -- "Cập nhật" --> S7
  S10 -- "Tạm ẩn" --> S2
  S10 -- "Gỡ bỏ" --> S11["Xóa (không hoàn tác)"]
  S1 & S7 & S8 & S11 -.-> AU[("Lịch sử hoạt động<br/>ai · làm gì · lúc nào")]
```

### 4.4 Quản lý tài khoản và phiên đăng nhập

```mermaid
flowchart TD
  T0["Lần khởi động đầu tiên, bảng admin_users trống"] --> T1["Server tạo quản trị viên đầu tiên<br/>từ ADMIN_USERNAME / ADMIN_PASSWORD"]
  T1 --> T2["Quản trị viên đăng nhập, đổi mật khẩu"]
  T2 --> T3["Tạo tài khoản cho từng nhân sự<br/>(vai trò editor hoặc admin, mật khẩu tạm ≥ 12 ký tự)"]
  T3 --> T4["Gửi mật khẩu tạm qua kênh an toàn"]
  T4 --> T5["Nhân sự đăng nhập, tự đổi mật khẩu<br/>(các thiết bị khác bị đăng xuất)"]
  T5 --> T6{"Thay đổi nhân sự?"}
  T6 -- "Đổi vai trò" --> T7["Admin đổi vai trò → thu hồi mọi phiên của tài khoản"]
  T6 -- "Nghỉ việc / nghi lộ mật khẩu" --> T8["Khóa tài khoản hoặc đặt lại mật khẩu<br/>→ thu hồi mọi phiên ngay lập tức"]
  T6 -- "Quên mật khẩu" --> T9["Admin đặt lại mật khẩu tạm"] --> T5
  T7 --> T5
  G1["Ràng buộc: không tự khóa, không tự đổi vai trò,<br/>luôn còn ≥ 1 admin hoạt động"] -.-> T7
  G1 -.-> T8
```

```mermaid
stateDiagram-v2
  [*] --> Active: Đăng nhập thành công (token 256 bit, hạn 8h)
  Active --> Active: Mỗi request kiểm tra phiên (last_seen cập nhật tối đa 5 phút/lần)
  Active --> Revoked: Đăng xuất
  Active --> Revoked: Bị khóa / đổi vai trò / đặt lại mật khẩu
  Active --> Revoked: Tự đổi mật khẩu (phiên khác)
  Active --> Expired: Quá 8 giờ
  Revoked --> Purged: Sau 30 ngày (job bảo trì)
  Expired --> Purged: Sau 30 ngày (job bảo trì)
  Purged --> [*]
```

### 4.5 Bảo trì và lưu trữ dữ liệu

```mermaid
sequenceDiagram
  autonumber
  participant I1 as NestJS instance 1
  participant I2 as NestJS instance 2
  participant DB as PostgreSQL

  Note over I1,I2: Khi khởi động và mỗi 24 giờ
  I1->>DB: BEGIN · pg_try_advisory_xact_lock(purge)
  I2->>DB: BEGIN · pg_try_advisory_xact_lock(purge)
  DB-->>I1: true (giành được khóa)
  DB-->>I2: false → bỏ qua, COMMIT
  I1->>DB: DELETE contact_submissions quá 90 ngày
  I1->>DB: INSERT activity "Tự động xóa N yêu cầu" (actor = system)
  I1->>DB: COMMIT (nhả khóa)
  I1->>DB: Dọn admin_sessions và rate_limits hết hạn
  opt ACTIVITY_RETENTION_DAYS được cấu hình (≥ 30)
    I1->>DB: DELETE activity_logs cũ hơn N ngày
  end
```

---

## 5. Mô hình dữ liệu

```mermaid
erDiagram
  ADMIN_USERS ||--o{ ADMIN_SESSIONS : "có phiên"
  ADMIN_USERS |o--o{ ACTIVITY_LOGS : "thực hiện (actor_id)"
  VEHICLES |o..o{ CONTACT_SUBMISSIONS : "vehicle_slug (không FK)"

  ADMIN_USERS {
    uuid id PK
    varchar username "UNIQUE lower(username)"
    varchar display_name
    text password_hash "scrypt"
    varchar role "admin | editor"
    boolean is_active
    timestamptz last_login_at
    timestamptz password_changed_at
  }
  ADMIN_SESSIONS {
    uuid id PK
    uuid user_id FK
    bytea token_hash "SHA-256, UNIQUE"
    varchar user_agent
    timestamptz expires_at
    timestamptz last_seen_at
    timestamptz revoked_at
  }
  VEHICLES {
    uuid id PK
    varchar slug UK
    varchar name
    varchar make
    varchar category
    varchar artwork "cargo | fire | rescue"
    jsonb images
    jsonb highlights
    jsonb known_details
    boolean is_published
  }
  ARTICLES {
    uuid id PK
    varchar slug UK
    varchar category
    varchar title
    jsonb sections
    boolean is_published
  }
  LEGAL_RESOURCES {
    uuid id PK
    varchar slug UK
    varchar resource_type "policy | regulation | legal_guide"
    varchar title
    text content
    boolean is_published
  }
  CONTACT_SUBMISSIONS {
    uuid id PK
    varchar name
    varchar phone
    varchar category
    varchar vehicle_slug
    varchar status "new | in_progress | contacted | closed | spam"
    text consent_text
    timestamptz consent_at
    timestamptz created_at "xóa sau 90 ngày"
  }
  ACTIVITY_LOGS {
    uuid id PK
    varchar actor "username hoặc system"
    uuid actor_id FK "ON DELETE SET NULL"
    varchar action "CREATE | UPDATE | DELETE | IMPORT | LOGIN | LOGOUT"
    varchar entity_type
    uuid entity_id
    varchar entity_label "không chứa PII"
  }
  RATE_LIMITS {
    bytea key_hash PK "SHA-256(method:route:ip)"
    int hits
    timestamptz reset_at
  }
```

Ghi chú thiết kế:

- `rate_limits` là bảng **UNLOGGED**: ghi nhanh vì không qua WAL; mất bộ đếm
  khi crash/failover là chấp nhận được.
- `contact_submissions.vehicle_slug` cố ý **không có khóa ngoại**: xóa xe không
  làm mất yêu cầu tư vấn đã gửi.
- `activity_logs.actor` giữ tên đăng nhập dạng văn bản để lịch sử vẫn đọc được
  khi tài khoản bị xóa (`actor_id` khi đó thành `NULL`).
- Mọi bảng nội dung có trigger `set_updated_at`; index GIN `pg_trgm` trên biểu
  thức tìm kiếm của từng bảng (migration 006).
