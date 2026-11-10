/**
 * Lenient parsing of JSON objects written by a language model.
 *
 * Models asked for JSON reliably get the structure right but often break the
 * string escaping, most commonly when a long markdown string contains quoted
 * words: {"summary": "They called it "Phoenix" internally"}. Strict parsing
 * rejects the whole reply for that, so these helpers repair the common cases
 * and only then give up.
 */

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

/**
 * Decide whether a `"` met inside a string really closes it, by looking at
 * what follows: a closing quote is followed by `:` (it was a key), by `}` or
 * `]`, by the end of the text, or by a `,` that leads on to the next key,
 * value, or closing bracket.
 */
function closesString(text: string, quoteIndex: number): boolean {
  const after = nextNonSpace(text, quoteIndex + 1);
  if (after >= text.length) return true;

  const char = text[after];
  if (char === ':' || char === '}' || char === ']') return true;
  if (char !== ',') return false;

  const afterComma = text[nextNonSpace(text, after + 1)];
  return afterComma === undefined || /["{[\]}\d\-tfn]/.test(afterComma);
}

/**
 * Fix the string-escaping mistakes models make: unescaped double quotes and
 * raw line breaks or tabs inside string values. Everything outside strings is
 * left untouched.
 */
export function repairJson(text: string): string {
  let repaired = '';
  let inString = false;

  for (let index = 0; index < text.length; index++) {
    const char = text[index];

    if (!inString) {
      if (char === '"') inString = true;
      repaired += char;
    } else if (char === '\\') {
      // Keep an existing escape sequence, whatever it escapes.
      repaired += char + (text[index + 1] ?? '');
      index++;
    } else if (char === '"') {
      if (closesString(text, index)) {
        inString = false;
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
 * code fence) and parse it, repairing string escaping if strict parsing fails.
 *
 * Throws JsonReplyError with an excerpt of the reply when nothing usable is found.
 */
export function parseJsonReply<T>(reply: string): T {
  const match = reply.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new JsonReplyError(`The agent reply contained no JSON: ${excerpt(reply)}`);
  }

  try {
    return JSON.parse(match[0]) as T;
  } catch (strictError) {
    try {
      return JSON.parse(repairJson(match[0])) as T;
    } catch {
      // Report the original problem: it describes what the agent actually wrote.
      const reason = strictError instanceof Error ? strictError.message : String(strictError);
      throw new JsonReplyError(`The agent reply was not valid JSON (${reason}): ${excerpt(reply)}`);
    }
  }
}
