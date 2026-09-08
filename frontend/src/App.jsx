/**
 * Crypto Signal Bot — Telegram Mini App
 * ========================================
 * Quiet luxury dark design: antracit pozadina, sivi akcenti, precizne animacije.
 * Integrisano sa Telegram WebApp SDK-om za prilagođavanje teme i dimenzija.
 *
 * Stack: React + Tailwind CSS + Framer Motion (ili CSS animacije)
 */

import { useState, useEffect, useCallback, useRef } from "react";

// ─── Konfiguracija ───────────────────────────────────────────────────────────
const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8000";

const SYMBOLS = [
  { value: "BTCUSDT", label: "BTC / USDT", icon: "₿" },
  { value: "ETHUSDT", label: "ETH / USDT", icon: "Ξ" },
  { value: "SOLUSDT", label: "SOL / USDT", icon: "◎" },
  { value: "BNBUSDT", label: "BNB / USDT", icon: "⬡" },
  { value: "XRPUSDT", label: "XRP / USDT", icon: "✕" },
  { value: "DOGEUSDT", label: "DOGE / USDT", icon: "Ð" },
];

const INTERVALS = [
  { value: "1m",  label: "1 min",   tag: "Scalp" },
  { value: "5m",  label: "5 min",   tag: "Short" },
  { value: "15m", label: "15 min",  tag: "Swing" },
  { value: "1h",  label: "1 Hour",  tag: "Mid" },
  { value: "4h",  label: "4 Hours", tag: "Trend" },
];

const STRATEGIES = [
  { value: "combined",      label: "Combined Strategy", desc: "RSI + EMA + Volume + BB" },
  { value: "rsi_ema",       label: "RSI / EMA Cross",   desc: "Momentum & trend" },
  { value: "volume_profile", label: "Volume Profile",   desc: "Liquidity analysis" },
];

const LOADING_STEPS = [
  { pct: 15, text: "Connecting to Binance..." },
  { pct: 32, text: "Collecting market data..." },
  { pct: 54, text: "Running technical analysis..." },
  { pct: 71, text: "Applying trend filters..." },
  { pct: 88, text: "Calculating probability..." },
  { pct: 100, text: "Signal ready." },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────
const fmt = {
  price: (n) =>
    n >= 1000
      ? n.toLocaleString("en-US", { maximumFractionDigits: 2 })
      : n.toFixed(4),
  pct: (n) => `${n > 0 ? "+" : ""}${n.toFixed(2)}%`,
  prob: (n) => `${n.toFixed(1)}%`,
  time: (ms) =>
    new Date(ms).toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }),
};

// ─── Telegram WebApp inicijalizacija ─────────────────────────────────────────
function useTelegram() {
  const tg = typeof window !== "undefined" ? window?.Telegram?.WebApp : null;

  useEffect(() => {
    if (!tg) return;
    tg.ready();
    tg.expand(); // punoekranski mod
    // Postavi boju header-a
    tg.setHeaderColor?.("#0a0a0a");
    tg.setBackgroundColor?.("#0a0a0a");
  }, [tg]);

  return { tg, isTelegram: !!tg };
}

// ─── Custom hooks ─────────────────────────────────────────────────────────────
function usePrice(symbol) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const fetch_ = useCallback(async () => {
    try {
      const r = await fetch(`${API_BASE}/api/price?symbol=${symbol}`);
      if (!r.ok) throw new Error("API error");
      setData(await r.json());
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, [symbol]);

  useEffect(() => {
    fetch_();
    const id = setInterval(fetch_, 8000); // osvežavaj svake 8s
    return () => clearInterval(id);
  }, [fetch_]);

  return { price: data, priceError: error, refetchPrice: fetch_ };
}

function useSignal() {
  const [signal, setSignal] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadStep, setLoadStep] = useState(0);
  const [error, setError] = useState(null);
  const stepRef = useRef(null);

  const generate = useCallback(async (symbol, interval, strategy) => {
    setLoading(true);
    setSignal(null);
    setError(null);
    setLoadStep(0);

    // Simuliraj napredak loading koraka
    let step = 0;
    stepRef.current = setInterval(() => {
      step++;
      if (step < LOADING_STEPS.length) {
        setLoadStep(step);
      }
    }, 480);

    try {
      const r = await fetch(`${API_BASE}/api/generate-signal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol, interval, strategy }),
      });
      if (!r.ok) {
        const err = await r.json();
        throw new Error(err.detail || "Server error");
      }
      const data = await r.json();
      
      // Pričekaj kraj animacije
      await new Promise(res => setTimeout(res, 400));
      setSignal(data);
    } catch (e) {
      setError(e.message);
    } finally {
      clearInterval(stepRef.current);
      setLoadStep(LOADING_STEPS.length - 1);
      setLoading(false);
    }
  }, []);

  return { signal, loading, loadStep, error, generate };
}

// ─── UI Komponente ────────────────────────────────────────────────────────────

/** Padajući meni sa hover efektom */
function Select({ value, onChange, options, label }) {
  return (
    <div className="select-wrap">
      <label className="field-label">{label}</label>
      <div className="select-box">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="custom-select"
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}{o.tag ? ` — ${o.tag}` : ""}{o.desc ? ` · ${o.desc}` : ""}
            </option>
          ))}
        </select>
        <span className="select-chevron">›</span>
      </div>
    </div>
  );
}

/** Ticker kartica sa live cenom */
function PriceTicker({ symbol, data, error }) {
  if (error) {
    return (
      <div className="ticker-card ticker-error">
        <span className="ticker-label">{symbol}</span>
        <span className="ticker-msg">Unable to fetch price</span>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="ticker-card">
        <span className="ticker-label">{symbol}</span>
        <span className="ticker-pulse">—</span>
      </div>
    );
  }

  const positive = data.change_24h >= 0;
  const icon = SYMBOLS.find((s) => s.value === symbol)?.icon || "◈";

  return (
    <div className="ticker-card">
      <div className="ticker-left">
        <span className="ticker-icon">{icon}</span>
        <div>
          <div className="ticker-sym">{symbol.replace("USDT", "")}</div>
          <div className="ticker-sub">/ USDT</div>
        </div>
      </div>
      <div className="ticker-right">
        <div className="ticker-price">${fmt.price(data.price)}</div>
        <div className={`ticker-change ${positive ? "pos" : "neg"}`}>
          {fmt.pct(data.change_24h)} 24h
        </div>
      </div>
    </div>
  );
}

/** Loading overlay sa progress bar-om */
function LoadingScreen({ step }) {
  const current = LOADING_STEPS[Math.min(step, LOADING_STEPS.length - 1)];
  const pct = current.pct;

  return (
    <div className="loading-screen">
      <div className="loading-inner">
        <div className="loading-orb">
          <div className="orb-ring" />
          <div className="orb-ring orb-ring2" />
          <div className="orb-core" />
        </div>

        <div className="loading-status">{current.text}</div>

        <div className="progress-track">
          <div
            className="progress-fill"
            style={{ width: `${pct}%` }}
          />
        </div>

        <div className="progress-pct">{pct}%</div>
      </div>
    </div>
  );
}

/** Indikator redovi */
function IndicatorRow({ label, value, sentiment }) {
  return (
    <div className="ind-row">
      <span className="ind-label">{label}</span>
      <span className={`ind-value ${sentiment}`}>{value}</span>
    </div>
  );
}

/** Signal kartica – glavni rezultat */
function SignalCard({ signal, onReset }) {
  const isHigher = signal.direction === "HIGHER";
  const isNeutral = signal.direction === "NEUTRAL";
  const probColor = signal.probability >= 75 ? "prob-high" :
                    signal.probability >= 60 ? "prob-mid" : "prob-low";

  const ind = signal.indicators;

  // Sentiment za svaki indikator
  const rsiSent = !ind.rsi ? "" : ind.rsi < 40 ? "bull" : ind.rsi > 60 ? "bear" : "neutral";
  const emaSent = !ind.ema_fast ? "" : ind.ema_fast > ind.ema_slow ? "bull" : "bear";
  const macdSent = !ind.macd_hist ? "" : ind.macd_hist > 0 ? "bull" : "bear";
  const volSent = !ind.volume_ratio ? "" :
                  ind.volume_ratio > 1.3 ? "bull" :
                  ind.volume_ratio < 0.8 ? "bear" : "neutral";

  return (
    <div className="signal-card-wrap">
      {/* Header */}
      <div className="signal-meta">
        <span className="signal-sym">{signal.symbol}</span>
        <span className="signal-interval">{signal.interval} · {signal.strategy_used}</span>
        <span className="signal-time">{fmt.time(signal.timestamp)}</span>
      </div>

      {/* Hlavní direction */}
      <div className={`direction-block ${isHigher ? "dir-higher" : isNeutral ? "dir-neutral" : "dir-lower"}`}>
        <div className="dir-arrow">
          {isHigher ? "↑" : isNeutral ? "→" : "↓"}
        </div>
        <div className="dir-label">
          {signal.direction}
        </div>
        <div className={`dir-prob ${probColor}`}>
          {fmt.prob(signal.probability)}
        </div>
        <div className="dir-desc">
          {isNeutral
            ? "No clear signal — market is sideways"
            : `${signal.expiry_minutes}min expiry · Entry $${fmt.price(signal.entry_price)}`}
        </div>
      </div>

      {/* Validity badge */}
      {!signal.valid && (
        <div className="filter-badge">
          ⚠ Signal filtered — low confidence conditions
        </div>
      )}

      {/* Indikatori */}
      {Object.keys(ind).length > 0 && (
        <div className="indicators-block">
          <div className="ind-title">Indicators</div>
          <IndicatorRow label="RSI (14)"       value={ind.rsi?.toFixed(1)}        sentiment={rsiSent} />
          <IndicatorRow label="EMA 9"          value={`$${fmt.price(ind.ema_fast || 0)}`} sentiment={emaSent} />
          <IndicatorRow label="EMA 21"         value={`$${fmt.price(ind.ema_slow || 0)}`} sentiment={emaSent} />
          <IndicatorRow label="ADX (trend)"    value={ind.adx?.toFixed(1)}        sentiment={ind.adx >= 25 ? "bull" : "neutral"} />
          <IndicatorRow label="MACD Hist"      value={ind.macd_hist?.toFixed(5)}  sentiment={macdSent} />
          <IndicatorRow label="BB Position"    value={`${(ind.bb_position * 100)?.toFixed(0)}%`} sentiment="neutral" />
          <IndicatorRow label="Volume Ratio"   value={`${ind.volume_ratio?.toFixed(2)}×`} sentiment={volSent} />
        </div>
      )}

      {/* Reset dugme */}
      <button className="btn-reset" onClick={onReset}>
        New Signal
      </button>
    </div>
  );
}

/** Error prikaz */
function ErrorCard({ message, onRetry }) {
  return (
    <div className="error-card">
      <div className="error-icon">⚡</div>
      <div className="error-title">Signal failed</div>
      <div className="error-msg">{message}</div>
      <button className="btn-retry" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}


// ─── Główna Aplikacija ────────────────────────────────────────────────────────
export default function App() {
  const { tg, isTelegram } = useTelegram();

  const [symbol,   setSymbol]   = useState("BTCUSDT");
  const [interval, setInterval] = useState("15m");
  const [strategy, setStrategy] = useState("combined");

  const { price, priceError } = usePrice(symbol);
  const { signal, loading, loadStep, error, generate } = useSignal();

  const handleGetSignal = () => generate(symbol, interval, strategy);
  const handleReset     = () => window.location.reload(); // čist reset

  // Haptic feedback za Telegram
  const handleButtonClick = () => {
    tg?.HapticFeedback?.impactOccurred("medium");
    handleGetSignal();
  };

  return (
    <>
      {/* ── Globalni stilovi (inline za TMA) ─────────────────────────── */}
      <style>{CSS}</style>

      <div className="app-root">
        {/* ── Header ──────────────────────────────────────────────────── */}
        <header className="app-header">
          <div className="header-logo">◈</div>
          <div className="header-text">
            <div className="header-title">Signal Bot</div>
            <div className="header-sub">Quantitative Analysis</div>
          </div>
          <div className={`header-live ${price ? "live-active" : ""}`}>
            {price ? "LIVE" : "···"}
          </div>
        </header>

        {/* ── Ticker ──────────────────────────────────────────────────── */}
        <PriceTicker symbol={symbol} data={price} error={priceError} />

        {/* ── Loading overlay ─────────────────────────────────────────── */}
        {loading && <LoadingScreen step={loadStep} />}

        {/* ── Signal rezultat ─────────────────────────────────────────── */}
        {!loading && signal && !error && (
          <SignalCard signal={signal} onReset={handleReset} />
        )}

        {/* ── Greška ──────────────────────────────────────────────────── */}
        {!loading && error && (
          <ErrorCard message={error} onRetry={handleGetSignal} />
        )}

        {/* ── Kontrole (sakrivene dok se prikazuje signal) ─────────────── */}
        {!loading && !signal && !error && (
          <div className="controls">
            <Select
              label="Crypto Pair"
              value={symbol}
              onChange={setSymbol}
              options={SYMBOLS}
            />
            <Select
              label="Time Frame"
              value={interval}
              onChange={setInterval}
              options={INTERVALS}
            />
            <Select
              label="Strategy"
              value={strategy}
              onChange={setStrategy}
              options={STRATEGIES}
            />

            <button
              className="btn-primary"
              onClick={handleButtonClick}
              disabled={loading}
            >
              <span className="btn-icon">◈</span>
              Get Signal
            </button>

            <p className="disclaimer">
              For educational purposes only. Not financial advice.
              {isTelegram && " · Telegram Mini App"}
            </p>
          </div>
        )}
      </div>
    </>
  );
}


// ─── CSS (inline string – idealno prebaci u index.css / Tailwind) ─────────────
const CSS = `
  /* Reset & base */
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg:        #090909;
    --surface:   #111111;
    --surface2:  #191919;
    --border:    #252525;
    --border2:   #2e2e2e;
    --text:      #e8e8e8;
    --text-sub:  #707070;
    --text-dim:  #404040;
    --accent:    #c8a96e;     /* warm gold — quiet luxury */
    --accent-dim:#7a6340;
    --higher:    #4ade80;
    --lower:     #f87171;
    --neutral:   #94a3b8;
    --radius:    12px;
    --radius-sm: 8px;
    font-family: -apple-system, 'SF Pro Display', 'Segoe UI', sans-serif;
    -webkit-font-smoothing: antialiased;
  }

  body {
    background: var(--bg);
    color: var(--text);
    min-height: 100dvh;
    overflow-x: hidden;
  }

  /* ── App shell ─────────────────────────────────────────────── */
  .app-root {
    max-width: 420px;
    margin: 0 auto;
    padding: 0 0 32px;
    display: flex;
    flex-direction: column;
    gap: 0;
    min-height: 100dvh;
  }

  /* ── Header ────────────────────────────────────────────────── */
  .app-header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 20px 20px 16px;
    border-bottom: 1px solid var(--border);
  }
  .header-logo {
    font-size: 22px;
    color: var(--accent);
    line-height: 1;
  }
  .header-text { flex: 1; }
  .header-title {
    font-size: 15px;
    font-weight: 600;
    letter-spacing: 0.01em;
    color: var(--text);
  }
  .header-sub {
    font-size: 11px;
    color: var(--text-sub);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    margin-top: 2px;
  }
  .header-live {
    font-size: 9px;
    letter-spacing: 0.12em;
    font-weight: 700;
    color: var(--text-dim);
    padding: 3px 7px;
    border: 1px solid var(--border);
    border-radius: 4px;
    transition: all 0.4s;
  }
  .live-active {
    color: var(--higher);
    border-color: #1a3a28;
    background: #0b1f14;
  }

  /* ── Ticker ────────────────────────────────────────────────── */
  .ticker-card {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin: 16px 16px 0;
    padding: 14px 18px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
  }
  .ticker-left  { display: flex; align-items: center; gap: 12px; }
  .ticker-icon  { font-size: 24px; color: var(--accent); opacity: 0.85; }
  .ticker-sym   { font-size: 15px; font-weight: 600; }
  .ticker-sub   { font-size: 11px; color: var(--text-sub); margin-top: 1px; }
  .ticker-price { font-size: 18px; font-weight: 700; text-align: right; font-variant-numeric: tabular-nums; }
  .ticker-change{
    font-size: 11px; text-align: right; margin-top: 3px;
    letter-spacing: 0.03em; font-weight: 500;
  }
  .pos { color: var(--higher); }
  .neg { color: var(--lower); }
  .ticker-pulse { color: var(--text-dim); animation: pulse 1.2s infinite; }
  @keyframes pulse { 0%,100%{opacity:.3} 50%{opacity:1} }
  .ticker-error .ticker-msg { font-size: 12px; color: var(--lower); }

  /* ── Controls ──────────────────────────────────────────────── */
  .controls {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 20px 16px 0;
    animation: fadeUp 0.3s ease;
  }
  @keyframes fadeUp {
    from { opacity:0; transform: translateY(10px); }
    to   { opacity:1; transform: translateY(0); }
  }

  /* Select */
  .select-wrap { display: flex; flex-direction: column; gap: 6px; }
  .field-label {
    font-size: 10px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-sub);
    padding-left: 2px;
  }
  .select-box {
    position: relative;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    transition: border-color 0.2s;
  }
  .select-box:hover { border-color: var(--border2); }
  .select-box:focus-within { border-color: var(--accent-dim); }
  .custom-select {
    width: 100%;
    padding: 12px 40px 12px 16px;
    background: transparent;
    border: none;
    outline: none;
    color: var(--text);
    font-size: 14px;
    cursor: pointer;
    appearance: none;
    -webkit-appearance: none;
  }
  .select-chevron {
    position: absolute;
    right: 14px;
    top: 50%;
    transform: translateY(-50%) rotate(90deg);
    color: var(--text-sub);
    font-size: 18px;
    pointer-events: none;
  }

  /* Primary button */
  .btn-primary {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    width: 100%;
    padding: 16px;
    margin-top: 4px;
    background: linear-gradient(135deg, #1a1612 0%, #2a2018 100%);
    border: 1px solid var(--accent-dim);
    border-radius: var(--radius);
    color: var(--accent);
    font-size: 15px;
    font-weight: 600;
    letter-spacing: 0.04em;
    cursor: pointer;
    transition: all 0.2s;
  }
  .btn-primary:hover {
    background: linear-gradient(135deg, #231e17 0%, #332618 100%);
    border-color: var(--accent);
    transform: translateY(-1px);
  }
  .btn-primary:active { transform: translateY(0); opacity: 0.85; }
  .btn-icon { font-size: 18px; }

  .disclaimer {
    font-size: 10px;
    color: var(--text-dim);
    text-align: center;
    padding: 4px 8px;
    line-height: 1.5;
  }

  /* ── Loading ───────────────────────────────────────────────── */
  .loading-screen {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 48px 24px;
    animation: fadeUp 0.2s ease;
  }
  .loading-inner {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 20px;
    width: 100%;
    max-width: 280px;
  }

  /* Animated orb */
  .loading-orb {
    position: relative;
    width: 72px;
    height: 72px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .orb-ring {
    position: absolute;
    inset: 0;
    border-radius: 50%;
    border: 1px solid var(--accent-dim);
    opacity: 0.4;
    animation: spin 2s linear infinite;
  }
  .orb-ring2 {
    inset: 6px;
    border-color: var(--accent);
    opacity: 0.25;
    animation: spin 1.3s linear infinite reverse;
  }
  .orb-core {
    width: 28px;
    height: 28px;
    background: radial-gradient(circle, var(--accent) 0%, #6b4c1e 70%, transparent 100%);
    border-radius: 50%;
    opacity: 0.7;
    animation: glow 1.4s ease-in-out infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes glow {
    0%,100% { opacity: 0.4; transform: scale(0.9); }
    50%      { opacity: 0.9; transform: scale(1.05); }
  }

  .loading-status {
    font-size: 13px;
    color: var(--text-sub);
    letter-spacing: 0.02em;
    text-align: center;
    min-height: 20px;
    transition: opacity 0.3s;
  }
  .progress-track {
    width: 100%;
    height: 2px;
    background: var(--surface2);
    border-radius: 2px;
    overflow: hidden;
  }
  .progress-fill {
    height: 100%;
    background: linear-gradient(90deg, var(--accent-dim), var(--accent));
    border-radius: 2px;
    transition: width 0.5s ease;
  }
  .progress-pct {
    font-size: 11px;
    color: var(--text-dim);
    letter-spacing: 0.06em;
    font-variant-numeric: tabular-nums;
  }

  /* ── Signal Card ───────────────────────────────────────────── */
  .signal-card-wrap {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 16px 16px 0;
    animation: fadeUp 0.35s ease;
  }
  .signal-meta {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 4px;
  }
  .signal-sym {
    font-size: 13px;
    font-weight: 700;
    color: var(--accent);
  }
  .signal-interval {
    font-size: 11px;
    color: var(--text-sub);
    flex: 1;
  }
  .signal-time {
    font-size: 10px;
    color: var(--text-dim);
    font-variant-numeric: tabular-nums;
  }

  /* Direction block */
  .direction-block {
    padding: 28px 20px 24px;
    border-radius: var(--radius);
    border: 1px solid;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    text-align: center;
  }
  .dir-higher { background: #0b1f14; border-color: #1e4a2e; }
  .dir-lower  { background: #1f0b0b; border-color: #4a1e1e; }
  .dir-neutral{ background: var(--surface); border-color: var(--border); }

  .dir-arrow {
    font-size: 42px;
    line-height: 1;
    font-weight: 300;
  }
  .dir-higher .dir-arrow { color: var(--higher); }
  .dir-lower  .dir-arrow { color: var(--lower);  }
  .dir-neutral .dir-arrow{ color: var(--neutral); }

  .dir-label {
    font-size: 22px;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .dir-higher .dir-label { color: var(--higher); }
  .dir-lower  .dir-label { color: var(--lower);  }
  .dir-neutral .dir-label{ color: var(--neutral); }

  /* Probability */
  .dir-prob {
    font-size: 36px;
    font-weight: 900;
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.02em;
  }
  .prob-high { color: var(--higher); }
  .prob-mid  { color: var(--accent); }
  .prob-low  { color: var(--neutral); }

  .dir-desc {
    font-size: 12px;
    color: var(--text-sub);
    margin-top: 2px;
  }

  /* Filter badge */
  .filter-badge {
    padding: 10px 14px;
    background: #1a1400;
    border: 1px solid #3a2e00;
    border-radius: var(--radius-sm);
    font-size: 12px;
    color: #c8a800;
    text-align: center;
  }

  /* Indicators */
  .indicators-block {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .ind-title {
    font-size: 10px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-sub);
    margin-bottom: 4px;
  }
  .ind-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .ind-label { font-size: 12px; color: var(--text-sub); }
  .ind-value { font-size: 13px; font-weight: 600; font-variant-numeric: tabular-nums; }
  .ind-value.bull    { color: var(--higher); }
  .ind-value.bear    { color: var(--lower);  }
  .ind-value.neutral { color: var(--neutral);}

  /* Reset button */
  .btn-reset {
    width: 100%;
    padding: 14px;
    background: var(--surface);
    border: 1px solid var(--border2);
    border-radius: var(--radius);
    color: var(--text-sub);
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    letter-spacing: 0.03em;
    transition: all 0.2s;
    margin-bottom: 8px;
  }
  .btn-reset:hover {
    border-color: var(--accent-dim);
    color: var(--accent);
  }

  /* Error */
  .error-card {
    margin: 20px 16px 0;
    padding: 32px 20px;
    background: var(--surface);
    border: 1px solid #3a1e1e;
    border-radius: var(--radius);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    text-align: center;
    animation: fadeUp 0.3s ease;
  }
  .error-icon  { font-size: 32px; }
  .error-title { font-size: 16px; font-weight: 600; color: var(--lower); }
  .error-msg   { font-size: 13px; color: var(--text-sub); line-height: 1.5; }
  .btn-retry {
    padding: 11px 28px;
    background: transparent;
    border: 1px solid var(--lower);
    border-radius: var(--radius-sm);
    color: var(--lower);
    font-size: 13px;
    cursor: pointer;
    transition: all 0.2s;
    margin-top: 4px;
  }
  .btn-retry:hover { background: #1f0b0b; }

  /* ── Scrollbar ─────────────────────────────────────────────── */
  ::-webkit-scrollbar       { width: 4px; }
  ::-webkit-scrollbar-track { background: var(--bg); }
  ::-webkit-scrollbar-thumb { background: var(--border2); border-radius: 4px; }

  /* ── Safe area (Telegram) ──────────────────────────────────── */
  @supports (padding-bottom: env(safe-area-inset-bottom)) {
    .app-root { padding-bottom: calc(32px + env(safe-area-inset-bottom)); }
  }

  /* ── Option text u select dropdowns ───────────────────────── */
  option { background: #151515; color: var(--text); }
`;
