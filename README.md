# Lab Copilot

> **One line:** Lab Copilot is a voice agent that helps engineering students get through circuits lab by walking them through each step and checking every reading they say out loud, so they catch wiring mistakes while their hands stay on the probes.

Built at the **SDxSDSU Voice Agent Hackathon** (Nov 8, 2026) by Team 12: [names].
Powered by **ElevenLabs** (the voice and the agent) and **Daytona** (runs the circuit analysis in a secure sandbox).

**Track:** [Learning and Careers / Open] · **User:** an SDSU engineering student in an intro circuits lab, a multimeter probe in each hand · **Finish line:** guided through the Ohm's law lab by voice, all 4 resistors measured and logged hands-free, the wrong part and the loose wire caught and explained out loud, and the lab results file saved.

---

## What it is

In circuits lab, both of your hands are busy holding multimeter probes, so you can't type, scroll the handout, or write down numbers. Lab Copilot is a lab partner you talk to. It walks you through the procedure one step at a time, explains anything in plain words, and logs each measurement you say. Every reading is checked against Ohm's law right away, so a wrong resistor or a loose jumper gets caught on the spot instead of after the lab.

**Try saying:**
- "Walk me through it." … "I'm done." … "Why am I doing this?"
- "Resistor 3, 4.99 volts, 1.06 milliamps." → *"R3 measures 4.7k but should be 1k. Looks like yellow-violet-red instead of brown-black-red. Check the color bands."*
- "Resistor 4, 4.98 volts, zero milliamps." → *"No current is flowing. Check for a loose jumper or a lead in the wrong breadboard row."*
- "Wait, that was resistor 2, not 3." · "Undo that." · "Wrap it up."

## Why it matters

- **The problem:** students juggle probes, a handout and a notebook at once. They mix up resistors that look identical, put a lead in the wrong breadboard row, and often only find out when the numbers don't add up after the lab. TAs spend the session answering the same "why doesn't my circuit work?" questions.
- **Who has it:** every engineering student who takes an intro circuits lab, plus the TAs who run those sections.
- **Why voice:** both hands are literally occupied. Talking is the only input that doesn't mean putting the probes down.
- **Why it's different:** it doesn't just answer questions. It follows the lab's approved procedure, won't skip ahead until you confirm each checkpoint, does the real math on your actual readings, and tells you exactly what to check when something's wrong.

## How it works

```
You speak  →  ElevenLabs agent (hears you, decides what to do)
           →  calls a tool in the browser  →  our server  →  Daytona sandbox runs the analysis (Python)
           →  result comes back  →  ElevenLabs speaks the answer, and the page updates
```

1. **Voice in:** the ElevenLabs agent listens and works out what you need: a guided step, a reading to log, a correction, or a question.
2. **Agent decides:** it calls one of four tools: `protocol_step` (guided steps), `log_reading`, `delete_reading` (undo and corrections), `finish_run`.
3. **Daytona does the work:** our server sends the readings to a Daytona sandbox, where Python computes each resistance (R = V / I), checks it against the color-band value and ±5% tolerance, detects open and short circuits, checks power against the resistor's rating, identifies which resistor you probably used instead (nearest standard E12 value plus its color bands), and draws the voltage-current chart. Each reading takes under a second, using Daytona's stateful code interpreter.
4. **Voice out:** the agent explains the result in one or two sentences, and the page shows the live resistor cards, chart and progress.

**Guided Lab Mentor Mode:** the procedure lives in `data/protocols/ohms-law.json` (steps, plain-language explanations, terms, safety notes, checkpoints). The server, not the AI, tracks the current step and refuses to move on until the student confirms the checkpoint. Answers stay grounded in the approved procedure. If something isn't covered, the agent says so and points the student to their TA instead of making things up. Adding another lab means adding another protocol file.

**Sponsor features used:**
- **ElevenLabs:** Agents platform with a private agent (short-lived conversation tokens), 4 client tools, automatic language detection (it switches to Spanish when the student does), patient turn-taking tuned for people reading numbers off a meter, lab-vocabulary speech recognition keywords, the expressive voice model, and live interruption handling.
- **Daytona:** stateful code interpreter (Python with numpy, pandas and matplotlib) for every measurement, plus chart generation in the sandbox.

## Demo

- **Loom (2 min):** [link]
- **Screenshot:** [add one]

## Built with

ElevenLabs Agents (`@elevenlabs/client`), Daytona SDK (`@daytona/sdk`), Node.js + Express, plain HTML/CSS/JS (no build step). Built with help from AI coding tools (Claude Code).

**Lab procedure source:** the guided steps, safety rules and deviation formula are adapted from James M. Fiore, *Laboratory Manual for DC Electrical Circuit Analysis*, v1.4.3 (exercises 1, 3 and 4, and Appendix D), used under its Creative Commons BY-NC-SA license. The results file uses the manual's data-table layout: theoretical vs. measured current with percent deviation.

## Run it yourself

```bash
npm install
cp .env.example .env   # add your own ELEVENLABS_API_KEY and DAYTONA_API_KEY
npm run setup          # creates the agent and its tools, saves the IDs to .env
npm run dev            # open http://localhost:3000
```

`npm run cleanup` deletes any leftover Daytona sandboxes. Never commit `.env`; it's in `.gitignore`.

## What's next

- **Any lab, same copilot:** drop in another procedure file (physics, chemistry, bio) to switch labs; later, upload a course's PDF handout and extract the steps.
- **Readings straight from the meter:** connect a Bluetooth or USB multimeter so values flow in automatically, with voice for corrections and questions.
- **More languages and a knowledge base:** Spanish works today; add more languages and an ElevenLabs knowledge base with each course's troubleshooting guide.
- **First users:** students and TAs in SDSU's intro circuits lab sections. We'd measure time per lab and how many wiring mistakes get caught before the TA has to step in.

## Team

| Name | What they did |
|---|---|
| Matt Teixeira | Product, build, voice testing, demo |
| [name] | Backend: lab results report |
| [name] | Pitch and Loom script |
| [name] | Research and README |
