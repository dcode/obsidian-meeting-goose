/**
 * Tests for directory-style speaker name normalization
 */

import { parseSpeakerName } from '../src/services/speakerName';

describe('parseSpeakerName', () => {
  it('shortens a full display name to "Last, First Rank"', () => {
    expect(parseSpeakerName('Doe, John A CTR USAF AFMC AFLCMC/HNCO')).toEqual({
      display: 'Doe, John CTR',
      details: {
        originalName: 'Doe, John A CTR USAF AFMC AFLCMC/HNCO',
        lastName: 'Doe',
        firstName: 'John',
        middleInitial: 'A',
        rank: 'CTR',
        branch: 'USAF',
        organization: 'AFMC AFLCMC/HNCO',
      },
    });
  });

  it.each([
    ['Smith, Jane B Maj USAF ACC 16 AF/A6', 'Smith, Jane Maj', 'Maj', 'USAF', 'ACC 16 AF/A6'],
    ['Lee, Sam Lt Col USSF SSC/CGT', 'Lee, Sam Lt Col', 'Lt Col', 'USSF', 'SSC/CGT'],
    ['Garcia, Ana M. 1st Lt USAF AETC 81 TRW/CC', 'Garcia, Ana 1st Lt', '1st Lt', 'USAF', 'AETC 81 TRW/CC'],
    ['Brown, Chris GS-13 USA AMC', 'Brown, Chris GS-13', 'GS-13', 'USA', 'AMC'],
    ['Nguyen, Kim T CIV DISA J6 (USA)', 'Nguyen, Kim CIV', 'CIV', 'DISA', 'J6 (USA)'],
    ['Patel, Raj SSgt USMC', 'Patel, Raj SSgt', 'SSgt', 'USMC', undefined],
    ["O'Neil-Ruiz, Pat Q NH-03 DAF AFRL/RI", "O'Neil-Ruiz, Pat NH-03", 'NH-03', 'DAF', 'AFRL/RI'],
  ])('parses %s', (name, display, rank, branch, organization) => {
    const parsed = parseSpeakerName(name);
    expect(parsed.display).toBe(display);
    expect(parsed.details).toMatchObject({ rank, branch });
    expect(parsed.details?.organization).toBe(organization);
  });

  it('handles a name with no middle initial', () => {
    const parsed = parseSpeakerName('Doe, John CTR USAF AFMC');
    expect(parsed.display).toBe('Doe, John CTR');
    expect(parsed.details?.middleInitial).toBeUndefined();
  });

  it('handles a name with a branch but no rank', () => {
    expect(parseSpeakerName('Doe, John A USAF AFMC').display).toBe('Doe, John');
  });

  it('recognizes a rank without a branch', () => {
    expect(parseSpeakerName('Doe, John A Lt Col')).toMatchObject({
      display: 'Doe, John Lt Col',
      details: { rank: 'Lt Col', middleInitial: 'A' },
    });
    expect(parseSpeakerName('Doe, John GS-14 Front Office')).toMatchObject({
      display: 'Doe, John GS-14',
      details: { rank: 'GS-14', organization: 'Front Office' },
    });
  });

  it('is stable when applied to its own output', () => {
    const once = parseSpeakerName('Doe, John A CTR USAF AFMC AFLCMC/HNCO').display;
    expect(parseSpeakerName(once).display).toBe(once);
    expect(parseSpeakerName('Lee, Sam Lt Col').display).toBe('Lee, Sam Lt Col');
  });

  it('collapses stray whitespace', () => {
    expect(parseSpeakerName('  Doe,  John   A  CTR  USAF ').display).toBe('Doe, John CTR');
  });

  it.each([
    'John Doe',
    'Sarah',
    'Speaker 1',
    'Smith, John Paul',
    'Smith, John',
    'Doe, John A',
    'Acme, Inc. Sales Team',
    '',
  ])('leaves %j unchanged', (name) => {
    expect(parseSpeakerName(name)).toEqual({ display: name, details: null });
  });
});
