// Lab Copilot server: hands the browser a short-lived ElevenLabs token, keeps the
// circuit measurements, runs the Ohm's law analysis in Daytona, tracks the guided
// protocol step, and writes the lab results file.
import express from 'express';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { need } from './lib/env.js';
import { analyze } from './lib/analyze.js';
import { getSandbox, closeSandbox } from './lib/daytona.js';

const ELEVENLABS_API_KEY = need('ELEVENLABS_API_KEY');
need('DAYTONA_API_KEY');
const AGENT_ID = need('AGENT_ID');
const PORT = Number(process.env.PORT) || 3000;

const LAB = JSON.parse(readFileSync(new URL('./data/seed.json', import.meta.url), 'utf8'));
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
const DEFAULT_PROTOCOL = 'ohms-law';

const freshRun = () => ({
  readings: [], // { label, volts, milliamps }
  files: [],
  guide: { protocol: DEFAULT_PROTOCOL, step: null }, // step: null = not started, else 0-based index
});
let run = existsSync(RUN_FILE) ? JSON.parse(readFileSync(RUN_FILE, 'utf8')) : freshRun();
if (!PROTOCOLS[run.guide?.protocol] || run.readings.some((r) => r.volts === undefined)) run = freshRun();
let lastAnalysis = null;
const save = () => writeFileSync(RUN_FILE, JSON.stringify(run, null, 2));

// "R3", "resistor 3", 3 -> "3"
const resistorLabel = (x) => {
  const digits = String(x ?? '').match(/\d+/);
  return digits ? String(Number(digits[0])) : '';
};
const partFor = (label) => LAB.parts.find((p) => p.label === label);
const ohms = (r) => (r >= 1000 ? `${+(r / 1000).toPrecision(3)}k ohms` : `${+r.toPrecision(3)} ohms`);

async function runAnalysis(latest = null) {
  lastAnalysis = await analyze(LAB, run.readings, latest);
  console.log(`Daytona analysis: ${lastAnalysis.n_measured}/${lastAnalysis.n_parts} measured, ` +
    `${lastAnalysis.flags.length} issue(s), ${lastAnalysis.ms} ms`);
  return lastAnalysis;
}

function guideView() {
  const p = PROTOCOLS[run.guide.protocol];
  return { name: p.name, step: run.guide.step, titles: p.steps.map((s) => s.title) };
}

const payload = (extra = {}) => ({ lab: LAB.lab, ...run, guide: guideView(), analysis: lastAnalysis, ...extra });

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

// Tool: log_reading. Logging the same resistor again replaces the old values (a correction or re-measure).
app.post('/api/reading', async (req, res) => {
  const label = resistorLabel(req.body?.resistor);
  const volts = Number(req.body?.volts);
  const milliamps = Number(req.body?.milliamps);
  if (!label || !Number.isFinite(volts) || !Number.isFinite(milliamps)) {
    return res.json({ agent: 'Not saved: I need the resistor number, the volts and the milliamps. Ask again.', ...payload() });
  }
  const replaced = run.readings.some((r) => r.label === label);
  run.readings = run.readings.filter((r) => r.label !== label).concat({ label, volts, milliamps });
  save();
  console.log(`${replaced ? 'Replaced' : 'Logged'} resistor ${label}: ${volts} V, ${milliamps} mA`);

  const part = partFor(label);
  try {
    const a = await runAnalysis(label);
    const x = a.latest;
    let text = `${replaced ? 'Updated' : 'Logged'} resistor ${label}: ${volts} volts, ${milliamps} milliamps.`;
    if (x?.measured != null) {
      text += ` That's ${ohms(x.measured)}` + (part ? `, expected ${ohms(part.nominal)} (${x.error_pct >= 0 ? '+' : ''}${x.error_pct}%).` : '.');
    }
    if (x?.flag) text += ` PROBLEM (${x.flag}): ${x.advice} Say this clearly and simply, then ask them to fix it and re-measure.`;
    else if (x?.measured != null) text += ' Within tolerance.';
    const left = LAB.parts.filter((p) => !run.readings.some((r) => r.label === p.label)).map((p) => p.label);
    text += left.length ? ` Still to measure: resistor ${left.join(', ')}.` : ' All resistors are measured. Offer to wrap up the lab.';
    res.json({ agent: text, ...payload() });
  } catch (err) {
    console.error(err.message);
    res.json({ agent: `Logged resistor ${label}, but the analysis is unavailable right now.`, ...payload() });
  }
});

// Tool: delete_reading. Used for "undo that" and when the student says it was a different resistor.
app.post('/api/delete', async (req, res) => {
  const label = resistorLabel(req.body?.resistor);
  const before = run.readings.length;
  run.readings = run.readings.filter((r) => r.label !== label);
  if (run.readings.length === before) {
    return res.json({ agent: `There was no reading for resistor ${label} to delete.`, ...payload() });
  }
  save();
  console.log(`Deleted resistor ${label}`);
  try { await runAnalysis(); } catch (err) { console.error(err.message); }
  res.json({ agent: `Deleted the reading for resistor ${label}.`, ...payload() });
});

// Tool: finish_run. Writes the lab results CSV and the V-I chart.
app.post('/api/finish', async (req, res) => {
  try {
    const a = await runAnalysis();
    mkdirSync(RESULTS_DIR, { recursive: true });
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '').replace(/^(\d{8})/, '$1-');
    const base = `ohms-law-${stamp}`;
    const rows = [['resistor', 'color_bands', 'expected_ohms', 'volts', 'milliamps', 'measured_ohms', 'error_pct', 'power_w', 'status']];
    for (const x of a.parts) {
      rows.push([x.label, x.bands ?? '', x.nominal ?? '', x.volts ?? '', x.milliamps ?? '', x.measured ?? '',
        x.error_pct ?? '', x.power_w ?? '', x.volts == null ? 'not measured' : (x.flag ?? 'ok')]);
    }
    const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n') + '\n';
    writeFileSync(new URL(`${base}.csv`, RESULTS_DIR), csv);
    writeFileSync(new URL(`${base}.png`, RESULTS_DIR), Buffer.from(a.chart.split(',')[1], 'base64'));
    run.files = [`${base}.csv`, `${base}.png`];
    save();
    console.log('Results written:', run.files.join(', '));

    res.json({
      agent: `Lab saved as ${base}.csv with the voltage-current chart. ${a.n_measured} of ${a.n_parts} resistors measured, ` +
        `${a.n_ok} within tolerance` + (a.avg_error_pct != null ? ` (average error ${a.avg_error_pct}%)` : '') + `. ` +
        (a.flags.length ? `Still open: ${a.flags.join(' ')}` : 'No open issues.'),
      ...payload(),
    });
  } catch (err) {
    console.error(err.message);
    res.json({ agent: `Could not save the lab: ${err.message}`, ...payload() });
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
      text = `They have finished all ${p.steps.length} steps. If they haven't read all four resistors yet, remind them to read each one to you.`;
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

// Demo helper: clear all measurements and the guided step.
app.post('/api/reset', async (req, res) => {
  run = freshRun();
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
  // Warm the sandbox and draw the first chart while the page loads.
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
