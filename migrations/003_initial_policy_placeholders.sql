INSERT INTO legal_resources (
  slug,
  resource_type,
  title,
  summary,
  content,
  source_url,
  is_published
)
VALUES
  (
    'du-lieu-lien-he-va-quyen-rieng-tu',
    'policy',
    'Dữ liệu liên hệ và quyền riêng tư',
    'Cần xác nhận thông tin đơn vị chịu trách nhiệm và thời hạn lưu dữ liệu.',
    'Khi gửi biểu mẫu, thông tin liên hệ và nội dung yêu cầu được dùng để phản hồi tư vấn. Trước khi công bố chính sách chính thức, đơn vị cần xác nhận pháp nhân chịu trách nhiệm, thời hạn lưu trữ, cách yêu cầu truy cập/chỉnh sửa/xóa dữ liệu và đầu mối liên hệ.',
    NULL,
    TRUE
  ),
  (
    'chinh-sach-ban-hang-va-thanh-toan',
    'policy',
    'Chính sách bán hàng và thanh toán',
    'Chờ doanh nghiệp xác nhận điều kiện áp dụng.',
    'Website chưa công bố điều khoản bán hàng hoặc cam kết dịch vụ.',
    NULL,
    TRUE
  ),
  (
    'giao-nhan-va-ban-giao-xe',
    'policy',
    'Giao nhận và bàn giao xe',
    'Chờ xác nhận phạm vi giao xe, thời gian và chi phí.',
    'Thông tin giao nhận cần được xác nhận trong báo giá chính thức.',
    NULL,
    TRUE
  ),
  (
    'bao-hanh-va-ho-tro-ky-thuat',
    'policy',
    'Bảo hành và hỗ trợ kỹ thuật',
    'Chờ xác nhận nhà cung cấp, thời hạn và điều kiện bảo hành.',
    'Điều kiện bảo hành cần được xác nhận theo từng cấu hình xe.',
    NULL,
    TRUE
  )
ON CONFLICT (slug) DO NOTHING;
