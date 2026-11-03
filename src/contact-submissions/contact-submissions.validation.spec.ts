import { BadRequestException } from '@nestjs/common';
import { parseContactSubmission } from './contact-submissions.validation.js';

const validSubmission = {
  name: 'Nguyễn Văn A',
  phone: '0901 234 567',
  category: 'Xe tải',
  location: 'Hồ Chí Minh',
  message: 'Tôi muốn được tư vấn xe tải.',
  vehicleSlug: 'xe-tai-mau',
  consent: true,
};

describe('contact submission validation', () => {
  it('trims fields and captures the consent wording', () => {
    const submission = parseContactSubmission({
      ...validSubmission,
      name: ' Nguyễn Văn A ',
    });
    expect(submission.name).toBe('Nguyễn Văn A');
    expect(submission.consent).toBe(true);
    expect(submission.consentText).toContain('lưu thông tin liên hệ');
  });

  it('allows optional location and message', () => {
    const submission = parseContactSubmission({
      ...validSubmission,
      location: undefined,
      message: undefined,
    });
    expect(submission.location).toBe('');
    expect(submission.message).toBe('');
  });

  it.each([
    { ...validSubmission, phone: '123' },
    { ...validSubmission, category: 'Không hợp lệ' },
    { ...validSubmission, consent: false },
    { ...validSubmission, name: 'x'.repeat(101) },
  ])('rejects invalid submissions', (input) => {
    expect(() => parseContactSubmission(input)).toThrow(BadRequestException);
  });
});
