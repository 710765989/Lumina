import {getLanguage} from './i18n';
export type Media = { coverSortValue?:number|string; fingerprint?:string; id: string; absolutePath: string; kind: string; hidden: boolean; sizeBytes: number; modifiedAtMs: number; capturedAtMs?: number | null; metadata?: Record<string, any> };
export type Rule = { relation: 'AND' | 'OR'; tags: string[]; notTags: string[]; excludedMediaIds: string[] };
export type Album = { hiddenByVisibility?:boolean; parentId?:string|null; id: string; name: string; description: string; coverMode: 'auto' | 'manual'; manualCoverMediaId: string | null; kind?: 'ordinary' | 'smart' | 'folder'; rule?: Rule; cover?: Media | null; mediaCount?: number; sizeBytes?: number; tagIds?: string[] };
export type Tag = { rootReference?:boolean; directory?:boolean; id: string; name: string; color?: string; group?: string; aliases?: string[]; blocked?: boolean; count?: number; englishName?:string;parentIds?:string[];parentId?:string|null;depth?:number;path?:string;childCount?:number };
export const mediaName = (item: Media) => item.metadata?.displayName || item.absolutePath.split(/[\\/]/u).pop() || item.absolutePath;
export function bytesText(bytes: number) { if (bytes < 1024) return `${bytes} B`; const power = Math.min(4, Math.floor(Math.log(bytes) / Math.log(1024))); return `${(bytes / 1024 ** power).toFixed(1)} ${['B', 'KB', 'MB', 'GB', 'TB'][power]}`; }
export const countryName = (code: string) => { try { return new Intl.DisplayNames([getLanguage()], { type: 'region' }).of(code) ?? code; } catch { return code; } };
