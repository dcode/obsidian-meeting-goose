/**
 * Tests for lenient parsing of agent JSON replies
 */

import { jsonrepair } from 'jsonrepair';
import { JsonReplyError, escapeStringContents, parseJsonReply } from '../src/services/jsonReply';

describe('escapeStringContents', () => {
  it('leaves valid JSON unchanged', () => {
    const valid = JSON.stringify({
      summary: 'He said "ship it"\nand left.\tDone, "really", ok',
      items: ['a, "b"', { c: 1 }],
      n: -2.5,
      flag: true,
      none: null,
    }, null, 2);
    expect(escapeStringContents(valid)).toBe(valid);
  });

  it('escapes unescaped quotes inside a string value', () => {
    const broken = '{"summary": "They called it "Phoenix" internally", "decisions": []}';
    expect(JSON.parse(escapeStringContents(broken))).toEqual({
      summary: 'They called it "Phoenix" internally',
      decisions: [],
    });
  });

  it('handles a quoted phrase followed by a comma and more prose', () => {
    const broken = '{"summary": "The plan, dubbed "big bang", was rejected", "tags": ["a"]}';
    expect(JSON.parse(escapeStringContents(broken))).toEqual({
      summary: 'The plan, dubbed "big bang", was rejected',
      tags: ['a'],
    });
  });

  it('handles a quoted phrase at the very end of a value', () => {
    const broken = '{"a": "known as "Phoenix"", "b": "x"}';
    expect(JSON.parse(escapeStringContents(broken))).toEqual({ a: 'known as "Phoenix"', b: 'x' });
  });

  it('escapes raw line breaks and tabs inside strings only', () => {
    const broken = '{\n  "summary": "**TL;DR**\n- one\r\n-\ttwo"\n}';
    expect(JSON.parse(escapeStringContents(broken))).toEqual({ summary: '**TL;DR**\n- one\r\n-\ttwo' });
  });

  it('repairs strings inside arrays and nested objects', () => {
    const broken = '{"actionItems": [{"task": "Fix the "flaky" test", "assignee": null}], "decisions": ["Use "main" only", "Ship"]}';
    expect(JSON.parse(escapeStringContents(broken))).toEqual({
      actionItems: [{ task: 'Fix the "flaky" test', assignee: null }],
      decisions: ['Use "main" only', 'Ship'],
    });
  });

  it('is not fooled by prose that looks like JSON after a quote', () => {
    for (const summary of [
      'He said "no", then "yes".',
      'Options were "a", "b", and "c"',
      'Status is "done", true to form, null result, 3 left',
      'Renamed "old": the new name is "new"',
      'Ended with "quote", ',
    ]) {
      const broken = `{"summary": "${summary}", "tags": ["x"]}`;
      expect(JSON.parse(escapeStringContents(broken))).toEqual({ summary, tags: ['x'] });
    }
  });

  it('recovers the original value for random prose in an object value', () => {
    const tokens = ['"', '"', ',', ', ', ' ', 'then', 'true', 'null', '42', 'word', '.', '\n', '-', '"a"', '{', ']', ':', ' : '];
    let seed = 12345;
    const random = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };

    for (let run = 0; run < 500; run++) {
      let summary = 'x';
      for (let i = 0; i < 12; i++) summary += tokens[Math.floor(random() * tokens.length)];
      // The one truly ambiguous shape: prose that spells out a following key.
      if (/"\s*,\s*"[^"\n]*"\s*:/.test(summary + '"') || /"\s*(,\s*)?$/.test(summary)) continue;

      const broken = `{"summary": "${summary}", "decisions": []}`;
      expect({ broken, parsed: JSON.parse(escapeStringContents(broken)) })
        .toEqual({ broken, parsed: { summary, decisions: [] } });
    }
  });

  it('keeps existing escape sequences intact', () => {
    const text = '{"a": "back\\\\slash \\"quoted\\" \\u00e9"}';
    expect(escapeStringContents(text)).toBe(text);
  });
});

describe('parseJsonReply', () => {
  it('parses plain JSON', () => {
    expect(parseJsonReply('{"a": 1}')).toEqual({ a: 1 });
  });

  it('finds JSON inside a code fence and surrounding prose', () => {
    expect(parseJsonReply('Sure:\n```json\n{"a": [1, 2]}\n```\nDone.')).toEqual({ a: [1, 2] });
  });

  it('repairs a long markdown summary with unescaped quotes, as a real agent produced', () => {
    const reply = '```json\n{\n  "summary": "**TL;DR** — The team discussed dying disks.\n\n**Key Discussion Points**\n- The "hot" tier is at risk, and "warm" is next\n- Ops wants a "stop the bleeding" fix", \n  "actionItems": [{"task": "Order disks", "assignee": "Ops", "dueDate": null}],\n  "decisions": [],\n  "suggestedTags": ["infrastructure"]\n}\n```';

    expect(parseJsonReply<{ summary: string; suggestedTags: string[] }>(reply)).toMatchObject({
      summary: expect.stringContaining('- The "hot" tier is at risk, and "warm" is next'),
      suggestedTags: ['infrastructure'],
    });
  });

  it('repairs structural damage with jsonrepair', () => {
    expect(parseJsonReply('{"decisions": ["Go", "Wait",], "suggestedTags": [\'a\']}'))
      .toEqual({ decisions: ['Go', 'Wait'], suggestedTags: ['a'] });
  });

  it('recovers a reply that was cut off mid-way', () => {
    expect(parseJsonReply('```json\n{"summary": "Short", "decisions": ["Go", "Wa'))
      .toEqual({ summary: 'Short', decisions: ['Go', 'Wa'] });
  });

  it('fixes quotes and structure in the same reply', () => {
    expect(parseJsonReply('{"summary": "He said "no", then "yes".", "decisions": ["Go",],}'))
      .toEqual({ summary: 'He said "no", then "yes".', decisions: ['Go'] });
  });

  it('throws with an excerpt when there is no JSON', () => {
    expect(() => parseJsonReply('I cannot   help\nwith that.')).toThrow(
      new JsonReplyError('The agent reply contained no JSON: "I cannot help with that."')
    );
  });

  it('throws with the original parse error when repair does not help', () => {
    expect(() => parseJsonReply('{ : : }')).toThrow(
      /^The agent reply was not valid JSON \(.+\): "\{ : : \}"$/
    );
  });

  it('truncates long replies in the error', () => {
    expect(() => parseJsonReply('x'.repeat(500))).toThrow(`"${'x'.repeat(200)}…"`);
  });
});

// Why escapeStringContents runs before jsonrepair. If these start failing after
// a jsonrepair upgrade, it may handle the case itself and our step can go.
describe('jsonrepair alone on unescaped quotes followed by a comma', () => {
  it('silently splits the string into a bogus extra key', () => {
    const broken = '{"summary": "He said "no", then "yes".", "tags": []}';
    expect(JSON.parse(jsonrepair(broken))).toEqual({ summary: 'He said "no', then: 'yes".', tags: [] });
    expect(parseJsonReply(broken)).toEqual({ summary: 'He said "no", then "yes".', tags: [] });
  });

  it('gives up on a quoted phrase mid-sentence', () => {
    const broken = '{"summary": "The plan, dubbed "big bang", was rejected", "tags": ["a"]}';
    expect(() => jsonrepair(broken)).toThrow();
    expect(parseJsonReply(broken)).toEqual({ summary: 'The plan, dubbed "big bang", was rejected', tags: ['a'] });
  });
});
