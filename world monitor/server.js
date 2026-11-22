import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)));
const port = Number(process.env.PORT || 4173);
const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

let conflictCache;
let conflictCacheAt = 0;
let theaterCache;
let theaterCacheAt = 0;
let candidateRelease = { version: '26.0.9', url: 'https://ucdp.uu.se/downloads/candidateged/GEDEvent_v26_0_9.csv' };

async function latestCandidateRelease() {
  try {
    const response = await fetch('https://ucdp.uu.se/downloads/', { headers: { 'User-Agent': 'WorldMonitor/1.0', Accept: 'text/html' }, signal: AbortSignal.timeout(15000) });
    if (!response.ok) return candidateRelease;
    const html = await response.text();
    const releases = [...html.matchAll(/href=["']([^"']*candidateged\/GEDEvent_v(\d+(?:_\d+){2})\.csv)["']/gi)]
      .map(match => ({ url: new URL(match[1], 'https://ucdp.uu.se').href, version: match[2].replaceAll('_', '.') }));
    releases.sort((a, b) => {
      const av = a.version.split('.').map(Number), bv = b.version.split('.').map(Number);
      for (let i = 0; i < Math.max(av.length, bv.length); i++) if ((av[i] || 0) !== (bv[i] || 0)) return (av[i] || 0) - (bv[i] || 0);
      return 0;
    });
    if (releases.length) candidateRelease = releases.at(-1);
  } catch {}
  return candidateRelease;
}

function parseCsvLine(line) {
  const values = [];
  let value = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"' && quoted && line[i + 1] === '"') { value += '"'; i++; }
    else if (char === '"') quoted = !quoted;
    else if (char === ',' && !quoted) { values.push(value); value = ''; }
    else value += char;
  }
  values.push(value);
  return values;
}

function normalizeDatasetDate(value) {
  const text = String(value || '').trim();
  if (/^\d{8}$/.test(text)) return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
  const timestamp = Date.parse(text);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString().slice(0, 10) : '';
}

function parseConflictCsv(csv) {
  const rows = csv.replace(/^\uFEFF/, '').split(/\r?\n/);
  const headers = parseCsvLine(rows.shift() || '').map(x => x.trim().toLowerCase());
  const at = (...names) => names.map(n => headers.indexOf(n)).find(i => i >= 0) ?? -1;
  const col = {
    id: at('id'), date: at('date_end', 'date_start'), start: at('date_start'),
    conflict: at('conflict_name'), dyad: at('dyad_name'), country: at('country'),
    place: at('where_coordinates'), adm1: at('adm_1'), lat: at('latitude'), lon: at('longitude'),
    sideA: at('side_a'), sideB: at('side_b'), deaths: at('best'), low: at('low'), high: at('high'),
    type: at('type_of_violence'), status: at('code_status'), sources: at('source_article'), headline: at('source_headline'), precision: at('where_prec')
  };
  const decoded = [];
  let latest = '';
  for (const line of rows) {
    if (!line) continue;
    const row = parseCsvLine(line);
    const value = i => i < 0 ? '' : (row[i] || '').trim();
    const date = normalizeDatasetDate(value(col.date));
    const startDate = normalizeDatasetDate(value(col.start));
    const lat = Number(value(col.lat));
    const lon = Number(value(col.lon));
    if (date && date > latest) latest = date;
    if (!date || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    decoded.push({
      id: value(col.id), date, startDate, conflict: value(col.conflict), dyad: value(col.dyad),
      country: value(col.country), place: value(col.place), region: value(col.adm1), lat, lon,
      sideA: value(col.sideA), sideB: value(col.sideB), deaths: Number(value(col.deaths)) || 0,
      low: Number(value(col.low)) || 0, high: Number(value(col.high)) || 0,
      type: Number(value(col.type)) || 0, status: value(col.status), sources: value(col.sources), headline: value(col.headline), precision: Number(value(col.precision)) || 0
    });
  }
  decoded.sort((a, b) => b.date.localeCompare(a.date));
  if (!latest) throw new Error('UCDP dataset contains no parseable event dates');
  const edge = new Date(`${latest}T00:00:00Z`);
  edge.setUTCDate(edge.getUTCDate() - 180);
  const cutoff = edge.toISOString().slice(0, 10);
  return { source: 'UCDP Candidate Events Dataset', version: '26.0.9', asOf: latest, cutoff, events: decoded.filter(e => e.date >= cutoff).slice(0, 5000) };
}

async function fetchSourceText(url, accept = 'text/html') {
  const response = await fetch(url, { headers: { 'User-Agent': 'WorldMonitor/1.0 (conflict catalog; source attribution retained)', Accept: accept }, signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error(`Armed Conflicts source returned ${response.status}`);
  return response.text();
}

function linksFrom(html) {
  return [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].map(match => {
    const href = match[1].match(/\bhref=["']([^"']+)["']/i)?.[1];
    const label = match[2].replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ').replace(/\s+/g, ' ').trim();
    return href ? { href, label } : null;
  }).filter(Boolean);
}

async function fetchTheaterRecord(pageUrl) {
  const html = await fetchSourceText(pageUrl);
  const exportLink = linksFrom(html).find(link => link.label.toUpperCase() === 'JSON' && /\.json(?:\?|$)/i.test(link.href));
  if (!exportLink) throw new Error(`No JSON export link on ${pageUrl}`);
  const jsonUrl = new URL(exportLink.href, pageUrl).href;
  const response = await fetch(jsonUrl, { headers: { 'User-Agent': 'WorldMonitor/1.0 (source attribution retained)', Accept: 'application/json' }, signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error(`Conflict record returned ${response.status}`);
  const record = await response.json();
  if (!record.id || !record.title || !record.intensity) throw new Error(`Incomplete conflict record from ${jsonUrl}`);
  return { ...record, source_url: jsonUrl, map_url: pageUrl };
}

async function loadTheaterCatalog() {
  const indexUrl = 'https://armedconflicts.org/maps/';
  const index = await fetchSourceText(indexUrl);
  const pages = [...new Set(linksFrom(index)
    .map(link => new URL(link.href, indexUrl).href)
    .filter(url => new URL(url).pathname.startsWith('/maps/') && /-conflict-map\.html$/i.test(new URL(url).pathname)))];
  if (pages.length < 20) throw new Error(`Only found ${pages.length} conflict map pages`);

  const records = [];
  const failures = [];
  for (let i = 0; i < pages.length; i += 6) {
    const results = await Promise.allSettled(pages.slice(i, i + 6).map(fetchTheaterRecord));
    results.forEach((result, offset) => result.status === 'fulfilled' ? records.push(result.value) : failures.push({ page: pages[i + offset], error: String(result.reason?.message || result.reason) }));
  }
  if (!records.length) throw new Error('No conflict records could be loaded');
  records.sort((a, b) => String(a.region || '').localeCompare(String(b.region || '')) || String(a.title).localeCompare(String(b.title)));
  return { source: 'Global Armed Conflicts Map', sourceUrl: indexUrl, updatedAt: new Date().toISOString(), total: pages.length, loaded: records.length, failures: failures.length, conflicts: records };
}

createServer(async (request, response) => {
  let pathname = '';
  try {
    pathname = decodeURIComponent(new URL(request.url, `http://${request.headers.host || 'localhost'}`).pathname);
    if (pathname === '/api/conflicts') {
      if (!conflictCache || Date.now() - conflictCacheAt > 6 * 60 * 60 * 1000) {
        const release = await latestCandidateRelease();
        const upstream = await fetch(release.url, { headers: { 'User-Agent': 'WorldMonitor/1.0', Accept: 'text/csv,text/plain;q=0.9,*/*;q=0.5' }, signal: AbortSignal.timeout(30000) });
        if (!upstream.ok) throw new Error(`UCDP returned ${upstream.status}`);
        const csv = await upstream.text();
        if (csv.trimStart().startsWith('<!DOCTYPE') || csv.trimStart().startsWith('<html')) throw new Error('UCDP returned a web page instead of the CSV dataset');
        const parsed = parseConflictCsv(csv);
        if (!parsed.events.length) throw new Error('UCDP returned no geocoded events');
        parsed.version = release.version;
        conflictCache = parsed;
        conflictCacheAt = Date.now();
      }
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=900' });
      response.end(JSON.stringify(conflictCache));
      return;
    }
    if (pathname === '/api/theaters') {
      if (!theaterCache || Date.now() - theaterCacheAt > 6 * 60 * 60 * 1000) {
        theaterCache = await loadTheaterCatalog();
        theaterCacheAt = Date.now();
      }
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=900' });
      response.end(JSON.stringify(theaterCache));
      return;
    }
    const requested = pathname === '/' ? '/index.html' : pathname;
    const file = resolve(root, `.${requested}`);
    if (file !== root && !file.startsWith(root + sep)) {
      response.writeHead(403).end('Forbidden');
      return;
    }
    const body = await readFile(file);
    response.writeHead(200, { 'Content-Type': contentTypes[extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    response.end(body);
  } catch (error) {
    if (pathname === '/api/conflicts') {
      response.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify({ error: 'UCDP Candidate event data is unavailable', detail: String(error?.message || error) }));
      return;
    }
    if (pathname === '/api/theaters') {
      response.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify({ error: 'The Armed Conflicts catalog is unavailable', detail: String(error?.message || error) }));
      return;
    }
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`WorldMonitor is running at http://127.0.0.1:${port}`);
  console.log('Press Ctrl+C to stop the server.');
});
