/**
 * Reading the published archive over the WordPress REST API.
 *
 * The archive is a `computer_media` post type on a WordPress site — normally
 * a local copy of it, which is why the setting is a base URL rather than a
 * name. Everything here is a GET of published posts, so no credentials are
 * involved and nothing can be written back: the site is the record of what
 * has been published, and this app only ever asks it questions.
 *
 * It replaces an offline two-step — `wp eval-file scripts/export-wordpress.php`
 * to dump the archive, then a matcher over the dump — and deliberately writes
 * the same `wordpress.json` that dump produced, so the scripts still work on
 * what this fetches and this works on what they fetched.
 *
 * Four things the REST API does that the dump did not have to think about:
 *
 *   - `programmers` comes back as `indiv` *taxonomy term* ids, not post ids,
 *     and `producer-company` as whole post objects. Both are resolved to
 *     plain names here, because a number is no use to anything downstream.
 *   - `_fields` prunes the response server-side. A record carries its whole
 *     rendered page, and the archive is large enough that asking for all of
 *     it costs tens of megabytes we would immediately throw away.
 *   - A field ACF does not know about is invisible. `get_post_meta` in the old
 *     dump read every row; REST exposes only registered meta and ACF's own
 *     fields, so a postmeta row orphaned by a renamed or removed field — on
 *     this archive, `media_type_tags` on eleven records — cannot be read at
 *     all. It is descriptive metadata that no matching depends on; recovering
 *     it would take a change on the site, not here.
 *   - `search` matches terms, not phrases: it splits on spaces and ANDs the
 *     parts, each matched anywhere in the post. So a phrase search asks the
 *     server to narrow and then confirms the phrase here, against the source
 *     text rather than the rendered HTML — `<` in a listing is `&lt;` there.
 */

/** One published program, in the shape the offline dump produced. */
export interface WpRecord {
  id: number;
  title: string;
  slug: string;
  url: string;
  modified: string;
  download_url: string;
  media_type: string;
  tags: string;
  date: string;
  spectrum_computing: string;
  programmers: string[];
  company: string[];
  /** Compilations this program was published on, when it has no file of its own. */
  part_of: { id: number; title: string; download_url: string }[];
}

/** A hit from a search, with the line that earned it when there was one. */
export interface WpHit {
  id: number;
  title: string;
  url: string;
  downloadUrl: string;
  mediaType: string;
  date: string;
  company: string[];
  /** Lines of source around the phrase, for a source search. */
  context: { line: string; number: number }[];
}

export interface WpSearchResult {
  hits: WpHit[];
  /** Records the server offered before the phrase was confirmed. */
  considered: number;
  /** More candidates existed than were read; the count is a floor. */
  truncated: boolean;
}

export interface WpSiteInfo {
  name: string;
  url: string;
  /** Published `computer_media` records the site holds. */
  records: number;
}

/** The default a reader is most likely to want, and what the field suggests. */
export const DEFAULT_WP_URL = 'http://localhost';

/** WordPress caps `per_page` at 100, and every list here wants the maximum. */
const PER_PAGE = 100;

/**
 * How many records a phrase search will read before giving up on being
 * exhaustive. A term like `GO SUB` matches most of the archive, and reading
 * all of it to find the twelve that hold the phrase is a poor trade — the
 * result says it was truncated rather than pretending it was complete.
 */
const SEARCH_LIMIT = 600;

export class WpError extends Error {}

function apiRoot(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '') + '/wp-json/wp/v2';
}

/** WordPress renders titles HTML-encoded; everything downstream wants text. */
function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');   // last, so &amp;lt; survives as &lt;
}

const rendered = (v: any): string =>
  decodeEntities(typeof v === 'object' && v ? String(v.rendered ?? '') : String(v ?? ''));

/** An ACF value that may be absent, `false`, or the empty string. */
const scalar = (v: any): string => (typeof v === 'string' ? v.trim() : '');

/**
 * ACF hands relationship fields back in whichever form the field was set to
 * return — a bare id, or the whole post. Both mean the same thing here.
 */
function relatedIds(v: any): number[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => (typeof x === 'number' ? x : Number(x?.ID ?? x?.id ?? NaN)))
    .filter((n) => Number.isFinite(n));
}

function relatedTitles(v: any): string[] | null {
  if (!Array.isArray(v)) return [];
  const titles = v.map((x) => (x && typeof x === 'object' ? rendered(x.post_title ?? x.title) : ''));
  // All ids and no titles: the caller has to resolve them itself.
  return titles.every((t) => !t) && v.length > 0 ? null : titles.filter(Boolean);
}

async function getJson(url: string, timeoutMs = 20000): Promise<{ body: any; total: number }> {
  const control = new AbortController();
  const timer = setTimeout(() => control.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(url, { headers: { 'user-agent': 'ts2068-disk-browser' }, signal: control.signal });
  } catch (err: any) {
    throw new WpError(
      err?.name === 'AbortError'
        ? 'The site did not answer in time.'
        : `Could not reach the site: ${err?.message ?? 'network error'}`,
    );
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 404) {
    throw new WpError('No REST API there (404). Check the address, and that permalinks are not set to Plain.');
  }
  if (res.status === 401 || res.status === 403) {
    throw new WpError(`The site refused the request (${res.status}). Its REST API may be restricted to logged-in users.`);
  }
  if (!res.ok) throw new WpError(`The site answered ${res.status} ${res.statusText}.`);

  const total = Number(res.headers.get('x-wp-total') ?? '0');
  try {
    return { body: await res.json(), total };
  } catch {
    throw new WpError('The site answered with something that was not JSON. Is that address a WordPress site?');
  }
}

/**
 * Is there an archive at this address? Answers with enough to show the reader
 * they pointed at the right site, rather than a bare yes.
 */
export async function siteInfo(baseUrl: string): Promise<WpSiteInfo> {
  const root = baseUrl.replace(/\/+$/, '') + '/wp-json/';
  const { body } = await getJson(root, 8000);
  if (!body || typeof body !== 'object' || !body.routes) {
    throw new WpError('That address answered, but not like a WordPress REST API.');
  }
  if (!('/wp/v2/computer_media' in body.routes)) {
    throw new WpError(
      'That is a WordPress site, but it publishes no computer_media records. '
      + 'The post type needs "Show in REST API" turned on.',
    );
  }
  const { total } = await getJson(`${apiRoot(baseUrl)}/computer_media?per_page=1&_fields=id`, 8000);
  return { name: rendered(body.name) || baseUrl, url: String(body.home ?? body.url ?? baseUrl), records: total };
}

/** Term ids to names, in as few requests as a hundred-per-page list allows. */
async function resolveTerms(baseUrl: string, taxonomy: string, ids: number[]): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  const unique = [...new Set(ids)];
  for (let i = 0; i < unique.length; i += PER_PAGE) {
    const batch = unique.slice(i, i + PER_PAGE);
    const url = `${apiRoot(baseUrl)}/${taxonomy}?include=${batch.join(',')}&per_page=${PER_PAGE}&_fields=id,name`;
    let body: any;
    try { ({ body } = await getJson(url)); } catch { continue; }   // a name is not worth failing over
    for (const t of Array.isArray(body) ? body : []) {
      if (t?.id != null) out.set(Number(t.id), decodeEntities(String(t.name ?? '')));
    }
  }
  return out;
}

/** Post ids to titles and downloads, for the compilations a program came on. */
async function resolvePosts(
  baseUrl: string, ids: number[],
): Promise<Map<number, { title: string; download_url: string }>> {
  const out = new Map<number, { title: string; download_url: string }>();
  const unique = [...new Set(ids)];
  for (let i = 0; i < unique.length; i += PER_PAGE) {
    const batch = unique.slice(i, i + PER_PAGE);
    const url = `${apiRoot(baseUrl)}/computer_media?include=${batch.join(',')}`
      + `&per_page=${PER_PAGE}&_fields=id,title,acf.download_url`;
    let body: any;
    try { ({ body } = await getJson(url)); } catch { continue; }
    for (const p of Array.isArray(body) ? body : []) {
      if (p?.id == null) continue;
      out.set(Number(p.id), {
        title: rendered(p.title),
        download_url: scalar(p.acf?.download_url),
      });
    }
  }
  return out;
}

/** The fields a record is built from — everything else is page furniture. */
const RECORD_FIELDS = [
  'id', 'title', 'slug', 'link', 'modified',
  'acf.download_url', 'acf.media-type', 'acf.media_type_tags', 'acf.mediadate',
  'acf.spectrum_computing', 'acf.programmers', 'acf.producer-company', 'acf.media_contents',
].join(',');

function toRecord(p: any): WpRecord {
  const acf = p?.acf ?? {};
  return {
    id: Number(p.id),
    title: rendered(p.title),
    slug: String(p.slug ?? ''),
    url: String(p.link ?? ''),
    modified: String(p.modified ?? ''),
    download_url: scalar(acf.download_url),
    media_type: scalar(acf['media-type']),
    tags: scalar(acf.media_type_tags),
    date: scalar(acf.mediadate),
    spectrum_computing: scalar(acf.spectrum_computing),
    programmers: [],
    company: [],
    part_of: [],
  };
}

/**
 * Every published program on the site.
 *
 * Two passes: the records themselves, then one round of lookups for the names
 * and compilations they refer to by number. Doing it that way costs a handful
 * of extra requests instead of one per record.
 */
export async function fetchArchive(
  baseUrl: string,
  onProgress?: (done: number, total: number) => void,
): Promise<WpRecord[]> {
  const records: WpRecord[] = [];
  const rawById = new Map<number, any>();
  let page = 1;
  let total = 0;

  for (;;) {
    const url = `${apiRoot(baseUrl)}/computer_media?per_page=${PER_PAGE}&page=${page}`
      + `&orderby=id&order=asc&_fields=${RECORD_FIELDS}`;
    const { body, total: reported } = await getJson(url, 30000);
    if (page === 1) total = reported;
    const batch = Array.isArray(body) ? body : [];
    if (batch.length === 0) break;
    for (const p of batch) {
      if (p?.id == null) continue;
      rawById.set(Number(p.id), p);
      records.push(toRecord(p));
    }
    onProgress?.(records.length, total || records.length);
    if (batch.length < PER_PAGE) break;
    page++;
  }

  // What the records referred to by number.
  const programmerIds: number[] = [];
  const parentIds: number[] = [];
  for (const raw of rawById.values()) {
    programmerIds.push(...relatedIds(raw.acf?.programmers));
    parentIds.push(...relatedIds(raw.acf?.media_contents));
  }
  const people = programmerIds.length ? await resolveTerms(baseUrl, 'indiv', programmerIds) : new Map();
  const parents = parentIds.length ? await resolvePosts(baseUrl, parentIds) : new Map();

  for (const rec of records) {
    const acf = rawById.get(rec.id)?.acf ?? {};
    rec.programmers = relatedTitles(acf.programmers)
      ?? relatedIds(acf.programmers).map((id) => people.get(id) ?? '').filter(Boolean);
    rec.company = relatedTitles(acf['producer-company'])
      ?? relatedIds(acf['producer-company']).map((id) => parents.get(id)?.title ?? '').filter(Boolean);
    rec.part_of = relatedIds(acf.media_contents)
      .map((id) => ({ id, ...(parents.get(id) ?? { title: '', download_url: '' }) }))
      .filter((x) => x.title);
  }

  return records;
}

/**
 * The file behind a record. A program published on a compilation has none of
 * its own — the reader is sent to the tape — so the parent's download is the
 * one that actually holds it.
 */
export function effectiveDownload(r: WpRecord): { url: string; via: string } | null {
  if (r.download_url.trim()) return { url: r.download_url, via: '' };
  const parent = (r.part_of ?? []).find((x) => x.download_url.trim());
  return parent ? { url: parent.download_url, via: parent.title } : null;
}

function toHit(p: any, context: { line: string; number: number }[] = []): WpHit {
  const acf = p?.acf ?? {};
  const parents = relatedTitles(acf.media_contents) ?? [];
  return {
    id: Number(p.id),
    title: rendered(p.title),
    url: String(p.link ?? ''),
    downloadUrl: scalar(acf.download_url),
    mediaType: scalar(acf['media-type']),
    date: scalar(acf.mediadate),
    company: relatedTitles(acf['producer-company']) ?? parents,
    context,
  };
}

const HIT_FIELDS = 'id,title,link,acf.download_url,acf.media-type,acf.mediadate,acf.producer-company';

/**
 * Records whose title matches `name`. This is the "is this one already up?"
 * question asked of a single program while browsing a disk, so it stays one
 * request and reports what the site says without interpreting it.
 */
export async function lookupByName(baseUrl: string, name: string): Promise<WpHit[]> {
  const q = name.trim();
  if (!q) return [];
  const url = `${apiRoot(baseUrl)}/computer_media?search=${encodeURIComponent(q)}`
    + `&per_page=20&_fields=${HIT_FIELDS}`;
  const { body } = await getJson(url, 10000);
  const hits = (Array.isArray(body) ? body : []).map((p: any) => toHit(p));

  // The server matched terms anywhere in the post, which for a short name
  // catches a great deal. Only titles that actually contain the name are an
  // answer to the question that was asked.
  const needle = q.toLowerCase();
  const inTitle = hits.filter((h) => h.title.toLowerCase().includes(needle));
  return inTitle.length > 0 ? inTitle : hits;
}

/** The lines around a phrase, for showing why a record matched. */
function contextFor(source: string, phrase: string, want = 3): { line: string; number: number }[] {
  const lines = source.split(/\r?\n/);
  const needle = phrase.toLowerCase();
  const out: { line: string; number: number }[] = [];
  for (let i = 0; i < lines.length && out.length < want; i++) {
    if (lines[i].toLowerCase().includes(needle)) out.push({ line: lines[i].trim(), number: i + 1 });
  }
  return out;
}

/**
 * Records whose BASIC source holds `phrase`.
 *
 * This is the search for when a name is no help — the disk calls it
 * `AUTOSTART`, or six programs share a title — and a line of the listing is
 * the only distinctive thing to hand.
 *
 * The site's own search does the narrowing: the listing is rendered into the
 * post body, so a search reaches it. But it matches each *word* anywhere in
 * the post, not the phrase, so every candidate is then confirmed here against
 * `source_code`, which is the listing as plain text.
 */
export async function searchSource(baseUrl: string, phrase: string): Promise<WpSearchResult> {
  const q = phrase.trim();
  if (!q) return { hits: [], considered: 0, truncated: false };

  const hits: WpHit[] = [];
  let considered = 0;
  let page = 1;
  let truncated = false;

  for (;;) {
    const url = `${apiRoot(baseUrl)}/computer_media?search=${encodeURIComponent(q)}`
      + `&per_page=${PER_PAGE}&page=${page}&_fields=${HIT_FIELDS},acf.source_code`;
    const { body, total } = await getJson(url, 30000);
    const batch = Array.isArray(body) ? body : [];
    if (batch.length === 0) break;

    for (const p of batch) {
      considered++;
      const source = scalar(p?.acf?.source_code);
      if (!source) continue;
      const context = contextFor(source, q);
      if (context.length > 0) hits.push(toHit(p, context));
    }

    if (batch.length < PER_PAGE) break;
    if (considered >= SEARCH_LIMIT) { truncated = total > considered; break; }
    page++;
  }

  return { hits, considered, truncated };
}
