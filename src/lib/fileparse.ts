/**
 * Turn an import file into books or Audible items. Pure, so it runs the same in the
 * Web Worker (normal use) and on the main thread (fallback and tests).
 */
import Papa from 'papaparse';
import { csvToBooks, jsonToBooks, newReport, xlsxToBooks, booksToCsv, booksToJson, booksToXlsx, xlsxTruncatedCells, type ParseReport } from './io';
import { isAudibleHeaders, isAudibleJson, parseAudibleCsv, parseAudibleJson, type AudibleItem } from './audible';
import type { Book } from './types';

export type Parsed =
  | { kind: 'books'; books: Book[]; rep: ParseReport }
  | { kind: 'audible'; items: AudibleItem[] };

export interface FileInput { name: string; text?: string; bytes?: ArrayBuffer }

export const isSpreadsheet = (name: string) => /\.xlsx?$/i.test(name);

/** `audibleOnly`: the Audible button; otherwise auto-detect Audible files. */
export function parseInput(f: FileInput, audibleOnly = false): Parsed {
  const name = f.name.toLowerCase();
  if (isSpreadsheet(name)) {
    if (audibleOnly) throw new Error('Use the CSV or JSON file from Audible Library Extractor.');
    const rep = newReport();
    return { kind: 'books', books: xlsxToBooks(f.bytes!, rep), rep };
  }
  const text = f.text ?? '';
  const t = text.trimStart();
  const isJson = name.endsWith('.json') || t.startsWith('{') || t.startsWith('[') || t === 'null';
  if (audibleOnly) return { kind: 'audible', items: isJson && t.startsWith('{') ? parseAudibleJson(text) : parseAudibleCsv(text) };
  if (isJson) {
    let j: unknown = undefined;
    try { j = JSON.parse(text); } catch { /* jsonToBooks reports it */ }
    if (j !== undefined && t.startsWith('{') && isAudibleJson(j)) return { kind: 'audible', items: parseAudibleJson(text) };
    const rep = newReport();
    return { kind: 'books', books: jsonToBooks(text, rep), rep };
  }
  const header = (Papa.parse<string[]>(text, { preview: 1 }).data[0] ?? []) as string[];
  if (isAudibleHeaders(header)) return { kind: 'audible', items: parseAudibleCsv(text) };
  const rep = newReport();
  return { kind: 'books', books: csvToBooks(text, rep), rep };
}

export type ExportKind = 'csv' | 'xlsx' | 'json';
export function buildExport(kind: ExportKind, books: Book[]): { data: string | ArrayBuffer; cut: number } {
  if (kind === 'csv') return { data: '\uFEFF' + booksToCsv(books), cut: 0 };
  if (kind === 'json') return { data: booksToJson(books), cut: 0 };
  return { data: booksToXlsx(books), cut: xlsxTruncatedCells(books) };
}
