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
  { name: "tea-machine", label: "Tea Machine" },
  { name: "milk-machine", label: "Milk Machine" },
  { name: "ice-cream-machine", label: "Ice Cream Machine" },
  { name: "lerys-elite-alerts", label: "Lery's Elite Alerts" }
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

  if (res.status !== 200) return null;

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
        const price = parseFloat(response.history.prices[0]);
        resolve(price);
        ws.close();
      }

      if (response.error) {
        reject(response.error.message);
        ws.close();
      }
    });

    ws.on("error", (err) => {
      reject(err);
      ws.close();
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

/* ---------------- SCAN MODE ---------------- */

async function runScanner() {

  for (const repo of REPOS) {

    const file = await getFile(repo.name);
    if (!file) continue;

    let trades = file.data;
    let updated = false;

    for (let trade of trades) {

      if (trade.result === null) {

        const currentPrice = await getCurrentPrice(trade.symbol);

        console.log(`Checking ${repo.label}`);
        console.log(`Current Price: ${currentPrice}`);
        console.log(`TP: ${trade.tp} | SL: ${trade.stop}`);

        if (trade.direction === "BUY") {

          if (currentPrice >= trade.tp) {

            trade.result = "WIN";
            trade.closeTime = new Date().toISOString();
            updated = true;

            const message = `
✅ ${repo.label} WIN

Symbol: ${trade.symbol}
Direction: BUY
Entry: ${trade.entry}
Stop: ${trade.stop}
TP: ${trade.tp}
RR: +${trade.rr}R

Signal Time: ${trade.openTime}
Close Time: ${trade.closeTime}
`;

            await sendTelegram(message);
          }

          else if (currentPrice <= trade.stop) {

            trade.result = "LOSS";
            trade.closeTime = new Date().toISOString();
            updated = true;

            const message = `
❌ ${repo.label} LOSS

Symbol: ${trade.symbol}
Direction: BUY
Entry: ${trade.entry}
Stop: ${trade.stop}
TP: ${trade.tp}
RR: -1R

Signal Time: ${trade.openTime}
Close Time: ${trade.closeTime}
`;

            await sendTelegram(message);
          }
        }

        if (trade.direction === "SELL") {

          if (currentPrice <= trade.tp) {

            trade.result = "WIN";
            trade.closeTime = new Date().toISOString();
            updated = true;

            const message = `
✅ ${repo.label} WIN

Symbol: ${trade.symbol}
Direction: SELL
Entry: ${trade.entry}
Stop: ${trade.stop}
TP: ${trade.tp}
RR: +${trade.rr}R

Signal Time: ${trade.openTime}
Close Time: ${trade.closeTime}
`;

            await sendTelegram(message);
          }

          else if (currentPrice >= trade.stop) {

            trade.result = "LOSS";
            trade.closeTime = new Date().toISOString();
            updated = true;

            const message = `
❌ ${repo.label} LOSS

Symbol: ${trade.symbol}
Direction: SELL
Entry: ${trade.entry}
Stop: ${trade.stop}
TP: ${trade.tp}
RR: -1R

Signal Time: ${trade.openTime}
Close Time: ${trade.closeTime}
`;

            await sendTelegram(message);
          }
        }
      }
    }

    if (updated) {
      await updateFile(repo.name, trades, file.sha);
    }
  }
}

/* ---------------- MAIN ---------------- */

(async () => {

  console.log("MODE:", MODE);

  if (MODE === "scan") {
    await runScanner();
  }

})();