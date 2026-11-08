// Lab Copilot server: hands the browser a short-lived ElevenLabs token, keeps the
// plate readings, runs the analysis in Daytona, and writes the results file.
import express from 'express';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { need } from './lib/env.js';
import { analyze } from './lib/analyze.js';
import { getSandbox, closeSandbox } from './lib/daytona.js';

const ELEVENLABS_API_KEY = need('ELEVENLABS_API_KEY');
need('DAYTONA_API_KEY');
const AGENT_ID = need('AGENT_ID');
const PORT = Number(process.env.PORT) || 3000;

const SEED = JSON.parse(readFileSync(new URL('./data/seed.json', import.meta.url), 'utf8'));
const RUN_FILE = new URL('./data/run.json', import.meta.url);
const RESULTS_DIR = new URL('./results/', import.meta.url);

const seedRun = () => ({ readings: SEED.readings.map((r) => ({ ...r })), files: [] });
let run = existsSync(RUN_FILE) ? JSON.parse(readFileSync(RUN_FILE, 'utf8')) : seedRun();
let lastAnalysis = null;
const save = () => writeFileSync(RUN_FILE, JSON.stringify(run, null, 2));

// "S3", "sample 3", 3 -> "3".  "0.50", ".5" -> "0.5"
function normalize(kind, label) {
  const k = /stand|std/i.test(String(kind)) ? 'standard' : 'sample';
  const raw = String(label ?? '').trim();
  if (k === 'standard') {
    const n = parseFloat(raw);
    return { kind: 'standard', label: Number.isFinite(n) ? String(n) : raw };
  }
  const digits = raw.match(/\d+/);
  return { kind: 'sample', label: digits ? String(Number(digits[0])) : raw };
}

async function runAnalysis(latest = null) {
  lastAnalysis = await analyze(run.readings, latest);
  console.log(`Daytona analysis: ${lastAnalysis.n_standards} standards, ${lastAnalysis.n_samples} samples, ` +
    `R2 ${lastAnalysis.fit?.r2 ?? '-'}, ${lastAnalysis.flags.length} flag(s), ${lastAnalysis.ms} ms`);
  return lastAnalysis;
}

const payload = (extra = {}) => ({ assay: SEED.assay, ...run, analysis: lastAnalysis, ...extra });

const app = express();
app.use(express.json());
app.use(express.static(new URL('./public', import.meta.url).pathname));
app.use('/results', express.static(RESULTS_DIR.pathname));

app.get('/vendor/elevenlabs.js', (req, res) => {
  res.sendFile(new URL('./node_modules/@elevenlabs/client/dist/lib.iife.js', import.meta.url).pathname);
});

app.get('/api/token', async (req, res) => {
  const r = await fetch(
    `https://api.elevenlabs.io/v1/convai/conversation/token?agent_id=${AGENT_ID}`,
    { headers: { 'xi-api-key': ELEVENLABS_API_KEY } },
  );
  if (!r.ok) return res.status(502).send(`ElevenLabs said ${r.status}: ${await r.text()}`);
  res.send((await r.json()).token);
});

app.get('/api/state', (req, res) => res.json(payload()));

app.post('/api/analyze', async (req, res) => {
  try {
    await runAnalysis();
    res.json(payload());
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: err.message });
  }
});

// Tool: log_reading. Logging the same well again replaces the old value (a correction).
app.post('/api/reading', async (req, res) => {
  const { kind, label } = normalize(req.body?.kind, req.body?.label);
  const absorbance = Number(req.body?.absorbance);
  if (!label || !Number.isFinite(absorbance)) {
    return res.json({ agent: 'Not saved: I need a sample or standard and an absorbance number. Ask again.', ...payload() });
  }
  const replaced = run.readings.some((r) => r.kind === kind && r.label === label);
  run.readings = run.readings.filter((r) => !(r.kind === kind && r.label === label)).concat({ kind, label, absorbance });
  save();
  console.log(`${replaced ? 'Replaced' : 'Logged'} ${kind} ${label}: ${absorbance}`);

  const name = kind === 'standard' ? `standard ${label} milligrams per mL` : `sample ${label}`;
  try {
    const a = await runAnalysis({ kind, label });
    let text = `${replaced ? 'Updated' : 'Logged'} ${name} at ${absorbance}.`;
    if (a.latest?.conc != null) text += ` That works out to ${a.latest.conc.toFixed(2)} mg/mL.`;
    if (a.latest?.flag) text += ` Warning: this sample is ${a.latest.flag}. Say this clearly.`;
    else if (kind === 'standard' && a.fit && a.n_standards >= 3) text += ` Standard curve R squared is now ${a.fit.r2.toFixed(3)}.`;
    const otherFlags = a.flags.filter((f) => !f.startsWith(`Sample ${label} `));
    if (otherFlags.length) text += ` Other open issues: ${otherFlags.join(' ')}`;
    res.json({ agent: text, ...payload() });
  } catch (err) {
    console.error(err.message);
    res.json({ agent: `Logged ${name} at ${absorbance}, but the analysis is unavailable right now.`, ...payload() });
  }
});

// Tool: delete_reading. Used for "undo that" and for moving a value to the right well.
app.post('/api/delete', async (req, res) => {
  const { kind, label } = normalize(req.body?.kind, req.body?.label);
  const before = run.readings.length;
  run.readings = run.readings.filter((r) => !(r.kind === kind && r.label === label));
  if (run.readings.length === before) {
    return res.json({ agent: `There was no ${kind} ${label} to delete.`, ...payload() });
  }
  save();
  console.log(`Deleted ${kind} ${label}`);
  try { await runAnalysis(); } catch (err) { console.error(err.message); }
  res.json({ agent: `Deleted ${kind} ${label}.`, ...payload() });
});

// Tool: finish_run. Writes the results CSV and the curve PNG.
app.post('/api/finish', async (req, res) => {
  try {
    const a = await runAnalysis();
    mkdirSync(RESULTS_DIR, { recursive: true });
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '').replace(/^(\d{8})/, '$1-');
    const base = `bradford-${stamp}`;
    const rows = [['kind', 'label', 'absorbance_595', 'protein_mg_per_ml', 'flag']];
    for (const r of run.readings.filter((x) => x.kind === 'standard')) rows.push(['standard', r.label, r.absorbance, r.label, '']);
    for (const s of a.samples) rows.push(['sample', s.label, s.absorbance, s.conc ?? '', s.flag ?? '']);
    const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n') + '\n';
    writeFileSync(new URL(`${base}.csv`, RESULTS_DIR), csv);
    writeFileSync(new URL(`${base}.png`, RESULTS_DIR), Buffer.from(a.chart.split(',')[1], 'base64'));
    run.files = [`${base}.csv`, `${base}.png`];
    save();
    console.log('Results written:', run.files.join(', '));

    const good = a.samples.filter((s) => !s.flag && s.conc != null);
    const mean = good.length ? good.reduce((t, s) => t + s.conc, 0) / good.length : null;
    res.json({
      agent: `Run saved as ${base}.csv with the curve chart. ${a.n_samples} samples, ` +
        (mean != null ? `average ${mean.toFixed(2)} mg/mL across the ${good.length} good samples, ` : '') +
        `${a.flags.length} issue(s) flagged${a.flags.length ? ': ' + a.flags.join(' ') : ''}. ` +
        `R squared ${a.fit?.r2?.toFixed(3) ?? 'not available'}.`,
      ...payload(),
    });
  } catch (err) {
    console.error(err.message);
    res.json({ agent: `Could not save the run: ${err.message}`, ...payload() });
  }
});

// Demo helper: back to the six standards, no samples.
app.post('/api/reset', async (req, res) => {
  run = seedRun();
  save();
  try {
    await runAnalysis();
    res.json(payload());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const server = app.listen(PORT, '127.0.0.1', () => {
  console.log(`Open http://localhost:${PORT}`);
  // Warm the sandbox and draw the first curve while the page loads.
  getSandbox().then(() => runAnalysis()).catch((err) => console.error('Warm-up failed:', err.message));
});

let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  console.log('\nShutting down, deleting sandbox…');
  server.close();
  await closeSandbox();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
