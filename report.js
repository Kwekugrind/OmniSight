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

/* ------------------------- FETCH TRADES ------------------------- */

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

/* ------------------------- TELEGRAM ------------------------- */

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

/* ------------------------- TRACKER MEMORY ------------------------- */

function loadTrackerState() {
  if (!fs.existsSync("tracker_state.json")) {
    return { processed: [] };
  }
  return JSON.parse(fs.readFileSync("tracker_state.json"));
}

function saveTrackerState(state) {
  fs.writeFileSync("tracker_state.json", JSON.stringify(state, null, 2));
}

/* ------------------------- SCAN MODE ------------------------- */

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

/* ------------------------- WEEKLY MODE ------------------------- */

async function runWeeklyReport() {

  let allTrades = [];

  for (const repo of REPOS) {
    const trades = await getTrades(repo.name);
    allTrades = allTrades.concat(trades);
  }

  const now = new Date();
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(now.getDate() - 7);

  const weeklyTrades = allTrades.filter(t =>
    t.result &&
    new Date(t.closeTime) >= sevenDaysAgo
  );

  const wins = weeklyTrades.filter(t => t.result === "WIN").length;
  const losses = weeklyTrades.filter(t => t.result === "LOSS").length;
  const total = weeklyTrades.length;
  const winRate = total > 0 ? ((wins / total) * 100).toFixed(1) : 0;

  const message = `
📊 OmniSight Weekly Report

Total Trades: ${total}
Wins: ${wins}
Losses: ${losses}
Win Rate: ${winRate}%
`;

  await sendTelegram(message);
}

/* ------------------------- MONTHLY MODE ------------------------- */

async function runMonthlyReport() {

  let allTrades = [];

  for (const repo of REPOS) {
    const trades = await getTrades(repo.name);
    allTrades = allTrades.concat(trades);
  }

  const now = new Date();
  const monthAgo = new Date();
  monthAgo.setMonth(now.getMonth() - 1);

  const monthlyTrades = allTrades.filter(t =>
    t.result &&
    new Date(t.closeTime) >= monthAgo
  );

  const wins = monthlyTrades.filter(t => t.result === "WIN").length;
  const losses = monthlyTrades.filter(t => t.result === "LOSS").length;
  const total = monthlyTrades.length;
  const winRate = total > 0 ? ((wins / total) * 100).toFixed(1) : 0;

  const message = `
📊 OmniSight Monthly Report

Total Trades: ${total}
Wins: ${wins}
Losses: ${losses}
Win Rate: ${winRate}%
`;

  await sendTelegram(message);
}

/* ------------------------- MAIN ------------------------- */

(async () => {

  console.log("Running mode:", MODE);

  if (MODE === "scan") {
    await runScanner();
  } else if (MODE === "weekly") {
    await runWeeklyReport();
  } else if (MODE === "monthly") {
    await runMonthlyReport();
  }

  console.log("✅ OmniSight complete.");

})();
