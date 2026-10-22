import { AsyncLocalStorage } from "node:async_hooks";
import { note as clackNote } from "@clack/prompts";
import { normalizeLowercaseStringOrEmpty } from "@openclaw/normalization-core/string-coerce";
import { iterateGraphemes, visibleWidth } from "./ansi.js";
import { resolveNoteOutput } from "./note-output.js";
import { stylePromptTitle } from "./prompt-style.js";

const MIN_NOTE_COLUMNS = 80;
const FILE_LIKE_RE = /^[a-zA-Z0-9._-]+$/;
const suppressNotesStorage = new AsyncLocalStorage<boolean>();

function isSuppressedByEnv(value: string | undefined): boolean {
  const normalized = normalizeLowercaseStringOrEmpty(value);
  return (
    Boolean(normalized) && normalized !== "0" && normalized !== "false" && normalized !== "off"
  );
}

function wrapLine(line: string, maxWidth: number): string[] {
  if (line.trim().length === 0) {
    return [line];
  }
  const match = line.match(/^(\s*)([-*\u2022]\s+)?(.*)$/);
  const indent = match?.[1] ?? "";
  const bullet = match?.[2] ?? "";
  const content = match?.[3] ?? "";
  const firstPrefix = `${indent}${bullet}`;
  const nextPrefix = `${indent}${bullet ? " ".repeat(bullet.length) : ""}`;
  const firstWidth = Math.max(10, maxWidth - visibleWidth(firstPrefix));
  const nextWidth = Math.max(10, maxWidth - visibleWidth(nextPrefix));

  // Printable ASCII width equals length; reuse that fact for every word and candidate.
  const isPrintableAscii = /^[\u0020-\u007E]*$/.test(content);
  const words = content.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  let prefix = firstPrefix;
  let available = firstWidth;

  for (const word of words) {
    if (current) {
      const candidate = `${current} ${word}`;
      if ((isPrintableAscii ? candidate.length : visibleWidth(candidate)) <= available) {
        current = candidate;
        continue;
      }
      lines.push(prefix + current);
      current = "";
      prefix = nextPrefix;
      available = nextWidth;
    }

    if (
      (isPrintableAscii ? word.length : visibleWidth(word)) > available &&
      // Preserve paths and file-like tokens (for example administrators_authorized_keys).
      !(
        word.includes("/") ||
        word.includes("\\") ||
        (word.includes("_") && FILE_LIKE_RE.test(word))
      )
    ) {
      // Measure whole graphemes in visible columns so CJK/emoji do not overflow.
      // Keep this word's initial budget for all fragments, even when the next prefix differs.
      let currentWidth = 0;
      for (const grapheme of iterateGraphemes(word)) {
        const width = visibleWidth(grapheme);
        if (current && currentWidth + width > available) {
          lines.push(prefix + current);
          prefix = nextPrefix;
          current = "";
          currentWidth = 0;
        }
        current += grapheme;
        currentWidth += width;
      }
      lines.push(prefix + current);
      current = "";
      prefix = nextPrefix;
      available = nextWidth;
      continue;
    }
    current = word;
  }

  if (current || words.length === 0) {
    lines.push(prefix + current);
  }

  return lines;
}

export function wrapNoteMessage(
  message: unknown,
  options: { maxWidth?: number; columns?: number } = {},
): string {
  let text = "";
  if (typeof message === "string") {
    text = message;
  } else if (
    typeof message === "number" ||
    typeof message === "boolean" ||
    typeof message === "bigint"
  ) {
    text = String(message);
  } else if (message instanceof Error) {
    text = message.message ? `${message.name}: ${message.message}` : message.name;
  }
  const columns = options.columns ?? resolveNoteColumns(process.stdout.columns);
  const maxWidth = options.maxWidth ?? Math.max(40, Math.min(88, columns - 10));
  return text
    .split(/\r\n?|[\n\u2028\u2029]/u)
    .flatMap((line) => wrapLine(line, maxWidth))
    .join("\n");
}

export function resolveNoteColumns(columns: number | undefined): number {
  if (!Number.isFinite(columns) || !columns || columns < MIN_NOTE_COLUMNS) {
    return MIN_NOTE_COLUMNS;
  }
  return columns;
}

export function resolveNoteOutputColumns(message: string, columns: number): number {
  const widestLine = message
    .split("\n")
    .reduce((max, line) => Math.max(max, visibleWidth(line)), 0);
  return Math.max(columns, widestLine + 6);
}

export function noteToStream(
  message: unknown,
  title: string | undefined,
  output: NodeJS.WriteStream,
) {
  if (
    suppressNotesStorage.getStore() === true ||
    isSuppressedByEnv(process.env.OPENCLAW_SUPPRESS_NOTES)
  ) {
    return;
  }
  const columns = resolveNoteColumns(output.columns);
  const wrappedMessage = wrapNoteMessage(message, { columns });
  const styledTitle = stylePromptTitle(title);
  const outputColumns = resolveNoteOutputColumns(wrappedMessage, columns);
  let adaptedOutput = output;
  if (output.columns !== outputColumns) {
    adaptedOutput = Object.create(output) as NodeJS.WriteStream;
    Object.defineProperty(adaptedOutput, "columns", {
      value: outputColumns,
      configurable: true,
    });
    adaptedOutput.write = output.write.bind(output);
  }
  clackNote(wrappedMessage, styledTitle, { output: adaptedOutput });
}

export function note(message: unknown, title?: string) {
  noteToStream(message, title, resolveNoteOutput());
}

export function withSuppressedNotes<T>(callback: () => T): T {
  return suppressNotesStorage.run(true, callback);
}
