import fetch from "node-fetch";
import fs from "fs";

const GITHUB_TOKEN = process.env.GH_TOKEN;
const TELEGRAM_TOKEN = process.env.TG_BOT_TOKEN;
const TELEGRAM_CHAT = process.env.TG_CHAT_ID;
const MODE = process.env.MODE || "scan";

const OWNER = "Kwekugrind";

const REPOS = [
  { name: "coffee", label: "Coffee Machine" },
  { name: "tea-machine", label: "Tea Machine" },
  { name: "milk-machine", label: "Milk Machine" },
  { name: "ice-cream-machine", label: "Ice Cream Machine" },
  { name: "lerys-elite-alerts", label: "Lery's Elite Alerts" }
];

const FILE_PATH = "trades.json";
const BRANCH = "main";

/* ---------------- FETCH TRADES ---------------- */

async function getTrades(repo) {
  const url = `https://api.github.com/repos/${OWNER}/${repo}/contents/${FILE_PATH}?ref=${BRANCH}`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json"
    }
  });

  if (res.status !== 200) return [];

  const data = await res.json();
  const content = Buffer.from(data.content, "base64").toString("utf-8");

  return JSON.parse(content);
}

/* ---------------- TELEGRAM ---------------- */

async function sendTelegram(message) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT,
      text: message
    })
  });
}

/* ---------------- TRACKER MEMORY ---------------- */

function loadTrackerState() {
  if (!fs.existsSync("tracker_state.json")) {
    return { processed: [] };
  }
  return JSON.parse(fs.readFileSync("tracker_state.json"));
}

function saveTrackerState(state) {
  fs.writeFileSync("tracker_state.json", JSON.stringify(state, null, 2));
}

/* ---------------- SCAN MODE ---------------- */

async function runScanner() {
  const tracker = loadTrackerState();

  for (const repo of REPOS) {
    const trades = await getTrades(repo.name);

    for (const trade of trades) {
      const tradeId = `${repo.name}-${trade.openTime}`;

      if (!tracker.processed.includes(tradeId)) {
        if (trade.result === "WIN" || trade.result === "LOSS") {

          const message = `
📊 ${repo.label}

${trade.result === "WIN" ? "✅ WIN" : "❌ LOSS"}

Symbol: ${trade.symbol}
Direction: ${trade.direction}
RR: ${trade.result === "WIN" ? "+" + trade.rr : "-1"}
`;

          await sendTelegram(message);
          tracker.processed.push(tradeId);
        }
      }
    }
  }

  saveTrackerState(tracker);
}

/* ---------------- GENERIC SUMMARY FUNCTION ---------------- */

async function runSummary(daysBack, title) {

  let reportText = `📊 OmniSight ${title}\n\n`;

  const now = new Date();
  const cutoff = new Date();
  cutoff.setDate(now.getDate() - daysBack);

  let repoStats = [];
  let totalWins = 0;
  let totalLosses = 0;
  let totalTrades = 0;
  let netR = 0;

  for (const repo of REPOS) {

    const trades = await getTrades(repo.name);

    const periodTrades = trades.filter(t =>
      t.result &&
      new Date(t.closeTime) >= cutoff
    );

    const wins = periodTrades.filter(t => t.result === "WIN").length;
    const losses = periodTrades.filter(t => t.result === "LOSS").length;
    const repoTotal = periodTrades.length;

    const repoNetR =
      periodTrades.reduce((sum, t) =>
        sum + (t.result === "WIN" ? t.rr : -1), 0);

    if (repoTotal > 0) {
      repoStats.push({
        name: repo.label,
        total: repoTotal,
        wins,
        losses,
        netR: repoNetR
      });
    }

    totalWins += wins;
    totalLosses += losses;
    totalTrades += repoTotal;
    netR += repoNetR;
  }

  repoStats.sort((a, b) => b.netR - a.netR);

  repoStats.forEach(r => {
    const winRate = ((r.wins / r.total) * 100).toFixed(1);
    reportText += `
${r.name}
Trades: ${r.total}
Wins: ${r.wins}
Losses: ${r.losses}
Win Rate: ${winRate}%
Net R: ${r.netR > 0 ? "+" : ""}${r.netR}R

`;
  });

  const overallWinRate =
    totalTrades > 0 ? ((totalWins / totalTrades) * 100).toFixed(1) : 0;

  reportText += `
──────────────
Combined Portfolio

Trades: ${totalTrades}
Wins: ${totalWins}
Losses: ${totalLosses}
Win Rate: ${overallWinRate}%
Net R: ${netR > 0 ? "+" : ""}${netR}R
`;

  if (repoStats.length > 0) {
    reportText += `
🏆 Best: ${repoStats[0].name}
📉 Worst: ${repoStats[repoStats.length - 1].name}
`;
  }

  await sendTelegram(reportText);
}

/* ---------------- MAIN ---------------- */

(async () => {

  console.log("Running mode:", MODE);

  if (MODE === "scan") {
    await runScanner();
  }

  else if (MODE === "weekly") {
    await runSummary(7, "Weekly Report");
  }

  else if (MODE === "monthly") {
    await runSummary(30, "Monthly Report");
  }

  console.log("✅ OmniSight complete.");

})();
