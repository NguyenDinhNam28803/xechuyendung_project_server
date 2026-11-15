import { BadRequestException } from '@nestjs/common';
import { isRecord } from './records.js';

/**
 * Bộ đọc dữ liệu đầu vào dùng chung cho các endpoint mới. Mọi hàm ném
 * BadRequestException kèm thông điệp tiếng Việt, nên controller chỉ cần gọi
 * và nhận về giá trị đã đúng kiểu.
 */

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && uuidPattern.test(value);
}

/** Body phải là object và chỉ chứa các khóa được liệt kê. */
export function readBody(
  value: unknown,
  allowedKeys: readonly string[],
  message = 'Dữ liệu gửi lên không hợp lệ.',
): Record<string, unknown> {
  if (!isRecord(value)) throw new BadRequestException(message);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.includes(key)) {
      throw new BadRequestException(`Trường "${key}" không được hỗ trợ.`);
    }
  }
  return value;
}

/** Danh sách UUID không trùng lặp, 1..max phần tử. */
export function readUuidList(value: unknown, field: string, max = 100) {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > max ||
    !value.every(isUuid)
  ) {
    throw new BadRequestException(
      `"${field}" phải là danh sách 1–${max} mã định danh hợp lệ.`,
    );
  }
  return [...new Set(value.map((id) => id.toLowerCase()))];
}

export function readEnum<Value extends string>(
  value: unknown,
  allowed: readonly Value[],
  field: string,
): Value {
  if (typeof value !== 'string' || !allowed.includes(value as Value)) {
    throw new BadRequestException(
      `"${field}" không hợp lệ. Cho phép: ${allowed.join(', ')}.`,
    );
  }
  return value as Value;
}

/** Giống readEnum nhưng undefined/chuỗi rỗng → undefined (bỏ lọc). */
export function readOptionalEnum<Value extends string>(
  value: unknown,
  allowed: readonly Value[],
  field: string,
): Value | undefined {
  if (value === undefined || value === '') return undefined;
  return readEnum(value, allowed, field);
}

/** Chuỗi đã trim, bắt buộc có nội dung, tối đa `max` ký tự. */
export function readText(
  value: unknown,
  field: string,
  max: number,
  options: { allowEmpty?: boolean } = {},
) {
  if (typeof value !== 'string') {
    throw new BadRequestException(`"${field}" phải là chuỗi ký tự.`);
  }
  const text = value.trim();
  if (!options.allowEmpty && text.length === 0) {
    throw new BadRequestException(`"${field}" không được để trống.`);
  }
  if (text.length > max) {
    throw new BadRequestException(`"${field}" tối đa ${max} ký tự.`);
  }
  return text;
}

export function readInteger(
  value: unknown,
  field: string,
  min: number,
  max: number,
) {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < min ||
    value > max
  ) {
    throw new BadRequestException(
      `"${field}" phải là số nguyên từ ${min} đến ${max}.`,
    );
  }
  return value;
}

/** Tham số query dạng số nguyên trong khoảng; thiếu → `fallback`. */
export function parseIntegerParam(
  value: string | undefined,
  field: string,
  min: number,
  max: number,
  fallback: number,
) {
  if (value === undefined || value === '') return fallback;
  if (!/^\d{1,6}$/.test(value)) {
    throw new BadRequestException(`Tham số "${field}" không hợp lệ.`);
  }
  return readInteger(Number(value), field, min, max);
}

/** Ngày dạng YYYY-MM-DD (lịch hợp lệ); thiếu → undefined. */
export function parseDateParam(value: string | undefined, field: string) {
  if (value === undefined || value === '') return undefined;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match) {
    const date = new Date(`${value}T00:00:00Z`);
    if (
      !Number.isNaN(date.getTime()) &&
      date.getUTCFullYear() === Number(match[1]) &&
      date.getUTCMonth() + 1 === Number(match[2]) &&
      date.getUTCDate() === Number(match[3])
    ) {
      return value;
    }
  }
  throw new BadRequestException(
    `Tham số "${field}" phải là ngày dạng YYYY-MM-DD.`,
  );
}
