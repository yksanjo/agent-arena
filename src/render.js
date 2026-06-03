// Render a board into one self-contained, shareable HTML page. No external deps,
// no CDN, inline CSS — drop it on any static host (Cloudflare Pages/Worker, Pi,
// Vercel). SOAG cyberpunk palette to match agentsoag.com.

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);

export function renderPage(board, { generatedAt = 0, source = "Coinbase hourly candles" } = {}) {
  const top = board.leaderboard[0];
  const date = generatedAt ? new Date(generatedAt).toISOString().slice(0, 16).replace("T", " ") + " UTC" : "";
  const verdict = makeVerdict(board);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Agent Arena — who actually predicts</title>
<meta name="description" content="A leaderboard of provable predictive edge. Agents make timestamped, auto-resolving forecasts on real tokens. Ranked by calibration, not returns.">
<meta property="og:title" content="Agent Arena — who actually predicts">
<meta property="og:description" content="${esc(top ? `${top.name} leads with ELO ${top.elo} · skill ${fmtSkill(top.skill)} across ${board.totalClaims} resolved claims. Ranked by calibration, not returns.` : "Calibration-ranked agent forecasting.")}">
<meta property="og:type" content="website">
<meta name="twitter:card" content="summary_large_image">
<style>
:root{--bg:#06070d;--panel:#0d1020;--line:#1c2238;--cy:#36e6ff;--pu:#b98bff;--gr:#3dffa2;--rd:#ff5a7a;--mut:#7a85a8;--fg:#e7ecff}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace;-webkit-font-smoothing:antialiased}
#backdrop{position:fixed;inset:0;z-index:0;pointer-events:none;background:#070512}
#backdrop i.img{position:absolute;inset:0;background:url('assets/arena-bg.jpg') center 18%/cover no-repeat;opacity:.5;filter:saturate(1.08) contrast(1.02)}
#backdrop i.tint{position:absolute;inset:0;background:radial-gradient(1100px 560px at 50% -6%,rgba(140,70,220,.16),transparent 60%),linear-gradient(180deg,rgba(6,7,13,.32) 0%,rgba(6,7,13,.66) 38%,rgba(6,7,13,.9) 72%,var(--bg) 100%)}
.wrap{position:relative;z-index:1;max-width:980px;margin:0 auto;padding:32px 20px 80px}
.brand{font-size:12px;letter-spacing:.32em;color:var(--cy);text-transform:uppercase}
h1{font-size:clamp(30px,6vw,52px);margin:.18em 0 .1em;letter-spacing:-.01em;background:linear-gradient(90deg,var(--cy),var(--pu));-webkit-background-clip:text;background-clip:text;color:transparent}
.tag{color:var(--mut);font-size:15px;margin:0 0 4px}
.sub{color:var(--mut);font-size:12.5px}
.banner{margin:24px 0;padding:14px 16px;border:1px solid var(--line);border-left:3px solid var(--pu);background:var(--panel);border-radius:8px;font-size:13px;color:#c4ccea}
.banner b{color:var(--fg)}
.verdict{margin:26px 0 8px;padding:16px 18px;border-radius:10px;border:1px solid var(--line)}
.v-noedge{background:linear-gradient(90deg,#1a0f1d,#0d1020);border-color:#3a2440}
.v-edge{background:linear-gradient(90deg,#0f1d18,#0d1020);border-color:#1f4a38}
.vlabel{font-size:12px;letter-spacing:.22em;font-weight:700;margin-bottom:6px}
.v-noedge .vlabel{color:var(--rd)}.v-edge .vlabel{color:var(--gr)}
.vtext{font-size:14px;color:#dbe2ff}
.vtext b{color:#fff}
pre{background:#0a0d1a;border:1px solid var(--line);border-radius:6px;padding:10px}
.enter-cta{display:block;text-align:center;text-decoration:none;font-weight:900;font-size:clamp(22px,4vw,34px);letter-spacing:.04em;color:#fff;padding:26px 20px;border-radius:14px;background:linear-gradient(90deg,#ff3b5c,#b98bff,#36e6ff);box-shadow:0 0 50px #b98bff55,0 10px 30px #ff3b5c33;transition:transform .1s,box-shadow .1s}
.enter-cta:hover{transform:translateY(-2px) scale(1.01);box-shadow:0 0 70px #b98bff77,0 14px 40px #ff3b5c44}
h2{font-size:12px;letter-spacing:.28em;text-transform:uppercase;color:var(--mut);margin:38px 0 12px;font-weight:600}
table{width:100%;border-collapse:collapse;font-size:13.5px}
th{text-align:right;color:var(--mut);font-weight:600;font-size:11px;letter-spacing:.06em;text-transform:uppercase;padding:0 10px 8px;border-bottom:1px solid var(--line)}
th:nth-child(2),td:nth-child(2){text-align:left}
td{padding:11px 10px;border-bottom:1px solid #11152a;text-align:right;vertical-align:middle}
tr:hover td{background:#0b0e1c}
.rank{color:var(--mut)}
.name{color:var(--fg);font-weight:600}
.thesis{display:block;color:var(--mut);font-size:11px;font-weight:400;margin-top:2px;max-width:380px}
.elo{color:var(--cy);font-weight:700}
.pos{color:var(--gr)}.neg{color:var(--rd)}.zero{color:var(--mut)}
.rec{color:var(--mut);font-size:12px}
.cal{margin:6px 0 2px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:14px}
.card{border:1px solid var(--line);background:var(--panel);border-radius:10px;padding:12px}
.card .cn{font-weight:700;font-size:13px}.card .ce{color:var(--cy);font-size:12px}
.log{font-size:12.5px}
.log td{padding:8px 10px}
.tk{color:var(--pu);font-weight:600}
.up{color:var(--gr)}.dn{color:var(--rd)}
.foot{margin-top:46px;padding-top:18px;border-top:1px solid var(--line);color:var(--mut);font-size:12px}
.foot a{color:var(--cy)}
.pill{display:inline-block;padding:2px 8px;border:1px solid var(--line);border-radius:999px;font-size:11px;color:var(--mut);margin-right:6px}
</style>
</head>
<body>
<div id="backdrop"><i class="img"></i><i class="tint"></i></div>
<div class="wrap">
  <div class="brand">◇ SOAG · Agent Arena</div>
  <h1>Who actually predicts.</h1>
  <p class="tag">Agents make timestamped, auto-resolving forecasts on real tokens. Ranked by <b style="color:var(--fg)">calibration, not returns</b>.</p>
  <p class="sub">${board.totalClaims} resolved 24h claims · ${board.tokens.map(esc).join(" · ")} · ${esc(date)}</p>
  <p style="margin:22px 0 4px"><a href="./battle.html" class="enter-cta">⚔ ENTER THE BATTLE ARENA →</a></p>

  <div class="verdict ${verdict.edge ? "v-edge" : "v-noedge"}">
    <div class="vlabel">${verdict.edge ? "◆ EDGE DETECTED" : "○ NO EDGE DETECTED"}</div>
    <div class="vtext">${verdict.text}</div>
  </div>

  <div class="banner">
    <b>How to read this.</b> Each agent states a probability that a token will be up 24h later. When the
    24h is up, a price feed settles it — no human judgment. We score how well-calibrated those probabilities
    are: a <b>Brier score</b> of <b>0.25 = a coin flip</b>, lower is better, and <b>skill</b> is how far an
    agent beats that baseline. Positive skill = real edge. Negative = worse than guessing. The leaderboard
    is sorted by <b>ELO</b> from head-to-head duels: on every claim, the agent with the sharper call beats
    the others. This is a falsification harness first — if nobody beats the baseline, the board says so.
  </div>

  <h2>Leaderboard</h2>
  <table>
    <thead><tr><th>#</th><th>Agent</th><th>ELO</th><th>Brier</th><th>Skill</th><th>Log-loss</th><th>Duels</th><th>Calibration</th></tr></thead>
    <tbody>
      ${board.leaderboard.map((r, i) => row(r, i)).join("\n      ")}
    </tbody>
  </table>

  <h2>Calibration — does 70% mean 70%?</h2>
  <p class="sub" style="margin:-4px 0 14px">Each curve plots stated probability (x) against what actually happened (y). On the diagonal = honest. Above = under-confident, below = over-confident.</p>
  <div class="grid">
    ${board.leaderboard.map((r) => calCard(r)).join("\n    ")}
  </div>

  <h2>Recent resolved claims — verify any of them</h2>
  <table class="log">
    <thead><tr><th>Token</th><th>Opened</th><th>24h move</th><th>Outcome</th><th>${board.leaderboard.slice(0, 3).map((r) => esc(r.name)).join("</th><th>")}</th></tr></thead>
    <tbody>
      ${board.claimsLog.map((c) => logRow(c, board.leaderboard.slice(0, 3))).join("\n      ")}
    </tbody>
  </table>

  <h2>Bring your own agent</h2>
  <div class="banner" style="border-left-color:var(--cy)">
    An agent is just a function: it sees recent price history and returns one number, its probability that the
    token goes up. That's it. <b>Beat ZERO</b> (the coin-flipper at skill 0.000) across a few hundred real
    claims and you've shown something almost nobody has: provable, timestamped, un-cherry-picked edge.
    <pre style="margin:10px 0 0;color:#9fb0e6;font-size:12px;overflow:auto">{ id: "my-agent", name: "MINE",
  predict: (ctx) =&gt; /* ctx.returns = recent % moves */  0.5 }</pre>
  </div>

  <div class="foot">
    <p><span class="pill">paper</span><span class="pill">no money</span><span class="pill">no betting yet</span>
    This is a benchmark, not a casino. Forecasts are scored, not staked. The agents shown are baseline
    forecasting strategies (momentum, mean-reversion, trend, plus calibration archetypes) run on real price
    history — the harness for plugging in the live SOAG grid agents next.</p>
    <p>Prices: ${esc(source)} (public, no key). Every claim above settles from the same data you can pull
    yourself. Built with Claude Code. <a href="https://agentsoag.com">agentsoag.com</a></p>
  </div>
</div>
</body>
</html>`;
}

function row(r, i) {
  return `<tr>
        <td class="rank">${i + 1}</td>
        <td><span class="name">${esc(r.name)}</span><span class="thesis">${esc(r.thesis)}</span></td>
        <td class="elo">${r.elo}</td>
        <td>${r.brier ?? "—"}</td>
        <td class="${cls(r.skill)}">${fmtSkill(r.skill)}</td>
        <td>${r.logLoss ?? "—"}</td>
        <td class="rec">${r.record.w}–${r.record.l}</td>
        <td>${calBar(r.calibration)}</td>
      </tr>`;
}

function logRow(c, top3) {
  const moved = c.pct >= 0 ? "up" : "dn";
  const out = c.outcome ? '<span class="up">▲ up</span>' : '<span class="dn">▼ down</span>';
  const cells = top3.map((r) => callCell(c.calls[r.id], c.outcome)).join("");
  return `<tr>
        <td class="tk">${esc(c.token)}</td>
        <td class="rec">${new Date(c.openTs).toISOString().slice(5, 16).replace("T", " ")}</td>
        <td class="${moved}">${c.pct >= 0 ? "+" : ""}${c.pct}%</td>
        <td>${out}</td>${cells}
      </tr>`;
}

// A forecast cell: shows the agent's stated p(up), tinted by whether it leaned
// the right way. p>0.5 means it predicted up.
function callCell(p, outcome) {
  if (p == null) return "<td>—</td>";
  const leanUp = p > 0.5;
  const right = (leanUp && outcome === 1) || (!leanUp && outcome === 0) || p === 0.5;
  const c = p === 0.5 ? "zero" : right ? "pos" : "neg";
  return `<td class="${c}">${p.toFixed(2)}</td>`;
}

// Tiny reliability diagram as inline SVG.
function calCard(r) {
  return `<div class="card">
      <div class="cn">${esc(r.name)} <span class="ce">${r.elo}</span></div>
      <div class="cal">${reliabilitySvg(r.calibration)}</div>
      <div class="sub">skill <span class="${cls(r.skill)}">${fmtSkill(r.skill)}</span> · ece ${r.ece ?? "—"}</div>
    </div>`;
}

function reliabilitySvg(bins) {
  const W = 126, H = 126, P = 6;
  const sx = (x) => P + x * (W - 2 * P);
  const sy = (y) => H - P - y * (H - 2 * P);
  const pts = bins.filter((b) => b.hitRate != null).map((b) => [sx(b.mid), sy(b.hitRate), b.n]);
  const dots = pts
    .map(([x, y, n]) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${Math.min(5, 1.6 + Math.sqrt(n) / 3).toFixed(1)}" fill="#36e6ff" opacity="0.85"/>`)
    .join("");
  const line = pts.length > 1 ? `<polyline points="${pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ")}" fill="none" stroke="#b98bff" stroke-width="1.4" opacity="0.7"/>` : "";
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
      <rect x="${P}" y="${P}" width="${W - 2 * P}" height="${H - 2 * P}" fill="#0a0d1a" stroke="#1c2238"/>
      <line x1="${sx(0)}" y1="${sy(0)}" x2="${sx(1)}" y2="${sy(1)}" stroke="#2a3252" stroke-dasharray="3 3"/>
      ${line}${dots}
    </svg>`;
}

function calBar(bins) {
  // compact horizontal calibration glyph for the table
  return `<svg width="120" height="20" viewBox="0 0 120 20">${bins
    .map((b, i) => {
      if (b.hitRate == null) return "";
      const x = 4 + i * 11.5;
      const h = Math.max(1, b.hitRate * 16);
      return `<rect x="${x}" y="${(18 - h).toFixed(1)}" width="8" height="${h.toFixed(1)}" fill="#36e6ff" opacity="${(0.3 + Math.min(0.7, b.n / 40)).toFixed(2)}"/>`;
    })
    .join("")}</svg>`;
}

// Honest headline. "Edge" requires a meaningfully positive skill score, not just
// the luck of topping the ELO ladder. The bar (+0.02 Brier skill) is low but
// real; noise-level skill (~0) reads as no edge, which is usually the truth.
function makeVerdict(board) {
  const best = board.leaderboard.reduce((a, r) => ((r.skill ?? -1) > (a.skill ?? -1) ? r : a));
  const flip = board.leaderboard.find((r) => r.id === "coinflip");
  const beatsFlip = board.leaderboard.filter((r) => r.skill != null && r.skill > 0.02);
  if (best.skill != null && best.skill > 0.02) {
    return {
      edge: true,
      text: `<b>${esc(best.name)}</b> beats the coin-flip baseline with skill <b>${fmtSkill(best.skill)}</b> across ${board.totalClaims} resolved claims. ${beatsFlip.length} agent${beatsFlip.length === 1 ? "" : "s"} clear the line. This is real, timestamped, auto-settled edge, the kind you can't fake.`,
    };
  }
  return {
    edge: false,
    text: `Across ${board.totalClaims} real, auto-settled claims, <b>no agent meaningfully beats a coin flip</b> (best skill ${fmtSkill(best.skill)}; ${flip ? `the actual coin-flipper sits mid-pack at rank ${board.leaderboard.indexOf(flip) + 1}` : "the baseline holds"}). That's the point: most "alpha" on short-horizon price direction is noise. The leaderboard rankings here are within that noise. Bring an agent that actually clears the line.`,
  };
}

function cls(skill) {
  if (skill == null || Math.abs(skill) < 0.001) return "zero";
  return skill > 0 ? "pos" : "neg";
}
function fmtSkill(s) {
  if (s == null) return "—";
  return (s >= 0 ? "+" : "") + s.toFixed(3);
}
