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

- **Track:** Health and Care
- **User:** an SDSU biology undergrad running their first Bradford protein assay in a teaching lab, alone, with gloves on
- **Problem:** gloved hands can't type. Students write readings on paper (or their glove) and retype them later, which is slow, error-prone, and means a bad sample is only found after the run. First-timers also don't know the steps and are nervous asking.
- **Finish line:** guided through the protocol by voice, 8 samples logged, the bad sample caught and explained out loud, and a results file saved.

**Pattern:** voice in → the agent decides → Daytona does the real work → voice out.

## How it works

```
Browser (public/index.html) ── GET /api/token ──► server.js ──► ElevenLabs (short-lived token)
mic + speaker ◄════════ live voice session (WebRTC) ════════► ElevenLabs agent
client tools (log_reading, delete_reading, protocol_step, finish_run)
      └── POST /api/... ──► server.js ──► Daytona sandbox (numpy/pandas/matplotlib)
```

- **ElevenLabs:** the voice agent. Private agent; the browser only gets a short-lived token.
- **Daytona:** fits the standard curve, works out protein concentrations, flags bad wells and draws the chart. It uses the stateful code interpreter, so each reading takes about 0.9 s (it was 2.5 s).
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
| Backend teammate | `lib/report.js`: the Markdown results report (due 2:45) |
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

### Data mode (passed at about 1:28 PM)

1. "Sample 1, 0.41"
2. "Sample 2, 0.38"
3. "Sample 4, 1.32" → should warn it's above the highest standard
4. "Wait, that was sample 5, not 4" → deletes 4, logs 5
5. "I'm done, wrap it up" → saves the CSV and chart, results links appear

Result: all five worked. One pause after the correction (Matt said "Hello?"); keep an eye on it.

### Mentor Mode (to test)

1. "Walk me through it" → safety note + Step 1, progress bar highlights Step 1
2. "I'm done" → asks to confirm the checkpoint, does **not** skip ahead
3. "Yes" → Step 2
4. "Why am I doing this?" → plain-language answer
5. "What does room temperature mean?" → explains the term
6. "Can I use a microwave to warm it up?" → not in the protocol, check with your TA
7. "Sample 1, 0.41" → data logging still works

### Demo numbers (Bradford, blank-subtracted A595)

- Standards (preloaded): 0 → 0.00, 0.25 → 0.14, 0.5 → 0.27, 1 → 0.52, 1.5 → 0.74, 2 → 0.95 (R² 0.998)
- Samples to read aloud: 1: 0.41, 2: 0.38, 3: 0.44, **4: 1.32 (the bad one)**, 5: 0.40, 6: 0.36, 7: 0.43, 8: 0.39

## Decisions log

| Time | Decision | Why |
|---|---|---|
| ~12:50 | Idea: Lab Copilot over interview coach, front desk, senior check-in | Strongest "why voice" (gloves), real Daytona work, clear real action |
| 12:58 | Briefly switched to senior check-in, then back to Lab Copilot | Team preferred the lab idea; senior-checkin folder is abandoned (never pushed) |
| 1:02 | First commit; public repo github.com/PanduhBuilds/lab-copilot | Judges need to see the history |
| ~1:15 | Switched to Daytona's stateful interpreter | Readings went from 2.5 s to 0.9 s (rubric: about 1.5 s replies) |
| ~1:25 | Added Guided Lab Mentor Mode; user changed to a first-time undergrad | Most students are alone in the lab and new to it; uses the protocol as a knowledge source |
| — | Skipped protocol upload for today | Time. The file format already makes new protocols a drop-in |

## Timeline

| Time | What |
|---|---|
| 1:00 | ✅ First commit |
| ~1:30 | ✅ v1 voice test passed, ✅ speed fix, ✅ Mentor Mode built |
| Next | Mentor Mode voice test |
| By 2:45 | Teammate's report wired in |
| 2:45–3:30 | Optional: ElevenLabs knowledge base, Spanish, turn-taking tuning; practice runs |
| **3:30** | **Feature freeze** |
| 3:30–3:50 | README finished, final push |
| 3:50–4:10 | Record the Loom (2–3 takes) |
| **4:15** | **Submit:** repo link, Loom, track, user, finish line |

## Loom plan (2:00 max)

1. **~15 s problem:** "First time in the lab, alone, gloves on: you can't type, and you don't know the steps."
2. **~25 s Mentor Mode:** "Walk me through it" → one step → "why am I doing this?"
3. **~50 s data:** read 3 to 4 samples, hit sample 4 so it warns, correct one, interrupt it once
4. **~15 s finish:** "Wrap it up" → results file appears
5. **~15 s how and who:** "ElevenLabs is the voice, Daytona does the math safely. Every teaching lab running these assays."

## After the hackathon

- Revoke the ElevenLabs and Daytona API keys.
- Run `npm run cleanup`.
- Delete the unused "Sunny" agent and the practice agent in ElevenLabs; trash the `senior-checkin` folder.
- Decide whether to keep the ElevenLabs Creator plan before it renews.
