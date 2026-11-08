// Creates (or updates) the Lab Copilot agent and its client tools on ElevenLabs,
// then saves the IDs into .env. Run again after changing the prompt: npm run setup
import { readFileSync, writeFileSync } from 'node:fs';
import { need } from '../lib/env.js';

const API = 'https://api.elevenlabs.io/v1/convai';
const key = need('ELEVENLABS_API_KEY');
const { lab, parts, tolerance } = JSON.parse(readFileSync(new URL('../data/seed.json', import.meta.url), 'utf8'));
const protocol = JSON.parse(readFileSync(new URL('../data/protocols/ohms-law.json', import.meta.url), 'utf8'));
const protocolText = protocol.steps
  .map((s, i) => `${i + 1}. ${s.title}: ${s.instruction} (Why: ${s.why})`)
  .join('\n');
const partsText = parts.map((p) => `resistor ${p.label}: ${p.nominal} ohms (${p.bands})`).join('; ');

const AGENT_NAME = 'Lab Copilot - hands-free circuits lab mentor';
const FIRST_MESSAGE = "Hey, I'm your lab copilot. Want me to walk you through the Ohm's law lab step by step, or are you ready to start measuring?";

const SYSTEM_PROMPT = `You are Lab Copilot, a patient, encouraging, hands-free lab partner for ${lab.user}. Their hands are busy holding probes, so they can only talk. They may be doing this for the first time: never assume experience.
They are doing the ${lab.name} with a ${lab.setup}. The four resistors are ${partsText}. Tolerance is plus or minus ${tolerance * 100} percent.

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

DATA MODE (measuring). Your job: log every reading they say, exactly, and catch wiring mistakes early.
- When they say a reading like "resistor 2, 4.97 volts, 10.6 milliamps", call log_reading right away. Do not ask for confirmation first. If they give only volts or only milliamps, ask for the missing one.
- After log_reading returns, say the result in ONE short sentence, e.g. "Resistor 2 is 469 ohms, right on." If it reports a PROBLEM, say it clearly and simply and tell them exactly what to check (color bands, a loose jumper, the wrong row), then wait while they fix it.
- If they correct you ("no, that was resistor 4", "wait, it's 2.25 milliamps"), fix it: call delete_reading for the wrong resistor if the number changed, then log_reading with the right values. Re-measuring the same resistor just replaces it.
- If they say "undo that" or "scratch that", call delete_reading for the last resistor you logged.
- When they say they're done, finished, or "wrap it up", call finish_run and summarize in two sentences.
- If a value sounds unusual or you misheard, ask them to repeat it once.

Keep every reply under two short sentences. Say numbers plainly: "four point nine eight volts", "4.7k" as "four point seven K".
If they ask a quick circuits question, answer in one sentence. If they go off-topic, answer in one friendly sentence and steer back to the lab.
Never invent readings or resistances: the numbers only come from the tools. Never mention tools, code or sandboxes.`;

const TOOLS = {
  TOOL_LOG_ID: {
    type: 'client',
    name: 'log_reading',
    description: "Saves one resistor's voltage and current and re-runs the Ohm's law analysis (resistance, tolerance, open or short circuit, power).",
    expects_response: true,
    response_timeout_secs: 60,
    parameters: {
      type: 'object',
      properties: {
        resistor: { type: 'string', description: 'Resistor number, 1 to 4, e.g. "3".' },
        volts: { type: 'number', description: 'Voltage across the resistor in volts, e.g. 4.98.' },
        milliamps: { type: 'number', description: 'Current through the resistor in milliamps, e.g. 22.4. Use 0 if they say zero or no current.' },
      },
      required: ['resistor', 'volts', 'milliamps'],
    },
  },
  TOOL_DELETE_ID: {
    type: 'client',
    name: 'delete_reading',
    description: 'Deletes the reading for one resistor (for undo, or when the user says it was a different resistor).',
    expects_response: true,
    response_timeout_secs: 60,
    parameters: {
      type: 'object',
      properties: {
        resistor: { type: 'string', description: 'Resistor number, 1 to 4.' },
      },
      required: ['resistor'],
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
    description: 'Finishes the run: saves the lab results CSV and the voltage-current chart, and returns a summary.',
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
