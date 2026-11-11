import { containsPattern, escapeLikePattern } from './search.js';
import { buildUpdateAssignments } from './update-builder.js';

describe('LIKE escaping', () => {
  it('treats wildcard characters literally', () => {
    expect(escapeLikePattern('50%_off\\x')).toBe('50\\%\\_off\\\\x');
    expect(containsPattern('a_b')).toBe('%a\\_b%');
  });
});

describe('buildUpdateAssignments', () => {
  type Input = { name: string; images: string[]; isPublished: boolean };
  const columns: Record<keyof Input, string> = {
    name: 'name',
    images: 'images',
    isPublished: 'is_published',
  };

  it('maps whitelisted columns to numbered parameters and serializes JSON fields', () => {
    const result = buildUpdateAssignments<Input>(
      { name: 'Xe', images: ['/a.png'], isPublished: true },
      columns,
      ['images'],
    );
    expect(result.assignments).toBe(
      'name = $1, images = $2::jsonb, is_published = $3',
    );
    expect(result.values).toEqual(['Xe', '["/a.png"]', true]);
  });
});
