#!/usr/bin/env node
/**
 * FLUX Finance MCP Server
 * ─────────────────────────────────────────────────
 * Registers all FLUX tools, resources, and prompts
 * with the Model Context Protocol (MCP) for use in
 * Antigravity and compatible AI assistants.
 *
 * Install deps:
 *   npm install @modelcontextprotocol/sdk node-fetch dotenv
 *
 * Run:
 *   node flux-finance-mcp.js
 */

import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fetch from "node-fetch";
import "dotenv/config";

// ─── Server Bootstrap ────────────────────────────────────────────────────────
const server = new McpServer({
  name: "flux-finance-mcp",
  version: "1.0.0",
});

// ─── MOCK DATA (replace with real DB calls) ──────────────────────────────────
const MOCK_USER = {
  id: "usr_001",
  name: "Nishanth S",
  risk_tolerance: "balanced",
  currency: "USD",
};

const MOCK_PORTFOLIO = {
  net_worth: 48320.5,
  change_24h: +2.3,
  assets: [
    { symbol: "NVDA", type: "stock", value: 15000, allocation: 31 },
    { symbol: "BTC",  type: "crypto", value: 12000, allocation: 25 },
    { symbol: "SPY",  type: "etf",   value: 10000, allocation: 21 },
    { symbol: "ETH",  type: "crypto", value: 6000,  allocation: 12 },
    { symbol: "CASH", type: "cash",  value: 5320,   allocation: 11 },
  ],
};

const MOCK_TRANSACTIONS = [
  { id: "t1", date: "2026-04-07", description: "NETFLIX.COM",       amount: -15.99, currency: "USD" },
  { id: "t2", date: "2026-04-06", description: "WHOLE FOODS MARKET",amount: -87.43, currency: "USD" },
  { id: "t3", date: "2026-04-05", description: "COINBASE BUY ETH",  amount: -500,   currency: "USD" },
  { id: "t4", date: "2026-04-04", description: "SALARY DEPOSIT",    amount: 4200,   currency: "USD" },
  { id: "t5", date: "2026-04-03", description: "UBER EATS",         amount: -32.10, currency: "USD" },
];

// ─── TOOLS ───────────────────────────────────────────────────────────────────

// 1. Get Portfolio Summary
server.tool(
  "get_portfolio_summary",
  "Retrieve the current portfolio snapshot including asset allocation, P&L, and net worth.",
  {
    user_id: z.string().describe("The user's unique identifier"),
    currency: z.string().default("USD").describe("Display currency"),
  },
  async ({ user_id, currency }) => {
    // In production: query your database with user_id
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ user_id, currency, ...MOCK_PORTFOLIO }, null, 2),
        },
      ],
    };
  }
);

// 2. Get Transaction History
server.tool(
  "get_transaction_history",
  "Fetch and filter transaction history for a user. Supports date range and limit.",
  {
    user_id: z.string(),
    from_date: z.string().optional().describe("ISO date string, e.g. 2026-01-01"),
    to_date:   z.string().optional(),
    limit:     z.number().default(20),
  },
  async ({ user_id, from_date, to_date, limit }) => {
    let txns = MOCK_TRANSACTIONS.slice(0, limit);
    if (from_date) txns = txns.filter(t => t.date >= from_date);
    if (to_date)   txns = txns.filter(t => t.date <= to_date);
    return {
      content: [{ type: "text", text: JSON.stringify({ transactions: txns }, null, 2) }],
    };
  }
);

// 3. Classify Transaction
server.tool(
  "classify_transaction",
  "Use AI to classify a raw bank transaction string into category, merchant, and intent.",
  {
    raw_description: z.string().describe("Raw transaction description from bank"),
    amount: z.number(),
    currency: z.string().default("USD"),
  },
  async ({ raw_description, amount, currency }) => {
    // Simple heuristic classifier (replace with LLM call in production)
    const lower = raw_description.toLowerCase();
    let category = "Other";
    if (/netflix|spotify|adobe|github/.test(lower))    category = "Subscription";
    if (/food|eats|restaurant|cafe|coffee/.test(lower)) category = "Food";
    if (/uber|lyft|taxi|airways/.test(lower))           category = "Travel";
    if (/coinbase|binance|robinhood/.test(lower))       category = "Investment";
    if (/salary|deposit|payroll/.test(lower))           category = "Income";

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          raw_description,
          amount,
          currency,
          classification: {
            merchant:   raw_description.split(" ").slice(0, 2).join(" "),
            category,
            intent:     amount < 0 ? "Expense" : "Income",
            confidence: 0.87,
          },
        }, null, 2),
      }],
    };
  }
);

// 4. Get Asset Price (via CoinGecko for crypto, stub for stocks)
server.tool(
  "get_asset_price",
  "Get real-time price data for a stock symbol or crypto token.",
  {
    symbol:     z.string().describe("Ticker symbol, e.g. BTC, AAPL, ETH"),
    asset_type: z.enum(["stock", "crypto", "etf", "forex"]).default("crypto"),
  },
  async ({ symbol, asset_type }) => {
    let priceData;

    if (asset_type === "crypto") {
      const coinMap = { BTC: "bitcoin", ETH: "ethereum", SOL: "solana" };
      const coinId = coinMap[symbol.toUpperCase()] || symbol.toLowerCase();
      const url = `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd&include_24hr_change=true`;
      try {
        const res = await fetch(url);
        const data = await res.json();
        priceData = { symbol, asset_type, price_usd: data[coinId]?.usd, change_24h: data[coinId]?.usd_24h_change };
      } catch {
        priceData = { symbol, asset_type, price_usd: null, error: "API unavailable" };
      }
    } else {
      // Stub for stocks — replace with Alpha Vantage call
      const stubPrices = { NVDA: 875.42, AAPL: 192.35, SPY: 520.10, MSFT: 415.88 };
      priceData = {
        symbol: symbol.toUpperCase(),
        asset_type,
        price_usd: stubPrices[symbol.toUpperCase()] ?? 100.00,
        change_24h: +(Math.random() * 4 - 2).toFixed(2),
        source: "stub — wire Alpha Vantage API key for live data",
      };
    }

    return { content: [{ type: "text", text: JSON.stringify(priceData, null, 2) }] };
  }
);

// 5. Get Market Sentiment
server.tool(
  "get_market_sentiment",
  "Returns AI-analyzed market sentiment (Bullish/Bearish/Neutral) for an asset based on current news.",
  {
    symbol:       z.string(),
    lookback_days: z.number().default(7),
  },
  async ({ symbol, lookback_days }) => {
    // Stub — in production: fetch news headlines via NewsAPI, run through LLM
    const sentiments = ["Bullish", "Bearish", "Neutral"];
    const sentiment = sentiments[Math.floor(Math.random() * sentiments.length)];
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          symbol,
          lookback_days,
          sentiment,
          summary: `Based on ${lookback_days} days of news analysis, ${symbol} is showing ${sentiment.toLowerCase()} signals. Wire NewsAPI + LLM for live analysis.`,
          confidence: 0.74,
        }, null, 2),
      }],
    };
  }
);

// 6. Convert Currency
server.tool(
  "convert_currency",
  "Convert an amount from one currency to another using live FX rates.",
  {
    amount:        z.number(),
    from_currency: z.string().describe("ISO 4217 code, e.g. USD"),
    to_currency:   z.string().describe("ISO 4217 code, e.g. JPY"),
  },
  async ({ amount, from_currency, to_currency }) => {
    try {
      const appId = process.env.OPEN_EXCHANGE_RATES_APP_ID || "demo";
      const url = `https://openexchangerates.org/api/latest.json?app_id=${appId}&base=USD&symbols=${from_currency},${to_currency}`;
      const res = await fetch(url);
      const data = await res.json();

      if (data.rates) {
        const rate_from = data.rates[from_currency] || 1;
        const rate_to   = data.rates[to_currency]   || 1;
        const converted = (amount / rate_from) * rate_to;
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              from: `${amount} ${from_currency}`,
              to:   `${converted.toFixed(2)} ${to_currency}`,
              rate: (rate_to / rate_from).toFixed(6),
              timestamp: new Date().toISOString(),
            }, null, 2),
          }],
        };
      }
    } catch {}

    // Stub fallback
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          from: `${amount} ${from_currency}`,
          to:   `${(amount * 0.92).toFixed(2)} ${to_currency}`,
          note: "Stub rate — wire Open Exchange Rates API for live data",
        }, null, 2),
      }],
    };
  }
);

// 7. Generate Investment Proposal
server.tool(
  "generate_investment_proposal",
  "Analyze the user's portfolio and generate concrete investment proposals.",
  {
    user_id:           z.string(),
    risk_tolerance:    z.enum(["conservative", "balanced", "aggressive"]).default("balanced"),
    investment_horizon: z.enum(["short", "medium", "long"]).default("medium"),
    focus_area:        z.string().optional(),
  },
  async ({ user_id, risk_tolerance, investment_horizon, focus_area }) => {
    const proposals = [
      {
        rank: 1,
        asset: "NVIDIA Corporation",
        ticker: "NVDA",
        suggested_allocation: risk_tolerance === "aggressive" ? "8%" : "4%",
        rationale: "AI infrastructure demand continues to drive earnings beats. Fits your growth exposure target.",
        key_risk: "High valuation multiple; sensitive to AI sector correction.",
      },
      {
        rank: 2,
        asset: "Vanguard S&P 500 ETF",
        ticker: "VOO",
        suggested_allocation: "10%",
        rationale: "Core diversified exposure with low fees. Ideal for balanced risk profile.",
        key_risk: "Broad market downturns will impact proportionally.",
      },
    ];
    return {
      content: [{
        type: "text",
        text: JSON.stringify({ user_id, risk_tolerance, investment_horizon, focus_area, proposals }, null, 2),
      }],
    };
  }
);

// ─── RESOURCES ───────────────────────────────────────────────────────────────

server.resource(
  "user-profile",
  new ResourceTemplate("flux://users/{user_id}/profile", { list: undefined }),
  async (uri, { user_id }) => ({
    contents: [{
      uri: uri.href,
      text: JSON.stringify(MOCK_USER, null, 2),
    }],
  })
);

server.resource(
  "user-portfolio",
  new ResourceTemplate("flux://users/{user_id}/portfolio", { list: undefined }),
  async (uri, { user_id }) => ({
    contents: [{
      uri: uri.href,
      text: JSON.stringify(MOCK_PORTFOLIO, null, 2),
    }],
  })
);

// ─── PROMPTS ─────────────────────────────────────────────────────────────────

server.prompt(
  "advisor_daily_briefing",
  "Generate a concise financial morning briefing for the user.",
  {
    user_name:         z.string(),
    portfolio_summary: z.string(),
    market_movers:     z.string().optional(),
  },
  ({ user_name, portfolio_summary, market_movers }) => ({
    messages: [{
      role: "user",
      content: {
        type: "text",
        text: `Generate a concise financial morning briefing for ${user_name}.

Portfolio Status: ${portfolio_summary}
${market_movers ? `Today's Market Movers: ${market_movers}` : ""}

Include:
1. Portfolio performance summary (2 sentences)
2. One key market observation
3. One actionable suggestion for today

Keep tone professional and data-driven. Max 150 words.`,
      },
    }],
  })
);

server.prompt(
  "transaction_analysis",
  "Deep analysis of a batch of transactions.",
  {
    transactions: z.string().describe("JSON stringified array of transaction objects"),
  },
  ({ transactions }) => ({
    messages: [{
      role: "user",
      content: {
        type: "text",
        text: `Analyze the following transactions and provide:
1. Spending category breakdown (as percentages)
2. Biggest unusual expense (and why it's unusual)
3. Top 2 cost-saving opportunities

Transactions:
${transactions}

Return as structured JSON.`,
      },
    }],
  })
);

// ─── START SERVER ────────────────────────────────────────────────────────────
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("✅ FLUX Finance MCP Server running...");
