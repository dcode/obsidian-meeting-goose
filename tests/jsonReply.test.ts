/**
 * Tests for lenient parsing of agent JSON replies
 */

import { JsonReplyError, parseJsonReply, repairJson } from '../src/services/jsonReply';

describe('repairJson', () => {
  it('leaves valid JSON unchanged', () => {
    const valid = JSON.stringify({
      summary: 'He said "ship it"\nand left.\tDone, "really", ok',
      items: ['a, "b"', { c: 1 }],
      n: -2.5,
      flag: true,
      none: null,
    }, null, 2);
    expect(repairJson(valid)).toBe(valid);
  });

  it('escapes unescaped quotes inside a string value', () => {
    const broken = '{"summary": "They called it "Phoenix" internally", "decisions": []}';
    expect(JSON.parse(repairJson(broken))).toEqual({
      summary: 'They called it "Phoenix" internally',
      decisions: [],
    });
  });

  it('handles a quoted phrase followed by a comma and more prose', () => {
    const broken = '{"summary": "The plan, dubbed "big bang", was rejected", "tags": ["a"]}';
    expect(JSON.parse(repairJson(broken))).toEqual({
      summary: 'The plan, dubbed "big bang", was rejected',
      tags: ['a'],
    });
  });

  it('handles a quoted phrase at the very end of a value', () => {
    const broken = '{"a": "known as "Phoenix"", "b": "x"}';
    expect(JSON.parse(repairJson(broken))).toEqual({ a: 'known as "Phoenix"', b: 'x' });
  });

  it('escapes raw line breaks and tabs inside strings only', () => {
    const broken = '{\n  "summary": "**TL;DR**\n- one\r\n-\ttwo"\n}';
    expect(JSON.parse(repairJson(broken))).toEqual({ summary: '**TL;DR**\n- one\r\n-\ttwo' });
  });

  it('repairs strings inside arrays and nested objects', () => {
    const broken = '{"actionItems": [{"task": "Fix the "flaky" test", "assignee": null}], "decisions": ["Use "main" only", "Ship"]}';
    expect(JSON.parse(repairJson(broken))).toEqual({
      actionItems: [{ task: 'Fix the "flaky" test', assignee: null }],
      decisions: ['Use "main" only', 'Ship'],
    });
  });

  it('keeps existing escape sequences intact', () => {
    const text = '{"a": "back\\\\slash \\"quoted\\" \\u00e9"}';
    expect(repairJson(text)).toBe(text);
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

  it('throws with an excerpt when there is no JSON', () => {
    expect(() => parseJsonReply('I cannot   help\nwith that.')).toThrow(
      new JsonReplyError('The agent reply contained no JSON: "I cannot help with that."')
    );
  });

  it('throws with the original parse error when repair does not help', () => {
    expect(() => parseJsonReply('{ "summary": oops }')).toThrow(
      /^The agent reply was not valid JSON \(.+\): "\{ "summary": oops \}"$/
    );
  });

  it('truncates long replies in the error', () => {
    expect(() => parseJsonReply('x'.repeat(500))).toThrow(`"${'x'.repeat(200)}…"`);
  });
});
