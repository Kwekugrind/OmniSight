async function runScanner() {

  for (const repo of REPOS) {

    const file = await getFile(repo.name);
    if (!file) continue;

    let trades = file.data;
    let updated = false;

    for (let trade of trades) {

      if (trade.result === null) {

        const currentPrice = await getCurrentPrice(trade.symbol);

        if (trade.direction === "BUY") {

          if (currentPrice >= trade.tp) {
            trade.result = "WIN";
            trade.closeTime = new Date().toISOString();
            updated = true;

            const message = `
✅ ${repo.label} WIN

Symbol: ${trade.symbol}
Direction: ${trade.direction}
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
Direction: ${trade.direction}
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
Direction: ${trade.direction}
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
Direction: ${trade.direction}
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