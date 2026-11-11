-- Index trigram cho tìm kiếm ILIKE '%từ khóa%' trong trang quản trị.
--
-- Biểu thức index phải trùng KHỚP với biểu thức trong src/common/search.ts.
-- Nếu tài khoản migration không có quyền CREATE EXTENSION (một số dịch vụ
-- PostgreSQL được quản lý), migration chỉ ghi NOTICE và bỏ qua: tìm kiếm vẫn
-- đúng, chỉ dùng sequential scan như trước.

DO $$
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_trgm;
  EXCEPTION
    WHEN insufficient_privilege OR feature_not_supported OR undefined_file THEN
      RAISE NOTICE 'pg_trgm is unavailable (%); search indexes were skipped.', SQLERRM;
      RETURN;
  END;

  BEGIN
    EXECUTE $index$
      CREATE INDEX vehicles_search_trgm_idx ON vehicles USING gin (
        (name || ' ' || make || ' ' || category || ' ' || slug) gin_trgm_ops
      )
    $index$;
    EXECUTE $index$
      CREATE INDEX articles_search_trgm_idx ON articles USING gin (
        (title || ' ' || category || ' ' || slug) gin_trgm_ops
      )
    $index$;
    EXECUTE $index$
      CREATE INDEX legal_resources_search_trgm_idx ON legal_resources USING gin (
        (title || ' ' || slug || ' ' || summary || ' ' || content) gin_trgm_ops
      )
    $index$;
    EXECUTE $index$
      CREATE INDEX contact_submissions_search_trgm_idx ON contact_submissions USING gin (
        (
          name || ' ' || phone || ' ' || category || ' ' || location || ' ' ||
          message || ' ' || COALESCE(vehicle_slug, '')
        ) gin_trgm_ops
      )
    $index$;
    EXECUTE $index$
      CREATE INDEX activity_logs_search_trgm_idx ON activity_logs USING gin (
        (actor || ' ' || action || ' ' || entity_type || ' ' || entity_label) gin_trgm_ops
      )
    $index$;
    EXECUTE $index$
      CREATE INDEX admin_users_search_trgm_idx ON admin_users USING gin (
        (username || ' ' || display_name) gin_trgm_ops
      )
    $index$;
  EXCEPTION
    WHEN undefined_object THEN
      -- Extension có thể nằm ở schema không thuộc search_path.
      RAISE NOTICE 'gin_trgm_ops is not visible (%); search indexes were skipped.', SQLERRM;
  END;
END;
$$;
