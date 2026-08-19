/**
 * Render the human-facing views of a catalogue from the catalog.json that
 * build-catalog.mts wrote.
 *
 * Kept separate from the build because the build re-reads the whole
 * collection, which on cloud storage is minutes of waiting, while the CSVs and
 * the index are cheap to regenerate and are what actually gets iterated on.
 *
 *   npx tsx scripts/render-catalog.mts <catalogDir>
 */

import * as fs from 'fs';
import * as path from 'path';

interface Occurrence {
  image: string; folder: string; format: string; index: number; filename: string;
}

interface Program {
  id: string; sha256: string; title: string; titleSource: string;
  type: string; size: number;
  isScreen: boolean; isFont: boolean; isUdg: boolean;
  names: string[]; formats: string[];
  basic: null | {
    lineCount: number; autostart?: number; rems: string[]; strings: string[];
    loads: string[]; usrCalls: string[]; preview: string;
  };
  occurrences: Occurrence[];
}

interface Catalog {
  root: string; generated: string;
  imageCount: number; entryCount: number; uniqueCount: number;
  programs: Program[];
  unreadable: { file: string; reason: string }[];
}

const dir = process.argv[2];
if (!dir) { console.error('usage: render-catalog.mts <catalogDir>'); process.exit(1); }

const cat: Catalog = JSON.parse(fs.readFileSync(path.join(dir, 'catalog.json'), 'utf-8'));

/**
 * Archive status, if a match pass has been run. Optional: the catalogue is
 * complete and useful without it, and stands on its own before any archive
 * has been consulted.
 */
interface MatchRec {
  programId: string; matchedOn: string; how: string; exact: boolean; ambiguous: boolean;
  wp: { id: number; title: string; url: string; downloadUrl: string; onCompilation: string;
        mediaType: string; tags: string; date: string; programmers: string[]; company: string[] }[];
}
let matchById = new Map<string, MatchRec>();
const matchPath = path.join(dir, 'matches.json');
if (fs.existsSync(matchPath)) {
  const m = JSON.parse(fs.readFileSync(matchPath, 'utf-8'));
  matchById = new Map<string, MatchRec>((m.matches as MatchRec[]).map((x) => [x.programId, x]));
}

/**
 * Marks made by hand, which outrank anything the name matching guessed. Kept
 * in their own file so a rebuild of the catalogue cannot overwrite them.
 */
interface Mark { status: string; note?: string; markedAt: string }
let marks: Record<string, Mark> = {};
const marksPath = path.join(dir, 'marks.json');
if (fs.existsSync(marksPath)) {
  marks = JSON.parse(fs.readFileSync(marksPath, 'utf-8')).marks ?? {};
}

const MARK_LABEL: Record<string, string> = {
  archived: 'archived (you)',
  'not-archived': 'not archived (you)',
  skip: 'skipped',
};

/** How far to trust the archive status, in one word. */
const statusOf = (id: string): string => {
  const mark = marks[id];
  if (mark) return MARK_LABEL[mark.status] ?? mark.status;
  const m = matchById.get(id);
  if (!m) return 'not found';
  if (m.exact) return 'archived';
  return m.ambiguous ? 'maybe' : 'likely';
};

/** Where a status came from, so a guess is never mistaken for a decision. */
const statusSource = (id: string): string => (marks[id] ? 'you' : matchById.has(id) ? 'name match' : '');

/**
 * Map each program to the file the build actually wrote for it, by looking on
 * disk rather than recomputing the name. Recomputation would silently break
 * every link the moment the slug rules changed.
 */
const fileById = new Map<string, string>();
const pngById = new Map<string, string>();
for (const sub of fs.readdirSync(path.join(dir, 'programs'), { withFileTypes: true })) {
  if (!sub.isDirectory()) continue;
  for (const name of fs.readdirSync(path.join(dir, 'programs', sub.name))) {
    const m = name.match(/-([0-9a-f]{8})\.([a-z.]+)$/);
    if (!m) continue;
    const rel = path.join('programs', sub.name, name);
    if (m[2] === 'png') pngById.set(m[1], rel);
    else if (m[2] === 'tap' || m[2] === 'bin') fileById.set(m[1], rel);
  }
}

function kindOf(p: Program): string {
  if (p.isScreen) return 'screen';
  if (p.isFont) return 'font';
  if (p.isUdg) return 'UDG';
  if (p.basic?.loads.length) return 'loader';
  return p.type;
}

const progs = [...cat.programs].sort(
  (a, b) => b.occurrences.length - a.occurrences.length || a.title.localeCompare(b.title),
);

// ------------------------------------------------------------------- CSV ----

const csv = (v: string | number) => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const distinctFolders = (p: Program) =>
  [...new Set(p.occurrences.map((o) => o.folder === '.' ? '(root)' : o.folder))];

fs.writeFileSync(path.join(dir, 'catalog.csv'),
  ['id,title,title_from,type,kind,size,copies,folders,found_in,archived,archive_title,archive_url,archive_date,archive_company,archive_tags,archive_on_compilation,status_from,mark_note,filed_as,autostart,basic_lines,loads,rems,strings,file']
    .concat(progs.map((p) => [
      p.id, p.title, p.titleSource, p.type, kindOf(p), p.size,
      p.occurrences.length, distinctFolders(p).length,
      distinctFolders(p).join(' | '),
      statusOf(p.id),
      matchById.get(p.id)?.wp[0]?.title ?? '',
      matchById.get(p.id)?.wp[0]?.url ?? '',
      matchById.get(p.id)?.wp[0]?.date ?? '',
      matchById.get(p.id)?.wp[0]?.company.join(' | ') ?? '',
      matchById.get(p.id)?.wp[0]?.tags ?? '',
      matchById.get(p.id)?.wp[0]?.onCompilation ?? '',
      statusSource(p.id),
      marks[p.id]?.note ?? '',
      p.names.join(' | '),
      p.basic?.autostart != null ? String(p.basic.autostart) : '',
      p.basic ? String(p.basic.lineCount) : '',
      p.basic?.loads.join(' | ') ?? '',
      p.basic?.rems.slice(0, 3).join(' / ') ?? '',
      p.basic?.strings.slice(0, 5).join(' / ') ?? '',
      fileById.get(p.id) ?? '',
    ].map(csv).join(',')))
    .join('\n') + '\n');

fs.writeFileSync(path.join(dir, 'occurrences.csv'),
  ['id,title,kind,image,folder,format,catalog_index,filed_as']
    .concat(progs.flatMap((p) => p.occurrences.map((o) => [
      p.id, p.title, kindOf(p), o.image, o.folder === '.' ? '(root)' : o.folder,
      o.format, o.index, o.filename,
    ].map(csv).join(','))))
    .join('\n') + '\n');

// One row per folder: what a given disk folder holds, for working folder by folder.
const folderMap = new Map<string, { total: number; unique: Set<string>; onlyHere: number }>();
for (const p of progs) {
  for (const folder of distinctFolders(p)) {
    if (!folderMap.has(folder)) folderMap.set(folder, { total: 0, unique: new Set(), onlyHere: 0 });
    const f = folderMap.get(folder)!;
    f.unique.add(p.id);
    if (distinctFolders(p).length === 1) f.onlyHere++;
  }
}
for (const p of progs) {
  for (const o of p.occurrences) {
    const key = o.folder === '.' ? '(root)' : o.folder;
    folderMap.get(key)!.total++;
  }
}
fs.writeFileSync(path.join(dir, 'folders.csv'),
  ['folder,entries,unique_programs,found_nowhere_else']
    .concat([...folderMap].sort((a, b) => b[1].onlyHere - a[1].onlyHere).map(([f, v]) =>
      [f, v.total, v.unique.size, v.onlyHere].map(csv).join(',')))
    .join('\n') + '\n');

const GENERIC = /^(AUTOSTART|AUTO|L|LOAD|LOADER|MENU|BOOT|START|RUN|FORMAT|README|CAT|DIR|COPY|PROG|A|B|C|X|[0-9]{1,3})$/i;
const byName = new Map<string, Set<string>>();
for (const p of progs) {
  for (const n of p.names) {
    const key = n.trim().replace(/\.[BCAbca][\w$]*$/, '').trim().toUpperCase();
    if (!key || GENERIC.test(key)) continue;
    if (!byName.has(key)) byName.set(key, new Set());
    byName.get(key)!.add(p.id);
  }
}
const variants = [...byName].filter(([, ids]) => ids.size > 1).sort((a, b) => b[1].size - a[1].size);
fs.writeFileSync(path.join(dir, 'variants.csv'),
  ['name,versions,ids'].concat(variants.map(([n, ids]) =>
    [n, ids.size, [...ids].join(' ')].map(csv).join(','))).join('\n') + '\n');

// ------------------------------------------------------------------ HTML ----

const esc = (s: string) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * The units you actually work through: a folder is usually one original disk
 * whose programs were extracted to separate tapes, and an image is a single
 * file. Both are offered, numbered together, so a row can name its sources in
 * a few bytes rather than repeating paths 16,650 times.
 */
const sourceIds = new Map<string, number>();
const sourceKind = new Map<string, 'folder' | 'image'>();
const addSource = (name: string, kind: 'folder' | 'image') => {
  if (!sourceIds.has(name)) { sourceIds.set(name, sourceIds.size); sourceKind.set(name, kind); }
};
for (const p of progs) {
  for (const o of p.occurrences) {
    addSource(o.folder === '.' ? '(root)' : o.folder, 'folder');
    addSource(o.image, 'image');
  }
}
const sourcesOf = (p: Program): number[] => [...new Set(p.occurrences.flatMap((o) => [
  sourceIds.get(o.folder === '.' ? '(root)' : o.folder)!,
  sourceIds.get(o.image)!,
]))];

/** Programs per source, for the progress line while working through one. */
const sourceMembers = new Map<number, Set<string>>();
for (const p of progs) {
  for (const id of sourcesOf(p)) {
    if (!sourceMembers.has(id)) sourceMembers.set(id, new Set());
    sourceMembers.get(id)!.add(p.id);
  }
}

const rowsHtml = progs.map((p) => {
  const png = pngById.get(p.id);
  const file = fileById.get(p.id);
  const clues = [
    p.basic?.rems.slice(0, 3).join(' · '),
    p.basic?.strings.slice(0, 4).join(' · '),
    p.basic?.loads.length ? `LOADs ${p.basic.loads.join(', ')}` : '',
  ].filter(Boolean).join(' — ');

  // Every place this program turned up, grouped so repeats within one folder
  // read as one line rather than many.
  const places = new Map<string, string[]>();
  for (const o of p.occurrences) {
    const f = o.folder === '.' ? '(root)' : o.folder;
    if (!places.has(f)) places.set(f, []);
    places.get(f)!.push(path.basename(o.image) + (o.filename ? ` → ${o.filename}` : ''));
  }
  const placesHtml = [...places].map(([folder, items]) =>
    `<div class="place"><b>${esc(folder)}</b>${items.map((i) => `<span>${esc(i)}</span>`).join('')}</div>`,
  ).join('');

  const search = [p.title, p.names.join(' '), p.basic?.rems.join(' ') ?? '',
    p.basic?.strings.join(' ') ?? '', p.basic?.loads.join(' ') ?? '',
    [...places.keys()].join(' ')].join(' ').toLowerCase();

  const st = statusOf(p.id), mr = matchById.get(p.id), mk = marks[p.id];
  const mkNote = mk
    ? `<span class="clue mark">marked ${esc(mk.status)} on ${esc(mk.markedAt.slice(0, 10))}${mk.note ? ` — ${esc(mk.note)}` : ''}</span>`
    : '';
  const arc = mr
    ? `<span class="clue">archive: <a href="${esc(mr.wp[0].url)}">${esc(mr.wp[0].title)}</a>`
      + `${mr.wp[0].date ? ` (${esc(mr.wp[0].date)})` : ''}`
      + `${mr.wp[0].company.length ? ` — ${esc(mr.wp[0].company.join(', '))}` : ''}`
      + `${mr.wp[0].onCompilation ? ` <i>on ${esc(mr.wp[0].onCompilation)}</i>` : ''}`
      + `${mr.exact ? '' : ` <i>matched on ${esc(mr.matchedOn)}${mr.ambiguous ? ', ambiguous' : ''}</i>`}</span>`
    : '';
  return `<tr data-s="${esc(search)}" data-kind="${esc(kindOf(p))}" data-copies="${p.occurrences.length}" data-arc="${esc(st)}" data-src="${sourcesOf(p).join(' ')}" data-id="${esc(p.id)}">
<td><input type="checkbox" class="pick" data-id="${esc(p.id)}" title="tick, then use Copy ticked ids">
${file ? `<a class="title" href="${esc(file)}">${esc(p.title)}</a>` : `<span class="title">${esc(p.title)}</span>`}
<code class="id">${esc(p.id)}</code>
<span class="clue">${esc(p.names.join(' | '))} <i>(${esc(p.titleSource)})</i></span>
${clues ? `<span class="clue">${esc(clues)}</span>` : ''}${arc}${mkNote}
<details><summary>found in ${places.size} folder${places.size === 1 ? '' : 's'}, ${p.occurrences.length} cop${p.occurrences.length === 1 ? 'y' : 'ies'}</summary>${placesHtml}</details></td>
<td><span class="badge">${esc(kindOf(p))}</span><br><span class="badge s-${esc(st.replace(' ','_'))}">${esc(st)}</span></td>
<td class="n">${p.size}</td><td class="n">${p.occurrences.length}</td><td class="n">${places.size}</td>
<td>${png ? `<a href="${esc(png)}"><img src="${esc(png)}" width="128" loading="lazy"></a>` : ''}</td></tr>`;
}).join('\n');

fs.writeFileSync(path.join(dir, 'index.html'), `<!doctype html>
<html><head><meta charset="utf-8"><title>TS Collection Catalogue</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 13px/1.45 system-ui, sans-serif; margin: 0; padding: 16px; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .meta { color: #888; margin-bottom: 14px; }
  .controls { position: sticky; top: 0; background: Canvas; padding: 8px 0; border-bottom: 1px solid #8884; display: flex; gap: 8px; flex-wrap: wrap; z-index: 2; }
  input, select { font: inherit; padding: 5px 8px; border: 1px solid #8886; border-radius: 4px; background: Canvas; color: CanvasText; }
  #q { flex: 1; min-width: 260px; }
  table { border-collapse: collapse; width: 100%; margin-top: 10px; }
  th { text-align: left; border-bottom: 2px solid #8886; padding: 6px 8px; position: sticky; top: 92px; background: Canvas; cursor: pointer; user-select: none; }
  td { border-bottom: 1px solid #8883; padding: 6px 8px; vertical-align: top; }
  tr:hover td { background: #8881; }
  .title { font-weight: 600; }
  .clue { color: #888; font-size: 11px; display: block; max-width: 520px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .n { text-align: right; font-variant-numeric: tabular-nums; }
  .badge { font-size: 10px; padding: 1px 5px; border-radius: 3px; border: 1px solid #8886; }
  img { image-rendering: pixelated; border: 1px solid #8884; display: block; }
  a { color: inherit; }
  details { margin-top: 3px; }
  summary { font-size: 11px; color: #6a9; cursor: pointer; }
  .place { font-size: 11px; margin: 4px 0 0 10px; }
  .place b { display: block; color: CanvasText; font-weight: 600; }
  .place span { display: block; color: #888; margin-left: 10px; }
  #count { color: #888; align-self: center; }
  .s-archived { border-color: #4a4; color: #4a4; }
  .s-likely { border-color: #a94; color: #a94; }
  .s-maybe { border-color: #a66; color: #a66; }
  .s-not_found { opacity: .5; }
  .s-archived_you { border-color: #4a4; color: #4a4; font-weight: 600; }
  .s-not_archived_you { border-color: #a66; color: #a66; font-weight: 600; }
  .s-skipped { opacity: .6; text-decoration: line-through; }
  .mark { color: #4a9; }
  .id { font-size: 10px; color: #888; margin-left: 6px; }
  .pick { margin-right: 6px; vertical-align: top; }
  .hint { font-size: 11px; color: #888; padding: 6px 0; word-break: break-all; }
  #copy, #markall, #imgclear { font: inherit; font-size: 12px; padding: 5px 10px; cursor: pointer; }
  .controls.second { top: 46px; }
  .controls label { align-self: center; font-size: 12px; color: #888; }
  #img { flex: 1; min-width: 260px; }
  .imgpanel { padding: 8px 10px; margin: 8px 0; border: 1px solid #8886; border-radius: 4px; font-size: 12px; }
  .imgpanel a { display: inline-block; color: #6a9; text-decoration: none; }
  .imgpanel .note { color: #888; font-size: 11px; }
</style></head><body>
<h1>TS Collection Catalogue</h1>
<div class="meta">${esc(cat.root)}<br>
${cat.imageCount} images &middot; ${cat.entryCount} entries &middot;
<strong>${cat.uniqueCount} unique programs</strong> &middot; built ${esc(cat.generated.slice(0, 10))}</div>
<div class="controls">
  <input id="q" placeholder="Search titles, filenames, REMs, printed text, folder names&hellip;" autofocus>
  <select id="kind"><option value="">every kind</option>${
  [...new Set(progs.map(kindOf))].sort().map((k) => `<option>${esc(k)}</option>`).join('')}</select>
  <select id="arc"><option value="">archived or not</option><option value="not found">not in the archive</option><option value="archived">archived (exact)</option><option value="likely">likely</option><option value="maybe">maybe — needs review</option><option value="archived (you)">marked archived by you</option><option value="not archived (you)">marked not archived</option><option value="skipped">skipped</option></select>
  <select id="dupes"><option value="">any number of copies</option><option value="1">one-offs only</option><option value="2">duplicated only</option></select>
  <button id="copy" type="button">Copy ticked ids</button>
</div>
<div class="controls second">
  <label for="img">Work through one disk:</label>
  <input id="img" list="imagelist" placeholder="folder or image — e.g. Sincus_103-4" autocomplete="off">
  <button id="imgclear" type="button">show all</button>
  <button id="markall" type="button">Copy command to mark all shown</button>
  <span id="count"></span>
</div>
<div id="hint" class="hint"></div>
<datalist id="imagelist">${
  [...sourceIds.keys()]
    .sort((a, b) => (sourceKind.get(a) === sourceKind.get(b) ? a.localeCompare(b) : sourceKind.get(a) === 'folder' ? -1 : 1))
    .map((n) => `<option value="${esc(n)}">`).join('')
}</datalist>
<div id="imgpanel" class="imgpanel" hidden></div>
<table id="t"><thead><tr>
<th data-k="title">Title &amp; where it was found</th><th data-k="kind">Kind</th><th data-k="size" class="n">Size</th>
<th data-k="copies" class="n">Copies</th><th data-k="folders" class="n">Folders</th><th>Screen</th>
</tr></thead><tbody>
${rowsHtml}
</tbody></table>
<script>
const CATALOG_DIR = ${JSON.stringify(dir)};
const SOURCES = JSON.parse(${JSON.stringify(JSON.stringify([...sourceIds.keys()]))});
const SOURCE_KIND = JSON.parse(${JSON.stringify(JSON.stringify([...sourceIds.keys()].map((n) => sourceKind.get(n))))});
const SOURCE_MEMBERS = JSON.parse(${JSON.stringify(JSON.stringify(
  Object.fromEntries([...sourceMembers].map(([id, ids]) => [String(id), [...ids]])),
))});
const STATUS_BY_ID = JSON.parse(${JSON.stringify(JSON.stringify(
  Object.fromEntries(progs.map((p) => [p.id, statusOf(p.id)])),
))});
const rows = [...document.querySelectorAll('#t tbody tr')];
const q = document.getElementById('q'), kind = document.getElementById('kind'),
      dupes = document.getElementById('dupes'), arc = document.getElementById('arc'),
      count = document.getElementById('count');
function apply() {
  const t = q.value.toLowerCase().trim(), k = kind.value, d = dupes.value;
  let n = 0;
  for (const r of rows) {
    let ok = (!t || r.dataset.s.includes(t)) && (!k || r.dataset.kind === k);
    if (ok && d === '1') ok = r.dataset.copies === '1';
    if (ok && d === '2') ok = +r.dataset.copies > 1;
    if (ok && arc.value) ok = r.dataset.arc === arc.value;
    if (ok && currentImage >= 0) ok = (' ' + r.dataset.src + ' ').includes(' ' + currentImage + ' ');
    r.hidden = !ok; if (ok) n++;
  }
  count.textContent = n.toLocaleString() + ' shown';
}
const img = document.getElementById('img'), imgpanel = document.getElementById('imgpanel');
let currentImage = -1;

/**
 * Narrow the table to one image. Everything else stays as it is, so the
 * search and the archived filter still compose with it.
 */
function pickImage() {
  const v = img.value.trim().toLowerCase();
  currentImage = -1;
  if (v) {
    let i = SOURCES.findIndex((n) => n.toLowerCase() === v);
    if (i < 0) {
      const hits = SOURCES.map((n, k) => [n, k]).filter(([n]) => n.toLowerCase().includes(v));
      // Naming a disk matches its folder and every tape extracted from it, so
      // a single matching folder is what was meant — otherwise typing a disk
      // name would offer its own hundred tapes back as choices.
      const folders = hits.filter(([, k]) => SOURCE_KIND[k] === 'folder');
      if (folders.length === 1) i = folders[0][1];
      else if (hits.length === 1) i = hits[0][1];
      else if (hits.length > 1) {
        imgpanel.hidden = false;
        imgpanel.innerHTML = hits.length + ' sources match — pick one:<br>'
          + hits.slice().sort((a, b) => (SOURCE_KIND[a[1]] === SOURCE_KIND[b[1]] ? 0 : SOURCE_KIND[a[1]] === 'folder' ? -1 : 1))
            .slice(0, 40).map(([n, k]) => '<a href="#" data-pick="' + n.replace(/"/g, '&quot;') + '">' + n + '</a> <span class="note">' + SOURCE_KIND[k] + '</span>').join('<br>')
          + (hits.length > 40 ? '<br>…and ' + (hits.length - 40) + ' more' : '');
        apply();
        return;
      }
    }
    currentImage = i;
  }
  renderImagePanel();
  apply();
}

/** What is left to do on the chosen image. */
function renderImagePanel() {
  if (currentImage < 0) { imgpanel.hidden = true; imgpanel.innerHTML = ''; return; }
  const ids = SOURCE_MEMBERS[String(currentImage)] || [];
  const done = ids.filter((id) => {
    const s = STATUS_BY_ID[id] || '';
    return s.startsWith('archived') || s === 'skipped';
  }).length;
  imgpanel.hidden = false;
  imgpanel.innerHTML = '<b>' + SOURCES[currentImage] + '</b> <span class="note">(' + SOURCE_KIND[currentImage] + ')</span> — ' + ids.length + ' program'
    + (ids.length === 1 ? '' : 's') + ', ' + done + ' already archived or skipped, '
    + (ids.length - done) + ' to go.'
    + '<br><span class="note">Ticking a program marks it everywhere it appears, not just on this image —'
    + ' marks are keyed by the program\'s content.</span>';
}

imgpanel.addEventListener('click', (e) => {
  const pick = e.target.dataset && e.target.dataset.pick;
  if (!pick) return;
  e.preventDefault();
  img.value = pick;
  pickImage();
});
img.addEventListener('input', pickImage);
document.getElementById('imgclear').addEventListener('click', () => { img.value = ''; pickImage(); });

document.getElementById('markall').addEventListener('click', () => {
  const ids = rows.filter((r) => !r.hidden).map((r) => r.dataset.id);
  const hint = document.getElementById('hint');
  if (ids.length === 0) { hint.textContent = 'Nothing shown.'; return; }
  const cmd = 'npx tsx scripts/mark-archived.mts ' + CATALOG_DIR + ' --status archived ' + ids.join(' ');
  navigator.clipboard?.writeText(cmd);
  hint.textContent = 'Command for all ' + ids.length + ' shown row(s) copied: ' + cmd;
});

[q, kind, dupes, arc].forEach((el) => el.addEventListener('input', apply));

// A page opened from disk cannot write marks.json, so it hands you the ids
// and the command that records them.
document.getElementById('copy').addEventListener('click', () => {
  const ids = [...document.querySelectorAll('.pick:checked')].map((c) => c.dataset.id);
  const hint = document.getElementById('hint');
  if (ids.length === 0) { hint.textContent = 'Nothing ticked.'; return; }
  const cmd = 'npx tsx scripts/mark-archived.mts ' + CATALOG_DIR + ' --status archived ' + ids.join(' ');
  navigator.clipboard?.writeText(cmd);
  hint.textContent = ids.length + ' ticked — command copied to the clipboard: ' + cmd;
});
const asc = {};
document.querySelectorAll('th[data-k]').forEach((th, i) => th.addEventListener('click', () => {
  const k = th.dataset.k; asc[k] = !asc[k];
  const body = document.querySelector('#t tbody');
  [...body.children].sort((a, b) => {
    const av = a.children[i].textContent.trim(), bv = b.children[i].textContent.trim();
    const an = parseFloat(av), bn = parseFloat(bv);
    const c = (!isNaN(an) && !isNaN(bn)) ? an - bn : av.localeCompare(bv);
    return asc[k] ? c : -c;
  }).forEach((r) => body.appendChild(r));
}));
apply();
</script></body></html>`);

console.log(`catalog.csv      ${progs.length} rows (with found_in)`);
console.log(`occurrences.csv  ${cat.entryCount} rows`);
console.log(`folders.csv      ${folderMap.size} folders`);
console.log(`variants.csv     ${variants.length} names`);
console.log(`index.html       ${(fs.statSync(path.join(dir, 'index.html')).size / 1048576).toFixed(1)} MB`);
