-- Dashboard thống kê, thời gian phản hồi liên hệ, lưu trữ số liệu tổng hợp
-- (không chứa dữ liệu cá nhân) và danh mục xe quản lý được.

-- 1. Index cho các truy vấn thống kê theo thời gian.
CREATE INDEX IF NOT EXISTS contact_submissions_created_at_idx
  ON contact_submissions (created_at DESC);

CREATE INDEX IF NOT EXISTS activity_logs_entity_created_at_idx
  ON activity_logs (entity_type, created_at DESC);

CREATE INDEX IF NOT EXISTS activity_logs_action_created_at_idx
  ON activity_logs (action, created_at DESC);

-- 2. Thời điểm yêu cầu liên hệ được xử lý lần đầu (rời trạng thái "new"),
-- dùng tính thời gian phản hồi trung bình. Dữ liệu cũ lấy gần đúng bằng
-- updated_at.
ALTER TABLE contact_submissions
  ADD COLUMN IF NOT EXISTS first_handled_at TIMESTAMPTZ;

UPDATE contact_submissions
SET first_handled_at = updated_at
WHERE status <> 'new' AND first_handled_at IS NULL;

-- 3. Số liệu liên hệ theo ngày được lưu lại TRƯỚC khi job retention xóa yêu
-- cầu quá hạn, nhờ đó biểu đồ xu hướng xem được quá 90 ngày. Chỉ lưu số đếm.
CREATE TABLE IF NOT EXISTS contact_daily_stats (
  day DATE NOT NULL,
  category VARCHAR(80) NOT NULL,
  status VARCHAR(20) NOT NULL,
  total INTEGER NOT NULL CHECK (total >= 0),
  PRIMARY KEY (day, category, status)
);

-- 4. Danh mục xe: trước đây hard-code ở client. vehicles.category vẫn là văn
-- bản (giữ tương thích API công khai); đổi tên danh mục cập nhật xe tương ứng.
CREATE TABLE IF NOT EXISTS vehicle_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  description VARCHAR(500) NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS vehicle_categories_name_key
  ON vehicle_categories (lower(name));

DROP TRIGGER IF EXISTS vehicle_categories_set_updated_at ON vehicle_categories;
CREATE TRIGGER vehicle_categories_set_updated_at
  BEFORE UPDATE ON vehicle_categories
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO vehicle_categories (name, sort_order)
VALUES
  ('Xe tải', 10),
  ('Xe chữa cháy', 20),
  ('Xe cứu hộ', 30),
  ('Xe bồn / xe môi trường', 40)
ON CONFLICT DO NOTHING;

-- Danh mục đang được xe sử dụng nhưng chưa có trong bảng.
INSERT INTO vehicle_categories (name, sort_order)
SELECT DISTINCT v.category, 100
FROM vehicles v
WHERE NOT EXISTS (
  SELECT 1 FROM vehicle_categories c WHERE lower(c.name) = lower(v.category)
)
ON CONFLICT DO NOTHING;

-- 5. Nhật ký cho thao tác trên danh mục xe.
ALTER TABLE activity_logs DROP CONSTRAINT activity_logs_entity_type_check;
ALTER TABLE activity_logs
  ADD CONSTRAINT activity_logs_entity_type_check
  CHECK (
    entity_type IN (
      'vehicle',
      'vehicle_category',
      'article',
      'policy',
      'regulation',
      'legal_guide',
      'contact_submission',
      'admin_user',
      'system'
    )
  );
