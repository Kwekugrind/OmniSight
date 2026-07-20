import fetch from "node-fetch";
import fs from "fs";
import WebSocket from "ws";

const GITHUB_TOKEN = process.env.GH_TOKEN;
const TELEGRAM_TOKEN = process.env.TG_BOT_TOKEN;
const TELEGRAM_CHAT = process.env.TG_CHAT_ID;
const MODE = process.env.MODE || "scan";

const OWNER = "Kwekugrind";

const REPOS = [
  { name: "coffee", label: "Coffee Machine" },
  { name: "Tea", label: "Tea Machine" },
  { name: "Milk", label: "Milk Machine" },
  { name: "ice-cream", label: "Ice Cream Machine" },
  { name: "Lery-s-Alerts", label: "Lery's Elite Alerts" }
];

const FILE_PATH = "trades.json";
const BRANCH = "main";

/* ---------------- FETCH FILE ---------------- */

async function getFile(repo) {
  const url = `https://api.github.com/repos/${OWNER}/${repo}/contents/${FILE_PATH}?ref=${BRANCH}`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json"
    }
  });

  if (res.status !== 200) {
    console.log(`Could not read trades.json from ${repo} (status ${res.status})`);
    return null;
  }

  const data = await res.json();
  const content = Buffer.from(data.content, "base64").toString("utf-8");

  return { data: JSON.parse(content), sha: data.sha };
}

/* ---------------- UPDATE FILE ---------------- */

async function updateFile(repo, content, sha) {
  const url = `https://api.github.com/repos/${OWNER}/${repo}/contents/${FILE_PATH}`;

  await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json"
    },
    body: JSON.stringify({
      message: "Update trade results",
      content: Buffer.from(JSON.stringify(content, null, 2)).toString("base64"),
      sha: sha,
      branch: BRANCH
    })
  });
}

/* ---------------- GET CURRENT PRICE ---------------- */

async function getCurrentPrice(symbol) {

  const ws = new WebSocket("wss://ws.binaryws.com/websockets/v3?app_id=1089");

  return new Promise((resolve, reject) => {

    const timeout = setTimeout(() => {
      ws.terminate();
      reject("Price fetch timeout");
    }, 10000);

    ws.on("open", () => {
      ws.send(JSON.stringify({
        ticks_history: symbol,
        count: 1,
        end: "latest"
      }));
    });

    ws.on("message", (data) => {
      const response = JSON.parse(data);

      if (response.history && response.history.prices) {
        clearTimeout(timeout);
        const price = parseFloat(response.history.prices[0]);
        ws.close();
        resolve(price);
      }

      if (response.error) {
        clearTimeout(timeout);
        ws.close();
        reject(response.error.message);
      }
    });

    ws.on("error", (err) => {
      clearTimeout(timeout);
      ws.close();
      reject(err);
    });
  });
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

/* ---------------- SCAN MODE (DUPLICATE-PROOF) ---------------- */

async function runScanner() {

  for (const repo of REPOS) {

    console.log(`Checking ${repo.label}`);

    const file = await getFile(repo.name);
    if (!file) continue;

    let trades = file.data;

    for (let i = 0; i < trades.length; i++) {

      let trade = trades[i];

      // ✅ Skip already resolved trades
      if (trade.result !== null) continue;

      const currentPrice = await getCurrentPrice(trade.symbol);

      console.log(`Current Price: ${currentPrice}`);
      console.log(`TP: ${trade.tp} | SL: ${trade.stop}`);

      let resolved = false;

      if (trade.direction === "BUY") {

        if (currentPrice >= trade.tp) {
          trade.result = "WIN";
          resolved = true;
        }

        else if (currentPrice <= trade.stop) {
          trade.result = "LOSS";
          resolved = true;
        }
      }

      if (trade.direction === "SELL") {

        if (currentPrice <= trade.tp) {
          trade.result = "WIN";
          resolved = true;
        }

        else if (currentPrice >= trade.stop) {
          trade.result = "LOSS";
          resolved = true;
        }
      }

      if (resolved) {

        trade.closeTime = new Date().toISOString();

        await updateFile(repo.name, trades, file.sha);

        await sendTelegram(`
${trade.result === "WIN" ? "✅" : "❌"} ${repo.label} ${trade.result}

Symbol: ${trade.symbol}
Direction: ${trade.direction}
Entry: ${trade.entry}
Stop: ${trade.stop}
TP: ${trade.tp}
RR: ${trade.result === "WIN" ? "+" + trade.rr : "-1"}R

Signal Time: ${trade.openTime}
Close Time: ${trade.closeTime}
`);

        // ✅ Stop processing this repo after first update
        break;
      }
    }
  }
}

/* ---------------- WEEKLY & MONTHLY SUMMARY ---------------- */

async function runSummary(daysBack, title) {

  let reportText = `📊 OmniSight ${title}\n\n`;

  const now = new Date();
  const cutoff = new Date();
  cutoff.setDate(now.getDate() - daysBack);

  let totalWins = 0;
  let totalLosses = 0;
  let totalTrades = 0;
  let totalNetR = 0;

  for (const repo of REPOS) {

    const file = await getFile(repo.name);
    if (!file) continue;

    const trades = file.data;

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

      const winRate = ((wins / repoTotal) * 100).toFixed(1);

      reportText += `
${repo.label}
Trades: ${repoTotal}
Wins: ${wins}
Losses: ${losses}
Win Rate: ${winRate}%
Net R: ${repoNetR > 0 ? "+" : ""}${repoNetR}R

`;
    }

    totalWins += wins;
    totalLosses += losses;
    totalTrades += repoTotal;
    totalNetR += repoNetR;
  }

  const overallWinRate =
    totalTrades > 0 ? ((totalWins / totalTrades) * 100).toFixed(1) : 0;

  reportText += `
──────────────
Combined Portfolio

Trades: ${totalTrades}
Wins: ${totalWins}
Losses: ${totalLosses}
Win Rate: ${overallWinRate}%
Net R: ${totalNetR > 0 ? "+" : ""}${totalNetR}R
`;

  await sendTelegram(reportText);
}

/* ---------------- MAIN ---------------- */

(async () => {

  console.log("MODE:", MODE);

  if (MODE === "scan") {
    await runScanner();
  }

  else if (MODE === "weekly") {
    await runSummary(7, "Weekly Report");
  }

  else if (MODE === "monthly") {
    await runSummary(30, "Monthly Report");
  }

})();