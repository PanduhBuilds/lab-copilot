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

- **Track:** Learning and Careers
- **Demo lab:** Ohm's law (V = I × R): measure 4 resistors at 5 V, adapted from James M. Fiore's *Laboratory Manual for DC Electrical Circuit Analysis* (CC BY-NC-SA)
- **User:** an SDSU engineering student in an intro circuits lab, a multimeter probe in each hand
- **Problem:** both hands are on the probes, so students can't type or check the handout. They mix up identical-looking resistors and wire into the wrong breadboard row, and often only find out after the lab. TAs answer the same "why doesn't my circuit work?" questions all session.
- **Finish line:** guided through the Ohm's law lab by voice, all 4 resistors measured and logged hands-free, the wrong part and the loose wire caught and explained out loud, and the lab report saved.

**One-line pitch:** "Lab Copilot catches your mistake the moment you make it, tells you exactly what to fix, and fills in your lab report while your hands stay on the probes."

**How it's built (one line):** "ElevenLabs is the voice and the brain. Daytona runs the real math safely in a sandbox. We built it today with Claude Code as our coding partner."

**Pitch document (share link):** https://claude.ai/artifact/GFZM9hJwNUWREXuRnBdewf

**Pattern:** voice in → the agent decides → Daytona does the real work → voice out.

## How it works

```
Browser (public/index.html or public/console.html) ── GET /api/token ──► server.js ──► ElevenLabs (short-lived token)
mic + speaker ◄════════ live voice session (WebRTC) ════════► ElevenLabs agent
client tools (log_reading, delete_reading, protocol_step, finish_run)
      └── POST /api/... ──► server.js ──► Daytona sandbox (Ohm's law, tolerance, open/short, power, chart)
```

- **ElevenLabs:** the voice agent. Private agent (the browser only gets a short-lived token). Language detection with a Spanish preset, patient turn-taking, lab-vocabulary speech recognition keywords.
- **Daytona:** computes R = V / I for each resistor, checks it against the color bands and ±5% tolerance, detects open and short circuits, checks power against the 0.25 W rating, guesses the resistor actually used (nearest E12 value + color bands) and draws the V–I chart. It uses the stateful code interpreter, so each reading takes under 1 s.
- **Protocols** live in `data/protocols/*.json`. Adding a lab means adding a file.
- **Mentor Mode:** the server tracks the current step and refuses "next" until the student confirms the checkpoint. Steps and safety follow the Fiore manual (exercises 1, 3, 4 and Appendix D).
- **Lab report:** `lib/report.js` builds a Markdown report on "wrap it up" (data table with theory vs. measured current and % deviation, chart, issues, observations). Saved in `results/` with the CSV and chart; viewable at `/report/<file>` via the "Open lab report" button.
- **UI:** dark instrument-panel look: voice orb (pulses while listening, bars while speaking), a big Now card (step, reading, problem caught, lab complete), resistor cards drawn with real color bands, progress bar, V–I chart.

### Commands (in `~/Desktop/lab-copilot`)

| Command | What it does |
|---|---|
| `npm run dev` | Runs the app at http://localhost:3000 (original page) and http://localhost:3000/console.html (bench console: Home, big NEXT step, readouts, V–I plot, timeline). Now `node --watch server.js`; the old watcher stopped noticing changes |
| `npm run setup` | Creates or updates the agent and its tools after a prompt change |
| `npm run cleanup` | Deletes leftover Daytona sandboxes (run at the end of the day) |

Pushing: commit, then click **Push origin** in GitHub Desktop.

The server runs in the Terminal tab **"lab copilot server"**. If a change doesn't show up, stop it with Ctrl+C and run `npm run dev` again. Protocol and seed files only load at startup.

## Who's doing what

| Person | Job |
|---|---|
| Matt | Runs the app on his laptop, voice tests, drives the Loom |
| Backend teammate | Was on `lib/report.js`; Claude built it at 2:30 instead, so he's helping with the Loom and README |
| Pitch teammate | Pitch, Loom script (from the pitch document) |
| Teammate | Research (found the Fiore DC lab manual and a robotics lab manual) and the UI design from Grok/Cursor |
| Claude | Agent, server, Daytona analysis, Mentor Mode, lab report, UI, README and pitch document |

### Message sent to the backend teammate

> Get the code: accept the GitHub invite, clone `lab-copilot` in GitHub Desktop, run `npm install` (Node 22+). No API keys needed; Matt runs the live app.
>
> Your job: `lib/report.js` (only you touch it). Export `buildReport(run, analysis)` that returns Markdown: assay name, date and time, curve equation and R², a sample table (well, A595, protein mg/mL, flag), mean and SD of good samples, and a "Needs attention" list. Input shapes: `data/seed.json` and the JSON at the bottom of the Python in `lib/analyze.js`.
>
> Rules: only edit `lib/report.js` and new files. Fetch and Pull before pushing. Commit small and often. Never put keys in code or the chat. Pushed by 2:45.

(This was for the Bradford version. The circuits report was built by Claude at 2:30 instead.)

## Test scripts (say these out loud)

### Circuits run (the Loom flow)

1. "Walk me through it" → safety + Step 1; "I'm done" → asks to confirm; "Yes" → Step 2
2. "Resistor 1, 4.98 volts, 22.4 milliamps" → 222 Ω, OK
3. "Resistor 2, 4.97 volts, 10.6 milliamps" → 469 Ω, OK
4. "Resistor 3, 4.99 volts, 1.06 milliamps" → **wrong part**: 4.7k instead of 1k (yellow-violet-red vs brown-black-red)
5. "Resistor 4, 4.98 volts, zero milliamps" → **open circuit**: loose jumper or wrong row
6. "Fixed it. Resistor 4, 4.98 volts, 2.25 milliamps" → 2.21k, OK
7. "Wrap it up" → lab report + CSV + chart saved, Lab complete card → click **Open lab report**
8. Optional: "¿Qué hago ahora?" → answers in Spanish; "back to English"

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
| ~2:25 | Adopted the Fiore DC lab manual (procedure, safety, deviation formula); lab-report CSV columns | Real published procedure = credibility; the report table matches what lab handouts ask for |
| ~2:25 | Spanish auto-detect + patient turn-taking + speech keywords | "Best ElevenLabs build" criteria; students pause while reading numbers |
| ~2:25 | Robotics lab manual kept for the pitch only | AI-written spec for hardware we don't have; good "any lab" story |
| ~2:30 | Built the lab report ourselves | Teammate's version wasn't ready; the finish line needs it |
| ~2:40 | No wake word: one tap starts a session that listens for the whole lab | Wake words take time to build well; mention as "what's next" |
| ~2:40 | Didn't raise ElevenLabs' max conversation length | Not needed for a 2-minute Loom |
| ~3:00 | Second UI, `public/console.html`, built in a separate Claude session from the teammate's UI prompt; `index.html` left untouched as the fallback. SDSU scarlet in the chrome only; green/amber/red stay for data | Readable from across the bench (64px readouts, one NEXT instruction). Both pages share `/api/state` and the same four tools, so switching tabs loses nothing. Exception to the one-editor rule: new file only, committed at once |
| — | Skipped: second lab, knowledge base upload, accessibility mode, voltage sweep, camera | Time; all listed as "what's next" |

## Timeline

| Time | What |
|---|---|
| 1:00 | ✅ First commit |
| ~1:30 | ✅ v1 voice test passed, ✅ speed fix, ✅ Mentor Mode built |
| ~2:15 | ✅ Circuits switch, ✅ UI redesign, ✅ README draft |
| ~2:30 | ✅ Fiore procedure, ✅ Spanish + turn-taking, ✅ lab report, ✅ pitch document |
| 3:20 | ✅ `console.html` (bench console + Home view) pushed; tested with the Loom readings through the server. Still to try: the voice session started from that page, in Chrome |
| 3:00–3:30 | Full voice run-throughs, bug fixes only; Loom audio test |
| **3:30** | **Feature freeze** |
| 3:30–3:50 | README finished, final push |
| 3:50–4:10 | Record the Loom (2–3 takes) |
| **4:15** | **Submit:** repo link, Loom, track, user, finish line |

## Loom plan (2:00 max)

Record on http://localhost:3000/console.html: open **Home**, click **Start lab** (opens the console and starts the session). If the session won't start there, record on http://localhost:3000/ instead; the readings carry over.

1. **~15 s problem + lab:** "Circuits lab: a probe in each hand, so you can't type, check the handout, or write things down. Today's demo is the classic first circuits lab: Ohm's law, measuring four resistors at 5 volts."
2. **~20 s Mentor Mode:** "Walk me through it" → one step → "why am I doing this?"
3. **~50 s data:** R1 OK → R3 wrong part caught → R4 open circuit → fix → R4 OK; interrupt it once
4. **~15 s finish:** "Wrap it up" → Lab complete → Open lab report
5. **~20 s how and who:** "ElevenLabs is the voice, Daytona runs the circuit math safely. Every engineering student takes circuits lab. Next: any lab from its handout, and a live TA dashboard."

## After the hackathon

- Revoke the ElevenLabs and Daytona API keys.
- Run `npm run cleanup`.
- Delete the unused "Sunny" agent and the practice agent in ElevenLabs; trash the `senior-checkin` folder.
- Decide whether to keep the ElevenLabs Creator plan before it renews.
- Send the project details to the Resume hub for `achievements.md`.
