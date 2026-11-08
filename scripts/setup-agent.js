// Creates (or updates) the Lab Copilot agent and its client tools on ElevenLabs,
// then saves the IDs into .env. Run again after changing the prompt: npm run setup
import { readFileSync, writeFileSync } from 'node:fs';
import { need } from '../lib/env.js';

const API = 'https://api.elevenlabs.io/v1/convai';
const key = need('ELEVENLABS_API_KEY');
const { assay } = JSON.parse(readFileSync(new URL('../data/seed.json', import.meta.url), 'utf8'));

const AGENT_NAME = 'Lab Copilot - hands-free plate reader logging';
const FIRST_MESSAGE = "Hi, I'm your lab copilot. Your six standards are already in. Read me your samples whenever you're ready.";

const SYSTEM_PROMPT = `You are Lab Copilot, a hands-free voice assistant for ${assay.user}.
They are running a ${assay.name}: ${assay.reader}, with standards of ${assay.standards}. Their hands are gloved, so they only talk.

Your job: log every reading they say, exactly, and catch problems early.
- When they say a reading like "sample 3, 0.44" or "standard 0.5 is 0.27", call log_reading right away. Do not ask for confirmation first.
- After log_reading returns, read back the result in ONE short sentence, e.g. "Sample 3, 0.44, that's 0.82 milligrams per mL." Always say any warning it gives.
- If they correct you ("no, that was sample 5", "wait, it's 0.48"), fix it: call delete_reading for the wrong entry if the sample number changed, then log_reading with the right values.
- If they say "undo that" or "scratch that", call delete_reading for the last thing you logged.
- When they say they're done, finished, or "wrap it up", call finish_run and summarize in two sentences.
- If a value sounds unusual or you misheard, ask them to repeat it once.

Keep every reply under two short sentences. Speak numbers plainly: "zero point four four".
If they ask a lab question you can answer briefly, answer in one sentence. If they go off-topic, answer in one friendly sentence and steer back to the run.
Never invent readings or concentrations: the numbers only come from the tools. Never mention tools, code or sandboxes.`;

const TOOLS = {
  TOOL_LOG_ID: {
    type: 'client',
    name: 'log_reading',
    description: 'Saves one plate reader value and re-runs the analysis (standard curve, concentrations, outlier checks).',
    expects_response: true,
    response_timeout_secs: 60,
    parameters: {
      type: 'object',
      properties: {
        kind: { type: 'string', description: 'Either "sample" or "standard".' },
        label: { type: 'string', description: 'Sample number like "3", or the standard concentration in mg/mL like "0.5".' },
        absorbance: { type: 'number', description: 'Absorbance at 595 nm, e.g. 0.44.' },
      },
      required: ['kind', 'label', 'absorbance'],
    },
  },
  TOOL_DELETE_ID: {
    type: 'client',
    name: 'delete_reading',
    description: 'Deletes one logged reading (for undo, or when the user says it was a different sample).',
    expects_response: true,
    response_timeout_secs: 60,
    parameters: {
      type: 'object',
      properties: {
        kind: { type: 'string', description: 'Either "sample" or "standard".' },
        label: { type: 'string', description: 'Sample number, or standard concentration in mg/mL.' },
      },
      required: ['kind', 'label'],
    },
  },
  TOOL_FINISH_ID: {
    type: 'client',
    name: 'finish_run',
    description: 'Finishes the run: saves the results CSV and the standard curve chart, and returns a summary.',
    expects_response: true,
    response_timeout_secs: 60,
    parameters: {
      type: 'object',
      properties: {
        note: { type: 'string', description: 'Optional note about the run.' },
      },
      required: [],
    },
  },
};

async function call(method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}\n${text}`);
  return JSON.parse(text);
}

function saveToEnv(name, value) {
  const path = new URL('../.env', import.meta.url);
  let env = readFileSync(path, 'utf8');
  const line = `${name}=${value}`;
  const re = new RegExp(`^${name}=.*$`, 'm');
  env = re.test(env) ? env.replace(re, line) : env.trimEnd() + '\n' + line + '\n';
  writeFileSync(path, env);
}

const toolIds = [];
for (const [envName, tool] of Object.entries(TOOLS)) {
  let id = process.env[envName];
  if (id) {
    await call('PATCH', `/tools/${id}`, { tool_config: tool });
    console.log('Updated tool', tool.name);
  } else {
    id = (await call('POST', '/tools', { tool_config: tool })).id;
    saveToEnv(envName, id);
    console.log('Created tool', tool.name);
  }
  toolIds.push(id);
}

const agent = {
  name: AGENT_NAME,
  conversation_config: {
    agent: {
      first_message: FIRST_MESSAGE,
      language: 'en',
      prompt: { prompt: SYSTEM_PROMPT, tool_ids: toolIds },
    },
    ...(process.env.VOICE_ID && { tts: { voice_id: process.env.VOICE_ID } }),
    // The default event list leaves out client_tool_call, so the page would never run tools.
    conversation: {
      client_events: [
        'audio', 'interruption', 'agent_response', 'user_transcript',
        'agent_response_correction', 'agent_tool_response', 'client_tool_call',
      ],
    },
  },
  // Private agent: only our server (with the API key) can start a conversation.
  platform_settings: { auth: { enable_auth: true } },
};

let agentId = process.env.AGENT_ID;
if (agentId) {
  await call('PATCH', `/agents/${agentId}`, agent);
  console.log('Updated agent', agentId);
} else {
  agentId = (await call('POST', '/agents/create', agent)).agent_id;
  saveToEnv('AGENT_ID', agentId);
  console.log('Created agent', agentId);
}
console.log(`Dashboard: https://elevenlabs.io/app/agents/agents/${agentId}`);
