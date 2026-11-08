// Sends the plate readings to the Daytona sandbox. There, numpy fits the standard
// curve, works out each sample's protein concentration, flags problems, and
// matplotlib draws the curve.
import { withSandbox } from './daytona.js';

const PYTHON = String.raw`
import json, base64
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

payload = json.loads(base64.b64decode(DATA_B64))
df = pd.DataFrame(payload["readings"], columns=["kind", "label", "absorbance"])
std = df[df.kind == "standard"].copy()
std["conc"] = std["label"].astype(float)
std = std.sort_values("conc")
smp = df[df.kind == "sample"].copy()
smp["num"] = pd.to_numeric(smp["label"], errors="coerce")
smp = smp.sort_values("num")

flags, samples = [], []
fit = None
if len(std) >= 2:
    slope, intercept = np.polyfit(std["conc"], std["absorbance"], 1)
    pred = slope * std["conc"] + intercept
    ss_res = float(((std["absorbance"] - pred) ** 2).sum())
    ss_tot = float(((std["absorbance"] - std["absorbance"].mean()) ** 2).sum()) or 1e-9
    r2 = 1 - ss_res / ss_tot
    fit = {"slope": round(float(slope), 4), "intercept": round(float(intercept), 4), "r2": round(r2, 4)}
    if len(std) >= 3 and r2 < 0.98:
        flags.append(f"Standard curve R squared is {r2:.3f}, below 0.98. Check the standards.")
    for _, row in std.iterrows():
        resid = row.absorbance - (slope * row.conc + intercept)
        if len(std) >= 4 and abs(resid) > 0.08:
            flags.append(f"Standard {row.conc:g} mg/mL is off the curve by {resid:+.2f}. Re-read it.")

    top = float(std["absorbance"].max())
    concs = (smp["absorbance"] - intercept) / slope
    smp["conc"] = concs
    med = float(concs.median()) if len(concs) else 0.0
    mad = float((concs - med).abs().median()) if len(concs) else 0.0
    for _, row in smp.iterrows():
        flag = None
        if row.absorbance > top:
            flag = "above the highest standard: dilute and re-read"
        elif row.conc < 0:
            flag = "below the blank: check the well"
        elif len(smp) >= 4 and mad > 0 and abs(row.conc - med) / (1.4826 * mad) > 3.5:
            flag = f"far from the other samples (median {med:.2f} mg/mL): re-measure"
        if flag:
            flags.append(f"Sample {row.label} is {flag}.")
        samples.append({"label": row.label, "absorbance": row.absorbance,
                        "conc": round(float(row.conc), 3), "flag": flag})
else:
    samples = [{"label": r.label, "absorbance": r.absorbance, "conc": None, "flag": None} for r in smp.itertuples()]

# Chart: standards, fitted line, samples placed on the curve.
fig, ax = plt.subplots(figsize=(7, 3.6), dpi=130)
ax.scatter(std["conc"], std["absorbance"], s=46, color="#2a6f97", zorder=3, label="Standards (BSA)")
if fit:
    hi = max([2.2] + [s["conc"] for s in samples if s["conc"] is not None])
    xs = np.linspace(0, hi, 50)
    ax.plot(xs, fit["slope"] * xs + fit["intercept"], color="#2a6f97", lw=1.4, alpha=.7,
            label=f"Fit  y = {fit['slope']:.3f}x + {fit['intercept']:.3f}   R² = {fit['r2']:.3f}")
    for s in samples:
        bad = s["flag"] is not None
        ax.scatter([s["conc"]], [s["absorbance"]], marker="D", s=42, zorder=4,
                   color="#d1495b" if bad else "#edae49", edgecolor="#333", linewidth=.5)
        if bad:
            ax.annotate(f"Sample {s['label']}", (s["conc"], s["absorbance"]), textcoords="offset points",
                        xytext=(-8, -14), ha="right", fontsize=8, color="#d1495b")
ax.set_xlabel("Protein (mg/mL)")
ax.set_ylabel("Absorbance at 595 nm")
ax.set_xlim(left=0)
ax.set_ylim(bottom=0)
ax.spines["top"].set_visible(False)
ax.spines["right"].set_visible(False)
ax.legend(loc="upper left", fontsize=8, frameon=False)
fig.tight_layout()
fig.savefig("curve.png")

latest = payload.get("latest")
latest_info = None
if latest and latest["kind"] == "sample":
    latest_info = next((s for s in samples if s["label"] == latest["label"]), None)

print(json.dumps({
    "n_standards": int(len(std)),
    "n_samples": int(len(smp)),
    "fit": fit,
    "samples": samples,
    "flags": flags,
    "latest": latest_info,
}))
`;

export async function analyze(readings, latest = null) {
  const started = Date.now();
  const data = Buffer.from(JSON.stringify({ readings, latest })).toString('base64');
  const code = `DATA_B64 = "${data}"\n${PYTHON}`;

  const { run, png } = await withSandbox(async (sandbox) => {
    const run = await sandbox.process.codeRun(code, undefined, 60);
    const png = run.exitCode === 0 ? await sandbox.fs.downloadFile('curve.png') : null;
    return { run, png };
  });

  if (run.exitCode !== 0) {
    throw new Error(`Analysis failed in the sandbox:\n${String(run.result).slice(-800)}`);
  }
  const lastLine = String(run.result).trim().split('\n').pop();
  return {
    ...JSON.parse(lastLine),
    chart: `data:image/png;base64,${Buffer.from(png).toString('base64')}`,
    ms: Date.now() - started,
  };
}
