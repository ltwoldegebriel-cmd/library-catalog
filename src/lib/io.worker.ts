/// <reference lib="webworker" />
import { parseInput, buildExport, type FileInput, type ExportKind } from './fileparse';
import type { Book } from './types';

type Msg = { op: 'parse'; file: FileInput; audibleOnly: boolean } | { op: 'export'; kind: ExportKind; books: Book[] };

self.onmessage = (e: MessageEvent<Msg>) => {
  const m = e.data;
  try {
    if (m.op === 'parse') self.postMessage({ ok: true, value: parseInput(m.file, m.audibleOnly) });
    else {
      const r = buildExport(m.kind, m.books);
      const transfer = r.data instanceof ArrayBuffer ? [r.data] : [];
      (self as unknown as Worker).postMessage({ ok: true, value: r }, transfer);
    }
  } catch (err) {
    self.postMessage({ ok: false, error: (err as Error)?.message ?? String(err), name: (err as Error)?.name });
  }
};
