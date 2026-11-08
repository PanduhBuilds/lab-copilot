// Lab Copilot server: hands the browser a short-lived ElevenLabs token, keeps the
// plate readings, runs the analysis in Daytona, and writes the results file.
import express from 'express';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
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

// Protocols: one JSON file per experiment in data/protocols/. Adding a lab = adding a file.
const PROTOCOLS = Object.fromEntries(
  readdirSync(new URL('./data/protocols/', import.meta.url))
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const p = JSON.parse(readFileSync(new URL(`./data/protocols/${f}`, import.meta.url), 'utf8'));
      return [p.id, p];
    }),
);
const DEFAULT_PROTOCOL = 'bradford';

const seedRun = () => ({
  readings: SEED.readings.map((r) => ({ ...r })),
  files: [],
  guide: { protocol: DEFAULT_PROTOCOL, step: null }, // step: null = not started, else 0-based index
});
let run = existsSync(RUN_FILE) ? JSON.parse(readFileSync(RUN_FILE, 'utf8')) : seedRun();
run.guide ??= { protocol: DEFAULT_PROTOCOL, step: null };
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

function guideView() {
  const p = PROTOCOLS[run.guide.protocol];
  return { name: p.name, step: run.guide.step, titles: p.steps.map((s) => s.title) };
}

const payload = (extra = {}) => ({ assay: SEED.assay, ...run, guide: guideView(), analysis: lastAnalysis, ...extra });

// What the agent hears about one step. Everything comes from the protocol file, nothing invented.
function describeStep(p, i, { withSafety = false } = {}) {
  const s = p.steps[i];
  const terms = Object.entries(s.terms ?? {}).map(([t, d]) => `${t}: ${d}`).join(' ');
  return [
    withSafety ? `Safety first: ${p.safety.join(' ')}` : '',
    `Step ${i + 1} of ${p.steps.length}: ${s.title}.`,
    `Instruction: ${s.instruction}`,
    `Why (only if they ask, or explain simply if they seem unsure): ${s.why}`,
    terms ? `Terms: ${terms}` : '',
    `Checkpoint before moving on: ${s.checkpoint}`,
    s.data_collection
      ? 'This is the data step. From now on, log every reading they say with log_reading.'
      : 'Explain the instruction simply in one or two sentences, then wait for them to say they are done.',
  ].filter(Boolean).join('\n');
}

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

// Tool: protocol_step. Guided Lab Mentor Mode. The server, not the AI, decides whether
// the student may move on: "next" only works once they confirmed the checkpoint.
app.post('/api/step', (req, res) => {
  const action = String(req.body?.action ?? 'current').toLowerCase();
  const confirmed = req.body?.confirmed === true || req.body?.confirmed === 'true';
  const p = PROTOCOLS[run.guide.protocol];
  const last = p.steps.length - 1;
  let step = run.guide.step;
  let text;

  if (action === 'start' || step === null) {
    step = 0;
    text = `Starting the ${p.name}. ${p.summary}\n${describeStep(p, 0, { withSafety: true })}`;
  } else if (action === 'next') {
    if (!confirmed) {
      text = `Not moving on yet. First ask them to confirm: "${p.steps[step].checkpoint}" Call protocol_step with action "next" and confirmed true only after they say yes.`;
    } else if (step >= last) {
      text = `They have finished all ${p.steps.length} steps. If they have not read the plate yet, remind them to read each value to you.`;
    } else {
      step += 1;
      text = describeStep(p, step);
    }
  } else if (action === 'back') {
    step = Math.max(0, step - 1);
    text = `Going back.\n${describeStep(p, step)}`;
  } else {
    // repeat / current / explain
    text = describeStep(p, step);
  }

  run.guide.step = step;
  save();
  console.log(`Protocol step: ${action}${confirmed ? ' (confirmed)' : ''} -> ${step + 1}/${p.steps.length}`);
  res.json({ agent: text, ...payload() });
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
