(function attachSignalPageComponent() {
  const STRATEGY_META = {
    SUPPORT: { label: "Support", className: "support" },
    EMA_RSI: { label: "EMA-RSI", className: "ema-rsi" },
    BREAKOUT: { label: "Breakout", className: "breakout" },
    PRO: { label: "Pro", className: "resistance" },
  };

  let activeChart = null;
  let activeChartContainer = null;
  let activeResizeHandler = null;

  function getStrategyMeta(strategyType) {
    return STRATEGY_META[String(strategyType || "").toUpperCase()] || { label: strategyType || "Signal", className: "support" };
  }

  function formatPair(pair) {
    const symbol = String(pair || "").toUpperCase();
    return symbol.endsWith("USDT") ? `${symbol.slice(0, -4)}/USDT` : symbol;
  }

  function formatTimestamp(value) {
    const date = new Date(Number(value || Date.now()));
    return date.toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function renderOpenTradeInvestmentBoard({
    trades = [],
    user = null,
    formatNumber,
    formatUsdtUnit,
    getTradePnlPercent,
    getTradeCurrentValue,
    getTradeEntryPrice,
    getTradeCurrentMarket,
    renderExchangeBadge,
    title = "Open Trades",
    description = "Select a trade to start P&L from the current market point.",
  }) {
    const openTrades = (trades || []).filter((trade) => ["OPEN", "PENDING"].includes(String(trade.lifecycleStatus || "").toUpperCase()));

    return `
      <section class="signal-board-card investment-board">
        <div class="signal-board-head">
          <div>
            <h4>${title}</h4>
            <p class="muted-copy">${description}</p>
          </div>
        </div>
        <div class="signal-list open-trade-investment-list">
          ${
            openTrades.length
              ? openTrades
                  .map((trade) => {
                    const pnlPercent = typeof getTradePnlPercent === "function" ? getTradePnlPercent(trade) : 0;
                    const currentValue = typeof getTradeCurrentValue === "function" ? getTradeCurrentValue(trade) : 0;
                    const entryPrice = typeof getTradeEntryPrice === "function" ? getTradeEntryPrice(trade) : Number(trade.price || 0);
                    const currentPrice = typeof getTradeCurrentMarket === "function" ? Number(getTradeCurrentMarket(trade.symbol)?.price || 0) : 0;
                    const investment = trade.userInvestment || null;
                    const isJoined = investment?.status === "ACTIVE";
                    const joinedDelta = isJoined ? pnlPercent - Number(investment.baselinePnlPercent || 0) : 0;
                    const joinedPnl = isJoined ? Number(investment.amountUsdt || 0) * (joinedDelta / 100) : 0;
                    return `
                      <div class="signal-list-row signal-open-trade-row">
                        <div class="signal-row-open signal-open-trade-main">
                          <div class="signal-list-main">
                            <div class="signal-row-top">
                              <strong>${formatPair(trade.symbol)}</strong>
                              <span class="signal-strategy-badge ${isJoined ? "support" : "breakout"}">${isJoined ? "Joined" : String(trade.lifecycleStatus || "Open")}</span>
                            </div>
                            <p class="muted-copy">${typeof renderExchangeBadge === "function" ? renderExchangeBadge(trade.exchange || "bybit") : ""}</p>
                            <p class="muted-copy">Entry ${entryPrice ? formatNumber(entryPrice, 8) : "Market"} | Current ${currentPrice ? formatNumber(currentPrice, 8) : "-"}</p>
                          </div>
                          <div class="signal-list-side">
                            <strong class="${pnlPercent >= 0 ? "positive" : "negative"}">${pnlPercent >= 0 ? "+" : ""}${formatNumber(pnlPercent, 2)}%</strong>
                            <p class="muted-copy">${isJoined ? `${formatUsdtUnit(investment.amountUsdt)} joined` : formatUsdtUnit(currentValue)}</p>
                            ${isJoined ? `<p class="${joinedPnl >= 0 ? "positive" : "negative"}">${joinedPnl >= 0 ? "+" : "-"}${formatUsdtUnit(Math.abs(joinedPnl))}</p>` : ""}
                          </div>
                        </div>
                        ${
                          user?.role === "user"
                            ? `
                              <div class="signal-invest-actions">
                                ${
                                  isJoined
                                    ? `<button class="mini-action danger" data-stop-trade-investment="${trade.id}" type="button">Stop</button>`
                                    : `<button class="mini-action" data-join-trade="${trade.id}" type="button">Join</button>`
                                }
                              </div>
                            `
                            : ""
                        }
                      </div>
                    `;
                  })
                  .join("")
              : `
                <div class="signal-empty-state">
                  <strong>No open trades</strong>
                  <p class="muted-copy">Open admin trades will appear here.</p>
                </div>
              `
          }
        </div>
      </section>
    `;
  }

  function renderSignalPage({
    signalFeed,
    trades = [],
    user = null,
    formatNumber,
    formatUsdtUnit,
    getTradePnlPercent,
    getTradeCurrentValue,
    getTradeEntryPrice,
    getTradeCurrentMarket,
    renderExchangeBadge,
  }) {
    const signals = signalFeed?.signals || [];
    const openTrades = (trades || []).filter((trade) => ["OPEN", "PENDING"].includes(String(trade.lifecycleStatus || "").toUpperCase()));
    const joinedTrades = openTrades.filter((trade) => trade.userInvestment?.status === "ACTIVE");
    const streamLabel = signalFeed?.streamConnected ? "Live" : "Reconnecting";
    const statusTone = signalFeed?.streamConnected ? "live" : "lagging";
    const selectedIds = signalFeed?.selectedIds || [];
    const deleting = !!signalFeed?.deleting;
    const switchingTimeframe = !!signalFeed?.switchingTimeframe;
    const allSelected = !!signals.length && selectedIds.length === signals.length;
    const supportedTimeframes = signalFeed?.supportedTimeframes?.length ? signalFeed.supportedTimeframes : ["15m"];

    return `
      <section class="signal-page-shell">
        <section class="signal-page-hero investment-signal-hero">
          <div>
            <p class="eyebrow">Trade Investments</p>
            <h3>Join open trades</h3>
            <p class="muted-copy">${user?.role === "user" ? "Deposits stay idle until you join a trade." : "Open admin trades available for users to join."}</p>
          </div>
          <div class="signal-hero-stack">
            <div class="signal-stream-pill ${statusTone}" id="signal-stream-pill">
              <span class="signal-stream-dot"></span>
              <strong id="signal-stream-label">${streamLabel}</strong>
              <span id="signal-stream-timeframe">${signalFeed?.timeframe || "15m"}</span>
            </div>
            <div class="signal-timeframe-toggle" role="group" aria-label="Signal timeframe">
              ${supportedTimeframes
                .map(
                  (timeframe) => `
                    <button
                      class="signal-timeframe-btn ${signalFeed?.timeframe === timeframe ? "active" : ""}"
                      type="button"
                      data-signal-timeframe="${timeframe}"
                      ${switchingTimeframe ? "disabled" : ""}
                    >
                      ${timeframe}
                    </button>
                  `
                )
                .join("")}
            </div>
            <button id="signal-alert-enable-btn" class="button-secondary signal-alert-btn" type="button">
              ${signalFeed?.audioEnabled ? "Sound on" : "Sound off"}
            </button>
          </div>
        </section>

        <section class="signal-page-toolbar">
          <div class="signal-toolbar-pill">
            <span>Open trades</span>
            <strong>${openTrades.length}</strong>
          </div>
          <div class="signal-toolbar-pill">
            <span>Joined</span>
            <strong>${joinedTrades.length}</strong>
          </div>
          <div class="signal-toolbar-pill">
            <span>Signals</span>
            <strong id="signal-recent-count">${signals.length}</strong>
          </div>
        </section>

        ${renderOpenTradeInvestmentBoard({
          trades,
          user,
          formatNumber,
          formatUsdtUnit,
          getTradePnlPercent,
          getTradeCurrentValue,
          getTradeEntryPrice,
          getTradeCurrentMarket,
          renderExchangeBadge,
        })}

        <section class="signal-board-card">
          <div class="signal-board-head">
            <div>
              <h4>Latest Signals</h4>
              <p class="muted-copy" id="signal-status-message">${signalFeed?.statusMessage || "Waiting for the next qualified setup."}</p>
            </div>
            <div class="signal-board-actions">
              <button class="text-link" id="signal-select-all-btn" type="button">${allSelected ? "Clear selection" : "Select all"}</button>
              <button class="mini-action danger" id="signal-delete-btn" type="button" ${selectedIds.length && !deleting ? "" : "disabled"}>
                ${deleting ? "Deleting..." : `Delete selected${selectedIds.length ? ` (${selectedIds.length})` : ""}`}
              </button>
            </div>
          </div>
          <div class="signal-list" id="signal-feed-list">
            ${
              signals.length
                ? signals
                    .map((signal) => {
                      const meta = getStrategyMeta(signal.strategyType);
                      return `
                        <div class="signal-list-row signal-pop-in">
                          <label class="signal-select-box" aria-label="Select ${formatPair(signal.pair)}">
                            <input type="checkbox" data-signal-select="${signal.id}" ${selectedIds.includes(signal.id) ? "checked" : ""} />
                            <span></span>
                          </label>
                          <button class="signal-row-open" data-open-signal="${signal.id}" type="button">
                            <div class="signal-list-main">
                              <div class="signal-row-top">
                                <strong>${formatPair(signal.pair)}</strong>
                                <span class="signal-strategy-badge ${meta.className}">${meta.label}</span>
                              </div>
                              <p class="muted-copy">Entry ${formatNumber(signal.entryPrice, 6)} | TP ${formatNumber(signal.takeProfit, 6)} | SL ${formatNumber(signal.stopLoss, 6)}</p>
                            </div>
                            <div class="signal-list-side">
                              <strong class="positive">BUY</strong>
                              <p class="muted-copy">${formatTimestamp(signal.timestamp)}</p>
                              <p class="signal-confidence">Confidence ${Math.round(Number(signal.confidence || 0))}%</p>
                            </div>
                          </button>
                        </div>
                      `;
                    })
                    .join("")
                : `
                  <div class="signal-empty-state">
                    <strong>No live BUY setups yet</strong>
                    <p class="muted-copy">Signals will appear here when Support, Breakout, EMA-RSI, or Pro conditions confirm on the selected timeframe.</p>
                  </div>
                `
            }
          </div>
        </section>
      </section>
    `;
  }

  function renderSignalChartModal({ signal, chartPayload, error, formatNumber }) {
    if (!signal) {
      return "";
    }

    const meta = getStrategyMeta(signal.strategyType);
    return `
      <div class="modal-backdrop">
        <div class="modal-card action-modal-card signal-modal-card">
          <button class="modal-close" id="action-modal-close-btn" type="button">x</button>
          <p class="modal-eyebrow neutral">${meta.label} signal</p>
          <h3>${formatPair(signal.pair)}</h3>
          <div class="signal-modal-grid">
            <div class="action-metric">
              <span>Entry</span>
              <strong>${formatNumber(signal.entryPrice, 6)}</strong>
            </div>
            <div class="action-metric">
              <span>Stop loss</span>
              <strong>${formatNumber(signal.stopLoss, 6)}</strong>
            </div>
            <div class="action-metric">
              <span>Take profit</span>
              <strong>${formatNumber(signal.takeProfit, 6)}</strong>
            </div>
            <div class="action-metric">
              <span>Confidence</span>
              <strong>${Math.round(Number(signal.confidence || 0))}%</strong>
            </div>
          </div>
          ${
            error
              ? `<p class="modal-text">${error}</p>`
              : `
                <div id="signal-chart-modal-host" class="signal-chart-modal-host">
                  ${chartPayload ? "" : `<p class="muted-copy">Loading live chart...</p>`}
                </div>
                <p class="modal-text">The chart plots the active timeframe with EMA overlays plus the entry, stop, and target for this BUY alert.</p>
              `
          }
        </div>
      </div>
    `;
  }

  function destroyActiveChart() {
    if (activeResizeHandler) {
      window.removeEventListener("resize", activeResizeHandler);
      activeResizeHandler = null;
    }
    if (activeChart) {
      activeChart.remove();
      activeChart = null;
    }
    activeChartContainer = null;
  }

  function mountSignalChart({ payload, theme }) {
    const container = document.getElementById("signal-chart-modal-host");
    const Charts = window.LightweightCharts;
    if (!container || !Charts || !payload) {
      return;
    }

    destroyActiveChart();
    activeChartContainer = container;
    container.innerHTML = "";

    const chart = Charts.createChart(container, {
      autoSize: true,
      height: 360,
      layout: {
        background: { color: theme === "dark" ? "#111926" : "#f7fbff" },
        textColor: theme === "dark" ? "#dfe7f7" : "#42506a",
      },
      grid: {
        vertLines: { color: theme === "dark" ? "rgba(255,255,255,0.06)" : "rgba(18,26,43,0.06)" },
        horzLines: { color: theme === "dark" ? "rgba(255,255,255,0.06)" : "rgba(18,26,43,0.06)" },
      },
      rightPriceScale: {
        borderColor: theme === "dark" ? "rgba(255,255,255,0.08)" : "rgba(18,26,43,0.08)",
      },
      timeScale: {
        borderColor: theme === "dark" ? "rgba(255,255,255,0.08)" : "rgba(18,26,43,0.08)",
        timeVisible: true,
      },
      crosshair: {
        mode: Charts.CrosshairMode.Normal,
      },
    });

    const candleSeries = chart.addSeries(Charts.CandlestickSeries, {
      upColor: "#16c47f",
      downColor: "#ff4d6d",
      borderUpColor: "#16c47f",
      borderDownColor: "#ff4d6d",
      wickUpColor: "#16c47f",
      wickDownColor: "#ff4d6d",
    });
    candleSeries.setData(payload.candles || []);

    const emaSeries = chart.addSeries(Charts.LineSeries, {
      color: "#6f5ef9",
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    emaSeries.setData(payload.ema20 || payload.ema50 || []);

    candleSeries.createPriceLine({
      price: Number(payload.entryPrice || 0),
      color: "#16c47f",
      lineWidth: 2,
      lineStyle: 2,
      axisLabelVisible: true,
      title: "Entry",
    });

    if (Number(payload.supportLevel || 0) > 0) {
      candleSeries.createPriceLine({
        price: Number(payload.supportLevel),
        color: "#2f7df6",
        lineWidth: 2,
        lineStyle: 1,
        axisLabelVisible: true,
        title: "Support",
      });
    }

    if (Number(payload.resistanceLevel || 0) > 0) {
      candleSeries.createPriceLine({
        price: Number(payload.resistanceLevel),
        color: "#f59b1d",
        lineWidth: 2,
        lineStyle: 1,
        axisLabelVisible: true,
        title: "Resistance",
      });
    }

    if (Number(payload.stopLoss || 0) > 0) {
      candleSeries.createPriceLine({
        price: Number(payload.stopLoss),
        color: "#ff4d6d",
        lineWidth: 1,
        lineStyle: 4,
        axisLabelVisible: true,
        title: "Stop",
      });
    }

    if (Number(payload.takeProfit || 0) > 0) {
      candleSeries.createPriceLine({
        price: Number(payload.takeProfit),
        color: "#16c47f",
        lineWidth: 1,
        lineStyle: 4,
        axisLabelVisible: true,
        title: "Target",
      });
    }

    chart.timeScale().fitContent();
    activeChart = chart;
    activeResizeHandler = () => {
      if (activeChart && activeChartContainer) {
        activeChart.applyOptions({ width: activeChartContainer.clientWidth });
      }
    };
    window.addEventListener("resize", activeResizeHandler);
  }

  window.SignalPage = {
    destroyActiveChart,
    mountSignalChart,
    renderSignalChartModal,
    renderOpenTradeInvestmentBoard,
    renderSignalPage,
  };
})();
