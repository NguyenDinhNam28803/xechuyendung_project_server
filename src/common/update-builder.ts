/**
 * Dựng mệnh đề SET cho UPDATE động một cách an toàn: tên cột chỉ lấy từ bảng
 * ánh xạ cố định (whitelist), giá trị luôn đi qua tham số $n.
 * updated_at do trigger set_updated_at cập nhật (migration 005).
 */
export function buildUpdateAssignments<Input extends object>(
  input: Partial<Input>,
  columns: Record<keyof Input, string>,
  jsonFields: readonly (keyof Input)[] = [],
) {
  const entries = Object.entries(input) as [keyof Input, unknown][];
  const values: unknown[] = [];
  const assignments = entries.map(([key, value]) => {
    const isJson = jsonFields.includes(key);
    values.push(isJson ? JSON.stringify(value) : value);
    return `${columns[key]} = $${values.length}${isJson ? '::jsonb' : ''}`;
  });
  return { assignments: assignments.join(', '), values };
}
