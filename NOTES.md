# Lab Copilot: build notes

Running notes for Team 12 during the SDxSDSU hackathon (Sun Nov 8, 2026). Updated as we go.

## The rules (from the organizers' slides)

- Teams of 1 to 4. **Start from scratch: no code written before 1:00.** Judges check the repo history.
- The agent's voice must run on ElevenLabs. Using Daytona earns points. A web demo counts; no phone needed.
- **Submit by 4:15:** repo link, a **2-minute Loom of a live conversation** (they stop at 2:00), and our track, user and finish line.
- Judges pick 2 finalists per track from the Looms. 8 teams demo live at 5:00.

### Rubric (each scored 1 to 5, out of 40)

| Line | Weight | What they want |
|---|---|---|
| Works live | ×2 | Replies in about 1.5 s, handles being interrupted, no faked steps |
| Solves the problem | ×2 | Does the job for the named user and reaches the finish line with a real action |
| Technical depth | ×1 | Real tool calls and data, beyond a configured agent |
| Handles curveballs | ×1 | Recovers when a judge changes their mind or goes off-topic |
| Uses Daytona | ×1 | Agent code, tools or data run in a Daytona sandbox |
| Demo | ×1 | Clean, and matches what we claim |

The "Best ElevenLabs build" prize looks at a knowledge base, custom voices, more than one language, and tuned turn-taking.

## What we're building

- **Track:** Learning and Careers (or Open)
- **User:** an SDSU engineering student in an intro circuits lab, a multimeter probe in each hand
- **Problem:** both hands are on the probes, so students can't type or check the handout. They mix up identical-looking resistors and wire into the wrong breadboard row, and often only find out after the lab. TAs answer the same "why doesn't my circuit work?" questions all session.
- **Finish line:** guided through the Ohm's law lab by voice, all 4 resistors measured and logged hands-free, the wrong part and the loose wire caught and explained out loud, and the lab results file saved.

**Pattern:** voice in → the agent decides → Daytona does the real work → voice out.

## How it works

```
Browser (public/index.html) ── GET /api/token ──► server.js ──► ElevenLabs (short-lived token)
mic + speaker ◄════════ live voice session (WebRTC) ════════► ElevenLabs agent
client tools (log_reading, delete_reading, protocol_step, finish_run)
      └── POST /api/... ──► server.js ──► Daytona sandbox (Ohm's law, tolerance, open/short, power, chart)
```

- **ElevenLabs:** the voice agent. Private agent; the browser only gets a short-lived token.
- **Daytona:** computes R = V / I for each resistor, checks it against the color bands and ±5% tolerance, detects open and short circuits, checks power against the 0.25 W rating, guesses the resistor actually used (nearest E12 value + color bands) and draws the V–I chart. It uses the stateful code interpreter, so each reading takes under 1 s.
- **Protocols** live in `data/protocols/*.json`. Adding a lab means adding a file.
- **Mentor Mode:** the server tracks the current step and refuses "next" until the student confirms the checkpoint.

### Commands (in `~/Desktop/lab-copilot`)

| Command | What it does |
|---|---|
| `npm run dev` | Runs the app at http://localhost:3000 |
| `npm run setup` | Creates or updates the agent and its tools after a prompt change |
| `npm run cleanup` | Deletes leftover Daytona sandboxes (run at the end of the day) |

Pushing: commit, then click **Push origin** in GitHub Desktop.

## Who's doing what

| Person | Job |
|---|---|
| Matt | Runs the app on his laptop, voice tests, drives the Loom |
| Backend teammate | `lib/report.js`: the Markdown results report (due 2:45), now using `analysis.parts` (circuits fields) |
| Teammate | Loom script |
| Teammate | README draft (track, user, finish line, problem, how it works) |
| Claude | Agent, server, Daytona analysis, Mentor Mode, wiring it together |

### Message sent to the backend teammate

> Get the code: accept the GitHub invite, clone `lab-copilot` in GitHub Desktop, run `npm install` (Node 22+). No API keys needed; Matt runs the live app.
>
> Your job: `lib/report.js` (only you touch it). Export `buildReport(run, analysis)` that returns Markdown: assay name, date and time, curve equation and R², a sample table (well, A595, protein mg/mL, flag), mean and SD of good samples, and a "Needs attention" list. Input shapes: `data/seed.json` and the JSON at the bottom of the Python in `lib/analyze.js`.
>
> Rules: only edit `lib/report.js` and new files. Fetch and Pull before pushing. Commit small and often. Never put keys in code or the chat. Pushed by 2:45.

## Test scripts (say these out loud)

### Circuits run (the Loom flow)

1. "Walk me through it" → safety + Step 1; "I'm done" → asks to confirm; "Yes" → Step 2
2. "Resistor 1, 4.98 volts, 22.4 milliamps" → 222 Ω, OK
3. "Resistor 2, 4.97 volts, 10.6 milliamps" → 469 Ω, OK
4. "Resistor 3, 4.99 volts, 1.06 milliamps" → **wrong part**: 4.7k instead of 1k (yellow-violet-red vs brown-black-red)
5. "Resistor 4, 4.98 volts, zero milliamps" → **open circuit**: loose jumper or wrong row
6. "Fixed it. Resistor 4, 4.98 volts, 2.25 milliamps" → 2.21k, OK
7. "Wrap it up" → CSV + chart saved, Lab complete card

Result: passed by voice at about 2:05 PM (circuits version). Earlier Bradford tests also passed (logging, corrections, Mentor Mode, refusing the microwave question, asking to confirm a misheard "sample 10.41").

Tips: say readings with small pauses ("resistor one … four point nine eight volts …"). For the Loom, make sure the agent's voice is recorded (computer audio, or speakers instead of headphones).

### Lab parts (data/seed.json)

| Resistor | Value | Bands |
|---|---|---|
| R1 | 220 Ω | red, red, brown |
| R2 | 470 Ω | yellow, violet, brown |
| R3 | 1 kΩ | brown, black, red |
| R4 | 2.2 kΩ | red, red, red |

## Decisions log

| Time | Decision | Why |
|---|---|---|
| ~12:50 | Idea: Lab Copilot over interview coach, front desk, senior check-in | Strongest "why voice" (gloves), real Daytona work, clear real action |
| 12:58 | Briefly switched to senior check-in, then back to Lab Copilot | Team preferred the lab idea; senior-checkin folder is abandoned (never pushed) |
| 1:02 | First commit; public repo github.com/PanduhBuilds/lab-copilot | Judges need to see the history |
| ~1:15 | Switched to Daytona's stateful interpreter | Readings went from 2.5 s to 0.9 s (rubric: about 1.5 s replies) |
| ~1:25 | Added Guided Lab Mentor Mode; user changed to a first-time undergrad | Most students are alone in the lab and new to it; uses the protocol as a knowledge source |
| — | Skipped protocol upload for today | Time. The file format already makes new protocols a drop-in |
| ~1:55 | Switched the lab from Bradford assay to a circuits (Ohm's law) lab | Nobody on the team has bio-lab experience; we're tech students and every engineering major takes circuits lab |
| ~2:10 | UI redesign (instrument panel); asking Grok and Cursor for SDSU-colored inspiration | Judges see the Loom on a screen; a stronger look sells it. Only this Claude chat edits the code |

## Timeline

| Time | What |
|---|---|
| 1:00 | ✅ First commit |
| ~1:30 | ✅ v1 voice test passed, ✅ speed fix, ✅ Mentor Mode built |
| ~2:15 | ✅ Circuits switch, ✅ UI redesign, ✅ README draft |
| Next | UI inspiration from Grok/Cursor → apply; Loom audio test; teammate report |
| By 2:45 | Teammate's report wired in |
| 2:45–3:30 | Optional: ElevenLabs knowledge base, Spanish, turn-taking tuning; practice runs |
| **3:30** | **Feature freeze** |
| 3:30–3:50 | README finished, final push |
| 3:50–4:10 | Record the Loom (2–3 takes) |
| **4:15** | **Submit:** repo link, Loom, track, user, finish line |

## Loom plan (2:00 max)

1. **~15 s problem:** "Circuits lab: a probe in each hand, so you can't type, check the handout, or write things down."
2. **~20 s Mentor Mode:** "Walk me through it" → one step → "why am I doing this?"
3. **~50 s data:** R1 OK → R3 wrong part caught → R4 open circuit → fix → R4 OK; interrupt it once
4. **~15 s finish:** "Wrap it up" → Lab complete + results file
5. **~20 s how and who:** "ElevenLabs is the voice, Daytona runs the circuit math safely. Every engineering student takes circuits lab."

## After the hackathon

- Revoke the ElevenLabs and Daytona API keys.
- Run `npm run cleanup`.
- Delete the unused "Sunny" agent and the practice agent in ElevenLabs; trash the `senior-checkin` folder.
- Decide whether to keep the ElevenLabs Creator plan before it renews.
