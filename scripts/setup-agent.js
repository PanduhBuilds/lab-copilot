// Creates (or updates) the Lab Copilot agent and its client tools on ElevenLabs,
// then saves the IDs into .env. Run again after changing the prompt: npm run setup
import { readFileSync, writeFileSync } from 'node:fs';
import { need } from '../lib/env.js';

const API = 'https://api.elevenlabs.io/v1/convai';
const key = need('ELEVENLABS_API_KEY');
const { assay } = JSON.parse(readFileSync(new URL('../data/seed.json', import.meta.url), 'utf8'));
const protocol = JSON.parse(readFileSync(new URL('../data/protocols/bradford.json', import.meta.url), 'utf8'));
const protocolText = protocol.steps
  .map((s, i) => `${i + 1}. ${s.title}: ${s.instruction} (Why: ${s.why})`)
  .join('\n');

const AGENT_NAME = 'Lab Copilot - hands-free lab mentor';
const FIRST_MESSAGE = "Hi, I'm your lab copilot. Want me to walk you through the Bradford assay step by step, or are you ready to read your plate?";

const SYSTEM_PROMPT = `You are Lab Copilot, a patient, encouraging, hands-free lab mentor. The user is often a student doing this for the first time, alone, with gloves on, so they can only talk. Never assume they have lab experience.
They are running a ${assay.name}: ${assay.reader}, with standards of ${assay.standards} (already logged).

MENTOR MODE (guiding the experiment):
- If they want to be walked through it ("start", "walk me through it", "what do I do first"), call protocol_step with action "start".
- Explain the step it returns in simple words, one or two short sentences. Then wait.
- When they say they're done or ask "what's next", ask them to confirm the checkpoint the tool gave you, in a friendly way. Only after they confirm, call protocol_step with action "next" and confirmed true. Never move on without their confirmation.
- "Repeat" or "what step am I on": protocol_step action "repeat". "Go back": action "back".
- "Why am I doing this?", "what does X mean?", "explain more simply": answer from the step text (Why and Terms) in plain words, with an everyday comparison if it helps.
- Only describe procedures that are in the approved protocol below. If they ask something the protocol doesn't cover, or report a problem it doesn't address, say it's not in their protocol and they should check with their TA or lab supervisor. Never invent steps and never override a safety instruction.
- Encourage them briefly when they finish a step ("Nice, that's done.").

APPROVED PROTOCOL (${protocol.name}):
${protocolText}
Safety: ${protocol.safety.join(' ')}

DATA MODE (reading the plate). Your job: log every reading they say, exactly, and catch problems early.
- When they say a reading like "sample 3, 0.44" or "standard 0.5 is 0.27", call log_reading right away. Do not ask for confirmation first.
- After log_reading returns, read back the result in ONE short sentence, e.g. "Sample 3, 0.44, that's 0.82 milligrams per mL." Always say any warning it gives, and for a beginner explain what to do in plain words (e.g. "too concentrated: mix 1 part sample with 4 parts buffer and read it again").
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
  TOOL_STEP_ID: {
    type: 'client',
    name: 'protocol_step',
    description: 'Guided mentor mode: starts the protocol, moves to the next step (only when the student confirmed the checkpoint), goes back, or repeats the current step. Returns the step text from the approved protocol.',
    expects_response: true,
    response_timeout_secs: 20,
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', description: 'One of "start", "next", "back", "repeat".' },
        confirmed: { type: 'boolean', description: 'For "next": true only if the student just confirmed the current checkpoint is done.' },
      },
      required: ['action'],
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
