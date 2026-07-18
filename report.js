import fetch from "node-fetch";
import fs from "fs";

const GITHUB_TOKEN = process.env.GH_TOKEN;
const TELEGRAM_TOKEN = process.env.TG_BOT_TOKEN;
const TELEGRAM_CHAT = process.env.TG_CHAT_ID;

const OWNER = "Kwekugrind";

const REPOS = [
  { name: "coffee-machine", label: "Coffee Machine" },
  { name: "tea-machine", label: "Tea Machine" },
  { name: "milk-machine", label: "Milk Machine" },
  { name: "ice-cream-machine", label: "Ice Cream Machine" },
  { name: "lerys-elite-alerts", label: "Lery's Elite Alerts" }
];

const FILE_PATH = "trades.json";
const BRANCH = "main";

async function getTrades(repo) {
  const url = `https://api.github.com/repos/${OWNER}/${repo}/contents/${FILE_PATH}?ref=${BRANCH}`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`
    }
  });

  if (res.status !== 200) return [];

  const data = await res.json();
  const content = Buffer.from(data.content, "base64").toString("utf-8");

  return JSON.parse(content);
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

function loadTrackerState() {
  if (!fs.existsSync("tracker_state.json")) {
    return { processed: [] };
  }
  return JSON.parse(fs.readFileSync("tracker_state.json"));
}

function saveTrackerState(state) {
  fs.writeFileSync("tracker_state.json", JSON.stringify(state, null, 2));
}

(async () => {
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

Opened: ${trade.openTime}
Closed: ${trade.closeTime}
`;

          await sendTelegram(message);

          tracker.processed.push(tradeId);
        }
      }
    }
  }

  saveTrackerState(tracker);
})();
