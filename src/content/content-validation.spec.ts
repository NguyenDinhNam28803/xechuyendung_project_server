import { BadRequestException } from '@nestjs/common';
import { AdminAuthService } from '../auth/admin-auth.service.js';
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

describe('admin authentication', () => {
  const originalEnvironment = {
    ADMIN_USERNAME: process.env.ADMIN_USERNAME,
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
    ADMIN_AUTH_SECRET: process.env.ADMIN_AUTH_SECRET,
  };
  const auth = new AdminAuthService();

  beforeEach(() => {
    process.env.ADMIN_USERNAME = 'admin';
    process.env.ADMIN_PASSWORD = 'password-for-test';
    process.env.ADMIN_AUTH_SECRET =
      'test-secret-with-more-than-thirty-two-characters';
  });

  afterAll(() => {
    restoreEnvironment('ADMIN_USERNAME', originalEnvironment.ADMIN_USERNAME);
    restoreEnvironment('ADMIN_PASSWORD', originalEnvironment.ADMIN_PASSWORD);
    restoreEnvironment(
      'ADMIN_AUTH_SECRET',
      originalEnvironment.ADMIN_AUTH_SECRET,
    );
  });

  it('issues a verifiable token for valid credentials', () => {
    const result = auth.login('admin', 'password-for-test');
    expect(result.expiresIn).toBe(8 * 60 * 60);
    expect(auth.verify(result.accessToken)).toBe(true);
  });

  it('rejects invalid credentials and modified tokens', () => {
    expect(() => auth.login('admin', 'wrong')).toThrow();
    const { accessToken } = auth.login('admin', 'password-for-test');
    expect(auth.verify(`${accessToken}x`)).toBe(false);
  });
});

function restoreEnvironment(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}
