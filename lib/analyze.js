// Sends the circuit measurements to the Daytona sandbox. There, Python applies
// Ohm's law (R = V / I), checks each resistor against its color-band value and
// tolerance, detects open and short circuits, checks power against the rating,
// guesses which resistor was actually used, and draws the V-I chart.
//
// Speed: Daytona's stateful code interpreter. SETUP (imports + the analysis
// function) runs once per sandbox; each reading only calls analyze_run().
import { withSandbox } from './daytona.js';

const SETUP = String.raw`
import json, base64, io, math
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

# Dark instrument-panel style to match the page.
plt.rcParams.update({
    "figure.facecolor": "#0f1513", "axes.facecolor": "#0f1513", "savefig.facecolor": "#0f1513",
    "axes.edgecolor": "#3a4743", "axes.labelcolor": "#a9b8b2", "text.color": "#d6e2dd",
    "xtick.color": "#7f8f89", "ytick.color": "#7f8f89", "grid.color": "#1f2a27",
    "font.size": 9,
})

E12 = [1.0, 1.2, 1.5, 1.8, 2.2, 2.7, 3.3, 3.9, 4.7, 5.6, 6.8, 8.2]
COLORS = ["black", "brown", "red", "orange", "yellow", "green", "blue", "violet", "gray", "white"]

def ohms(r):
    if r >= 1e6: return f"{r/1e6:g} megohms"
    if r >= 1000: return f"{r/1000:.3g}k ohms"
    return f"{r:.3g} ohms"

def nearest_e12(r):
    cands = [m * 10**e for e in range(0, 7) for m in E12]
    return min(cands, key=lambda c: abs(math.log(r / c)))

def bands(value):
    exp = int(math.floor(math.log10(value))) - 1
    digits = int(round(value / 10**exp))
    if digits >= 100:
        digits //= 10; exp += 1
    return f"{COLORS[digits // 10]}, {COLORS[digits % 10]}, {COLORS[max(exp, 0)]}"

def analyze_run(data_b64):
    payload = json.loads(base64.b64decode(data_b64))
    parts = {p["label"]: p for p in payload["parts"]}
    tol = payload["tolerance"]
    rating = payload["rating_w"]
    readings = {r["label"]: r for r in payload["readings"]}

    results, flags = [], []
    for label in sorted(set(parts) | set(readings), key=lambda x: (len(x), x)):
        part = parts.get(label, {})
        nominal = part.get("nominal")
        row = {"label": label, "nominal": nominal, "bands": part.get("bands"),
               "volts": None, "milliamps": None, "measured": None, "error_pct": None,
               "power_w": None, "flag": None, "advice": None}
        r = readings.get(label)
        if r:
            v, ma = float(r["volts"]), float(r["milliamps"])
            row["volts"], row["milliamps"] = v, ma
            if ma <= 0.01 and v > 0.5:
                row["flag"] = "open circuit"
                row["advice"] = "No current is flowing. Check for a loose jumper or a lead in the wrong breadboard row."
            elif v < 0.05 and ma > 1:
                row["flag"] = "short circuit"
                row["advice"] = "Almost no voltage across it with current flowing. Something is bypassing the resistor, often both legs in the same row."
            else:
                measured = v / (ma / 1000)
                power = v * ma / 1000
                row["measured"] = round(measured, 1)
                row["power_w"] = round(power, 3)
                if nominal:
                    err = (measured - nominal) / nominal * 100
                    row["error_pct"] = round(err, 1)
                    if abs(err) > tol * 100:
                        guess = nearest_e12(measured)
                        row["flag"] = f"{err:+.0f}% off"
                        row["advice"] = (f"It measures {ohms(measured)} but should be {ohms(nominal)}. "
                                         f"That looks like a {ohms(guess)} resistor ({bands(guess)}) instead of "
                                         f"{part.get('bands')}. Check the color bands.")
                if not row["flag"] and power > rating:
                    row["flag"] = "over power rating"
                    row["advice"] = f"It's dissipating {power:.2f} watts, over its {rating} watt rating, so it will get hot. Turn the output off."
            if row["flag"]:
                flags.append(f"Resistor {label}: {row['advice']}")
        results.append(row)

    good = [x for x in results if x["measured"] is not None and not x["flag"] and x["error_pct"] is not None]
    avg_err = round(sum(abs(x["error_pct"]) for x in good) / len(good), 1) if good else None

    # V-I chart: dashed lines are what Ohm's law predicts for each labeled resistor,
    # dots are the student's measurements.
    fig, ax = plt.subplots(figsize=(7, 3.6), dpi=130)
    max_ma = max([25.0] + [x["milliamps"] or 0 for x in results])
    for x in results:
        if x["nominal"]:
            ma_line = [0, max_ma * 1.05]
            ax.plot(ma_line, [m / 1000 * x["nominal"] for m in ma_line], ls="--", lw=1, color="#45534f", zorder=1)
            end_ma = min(max_ma * 1.05, 5.4 / x["nominal"] * 1000)
            ax.annotate(f"{ohms(x['nominal']).replace(' ohms', ' Ω')}", (end_ma, end_ma / 1000 * x["nominal"]),
                        fontsize=7, color="#7f8f89", xytext=(2, 0), textcoords="offset points")
    for x in results:
        if x["volts"] is None: continue
        bad = x["flag"] is not None
        ax.scatter([x["milliamps"]], [x["volts"]], s=60, zorder=3,
                   color="#ff5a4e" if bad else "#5ee08a", edgecolor="#0f1513", linewidth=1)
        ax.annotate(f"R{x['label']}", (x["milliamps"], x["volts"]), xytext=(6, -12), textcoords="offset points",
                    fontsize=8, fontweight="bold", color="#ff5a4e" if bad else "#5ee08a")
    ax.set_xlim(0, max_ma * 1.15)
    ax.set_ylim(0, 6)
    ax.set_xlabel("Current (mA)")
    ax.set_ylabel("Voltage (V)")
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.grid(True, lw=.6)
    fig.tight_layout()
    buf = io.BytesIO()
    fig.savefig(buf, format="png")
    plt.close(fig)

    latest = payload.get("latest")
    latest_info = next((x for x in results if x["label"] == latest), None) if latest else None

    return json.dumps({
        "parts": results,
        "flags": flags,
        "n_parts": len(parts),
        "n_measured": sum(1 for x in results if x["volts"] is not None),
        "n_ok": len(good),
        "avg_error_pct": avg_err,
        "latest": latest_info,
        "chart": base64.b64encode(buf.getvalue()).decode(),
    })

print("ready")
`;

const readySandboxes = new WeakSet();

async function runPython(sandbox, code) {
  const r = await sandbox.codeInterpreter.runCode(code, { timeout: 60 });
  return r.error ? { error: r.error } : { stdout: r.stdout };
}

// lab: { parts, tolerance, rating_w }. readings: [{ label, volts, milliamps }]. latest: label just logged.
export async function analyze(lab, readings, latest = null) {
  const started = Date.now();
  const payload = { parts: lab.parts, tolerance: lab.tolerance, rating_w: lab.rating_w, readings, latest };
  const data = Buffer.from(JSON.stringify(payload)).toString('base64');
  const call = `print(analyze_run("${data}"))`;

  const out = await withSandbox(async (sandbox) => {
    if (!readySandboxes.has(sandbox)) {
      const s = await runPython(sandbox, SETUP);
      if (s.error) return s;
      readySandboxes.add(sandbox);
    }
    let r = await runPython(sandbox, call);
    if (r.error?.name === 'NameError') {
      // Interpreter was restarted: load the analysis function again.
      await runPython(sandbox, SETUP);
      r = await runPython(sandbox, call);
    }
    return r;
  });

  if (out.error) {
    const { name, value, traceback } = out.error;
    throw new Error(`Analysis failed in the sandbox: ${name}: ${value}\n${String(traceback ?? '').slice(-600)}`);
  }
  const result = JSON.parse(String(out.stdout).trim().split('\n').pop());
  return { ...result, chart: `data:image/png;base64,${result.chart}`, ms: Date.now() - started };
}
