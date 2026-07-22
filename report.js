import fetch from "node-fetch";
import fs from "fs";
import WebSocket from "ws";

const GITHUB_TOKEN = process.env.GH_TOKEN;
const TELEGRAM_TOKEN = process.env.TG_BOT_TOKEN;
const TELEGRAM_CHAT = process.env.TG_CHAT_ID;
const MODE = process.env.MODE && process.env.MODE.trim() !== "" ? process.env.MODE.trim() : "scan";

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

function getSymbolDisplay(symbol) {
  switch (symbol) {
    case "R_10": return "📊 VOLATILITY 10";
    case "R_25": return "📊 VOLATILITY 25";
    case "R_50": return "📊 VOLATILITY 50";
    case "R_75": return "📊 VOLATILITY 75";
    case "stpRNG": return "📊 STEP INDEX";
    default: return symbol;
  }
}

function loadTrackerState() {
  if (!fs.existsSync("tracker_state.json")) {
    return { processed: [], counter: 1 };
  }
  const state = JSON.parse(fs.readFileSync("tracker_state.json"));
  if (!state.processed) state.processed = [];
  if (!state.counter) state.counter = 1;
  return state;
}

function saveTrackerState(state) {
  state.processed = state.processed.filter(id => id !== null);
  fs.writeFileSync("tracker_state.json", JSON.stringify(state, null, 2));
}

async function getFile(repo) {
  const url = `https://api.github.com/repos/${OWNER}/${repo}/contents/${FILE_PATH}?ref=${BRANCH}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: "application/vnd.github+json" }
  });
  if (res.status !== 200) return null;
  const data = await res.json();
  const content = Buffer.from(data.content, "base64").toString("utf-8");
  return { data: JSON.parse(content), sha: data.sha };
}

async function updateFile(repo, content) {
  const fresh = await getFile(repo);
  if (!fresh) return false;
  const url = `https://api.github.com/repos/${OWNER}/${repo}/contents/${FILE_PATH}`;
  const res = await fetch(url, {
    method: "PUT",
    headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: "application/vnd.github+json" },
    body: JSON.stringify({
      message: "OmniSight: Close trade on MACD Warning (SL hit)",
      content: Buffer.from(JSON.stringify(content, null, 2)).toString("base64"),
      sha: fresh.sha,
      branch: BRANCH
    })
  });
  return res.status === 200 || res.status === 201;
}

async function getCurrentPrice(symbol) {
  const ws = new WebSocket("wss://ws.binaryws.com/websockets/v3?app_id=1089");
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { ws.terminate(); reject("Timeout"); }, 10000);
    ws.on("open", () => { ws.send(JSON.stringify({ ticks_history: symbol, count: 1, end: "latest" })); });
    ws.on("message", (data) => {
      const response = JSON.parse(data);
      if (response.history && response.history.prices) {
        clearTimeout(timeout);
        resolve(parseFloat(response.history.prices[0]));
        ws.close();
      }
    });
    ws.on("error", (e) => { clearTimeout(timeout); reject(e); });
  });
}

async function getM5MACD(symbol) {
  const ws = new WebSocket("wss://ws.binaryws.com/websockets/v3?app_id=1089");
  return new Promise((resolve, reject) => {
    ws.on("open", () => { ws.send(JSON.stringify({ ticks_history: symbol, count: 200, granularity: 300, end: "latest", style: "candles" })); });
    ws.on("message", (data) => {
      const response = JSON.parse(data);
      if (response.candles) {
        const closes = response.candles.map(c => parseFloat(c.close));
        const ema = (d, l) => {
          let k = 2 / (l + 1), r = [d[0]];
          for (let i = 1; i < d.length; i++) r[i] = d[i] * k + r[i - 1] * (1 - k);
          return r;
        };
        const macd = ema(closes, 4)[closes.length - 2] - ema(closes, 34)[closes.length - 2];
        resolve(macd);
        ws.close();
      }
    });
    ws.on("error", reject);
  });
}

async function sendTelegram(message) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT, text: message })
  });
}

async function runScanner() {
  const tracker = loadTrackerState();
  for (const repo of REPOS) {
    const file = await getFile(repo.name);
    if (!file) continue;
    let trades = file.data;
    let updated = false;

    for (let trade of trades) {
      if (trade.result !== null) continue;

      // 1. OmniSight MACD Warning -> Treated as immediate Stop Loss (LOSS) & Closed
      if (trade.warningSentOmni !== true) {
        const macd = await getM5MACD(trade.symbol);
        const price = await getCurrentPrice(trade.symbol);
        
        if ((trade.direction === "BUY" && macd < 0) || (trade.direction === "SELL" && macd > 0)) {
          // Send warning/SL notice
          await sendTelegram(`⚠⚠⚠ [OmniSight SL HIT] CLOSE ${trade.direction} ${getSymbolDisplay(trade.symbol)} NOW\nEntry: ${trade.entry}\nExit Price: ${price}\nMACD is ${macd < 0 ? 'Negative' : 'Positive'}\nResult: STOP LOSS (1.0R Loss)`);
          
          // Immediately close the trade as a LOSS
          trade.warningSentOmni = true;
          trade.result = "LOSS";
          trade.closeTime = new Date().toISOString();
          
          const num = tracker.counter++;
          const tradeIdentifier = trade.id || `${trade.symbol}-${trade.openTime}`;
          if (!tracker.processed.includes(tradeIdentifier)) {
            tracker.processed.push(tradeIdentifier);
          }
          
          updated = true;
        }
      }

      // 2. Standard TP/SL Resolution Check (if warning didn't trigger it yet)
      if (trade.result === null) {
        const tradeIdentifier = trade.id || `${trade.symbol}-${trade.openTime}`;
        if (!tracker.processed.includes(tradeIdentifier)) {
          const price = await getCurrentPrice(trade.symbol);
          if (trade.direction === "BUY") {
            if (price >= trade.tp) trade.result = "WIN";
            else if (price <= trade.stop) trade.result = "LOSS";
          } else {
            if (price <= trade.tp) trade.result = "WIN";
            else if (price >= trade.stop) trade.result = "LOSS";
          }

          if (trade.result) {
            trade.closeTime = new Date().toISOString();
            const num = tracker.counter++;
            await sendTelegram(`${trade.result === "WIN" ? "✅" : "❌"} Trade #${num}\nRepo: ${repo.label}\nSymbol: ${getSymbolDisplay(trade.symbol)}\nResult: ${trade.result}\nRR: ${trade.result === "WIN" ? "+" + trade.rr : "-1"}R`);
            tracker.processed.push(tradeIdentifier);
            updated = true;
          }
        }
      }

      if (updated) break;
    }

    if (updated) {
      const success = await updateFile(repo.name, trades);
      if (success) {
        console.log(`Successfully closed trade and committed state for ${repo.name}`);
      } else {
        console.error(`Failed to commit trade closure for ${repo.name}`);
      }
    }
  }
  saveTrackerState(tracker);
}

async function runSummary(daysBack, title) {
  let reportText = `📊 OmniSight ${title}\n\n`;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysBack);
  let totals = { trades: 0, wins: 0, losses: 0, netR: 0 };

  for (const repo of REPOS) {
    const file = await getFile(repo.name);
    if (!file) continue;
    const periodTrades = file.data.filter(t => t.result && t.result !== "CANCELLED" && new Date(t.closeTime) >= cutoff);
    if (periodTrades.length > 0) {
      const wins = periodTrades.filter(t => t.result === "WIN").length;
      const losses = periodTrades.filter(t => t.result === "LOSS").length;
      const netR = periodTrades.reduce((s, t) => s + (t.result === "WIN" ? t.rr : -1), 0);
      reportText += `${repo.label}\nTrades: ${periodTrades.length}\nWins: ${wins} | Losses: ${losses}\nNet R: ${netR.toFixed(1)}R\n\n`;
      totals.trades += periodTrades.length; totals.wins += wins; totals.losses += losses; totals.netR += netR;
    }
  }
  const winRate = totals.trades > 0 ? ((totals.wins / totals.trades) * 100).toFixed(1) : 0;
  reportText += `──────────────\n📈 Combined Portfolio\nTrades: ${totals.trades}\nWin Rate: ${winRate}%\nNet R: ${totals.netR.toFixed(1)}R`;
  await sendTelegram(reportText);
}

(async () => {
  console.log("MODE:", MODE);
  if (MODE === "scan") await runScanner();
  else if (MODE === "weekly") await runSummary(7, "Weekly Report");
  else if (MODE === "monthly") await runSummary(30, "Monthly Report");
})();
