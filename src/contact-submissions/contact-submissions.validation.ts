import { BadRequestException } from '@nestjs/common';

const allowedCategories = new Set([
  'Xe tải',
  'Xe chữa cháy',
  'Xe cứu hộ',
  'Xe bồn / xe môi trường',
  'Khác / cần tư vấn',
]);

export type ContactSubmissionInput = {
  name: string;
  phone: string;
  category: string;
  location: string;
  message: string;
  vehicleSlug: string;
  consent: true;
  consentText: string;
};

const consentText =
  'Tôi đồng ý để đơn vị lưu thông tin liên hệ trong hệ thống và sử dụng thông tin này để phản hồi yêu cầu tư vấn. Tôi đã xem thông tin quyền riêng tư.';

export function parseContactSubmission(value: unknown): ContactSubmissionInput {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new BadRequestException('Dữ liệu gửi lên không hợp lệ.');
  }
  const record = value as Record<string, unknown>;
  const name = readText(record.name, 100);
  const phone = readText(record.phone, 20);
  const category = readText(record.category, 80);
  const location = readText(record.location ?? '', 80);
  const message = readText(record.message ?? '', 1000);
  const vehicleSlug = readText(record.vehicleSlug ?? '', 120);

  if (
    !name ||
    !phone ||
    !category ||
    location === null ||
    message === null ||
    vehicleSlug === null
  ) {
    throw new BadRequestException(
      'Vui lòng kiểm tra lại các trường thông tin.',
    );
  }
  if (
    !/^[+()\d\s.-]{8,20}$/.test(phone) ||
    phone.replace(/\D/g, '').length < 8
  ) {
    throw new BadRequestException('Vui lòng nhập số điện thoại hợp lệ.');
  }
  if (!allowedCategories.has(category)) {
    throw new BadRequestException('Dòng xe quan tâm không hợp lệ.');
  }
  if (record.consent !== true) {
    throw new BadRequestException(
      'Bạn cần đồng ý với thông tin quyền riêng tư.',
    );
  }

  return {
    name,
    phone,
    category,
    location,
    message,
    vehicleSlug,
    consent: true,
    consentText,
  };
}

function readText(value: unknown, maximum: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text.length <= maximum ? text : null;
}
