# Home Library

A local-first catalog for the books at home. Scan an ISBN barcode or type it, review the details, save. Mark books as read with a date. Export to CSV, Excel or JSON at any time. No account, no tracking, no server.

## Run

    npm install
    npm run dev        # http://localhost:5173
    npm test           # ISBN validation, CSV/JSON/XLSX round-trip, merge
    npm run build      # static PWA in dist/, built for /library-catalog/ (GitHub Pages)

## How it works

- **Scan:** BarcodeDetector where the browser has it (Android Chrome), ZXing otherwise (iPhone Safari). Only EAN-13 codes starting 978 or 979 are accepted.
- **Lookup:** Open Library ISBN API, then Google Books. Title or author searches use the Open Library search API. Only the ISBN or search text is sent.
- **Storage:** IndexedDB via Dexie, on the device only. Covers are cached by the service worker.
- **Format:** every book is Print, Audiobook or Ebook (default Print). Audiobooks also carry narrators, length and ASIN.
- **Audible import:** reads the CSV spreadsheet and the raw data JSON from the [Audible Library Extractor](https://joonaspaakko.github.io/audible-library-extractor/) extension. New titles are added as Audiobook; titles already in the library (same ASIN, or same title and first author among audiobooks) are skipped, so re-importing only adds new purchases. tests/fixtures holds fake sample files in the extractor's format.
- **Export and import:** CSV, .xlsx (SheetJS) and JSON, all round-trip safe. Import merges by id, then ISBN-13, then title and author; the newest edit wins.
- **Sync with a computer:** "Backup to file" writes one JSON file (into iCloud Drive, Google Drive or Dropbox, or AirDrop it). "Load from backup" on the other device merges it in.

## Notes

- The camera only works on HTTPS (or localhost). Test scanning on the phone after hosting.
