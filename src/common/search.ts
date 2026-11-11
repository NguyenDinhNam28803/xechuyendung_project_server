/**
 * Biểu thức tìm kiếm của từng bảng. Mỗi biểu thức phải trùng khớp với biểu
 * thức trong migrations/006_search_trigram_indexes.sql để PostgreSQL dùng được
 * index trigram (GIN). Gộp nhiều cột thành một chuỗi giúp chỉ cần một index
 * cho mỗi bảng thay vì một chuỗi OR qua nhiều cột.
 */
export const searchExpressions = {
  vehicles: `(name || ' ' || make || ' ' || category || ' ' || slug)`,
  articles: `(title || ' ' || category || ' ' || slug)`,
  legalResources: `(title || ' ' || slug || ' ' || summary || ' ' || content)`,
  contactSubmissions: `(name || ' ' || phone || ' ' || category || ' ' || location || ' ' || message || ' ' || COALESCE(vehicle_slug, ''))`,
  activityLogs: `(actor || ' ' || action || ' ' || entity_type || ' ' || entity_label)`,
  adminUsers: `(username || ' ' || display_name)`,
} as const;

/**
 * Escape các ký tự đại diện của LIKE để từ khóa được so khớp theo nghĩa đen:
 * người dùng gõ "_" hoặc "%" sẽ không còn khớp với mọi ký tự.
 * PostgreSQL dùng dấu "\" làm ký tự escape mặc định của LIKE/ILIKE.
 */
export function escapeLikePattern(value: string) {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

export function containsPattern(value: string) {
  return `%${escapeLikePattern(value)}%`;
}
