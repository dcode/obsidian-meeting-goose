import fs from 'fs';
import path from 'path';

const PROJECT_ROOT = path.resolve(__dirname, '..');
const PURCHASE_URL_PREFIX = 'https://tumbucon.gumroad.com/l/meetingmind-pro';
const REQUIRED_UTM_PARAMS = ['utm_source', 'utm_medium', 'utm_campaign'];
const SEARCH_ROOTS = ['README.md', 'docs', 'src', 'content/src', 'frontend'];
const IGNORED_PATH_PARTS = new Set(['node_modules', 'dist', '.astro']);
const SEARCH_EXTENSIONS = new Set(['.astro', '.html', '.md', '.mdx', '.ts', '.tsx']);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}


interface LinkOccurrence {
  file: string;
  line: number;
  url: string;
}

function collectFiles(entry: string): string[] {
  const absoluteEntry = path.join(PROJECT_ROOT, entry);

  if (!fs.existsSync(absoluteEntry)) {
    return [];
  }

  const stat = fs.statSync(absoluteEntry);
  if (stat.isFile()) {
    return SEARCH_EXTENSIONS.has(path.extname(absoluteEntry)) ? [absoluteEntry] : [];
  }

  const files: string[] = [];
  for (const child of fs.readdirSync(absoluteEntry)) {
    const childPath = path.join(absoluteEntry, child);
    const relativeParts = path.relative(PROJECT_ROOT, childPath).split(path.sep);
    if (relativeParts.some((part) => IGNORED_PATH_PARTS.has(part))) {
      continue;
    }

    const childStat = fs.statSync(childPath);
    if (childStat.isDirectory()) {
      files.push(...collectFiles(path.relative(PROJECT_ROOT, childPath)));
    } else if (SEARCH_EXTENSIONS.has(path.extname(childPath))) {
      files.push(childPath);
    }
  }

  return files;
}

function findClickablePurchaseLinks(filePath: string): LinkOccurrence[] {
  const text = fs.readFileSync(filePath, 'utf8');
  const relativePath = path.relative(PROJECT_ROOT, filePath);
  const escapedPurchaseUrlPrefix = escapeRegExp(PURCHASE_URL_PREFIX);
  const clickableLinkPattern = new RegExp(
    String.raw`(?:href=["']|\]\(|window\.open\(["'])(${escapedPurchaseUrlPrefix}[^\s\)\]"'<>]*)`,
    'g'
  );
  const occurrences: LinkOccurrence[] = [];

  for (const match of text.matchAll(clickableLinkPattern)) {
    const matchedUrl = match[1];
    const line = text.slice(0, match.index).split('\n').length;
    occurrences.push({ file: relativePath, line, url: matchedUrl });
  }

  return occurrences;
}

describe('Gumroad purchase link tracking', () => {
  it('adds source, medium, and campaign UTMs to every clickable MeetingMind Pro link', () => {
    const files = SEARCH_ROOTS.flatMap(collectFiles);
    const links = files.flatMap(findClickablePurchaseLinks);

    expect(links.length).toBeGreaterThan(0);

    const untrackedLinks = links.filter(({ url }) => {
      const parsedUrl = new URL(url);
      return REQUIRED_UTM_PARAMS.some((param) => !parsedUrl.searchParams.get(param));
    });

    expect(untrackedLinks).toEqual([]);
  });
});
