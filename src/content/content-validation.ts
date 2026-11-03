import { BadRequestException } from '@nestjs/common';

export type VehicleInput = {
  slug: string;
  name: string;
  make: string;
  category: string;
  description: string;
  artwork: 'cargo' | 'fire' | 'rescue';
  images: string[];
  badge: string;
  useCase: string;
  highlights: string[];
  knownDetails: { label: string; value: string }[];
  sourceUrl: string | null;
  isPublished: boolean;
};

export type ArticleInput = {
  slug: string;
  category: string;
  title: string;
  summary: string;
  sections: { heading: string; paragraphs: string[] }[];
  isPublished: boolean;
};

export type LegalResourceType = 'policy' | 'regulation' | 'legal_guide';

export type LegalResourceInput = {
  slug: string;
  resourceType: LegalResourceType;
  title: string;
  summary: string;
  content: string;
  sourceUrl: string | null;
  isPublished: boolean;
};

const vehicleFields = new Set([
  'slug',
  'name',
  'make',
  'category',
  'description',
  'artwork',
  'images',
  'badge',
  'useCase',
  'highlights',
  'knownDetails',
  'sourceUrl',
  'isPublished',
]);
const articleFields = new Set([
  'slug',
  'category',
  'title',
  'summary',
  'sections',
  'isPublished',
]);
const legalResourceFields = new Set([
  'slug',
  'resourceType',
  'title',
  'summary',
  'content',
  'sourceUrl',
  'isPublished',
]);

export function parseVehicleInput(value: unknown): VehicleInput;
export function parseVehicleInput(
  value: unknown,
  partial: true,
): Partial<VehicleInput>;
export function parseVehicleInput(
  value: unknown,
  partial = false,
): VehicleInput | Partial<VehicleInput> {
  const record = readRecord(value, vehicleFields, partial);
  const result: Partial<VehicleInput> = {};

  assignString(record, result, 'slug', 120, partial);
  assignString(record, result, 'name', 200, partial);
  assignString(record, result, 'make', 120, partial);
  assignString(record, result, 'category', 100, partial);
  assignString(record, result, 'description', 5000, partial);
  assignString(record, result, 'badge', 120, partial);
  assignString(record, result, 'useCase', 1000, partial);

  if ('artwork' in record) {
    if (
      record.artwork !== 'cargo' &&
      record.artwork !== 'fire' &&
      record.artwork !== 'rescue'
    ) {
      invalid('artwork');
    }
    result.artwork = record.artwork;
  } else {
    requireField('artwork', partial);
  }

  if ('images' in record) {
    result.images = readStringArray(record.images, 'images', 4, 500);
  } else {
    requireField('images', partial);
  }
  if ('highlights' in record) {
    result.highlights = readStringArray(
      record.highlights,
      'highlights',
      20,
      500,
    );
  } else {
    requireField('highlights', partial);
  }
  if ('knownDetails' in record) {
    result.knownDetails = readKnownDetails(record.knownDetails);
  } else {
    requireField('knownDetails', partial);
  }
  if ('sourceUrl' in record) {
    const sourceUrl = record.sourceUrl;
    if (sourceUrl === null || sourceUrl === '') {
      result.sourceUrl = null;
    } else if (typeof sourceUrl === 'string' && isValidUrl(sourceUrl)) {
      result.sourceUrl = sourceUrl;
    } else {
      invalid('sourceUrl');
    }
  } else if (!partial) {
    result.sourceUrl = null;
  }
  assignBoolean(record, result, 'isPublished', partial);

  return result;
}

export function parseArticleInput(value: unknown): ArticleInput;
export function parseArticleInput(
  value: unknown,
  partial: true,
): Partial<ArticleInput>;
export function parseArticleInput(
  value: unknown,
  partial = false,
): ArticleInput | Partial<ArticleInput> {
  const record = readRecord(value, articleFields, partial);
  const result: Partial<ArticleInput> = {};

  assignString(record, result, 'slug', 120, partial);
  assignString(record, result, 'category', 100, partial);
  assignString(record, result, 'title', 250, partial);
  assignString(record, result, 'summary', 2000, partial);
  if ('sections' in record) {
    result.sections = readSections(record.sections);
  } else {
    requireField('sections', partial);
  }
  assignBoolean(record, result, 'isPublished', partial);
  return result;
}

export function parseLegalResourceInput(value: unknown): LegalResourceInput;
export function parseLegalResourceInput(
  value: unknown,
  partial: true,
): Partial<LegalResourceInput>;
export function parseLegalResourceInput(
  value: unknown,
  partial = false,
): LegalResourceInput | Partial<LegalResourceInput> {
  const record = readRecord(value, legalResourceFields, partial);
  const result: Partial<LegalResourceInput> = {};

  assignString(record, result, 'slug', 120, partial);
  assignString(record, result, 'title', 250, partial);
  assignString(record, result, 'summary', 2000, partial);
  assignString(record, result, 'content', 20000, partial);
  if ('resourceType' in record) {
    if (
      record.resourceType !== 'policy' &&
      record.resourceType !== 'regulation' &&
      record.resourceType !== 'legal_guide'
    ) {
      invalid('resourceType');
    }
    result.resourceType = record.resourceType;
  } else {
    requireField('resourceType', partial);
  }
  if ('sourceUrl' in record) {
    const sourceUrl = record.sourceUrl;
    if (sourceUrl === null || sourceUrl === '') {
      result.sourceUrl = null;
    } else if (typeof sourceUrl === 'string' && isValidUrl(sourceUrl)) {
      result.sourceUrl = sourceUrl;
    } else {
      invalid('sourceUrl');
    }
  } else if (!partial) {
    result.sourceUrl = null;
  }
  assignBoolean(record, result, 'isPublished', partial);
  return result;
}

function readRecord(
  value: unknown,
  fields: Set<string>,
  partial: boolean,
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new BadRequestException('Dữ liệu gửi lên không hợp lệ.');
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!fields.has(key)) invalid(key);
  }
  if (partial && Object.keys(record).length === 0) {
    throw new BadRequestException(
      'Cần cung cấp ít nhất một trường để cập nhật.',
    );
  }
  return record;
}

function assignString(
  source: Record<string, unknown>,
  target: object,
  key: string,
  maximum: number,
  partial: boolean,
) {
  if (!(key in source)) {
    requireField(key, partial);
    return;
  }
  const value = source[key];
  if (
    typeof value !== 'string' ||
    value.trim().length === 0 ||
    value.length > maximum
  ) {
    invalid(key);
  }
  Object.assign(target, { [key]: value.trim() });
}

function assignBoolean(
  source: Record<string, unknown>,
  target: object,
  key: string,
  partial: boolean,
) {
  if (!(key in source)) {
    requireField(key, partial);
    return;
  }
  if (typeof source[key] !== 'boolean') invalid(key);
  Object.assign(target, { [key]: source[key] });
}

function readStringArray(
  value: unknown,
  field: string,
  maximumCount: number,
  maximumLength: number,
) {
  if (
    !Array.isArray(value) ||
    value.length > maximumCount ||
    value.some(
      (item) =>
        typeof item !== 'string' ||
        item.length > maximumLength ||
        item.trim().length === 0,
    )
  ) {
    invalid(field);
  }
  return value.map((item: string) => item.trim());
}

function readKnownDetails(value: unknown) {
  if (
    !Array.isArray(value) ||
    value.length > 30 ||
    value.some(
      (item) =>
        typeof item !== 'object' ||
        item === null ||
        Array.isArray(item) ||
        !isText(item.label, 120) ||
        !isText(item.value, 500),
    )
  ) {
    invalid('knownDetails');
  }
  return value.map((item: { label: string; value: string }) => ({
    label: item.label.trim(),
    value: item.value.trim(),
  }));
}

function readSections(value: unknown) {
  if (
    !Array.isArray(value) ||
    value.length > 50 ||
    value.some(
      (section) =>
        typeof section !== 'object' ||
        section === null ||
        Array.isArray(section) ||
        !isText(section.heading, 250) ||
        !Array.isArray(section.paragraphs) ||
        section.paragraphs.length > 50 ||
        section.paragraphs.some(
          (paragraph: unknown) => !isText(paragraph, 5000),
        ),
    )
  ) {
    invalid('sections');
  }
  return value.map((section: { heading: string; paragraphs: string[] }) => ({
    heading: section.heading.trim(),
    paragraphs: section.paragraphs.map((paragraph) => paragraph.trim()),
  }));
}

function isText(value: unknown, maximum: number): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <= maximum
  );
}

function isValidUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function requireField(key: string, partial: boolean) {
  if (!partial) invalid(key);
}

function invalid(key: string): never {
  throw new BadRequestException(`Trường "${key}" không hợp lệ.`);
}
