/**
 * A small RFC 4180 CSV reader, because the archive needs one and a dependency does not earn its
 * place here. Player names carry commas ("Hee-Chan, Hwang"), news strings carry quotes, and a
 * `split(',')` corrupts exactly those rows while leaving the other 99% looking correct — a parse bug
 * that hides in the tail is worse than no parser at all.
 *
 * Handles: quoted fields, commas and newlines inside quotes, doubled quotes as an escape, and CRLF.
 * Does not handle: anything else. If the archive ever needs more, that is the moment to take a
 * dependency, not before.
 */

/** Split one CSV document into rows of raw string cells. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let i = 0;

  // A trailing newline would otherwise produce a final row of one empty field. Strip the whole
  // sequence, not just the '\n' — a trailing CRLF otherwise leaves the '\r' glued to the last cell,
  // where it survives as an invisible character in a value nobody thinks to look at.
  const src = text.replace(/\r?\n$/, '');

  while (i < src.length) {
    const c = src[i];

    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }

    if (c === '"') {
      quoted = true;
      i++;
      continue;
    }
    if (c === ',') {
      row.push(field);
      field = '';
      i++;
      continue;
    }
    if (c === '\r' && src[i + 1] === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i += 2;
      continue;
    }
    if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i++;
      continue;
    }

    field += c;
    i++;
  }

  row.push(field);
  rows.push(row);
  return rows;
}

/**
 * Parse into objects keyed by the header row.
 *
 * A row whose cell count disagrees with the header is a parse failure, never something to pad or
 * truncate: a short row means the reader lost a delimiter, and silently filling the gap turns a
 * detectable bug into wrong numbers in a fitted model.
 */
export function parseCsvRecords(text: string): Record<string, string>[] {
  const rows = parseCsv(text);
  if (rows.length === 0) return [];

  const header = rows[0];
  const records: Record<string, string>[] = [];

  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    // A blank final line is not a row.
    if (cells.length === 1 && cells[0] === '') continue;
    if (cells.length !== header.length) {
      throw new Error(
        `CSV row ${r + 1}: expected ${header.length} cells, found ${cells.length}`,
      );
    }
    const rec: Record<string, string> = {};
    for (let c = 0; c < header.length; c++) rec[header[c]] = cells[c];
    records.push(rec);
  }

  return records;
}

/** Required integer cell. Throws rather than defaulting — a missing stat is not a zero. */
export function int(rec: Record<string, string>, key: string): number {
  const v = num(rec, key);
  if (v === null) throw new Error(`CSV: missing or non-numeric "${key}"`);
  return Math.trunc(v);
}

/** Optional numeric cell: absent column, or empty value, is null. */
export function num(
  rec: Record<string, string>,
  key: string,
): number | null {
  const raw = rec[key];
  if (raw === undefined || raw.trim() === '') return null;
  const v = Number(raw);
  return Number.isFinite(v) ? v : null;
}

/** Optional integer cell — for columns a season may not have at all. */
export function intOrNull(
  rec: Record<string, string>,
  key: string,
): number | null {
  const v = num(rec, key);
  return v === null ? null : Math.trunc(v);
}

/** The archive writes booleans as `True` / `False`. */
export function bool(rec: Record<string, string>, key: string): boolean {
  return (rec[key] ?? '').trim().toLowerCase() === 'true';
}
