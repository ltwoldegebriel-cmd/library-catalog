import { describe, it, expect } from 'vitest';
import { checkIsbn, isValidIsbn10, isValidIsbn13, isbn10To13, isbn13To10, isBookBarcode, cleanIsbn, looksLikeIsbn } from '../src/lib/isbn';

describe('ISBN validation', () => {
  it('accepts valid ISBN-13', () => {
    expect(isValidIsbn13('9780140449136')).toBe(true);
    expect(isValidIsbn13('978-0-14-044913-6')).toBe(true);
    expect(isValidIsbn13('9791032305690')).toBe(true);
  });
  it('rejects bad ISBN-13 checksum and non-book prefixes', () => {
    expect(isValidIsbn13('9780140449137')).toBe(false);
    expect(isValidIsbn13('4006381333931')).toBe(false); // valid EAN, not a book
    expect(isValidIsbn13('978014044913')).toBe(false);
  });
  it('accepts valid ISBN-10 including X check digit', () => {
    expect(isValidIsbn10('0140449132')).toBe(true);
    expect(isValidIsbn10('080442957X')).toBe(true);
    expect(isValidIsbn10('080442957x')).toBe(true);
    expect(isValidIsbn10('0-8044-2957-X')).toBe(true);
  });
  it('rejects bad ISBN-10', () => {
    expect(isValidIsbn10('0140449133')).toBe(false);
    expect(isValidIsbn10('X140449132')).toBe(false);
    expect(isValidIsbn10('014044913')).toBe(false);
  });
  it('converts between 10 and 13', () => {
    expect(isbn10To13('0140449132')).toBe('9780140449136');
    expect(isbn10To13('080442957X')).toBe('9780804429573');
    expect(isbn13To10('9780140449136')).toBe('0140449132');
    expect(isbn13To10('9780804429573')).toBe('080442957X');
    expect(isbn13To10('9791032305690')).toBeNull(); // 979 has no ISBN-10
    expect(isbn10To13('0140449133')).toBeNull();
  });
  it('checkIsbn normalises and explains failures', () => {
    expect(checkIsbn(' 0-14-044913-2 ')).toEqual({ ok: true, isbn13: '9780140449136', isbn10: '0140449132' });
    expect(checkIsbn('9780140449136')).toEqual({ ok: true, isbn13: '9780140449136', isbn10: '0140449132' });
    expect(checkIsbn('')).toEqual({ ok: false, reason: 'empty' });
    expect(checkIsbn('12345')).toEqual({ ok: false, reason: 'length' });
    expect(checkIsbn('9780140449137')).toEqual({ ok: false, reason: 'checksum' });
    expect(checkIsbn('4006381333931')).toEqual({ ok: false, reason: 'prefix' });
  });
  it('barcode and input helpers', () => {
    expect(isBookBarcode('9780140449136')).toBe(true);
    expect(isBookBarcode('012345678905')).toBe(false);
    expect(cleanIsbn('isbn 978-0 14')).toBe('978014');
    expect(looksLikeIsbn('978-0-14-044913-6')).toBe(true);
    expect(looksLikeIsbn('The Odyssey')).toBe(false);
  });
});
