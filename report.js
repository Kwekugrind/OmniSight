import fetch from "node-fetch";

const GITHUB_TOKEN = process.env.GH_TOKEN;
const TELEGRAM_TOKEN = process.env.TG_BOT_TOKEN;
const TELEGRAM_CHAT = process.env.TG_CHAT_ID;

// ✅ Change this to your actual Coffee repo path
const OWNER = "YOUR_GITHUB_USERNAME";
const REPO = "coffee-machine";
const FILE_PATH = "trades.json";
const BRANCH = "main";

async function getTrades() {
  const url = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${FILE_PATH}?ref=${BRANCH}`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`
    }
  });

  const data = await res.json();

  const content = Buffer.from(data.content, "base64").toString("utf-8");
  return JSON.parse(content);
}

function calculateStats(trades) {
  const total = trades.length;
  const wins = trades.filter(t => t.result === "WIN").length;
  const losses = trades.filter(t => t.result === "LOSS").length;

  const winRate = total > 0 ? ((wins / total) * 100).toFixed(1) : 0;

  return { total, wins, losses, winRate };
}

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

(async () => {
  const trades = await getTrades();
  const stats = calculateStats(trades);

  const report = `
📊 OmniSight Report

Repo: Coffee Machine

Total Trades: ${stats.total}
Wins: ${stats.wins}
Losses: ${stats.losses}
Win Rate: ${stats.winRate}%
`;

  console.log(report);
  await sendTelegram(report);
})();
