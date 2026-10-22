import { z } from 'zod';

export const FIELD_TYPES = ['text', 'number', 'integer', 'currency', 'date'] as const;
export type FieldType = (typeof FIELD_TYPES)[number];
export const MATCH_MODES = ['exact', 'starts-with', 'contains', 'regex'] as const;
export type MatchMode = (typeof MATCH_MODES)[number];
export const DIRECTIONS = ['right', 'below', 'left', 'above'] as const;
export type Direction = (typeof DIRECTIONS)[number];

const cleanerSchema = z.union([
  z.string(),
  z.looseObject({ replace: z.looseObject({ pattern: z.string(), with: z.string().default('') }) }),
  z.looseObject({
    keep: z.looseObject({ pattern: z.string(), group: z.number().int().min(0).default(0) }),
  }),
]);
export type Cleaner = z.infer<typeof cleanerSchema>;

const anchorSchema = z.looseObject({
  labels: z.array(z.string().min(1)).min(1),
  match: z.enum(MATCH_MODES).optional(),
});

const pageSel = z.union([z.enum(['first', 'last', 'any']), z.number().int().min(1)]);
const occurrenceSel = z.union([z.enum(['first', 'last']), z.number().int().min(1)]);

export const regionSchema = z.looseObject({
  page: z.number().int().min(1),
  x0: z.number().min(0).max(1),
  y0: z.number().min(0).max(1),
  x1: z.number().min(0).max(1),
  y1: z.number().min(0).max(1),
});
export type Region = z.infer<typeof regionSchema>;

export const fieldSchema = z.looseObject({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(FIELD_TYPES).optional(),
  required: z.boolean().optional(),
  anchor: anchorSchema,
  direction: z.enum(DIRECTIONS).optional(),
  maxDistance: z.number().positive().optional(),
  take: z
    .string()
    .regex(/^(token|phrase|rest-of-line|until-gap|tokens:\d+)$/)
    .optional(),
  pattern: z.string().optional(),
  page: pageSel.optional(),
  occurrence: occurrenceSel.optional(),
  clean: z.array(cleanerSchema).optional(),
  dateFormats: z.array(z.string().min(1)).optional(),
  creditMeansNegative: z.boolean().optional(),
  region: regionSchema.optional(),
  hint: z
    .looseObject({
      page: z.number().int().min(1),
      bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
    })
    .optional(),
});
export type FieldRule = z.infer<typeof fieldSchema>;

export const columnSchema = z.looseObject({
  name: z.string().min(1),
  header: z.string().min(1),
  type: z.enum(FIELD_TYPES).optional(),
  required: z.boolean().optional(),
  dateFormats: z.array(z.string().min(1)).optional(),
  clean: z.array(cleanerSchema).optional(),
  creditMeansNegative: z.boolean().optional(),
  x0: z.number().optional(),
  x1: z.number().optional(),
});
export type ColumnRule = z.infer<typeof columnSchema>;

export const groupSchema = z.looseObject({
  name: z.string().min(1),
  pattern: z.string().min(1),
  capture: z.number().int().min(0).optional(),
});
export type GroupRule = z.infer<typeof groupSchema>;

export const tableSchema = z.looseObject({
  id: z.string().min(1),
  name: z.string().min(1),
  header: z.looseObject({
    labels: z.array(z.string().min(1)).min(1),
    minMatch: z.number().int().min(1).optional(),
  }),
  columns: z.array(columnSchema).min(1),
  boundaries: z.enum(['from-header', 'explicit']).optional(),
  rowStart: z.looseObject({ column: z.string(), pattern: z.string() }).optional(),
  wrappedLines: z.enum(['join', 'ignore']).optional(),
  end: z
    .looseObject({
      labels: z.array(z.string().min(1)).min(1),
      match: z.enum(MATCH_MODES).optional(),
    })
    .optional(),
  skip: z.array(z.string()).optional(),
  continuesOnNextPage: z.boolean().optional(),
  groups: z.array(groupSchema).optional(),
});
export type TableRule = z.infer<typeof tableSchema>;

export const checkSchema = z.looseObject({
  id: z.string().min(1),
  label: z.string().min(1),
  expr: z.string().min(1),
  tolerance: z.number().min(0).optional(),
  severity: z.enum(['error', 'warning']).optional(),
  enabled: z.boolean().optional(),
});
export type CheckRule = z.infer<typeof checkSchema>;

export const templateSchema = z.looseObject({
  schema: z.literal('pdfx.template/1'),
  id: z
    .string()
    .min(1)
    .regex(/^[a-z0-9][a-z0-9-]*$/, 'Use lower case letters, digits and dashes'),
  name: z.string().min(1),
  version: z.number().int().min(0),
  savedAt: z.string().optional(),
  savedBy: z.string().optional(),
  fingerprint: z.looseObject({
    mustContain: z.array(z.string()),
    mustNotContain: z.array(z.string()).optional(),
    abn: z.string().optional(),
    anyPage: z.boolean().optional(),
  }),
  settings: z
    .looseObject({
      confidenceThreshold: z.number().min(0).max(1).optional(),
      ocr: z.enum(['auto', 'always', 'never']).optional(),
      decimal: z.enum(['.', ',']).optional(),
    })
    .optional(),
  fields: z.array(fieldSchema),
  tables: z.array(tableSchema).optional(),
  checks: z.array(checkSchema).optional(),
});
export type Template = z.infer<typeof templateSchema>;

/** Validates a template. Unknown keys are kept. */
export function parseTemplate(
  data: unknown,
): { ok: true; template: Template } | { ok: false; errors: string[] } {
  const r = templateSchema.safeParse(data);
  if (r.success) return { ok: true, template: r.data };
  return {
    ok: false,
    errors: r.error.issues.map((i) => `${i.path.join('.') || 'template'}: ${i.message}`),
  };
}

/** All saved versions of one template, newest last. */
export interface TemplateSet {
  id: string;
  versions: Template[];
}

export function latest(set: TemplateSet): Template {
  return set.versions.reduce((a, b) => (b.version > a.version ? b : a));
}

// ---------- Resolved defaults ----------

export const defaultTake = (type: FieldType) => (type === 'text' ? 'phrase' : 'token');

export function fieldDefaults(f: FieldRule) {
  const type = f.type ?? 'text';
  const direction = f.direction ?? 'right';
  return {
    type,
    direction,
    match: f.anchor.match ?? 'exact',
    take: f.take ?? defaultTake(type),
    page: f.page ?? 'any',
    occurrence: f.occurrence,
    clean: f.clean ?? ['trim', 'collapseSpaces'],
    dateFormats: f.dateFormats ?? ['DD/MM/YYYY'],
    creditMeansNegative: f.creditMeansNegative ?? true,
    required: f.required ?? false,
  };
}
