/**
 * Lenient parsing of JSON objects written by a language model.
 *
 * Models asked for JSON reliably get the structure right but often break the
 * details. A reply that fails strict parsing is repaired in two steps:
 *
 * 1. escapeStringContents() fixes unescaped double quotes and raw line breaks
 *    inside string values, the usual damage when a long markdown string
 *    contains quoted words: {"summary": "He said "no", then "yes"."}
 * 2. The jsonrepair library fixes everything else: trailing commas, missing
 *    brackets, output cut off mid-way, single quotes, comments.
 *
 * Step 1 is ours, and has to run first, because jsonrepair reads a quote
 * followed by a comma as the end of the string. On the example above it
 * either gives up or, worse, returns {"summary": "He said \"no", "then": ...}
 * without complaint. tests/jsonReply.test.ts pins that behaviour down, so the
 * step can be deleted if a later jsonrepair release handles it.
 */

import { jsonrepair } from 'jsonrepair';

export class JsonReplyError extends Error {}

/** A short, single-line sample of a reply for error messages. */
function excerpt(text: string, maxLength = 200): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > maxLength ? `"${flat.slice(0, maxLength)}…"` : `"${flat}"`;
}

function nextNonSpace(text: string, from: number): number {
  let index = from;
  while (index < text.length && /\s/.test(text[index])) index++;
  return index;
}

/** Where a string sits in the document, which decides what may follow its closing quote. */
type StringRole = 'key' | 'object-value' | 'array-item';

const NEXT_KEY = /^"[^"\\\n]*"\s*:/;
const NEXT_ARRAY_ITEM = /^(?:["{[\]]|-?\d[\d.eE+-]*\s*[,\]]|(?:true|false|null)\s*[,\]])/;

/**
 * Decide whether a `"` met inside a string really closes it, by checking that
 * what follows is what JSON allows after a string in that position. Prose
 * rarely passes: in {"summary": "He said "no", then "yes"."} the quote after
 * `no` is followed by a comma, but not by another key.
 */
function closesString(text: string, quoteIndex: number, role: StringRole): boolean {
  const after = nextNonSpace(text, quoteIndex + 1);
  if (after >= text.length) return true;
  const char = text[after];

  if (role === 'key') return char === ':';

  const closer = role === 'object-value' ? '}' : ']';
  if (char === closer) return true;
  if (char !== ',') return false;

  const rest = text.slice(nextNonSpace(text, after + 1));
  if (rest === '' || rest.startsWith(closer)) return true; // trailing comma
  return (role === 'object-value' ? NEXT_KEY : NEXT_ARRAY_ITEM).test(rest);
}

/**
 * Fix the string-escaping mistakes models make: unescaped double quotes and
 * raw line breaks or tabs inside string values. Everything outside strings is
 * left untouched.
 */
export function escapeStringContents(text: string): string {
  let repaired = '';
  let role: StringRole | null = null; // non-null while inside a string
  const containers: Array<'{' | '['> = [];
  let afterColon = false;

  for (let index = 0; index < text.length; index++) {
    const char = text[index];

    if (role === null) {
      if (char === '"') {
        const container = containers[containers.length - 1];
        role = container === '[' ? 'array-item' : afterColon ? 'object-value' : 'key';
      } else if (char === '{' || char === '[') {
        containers.push(char);
        afterColon = false;
      } else if (char === '}' || char === ']') {
        containers.pop();
        afterColon = false;
      } else if (char === ':') {
        afterColon = true;
      } else if (char === ',') {
        afterColon = false;
      }
      repaired += char;
    } else if (char === '\\') {
      // Keep an existing escape sequence, whatever it escapes.
      repaired += char + (text[index + 1] ?? '');
      index++;
    } else if (char === '"') {
      if (closesString(text, index, role)) {
        role = null;
        repaired += char;
      } else {
        repaired += '\\"';
      }
    } else if (char === '\n') {
      repaired += '\\n';
    } else if (char === '\r') {
      repaired += '\\r';
    } else if (char === '\t') {
      repaired += '\\t';
    } else {
      repaired += char;
    }
  }

  return repaired;
}

/**
 * Pull the JSON object out of an agent reply (which may wrap it in prose or a
 * code fence) and parse it, repairing it if strict parsing fails.
 *
 * Throws JsonReplyError with an excerpt of the reply when nothing usable is found.
 */
export function parseJsonReply<T>(reply: string): T {
  const start = reply.indexOf('{');
  if (start < 0) {
    throw new JsonReplyError(`The agent reply contained no JSON: ${excerpt(reply)}`);
  }
  // Up to the last closing brace, or to the end if the reply was cut off before one.
  const end = reply.lastIndexOf('}');
  const candidate = end > start ? reply.slice(start, end + 1) : reply.slice(start);

  try {
    return JSON.parse(candidate) as T;
  } catch (strictError) {
    const escaped = escapeStringContents(candidate);
    try {
      return JSON.parse(escaped) as T;
    } catch {
      try {
        return JSON.parse(jsonrepair(escaped)) as T;
      } catch {
        // Report the original problem: it describes what the agent actually wrote.
        const reason = strictError instanceof Error ? strictError.message : String(strictError);
        throw new JsonReplyError(`The agent reply was not valid JSON (${reason}): ${excerpt(reply)}`);
      }
    }
  }
}
