// Builds the lab report (Markdown) saved when the student says "wrap it up".
// Layout follows a typical lab report: objective, equipment, data table with
// theory vs measured and percent deviation, issues, observations.

const ohms = (r) => (r == null ? '—' : r >= 1000 ? `${+(r / 1000).toPrecision(3)} kΩ` : `${+r.toPrecision(3)} Ω`);
const num = (v, digits = 2) => (v == null || Number.isNaN(v) ? '—' : Number(v).toFixed(digits));
const signed = (v, digits = 1) => (v == null ? '—' : `${v > 0 ? '+' : ''}${Number(v).toFixed(digits)}%`);

/**
 * @param {object} p
 * @param {object} p.lab       seed.json contents (lab, tolerance, rating_w, parts)
 * @param {object} p.protocol  the protocol JSON (name, summary, source)
 * @param {object} p.analysis  the Daytona analysis result (parts, flags, n_measured, ...)
 * @param {string} p.chartFile file name of the saved V-I chart PNG
 * @param {string} p.csvFile   file name of the saved CSV
 * @param {Date}   [p.when]
 */
export function buildReport({ lab, protocol, analysis: a, chartFile, csvFile, when = new Date() }) {
  const date = when.toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' });
  const tolPct = lab.tolerance * 100;

  const rows = a.parts.map((x) => {
    const theory = x.volts != null && x.nominal ? (x.volts / x.nominal) * 1000 : null;
    const curDev = theory && x.milliamps != null ? (100 * (x.milliamps - theory)) / theory : null;
    const status = x.volts == null ? 'not measured' : x.flag ? `⚠ ${x.flag}` : '✓ within tolerance';
    return `| R${x.label} | ${x.bands ?? ''} | ${ohms(x.nominal)} | ${num(x.volts)} | ${num(theory, 3)} | ${num(x.milliamps, 3)} | ${signed(curDev)} | ${ohms(x.measured)} | ${signed(x.error_pct)} | ${status} |`;
  });

  const good = a.parts.filter((x) => x.measured != null && !x.flag && x.error_pct != null);
  const devs = good.map((x) => x.error_pct);
  const mean = devs.length ? devs.reduce((s, v) => s + v, 0) / devs.length : null;
  const sd = devs.length > 1 ? Math.sqrt(devs.reduce((s, v) => s + (v - mean) ** 2, 0) / (devs.length - 1)) : null;
  const worst = good.reduce((w, x) => (w == null || Math.abs(x.error_pct) > Math.abs(w.error_pct) ? x : w), null);
  const missing = a.parts.filter((x) => x.volts == null).map((x) => `R${x.label}`);

  const holds = good.length >= 2 && Math.abs(worst.error_pct) <= tolPct;
  const observations = [
    good.length
      ? `${good.length} of ${a.n_parts} resistors were within the ±${tolPct}% tolerance. Mean resistance deviation ${signed(mean)}${sd != null ? ` (standard deviation ${num(sd, 1)} points)` : ''}; largest ${signed(worst.error_pct)} on R${worst.label}.`
      : 'No resistors were within tolerance yet.',
    holds
      ? "For the in-tolerance resistors, the measured voltage and current agree with Ohm's law (V = I × R) to within the parts' tolerance."
      : "Ohm's law could not be confirmed for every part. See the issues below.",
    a.flags.length ? `${a.flags.length} issue(s) were caught during the run and are listed below; re-measure after fixing them.` : 'No wiring or part problems were detected.',
    missing.length ? `Not measured: ${missing.join(', ')}.` : 'All resistors were measured.',
  ];

  return `# ${protocol.name}: lab report

**Date:** ${date}
**Setup:** ${lab.lab.setup}
**Recorded by:** Lab Copilot (hands-free voice logging). Analysis ran in a Daytona sandbox.

## Objective

${protocol.summary}

## Equipment

- Adjustable DC power supply set to 5 V
- Digital multimeter (DC voltage and DC current)
- Solderless breadboard and 22–24 gauge hookup wire
${lab.parts.map((p) => `- R${p.label}: ${ohms(p.nominal)}, ${p.bands}, ±${tolPct}%`).join('\n')}

## Data

Theory current: I = V / R(nominal). Deviation = 100 × (measured − theory) / theory.

| Resistor | Color bands | Nominal | Volts (V) | I theory (mA) | I measured (mA) | Current deviation | R measured | R deviation | Status |
|---|---|---|---|---|---|---|---|---|---|
${rows.join('\n')}

![Measured vs. Ohm's law](${chartFile})

Raw data: \`${csvFile}\`

## Issues caught

${a.flags.length ? a.flags.map((f) => `- ${f}`).join('\n') : '- None.'}

## Observations

${observations.map((o) => `- ${o}`).join('\n')}

---

*Procedure adapted from: ${protocol.source}*
`;
}
