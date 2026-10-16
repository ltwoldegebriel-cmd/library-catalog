/** ISBN helpers: cleaning, checksum validation, 10/13 conversion. */

export function cleanIsbn(input: string): string {
  return input.replace(/[^0-9Xx]/g, '').toUpperCase();
}

export function isValidIsbn10(input: string): boolean {
  const s = cleanIsbn(input);
  if (!/^\d{9}[\dX]$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const v = s[i] === 'X' ? 10 : Number(s[i]);
    sum += v * (10 - i);
  }
  return sum % 11 === 0;
}

function isbn13CheckDigit(first12: string): string {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
  return String((10 - (sum % 10)) % 10);
}

export function isValidIsbn13(input: string): boolean {
  const s = cleanIsbn(input);
  if (!/^\d{13}$/.test(s)) return false;
  if (!s.startsWith('978') && !s.startsWith('979')) return false;
  return isbn13CheckDigit(s.slice(0, 12)) === s[12];
}

export function isbn10To13(input: string): string | null {
  const s = cleanIsbn(input);
  if (!isValidIsbn10(s)) return null;
  const body = '978' + s.slice(0, 9);
  return body + isbn13CheckDigit(body);
}

export function isbn13To10(input: string): string | null {
  const s = cleanIsbn(input);
  if (!isValidIsbn13(s) || !s.startsWith('978')) return null;
  const body = s.slice(3, 12);
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(body[i]) * (10 - i);
  const check = (11 - (sum % 11)) % 11;
  return body + (check === 10 ? 'X' : String(check));
}

export type IsbnCheck =
  | { ok: true; isbn13: string; isbn10: string | null }
  | { ok: false; reason: 'empty' | 'length' | 'checksum' | 'prefix' };

/** Validate any typed or scanned ISBN and normalise to ISBN-13. */
export function checkIsbn(input: string): IsbnCheck {
  const s = cleanIsbn(input);
  if (!s) return { ok: false, reason: 'empty' };
  if (s.length === 10) {
    const i13 = isbn10To13(s);
    return i13 ? { ok: true, isbn13: i13, isbn10: s } : { ok: false, reason: 'checksum' };
  }
  if (s.length === 13) {
    if (!s.startsWith('978') && !s.startsWith('979')) return { ok: false, reason: 'prefix' };
    return isValidIsbn13(s)
      ? { ok: true, isbn13: s, isbn10: isbn13To10(s) }
      : { ok: false, reason: 'checksum' };
  }
  return { ok: false, reason: 'length' };
}

export function isbnErrorText(reason: string): string {
  switch (reason) {
    case 'empty': return 'Enter an ISBN.';
    case 'length': return 'An ISBN has 10 or 13 digits.';
    case 'prefix': return 'Book barcodes start with 978 or 979.';
    default: return 'That ISBN fails its check digit. Check for a typo.';
  }
}

/** True for an EAN-13 barcode value that is a valid book ISBN. */
export function isBookBarcode(code: string): boolean {
  return /^\d{13}$/.test(code) && isValidIsbn13(code);
}

/** Does the input look like an ISBN attempt rather than a title? */
export function looksLikeIsbn(input: string): boolean {
  return /^[\d\s-]{9,}[\dXx]?$/.test(input.trim());
}
