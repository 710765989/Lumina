import { z } from 'zod';

export const idSchema = z.string().min(1).max(128);
export const taskStatusSchema = z.enum(['queued', 'running', 'paused', 'completed', 'failed', 'cancelled']);
export type TaskStatus = z.infer<typeof taskStatusSchema>;

export const mediaKindSchema = z.enum(['photo', 'video', 'unknown']);
export type MediaKind = z.infer<typeof mediaKindSchema>;

export const mediaRecordSchema = z.object({
  id: idSchema,
  absolutePath: z.string().min(1),
  kind: mediaKindSchema,
  sizeBytes: z.number().int().nonnegative(),
  modifiedAtMs: z.number().nonnegative(),
  capturedAtMs: z.number().nonnegative().nullable().optional(),
  fingerprint: z.string().min(1),
});
export type MediaRecord = z.infer<typeof mediaRecordSchema>;

export const taskRecordSchema = z.object({
  id: idSchema,
  kind: z.enum(['scan', 'thumbnail', 'backup', 'index-rebuild']),
  status: taskStatusSchema,
  processed: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  errorCode: z.string().nullable(),
});
export type TaskRecord = z.infer<typeof taskRecordSchema>;

export const errorCodes = {
  InvalidArgument: 'invalid_argument',
  MediaNotFound: 'media_not_found',
  UnsupportedFormat: 'unsupported_format',
  PermissionDenied: 'permission_denied',
  TaskConflict: 'task_conflict',
} as const;

export * from './ipc.js';
export * from './organization.js';
export * from './search-text.js';
export * from './tag-graph.js';
export * from './user-error.js';
export * from './tag-colors.js';
