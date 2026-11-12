/**
 * Normalizes directory-style display names, as Microsoft Teams writes them
 * into transcripts for US DoD tenants:
 *
 *   Doe, John A CTR USAF AFMC AFLCMC/HNCO
 *   └last ┘first MI rank branch organization…
 *
 * becomes the display name "Doe, John CTR", with the remaining parts returned
 * separately so they can be recorded on the person's note instead of being
 * repeated on every line of every transcript.
 *
 * Names that do not clearly follow the pattern are returned unchanged.
 */

export interface SpeakerDetails {
  /** The name exactly as the transcript had it. */
  originalName: string;
  lastName: string;
  firstName: string;
  middleInitial?: string;
  /** Rank, grade, or status such as "Maj", "GS-13", "CTR". */
  rank?: string;
  /** Service branch or agency such as "USAF". */
  branch?: string;
  organization?: string;
}

export interface ParsedSpeakerName {
  /** "Last, First Rank", or the original name when it was not recognized. */
  display: string;
  /** Null when the name was not recognized. */
  details: SpeakerDetails | null;
}

/** Service branches and agencies that follow the rank in a display name. */
const BRANCHES = new Set([
  'USAF', 'USSF', 'USA', 'USN', 'USMC', 'USCG', 'DAF', 'DA', 'DON', 'DOD', 'DOW', 'OSD', 'JS',
  'ANG', 'ARNG', 'NG', 'USAFR', 'AFR', 'USAR', 'USNR', 'USMCR', 'USCGR',
  'DISA', 'DLA', 'DHA', 'DIA', 'NSA', 'NGA', 'NRO', 'DCSA', 'DTRA', 'MDA', 'DARPA', 'DCMA', 'DFAS', 'DCAA',
  'USSOCOM', 'USCYBERCOM', 'USSTRATCOM', 'USTRANSCOM', 'USSPACECOM', 'USINDOPACOM', 'USEUCOM',
  'USCENTCOM', 'USNORTHCOM', 'USSOUTHCOM', 'USAFRICOM',
]);

/**
 * Words that make up a rank or status. Only consulted when no branch is
 * present to mark where the rank ends; ranks may span several of them
 * ("Lt Col", "1st Lt", "Brig Gen").
 */
const RANK_WORDS = new Set([
  // Status
  'CTR', 'CIV', 'CONT', 'MIL', 'NFG', 'FN', 'MR', 'MS', 'MRS', 'DR',
  // Officers
  'GEN', 'LTGEN', 'MAJGEN', 'BRIGGEN', 'BGEN', 'LTG', 'MG', 'BG', 'COL', 'LTCOL', 'LTC', 'MAJ', 'CAPT', 'CPT',
  'LT', '1STLT', '2NDLT', '1LT', '2LT', '1ST', '2ND', 'BRIG',
  'ADM', 'VADM', 'RADM', 'RDML', 'CDR', 'LCDR', 'LTJG', 'ENS',
  'CW5', 'CW4', 'CW3', 'CW2', 'CWO5', 'CWO4', 'CWO3', 'CWO2', 'WO1', 'WO',
  // Enlisted
  'CMSAF', 'CMSGT', 'SMSGT', 'MSGT', 'TSGT', 'SSGT', 'SRA', 'A1C', 'AMN', 'AB',
  'SMA', 'CSM', 'SGM', '1SG', 'MSG', 'SFC', 'SSG', 'SGT', 'CPL', 'SPC', 'PFC', 'PV2', 'PVT',
  'SPC1', 'SPC2', 'SPC3', 'SPC4',
  'MCPON', 'MCPO', 'SCPO', 'CPO', 'PO1', 'PO2', 'PO3', 'SN', 'SA', 'SR',
  'SGTMAJ', 'MGYSGT', '1STSGT', 'GYSGT', 'LCPL',
]);

/** Civilian pay grades: GS-13, GG-14, NH-03, SES, O-4, E-7, W-2, … */
const GRADE = /^(?:(?:GS|GG|GM|WG|WL|WS|NH|NK|NJ|ND|NM|NT|NP|DR|DB|DE|DJ|DK|AD|ST|SL|IA|[OEW])-?\d{1,2}|SES)$/i;

const stripPunctuation = (token: string): string => token.replace(/[.,;]+$/, '');
const isBranch = (token: string): boolean => BRANCHES.has(stripPunctuation(token).toUpperCase());
const isRankWord = (token: string): boolean => {
  const word = stripPunctuation(token);
  return RANK_WORDS.has(word.toUpperCase()) || GRADE.test(word);
};

export function parseSpeakerName(rawName: string): ParsedSpeakerName {
  const name = rawName.replace(/\s+/g, ' ').trim();
  const unrecognized: ParsedSpeakerName = { display: name, details: null };

  const match = name.match(/^([^,]+),\s*(\S.*)$/);
  if (!match) return unrecognized;

  const lastName = match[1].trim();
  const tokens = match[2].split(' ');
  const firstName = tokens[0];
  let index = 1;

  let middleInitial: string | undefined;
  if (index < tokens.length && /^[A-Za-z]\.?$/.test(tokens[index])) {
    middleInitial = tokens[index].charAt(0).toUpperCase();
    index++;
  }

  let rank: string | undefined;
  let branch: string | undefined;
  let organization: string | undefined;

  const branchIndex = tokens.findIndex((token, i) => i >= index && isBranch(token));
  if (branchIndex >= 0) {
    // Everything between the name and the branch is the rank.
    rank = tokens.slice(index, branchIndex).join(' ') || undefined;
    branch = stripPunctuation(tokens[branchIndex]);
    organization = tokens.slice(branchIndex + 1).join(' ') || undefined;
  } else {
    // No branch to mark the end of the rank, so take only words known to be one.
    let rankEnd = index;
    while (rankEnd < tokens.length && isRankWord(tokens[rankEnd])) rankEnd++;
    if (rankEnd === index) {
      // "Smith, John Paul" or "Acme, Inc. Sales": not this format, leave it alone.
      return unrecognized;
    }
    rank = tokens.slice(index, rankEnd).join(' ');
    organization = tokens.slice(rankEnd).join(' ') || undefined;
  }

  const details: SpeakerDetails = { originalName: name, lastName, firstName };
  if (middleInitial) details.middleInitial = middleInitial;
  if (rank) details.rank = rank;
  if (branch) details.branch = branch;
  if (organization) details.organization = organization;

  return {
    display: `${lastName}, ${firstName}${rank ? ` ${rank}` : ''}`,
    details,
  };
}
