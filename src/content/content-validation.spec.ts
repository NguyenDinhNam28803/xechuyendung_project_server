import { BadRequestException } from '@nestjs/common';
import {
  parseArticleInput,
  parseLegalResourceInput,
  parseVehicleInput,
} from './content-validation.js';

const validVehicle = {
  slug: 'xe-tai-mau',
  name: 'Xe tải mẫu',
  make: 'Nhà sản xuất',
  category: 'Xe tải',
  description: 'Mô tả xe',
  artwork: 'cargo',
  images: [],
  badge: 'Mẫu tham khảo',
  useCase: 'Vận chuyển hàng hóa',
  highlights: [],
  knownDetails: [],
  isPublished: false,
};

const validArticle = {
  slug: 'bai-viet-mau',
  category: 'Hướng dẫn',
  title: 'Bài viết mẫu',
  summary: 'Mô tả ngắn',
  sections: [{ heading: 'Nội dung', paragraphs: ['Đoạn văn'] }],
  isPublished: false,
};

describe('content input validation', () => {
  it('defaults the optional vehicle source URL to null', () => {
    expect(parseVehicleInput(validVehicle).sourceUrl).toBeNull();
  });

  it('does not clear an omitted optional field during a partial update', () => {
    expect(parseVehicleInput({ name: 'Tên mới' }, true)).toEqual({
      name: 'Tên mới',
    });
  });

  it('rejects invalid structured content', () => {
    expect(() =>
      parseArticleInput({ ...validArticle, sections: 'not-an-array' }),
    ).toThrow(BadRequestException);
  });

  it('rejects unsupported vehicle fields', () => {
    expect(() =>
      parseVehicleInput({ ...validVehicle, unexpected: 'value' }),
    ).toThrow(BadRequestException);
  });

  it('accepts legal resources with a known type and official source', () => {
    expect(
      parseLegalResourceInput({
        slug: 'legal-resource',
        resourceType: 'regulation',
        title: 'Quy định tham khảo',
        summary: 'Tóm tắt',
        content: 'Nội dung tham khảo.',
        sourceUrl: 'https://example.gov.vn/document',
        isPublished: false,
      }).resourceType,
    ).toBe('regulation');
  });

  it('rejects unsupported legal resource types and non-HTTP sources', () => {
    const resource = {
      slug: 'legal-resource',
      resourceType: 'policy',
      title: 'Chính sách',
      summary: 'Tóm tắt',
      content: 'Nội dung',
      sourceUrl: null,
      isPublished: false,
    };
    expect(() =>
      parseLegalResourceInput({ ...resource, resourceType: 'legal_advice' }),
    ).toThrow(BadRequestException);
    expect(() =>
      parseLegalResourceInput({
        ...resource,
        sourceUrl: 'javascript:alert(1)',
      }),
    ).toThrow(BadRequestException);
  });
});
