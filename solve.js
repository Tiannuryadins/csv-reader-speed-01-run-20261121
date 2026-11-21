// csv-reader-speed-01: a faster drop-in for csv-reader 1.0.0.
// Written from scratch against the reference semantics (RULES.txt):
//   - U+FEFF at the very start is dropped
//   - a record ends at LF or CRLF; a line left with no characters is no record
//   - outside quotes a CR not followed by LF is dropped (stray_cr)
//   - a field opening with a quote runs to the next non-doubled quote ("" = one quote,
//     CRLF / lone CR inside quotes read as LF); junk after the closing quote is appended
//     as it stands (quote_junk, when the field ends); a quote that never closes is a
//     literal and the text after it is read again as unquoted (unterminated_quote)
//   - a quote inside an unquoted field is a literal; fields stay strings
//   - columns = first record when header, else null; rows padded (short_row, fields) or
//     cut (long_row, extra) to the first record's width
//   - errors {code, line, row} in order met; line = 1-based line the record starts on
//     (counting every LF, CRLF and lone CR inside quotes), row = record index in rows
//     (null for the header).
//
// Speed strategy: most records are plain (no quotes, no stray CR), so they are taken
// whole-line: one indexOf('\n'), two bounded includes() checks and a C split(',').
// Only records holding a quote or a stray CR go through the per-field parser, which
// itself works with indexOf/slice instead of per-character string building.

const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

/** csv-reader 1.0.0's answer for one case's input. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const len = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (len > 0 && text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on and the index in rows it takes.
  let recordLine = 1;
  let recordRow = null;
  // How the field being read ended (COMMA / LINE_BREAK / END); shared with the readers.
  let fieldEnded = END;

  function finishUnquoted(prefix, acc, start, end) {
    if (acc === null) return prefix === '' ? text.slice(start, end) : prefix + text.slice(start, end);
    acc.push(text.slice(start, end));
    return acc.join('');
  }

  // Reads unquoted characters from pos up to the next comma or line break; a CR not
  // followed by LF is dropped (stray_cr). prefix is text already kept for the field
  // ('' normally, '"' for the unterminated-quote re-read, or a quoted value for junk).
  // Sets fieldEnded; returns the field.
  function readUnquoted(prefix) {
    let start = pos;
    let acc = null;
    for (;;) {
      const c = text.charCodeAt(pos);
      if (c === 44) {
        const v = acc === null ? (prefix === '' ? text.slice(start, pos) : prefix + text.slice(start, pos)) : (acc.push(text.slice(start, pos)), acc.join(''));
        pos += 1;
        fieldEnded = COMMA;
        return v;
      }
      if (c === 10) {
        const v = acc === null ? (prefix === '' ? text.slice(start, pos) : prefix + text.slice(start, pos)) : (acc.push(text.slice(start, pos)), acc.join(''));
        pos += 1;
        line += 1;
        fieldEnded = LINE_BREAK;
        return v;
      }
      if (c === 13) {
        if (text.charCodeAt(pos + 1) === 10) {
          const v = acc === null ? (prefix === '' ? text.slice(start, pos) : prefix + text.slice(start, pos)) : (acc.push(text.slice(start, pos)), acc.join(''));
          pos += 2;
          line += 1;
          fieldEnded = LINE_BREAK;
          return v;
        }
        if (acc === null) acc = prefix === '' ? [] : [prefix];
        acc.push(text.slice(start, pos));
        errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
        pos += 1;
        start = pos;
        continue;
      }
      if (Number.isNaN(c)) {
        const v = acc === null ? (prefix === '' ? text.slice(start, pos) : prefix + text.slice(start, pos)) : (acc.push(text.slice(start, pos)), acc.join(''));
        fieldEnded = END;
        return v;
      }
      pos += 1;
    }
  }

  // Reads a quoted field whose opening quote is at pos. Sets fieldEnded; returns the field.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    pos = open + 1;
    let cur = pos;
    let val = null; // the whole value when it is one clean slice
    let parts = null; // pieces once more than one is needed
    for (;;) {
      const q = text.indexOf('"', cur);
      if (q === -1) {
        // The quote never closes: it is a literal, the text after it is read again
        // as unquoted.
        pos = open + 1;
        line = openLine;
        errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
        return readUnquoted('"');
      }
      const dbl = text.charCodeAt(q + 1) === 34;
      const seg = text.slice(cur, q);
      if (!seg.includes('\n') && !seg.includes('\r')) {
        if (dbl) {
          if (parts !== null) {
            parts.push(seg, '"');
          } else if (val === null) {
            parts = [seg, '"'];
          } else {
            parts = [val, seg, '"'];
            val = null;
          }
        } else if (parts !== null) {
          parts.push(seg);
        } else if (val === null) {
          val = seg;
        } else {
          parts = [val, seg];
          val = null;
        }
      } else {
        // The segment holds line breaks: count each LF, CRLF and lone CR once and
        // normalise them all to LF in the value.
        if (parts === null) {
          parts = val === null ? [] : [val];
          val = null;
        }
        let s = cur;
        let i = cur;
        while (i < q) {
          const c = text.charCodeAt(i);
          if (c === 13) {
            parts.push(text.slice(s, i), '\n');
            line += 1;
            i += text.charCodeAt(i + 1) === 10 ? 2 : 1;
            s = i;
          } else if (c === 10) {
            parts.push(text.slice(s, i), '\n');
            line += 1;
            i += 1;
            s = i;
          } else {
            i += 1;
          }
        }
        parts.push(text.slice(s, q));
        if (dbl) parts.push('"');
      }
      if (dbl) {
        cur = q + 2;
        continue;
      }
      pos = q + 1;
      break;
    }
    const v = parts !== null ? parts.join('') : val === null ? '' : val;
    if (pos >= len) {
      fieldEnded = END;
      return v;
    }
    const c = text.charCodeAt(pos);
    if (c === 44) {
      pos += 1;
      fieldEnded = COMMA;
      return v;
    }
    if (c === 10) {
      pos += 1;
      line += 1;
      fieldEnded = LINE_BREAK;
      return v;
    }
    if (c === 13 && text.charCodeAt(pos + 1) === 10) {
      pos += 2;
      line += 1;
      fieldEnded = LINE_BREAK;
      return v;
    }
    // What follows the closing quote is appended as it stands, up to the next
    // comma or line break.
    const junk = readUnquoted(v);
    if (junk.length > v.length) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
    return junk;
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < len) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= len) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;

    // Fast path: a record with no quote and no stray CR is one line split on commas.
    let fields = null;
    const nl = text.indexOf('\n', pos);
    const recEnd = nl === -1 ? len : nl;
    let lineStr = text.slice(pos, recEnd);
    if (nl !== -1 && lineStr.length > 0 && lineStr.charCodeAt(lineStr.length - 1) === 13) {
      lineStr = lineStr.slice(0, -1);
    }
    if (!lineStr.includes('"') && !lineStr.includes('\r')) {
      fields = lineStr.split(',');
      if (nl !== -1) line += 1;
      pos = nl === -1 ? len : nl + 1;
    } else {
      // Slow path: per-field parsing (quoted fields, stray CRs).
      fields = [];
      let lastQuoted = false;
      do {
        if (text.charCodeAt(pos) === 34) {
          lastQuoted = true;
          fields.push(readQuoted());
        } else {
          lastQuoted = false;
          fields.push(readUnquoted(''));
        }
      } while (fieldEnded === COMMA);
      // A line that held only stray CRs is left with no characters: no record
      // (its stray_cr errors stay).
      if (fields.length === 1 && fields[0] === '' && !lastQuoted) continue;
    }

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
