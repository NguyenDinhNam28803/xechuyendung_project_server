import { BadRequestException } from '@nestjs/common';
import { parseBulkRequest } from './bulk-content.js';
import { parseSort } from './sorting.js';
import { addDays, dayRange, todayInBusinessZone } from './time.js';
import {
  parseDateParam,
  parseIntegerParam,
  readOptionalEnum,
  readUuidList,
} from './validation.js';

const columns = { name: 'name', createdAt: 'created_at' };
const idA = '11111111-1111-4111-8111-111111111111';
const idB = '22222222-2222-4222-8222-222222222222';

describe('parseSort', () => {
  it('uses the fallback when sort is missing or blank', () => {
    expect(parseSort(undefined, columns, 'x DESC')).toBe('x DESC');
    expect(parseSort(' ', columns, 'x DESC')).toBe('x DESC');
  });

  it('maps whitelisted fields to SQL with a stable id tie-breaker', () => {
    expect(parseSort('createdAt:desc', columns, '')).toBe(
      'created_at DESC NULLS LAST, id DESC',
    );
    expect(parseSort('name', columns, '')).toBe('name ASC NULLS LAST, id ASC');
  });

  it.each([
    'password',
    'name:sideways',
    'name;DROP TABLE x',
    'constructor',
    '__proto__',
  ])('rejects %s', (value) => {
    expect(() => parseSort(value, columns, '')).toThrow(BadRequestException);
  });
});

describe('parseBulkRequest', () => {
  it('accepts ids and an action, removing duplicates', () => {
    expect(
      parseBulkRequest({
        ids: [idA, idA.toUpperCase(), idB],
        action: 'publish',
      }),
    ).toEqual({ ids: [idA, idB], action: 'publish' });
  });

  it.each([
    { ids: [], action: 'publish' },
    { ids: ['not-a-uuid'], action: 'delete' },
    { ids: [idA], action: 'archive' },
    { ids: [idA], action: 'delete', extra: true },
    [idA],
    null,
  ])('rejects %j', (body) => {
    expect(() => parseBulkRequest(body)).toThrow(BadRequestException);
  });

  it('caps the number of ids per request', () => {
    const ids = Array.from(
      { length: 101 },
      (_, index) =>
        `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    );
    expect(() => readUuidList(ids, 'ids', 100)).toThrow(BadRequestException);
  });
});

describe('query parameter readers', () => {
  it('validates calendar dates', () => {
    expect(parseDateParam('2026-02-28', 'from')).toBe('2026-02-28');
    expect(parseDateParam(undefined, 'from')).toBeUndefined();
    expect(() => parseDateParam('2026-02-30', 'from')).toThrow(
      BadRequestException,
    );
    expect(() => parseDateParam('28/02/2026', 'from')).toThrow(
      BadRequestException,
    );
  });

  it('bounds integer parameters', () => {
    expect(parseIntegerParam(undefined, 'days', 7, 365, 30)).toBe(30);
    expect(parseIntegerParam('90', 'days', 7, 365, 30)).toBe(90);
    expect(() => parseIntegerParam('3', 'days', 7, 365, 30)).toThrow(
      BadRequestException,
    );
    expect(() => parseIntegerParam('1e3', 'days', 7, 365, 30)).toThrow(
      BadRequestException,
    );
  });

  it('treats empty enum filters as absent', () => {
    expect(readOptionalEnum('', ['a', 'b'], 'x')).toBeUndefined();
    expect(readOptionalEnum('b', ['a', 'b'], 'x')).toBe('b');
    expect(() => readOptionalEnum('c', ['a', 'b'], 'x')).toThrow(
      BadRequestException,
    );
  });
});

describe('business-day helpers', () => {
  it('uses the Vietnam calendar day, not UTC', () => {
    // 2026-11-14 18:30 UTC = 2026-11-15 01:30 giờ Việt Nam.
    expect(todayInBusinessZone(new Date('2026-11-14T18:30:00Z'))).toBe(
      '2026-11-15',
    );
  });

  it('adds days across month boundaries and lists inclusive ranges', () => {
    expect(addDays('2026-02-27', 2)).toBe('2026-03-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(dayRange('2026-12-30', '2027-01-02')).toEqual([
      '2026-12-30',
      '2026-12-31',
      '2027-01-01',
      '2027-01-02',
    ]);
  });
});
