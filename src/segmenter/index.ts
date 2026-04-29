export type SegmentKind = "paragraph" | "heading" | "code" | "table";

export interface Segment {
  text: string;
  sourceStart: number;
  sourceEnd: number;
  sourceMap: number[];
  kind: SegmentKind;
}

export function markdownToSegments(markdown: string): Segment[] {
  let cursor = 0;

  const fm = matchAt(markdown, 0, /^---\n[\s\S]*?\n---\n?/);
  if (fm) cursor = fm.length;

  const segments: Segment[] = [];

  while (cursor < markdown.length) {
    cursor = skipWhitespaceAndBlankLines(markdown, cursor);
    if (cursor >= markdown.length) break;

    const start = cursor;

    const code = matchAt(markdown, cursor, /^```[^\n]*\n[\s\S]*?\n```/);
    if (code) {
      const lines = code.split("\n").length - 2;
      const text = `Code block, ${lines} ${lines === 1 ? "line" : "lines"}, skipped.`;
      segments.push({
        text,
        sourceStart: start,
        sourceEnd: start + code.length,
        sourceMap: announcementMap(text, start),
        kind: "code",
      });
      cursor = start + code.length;
      continue;
    }

    if (markdown[cursor] === "|") {
      const table = matchAt(markdown, cursor, /^(?:\|[^\n]*(?:\n|$))+/);
      if (table) {
        const rows = table
          .split("\n")
          .filter((l) => l.trim().startsWith("|")).length;
        const dataRows = Math.max(0, rows - 2);
        const text = `Table with ${dataRows} ${dataRows === 1 ? "row" : "rows"}, skipped.`;
        segments.push({
          text,
          sourceStart: start,
          sourceEnd: start + table.length,
          sourceMap: announcementMap(text, start),
          kind: "table",
        });
        cursor = start + table.length;
        continue;
      }
    }

    const paraEnd = readParagraphEnd(markdown, cursor);
    if (paraEnd <= cursor) {
      cursor++;
      continue;
    }
    const paraSource = markdown.slice(cursor, paraEnd);
    if (/^[-*_]{3,}\s*$/.test(paraSource)) {
      cursor = paraEnd;
      continue;
    }
    const isHeading = /^#+\s+/.test(paraSource);
    const rendered = renderForSpeech(paraSource, cursor);
    if (rendered.text) {
      segments.push({
        text: rendered.text,
        sourceStart: start,
        sourceEnd: paraEnd,
        sourceMap: rendered.sourceMap,
        kind: isHeading ? "heading" : "paragraph",
      });
    }
    cursor = paraEnd;
  }

  return segments;
}

function readParagraphEnd(source: string, start: number): number {
  if (start >= source.length) return start;

  const firstLineEnd = source.indexOf("\n", start);
  if (firstLineEnd === -1) return source.length;

  const firstIndent = countIndent(source.slice(start, firstLineEnd));
  let end = firstLineEnd;

  while (end < source.length) {
    const nextLineStart = end + 1;
    if (nextLineStart >= source.length) break;
    if (source[nextLineStart] === "\n") break;

    const nextLineEnd = source.indexOf("\n", nextLineStart);
    const lineEnd = nextLineEnd === -1 ? source.length : nextLineEnd;
    const nextLine = source.slice(nextLineStart, lineEnd);

    if (countIndent(nextLine) !== firstIndent) break;

    end = lineEnd;
  }

  return end;
}

function countIndent(line: string): number {
  let n = 0;
  while (n < line.length && (line[n] === " " || line[n] === "\t")) n++;
  return n;
}

function isListItemStart(line: string): boolean {
  return /^\s*([-*+]|\d+\.)\s+/.test(line);
}

function announcementMap(text: string, sourceStart: number): number[] {
  return Array.from({ length: text.length }, () => sourceStart);
}

function matchAt(text: string, pos: number, regex: RegExp): string | null {
  const m = text.slice(pos).match(regex);
  return m ? m[0] : null;
}

function skipWhitespaceAndBlankLines(text: string, pos: number): number {
  while (pos < text.length) {
    const c = text[pos];
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      pos++;
    } else {
      break;
    }
  }
  return pos;
}

function renderForSpeech(
  source: string,
  baseOffset: number,
): { text: string; sourceMap: number[] } {
  const out: string[] = [];
  const map: number[] = [];
  let i = 0;

  const isLineStart = () => i === 0 || source[i - 1] === "\n";

  while (i < source.length) {
    if (isLineStart()) {
      const skip =
        matchHere(source, i, /^#+\s+/) ??
        matchHere(source, i, /^>\s*\[!\w+\][^\n]*/) ??
        matchHere(source, i, /^>\s*/) ??
        matchHere(source, i, /^\d+\.\s+/) ??
        matchHere(source, i, /^[-*+]\s+/) ??
        matchHere(source, i, /^\[[ xX]\]\s+/);
      if (skip !== null) {
        i += skip;
        continue;
      }
    }

    if (source.startsWith("%%", i)) {
      const close = source.indexOf("%%", i + 2);
      if (close !== -1) {
        i = close + 2;
        continue;
      }
    }

    if (source.startsWith("![[", i)) {
      const close = source.indexOf("]]", i + 3);
      if (close !== -1) {
        emitWikiLabel(source, i + 3, close, baseOffset, out, map);
        i = close + 2;
        continue;
      }
    }

    if (source.startsWith("[[", i)) {
      const close = source.indexOf("]]", i + 2);
      if (close !== -1) {
        emitWikiLabel(source, i + 2, close, baseOffset, out, map);
        i = close + 2;
        continue;
      }
    }

    if (source[i] === "[" || (source[i] === "!" && source[i + 1] === "[")) {
      const start = source[i] === "!" ? i + 1 : i;
      const labelEnd = source.indexOf("]", start + 1);
      if (labelEnd !== -1 && source[labelEnd + 1] === "(") {
        const urlEnd = source.indexOf(")", labelEnd + 2);
        if (urlEnd !== -1) {
          for (let j = start + 1; j < labelEnd; j++) {
            out.push(source[j]);
            map.push(baseOffset + j);
          }
          i = urlEnd + 1;
          continue;
        }
      }
    }

    if (
      (source.startsWith("**", i) && source[i + 2] !== "*") ||
      (source.startsWith("__", i) && source[i + 2] !== "_")
    ) {
      const marker = source.slice(i, i + 2);
      const close = source.indexOf(marker, i + 2);
      if (close !== -1) {
        for (let j = i + 2; j < close; j++) {
          out.push(source[j]);
          map.push(baseOffset + j);
        }
        i = close + 2;
        continue;
      }
    }

    if (source.startsWith("==", i)) {
      const close = source.indexOf("==", i + 2);
      if (close !== -1) {
        for (let j = i + 2; j < close; j++) {
          out.push(source[j]);
          map.push(baseOffset + j);
        }
        i = close + 2;
        continue;
      }
    }

    if (source.startsWith("~~", i)) {
      const close = source.indexOf("~~", i + 2);
      if (close !== -1) {
        for (let j = i + 2; j < close; j++) {
          out.push(source[j]);
          map.push(baseOffset + j);
        }
        i = close + 2;
        continue;
      }
    }

    if (source[i] === "`" && source[i + 1] !== "`") {
      const close = source.indexOf("`", i + 1);
      if (close !== -1) {
        for (let j = i + 1; j < close; j++) {
          out.push(source[j]);
          map.push(baseOffset + j);
        }
        i = close + 1;
        continue;
      }
    }

    if (
      (source[i] === "*" && source[i + 1] !== "*" && source[i - 1] !== "*") ||
      (source[i] === "_" && source[i + 1] !== "_" && source[i - 1] !== "_")
    ) {
      const marker = source[i];
      const close = source.indexOf(marker, i + 1);
      if (close !== -1 && source[close + 1] !== marker) {
        for (let j = i + 1; j < close; j++) {
          out.push(source[j]);
          map.push(baseOffset + j);
        }
        i = close + 1;
        continue;
      }
    }

    if (source[i] === "\n") {
      let j = i + 1;
      while (j < source.length && (source[j] === " " || source[j] === "\t")) j++;
      if (j < source.length && source[j] !== "\n") {
        const restEnd = source.indexOf("\n", j);
        const restOfLine = source.slice(j, restEnd === -1 ? source.length : restEnd);
        if (isListItemStart(restOfLine)) {
          out.push(".");
          map.push(baseOffset + i);
          out.push(" ");
          map.push(baseOffset + i);
        } else {
          out.push(" ");
          map.push(baseOffset + i);
        }
      }
      i = j;
      continue;
    }

    out.push(source[i]);
    map.push(baseOffset + i);
    i++;
  }

  while (out.length > 0 && /\s/.test(out[out.length - 1])) {
    out.pop();
    map.pop();
  }
  while (out.length > 0 && /\s/.test(out[0])) {
    out.shift();
    map.shift();
  }

  return { text: out.join(""), sourceMap: map };
}

function matchHere(source: string, i: number, regex: RegExp): number | null {
  const m = source.slice(i).match(regex);
  return m && m.index === 0 ? m[0].length : null;
}

function emitWikiLabel(
  source: string,
  open: number,
  close: number,
  baseOffset: number,
  out: string[],
  map: number[],
): void {
  const inner = source.slice(open, close);
  const pipeIdx = inner.indexOf("|");
  const labelStart = pipeIdx >= 0 ? open + pipeIdx + 1 : open;
  for (let j = labelStart; j < close; j++) {
    out.push(source[j]);
    map.push(baseOffset + j);
  }
}
