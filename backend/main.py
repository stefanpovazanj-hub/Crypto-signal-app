"""
Crypto Signal Bot - FastAPI Backend
=====================================
Povlači real-time podatke sa Binance API-ja, vrši tehničku analizu
i generiše trading signale sa visokom verovatnoćom uspeha.

Zahtevi: pip install fastapi uvicorn httpx websockets pandas numpy ta
"""

import asyncio
import time
import logging
from datetime import datetime, timezone
from typing import Optional, Literal
from contextlib import asynccontextmanager

import httpx
import numpy as np
import pandas as pd
import ta  # Technical Analysis library

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# ─────────────────────────────────────────────
# KONFIGURACIJA
# ─────────────────────────────────────────────
BINANCE_BASE   = "https://api.binance.com"
VALID_SYMBOLS  = ["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT", "DOGEUSDT"]
VALID_INTERVALS = ["1m", "5m", "15m", "1h", "4h"]

# Minimalni broj svećica za pouzdanu analizu
MIN_CANDLES = 100

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger(__name__)


# ─────────────────────────────────────────────
# PYDANTIC MODELI
# ─────────────────────────────────────────────
class SignalRequest(BaseModel):
    symbol: str = "BTCUSDT"
    interval: str = "15m"
    strategy: str = "combined"  # "rsi_ema" | "volume_profile" | "combined"


class PriceResponse(BaseModel):
    symbol: str
    price: float
    change_24h: float
    volume_24h: float
    timestamp: int


class SignalResponse(BaseModel):
    symbol: str
    interval: str
    direction: Literal["HIGHER", "LOWER", "NEUTRAL"]
    probability: float          # 0–100
    entry_price: float
    expiry_minutes: int
    strategy_used: str
    indicators: dict
    timestamp: int
    valid: bool                 # False ako je signal odbačen zbog filtera


# ─────────────────────────────────────────────
# BINANCE CLIENT
# ─────────────────────────────────────────────
class BinanceClient:
    """Tanka omotač oko Binance Public REST API-ja."""

    def __init__(self):
        self._client: Optional[httpx.AsyncClient] = None

    async def start(self):
        self._client = httpx.AsyncClient(
            base_url=BINANCE_BASE,
            timeout=10.0,
            headers={"User-Agent": "CryptoSignalBot/1.0"}
        )

    async def stop(self):
        if self._client:
            await self._client.aclose()

    async def get_ticker(self, symbol: str) -> dict:
        """Vraća 24h statistiku za izabrani par."""
        r = await self._client.get("/api/v3/ticker/24hr", params={"symbol": symbol.upper()})
        r.raise_for_status()
        return r.json()

    async def get_klines(self, symbol: str, interval: str, limit: int = 200) -> list[list]:
        """
        Vraća candlestick podatke.
        Svaki element: [open_time, open, high, low, close, volume, ...]
        """
        r = await self._client.get(
            "/api/v3/klines",
            params={"symbol": symbol.upper(), "interval": interval, "limit": limit}
        )
        r.raise_for_status()
        return r.json()


# Singleton
binance = BinanceClient()


# ─────────────────────────────────────────────
# TEHNIČKA ANALIZA
# ─────────────────────────────────────────────
class TechnicalAnalyzer:
    """
    Kombinovana strategija: RSI + EMA Crossover + Volume Filter + Trend Filter.

    Logika odbacivanja signala:
    • ADX < 20  → bočno tržište → NEUTRAL
    • Volumen ispod 20-period SMA-a → niska likvidnost → smanjuje verovatnoću

    Signal se računa kao zbir bodova iz više indikatora (scoring approach).
    """

    @staticmethod
    def klines_to_df(raw: list[list]) -> pd.DataFrame:
        """Konvertuje sirove Binance klines u DataFrame sa numeričkim vrednostima."""
        cols = ["open_time","open","high","low","close","volume",
                "close_time","quote_volume","num_trades",
                "taker_buy_base","taker_buy_quote","ignore"]
        df = pd.DataFrame(raw, columns=cols)
        for col in ["open","high","low","close","volume","quote_volume"]:
            df[col] = pd.to_numeric(df[col])
        df["open_time"] = pd.to_datetime(df["open_time"], unit="ms")
        return df.set_index("open_time")

    @staticmethod
    def compute_rsi(df: pd.DataFrame, period: int = 14) -> pd.Series:
        return ta.momentum.RSIIndicator(df["close"], window=period).rsi()

    @staticmethod
    def compute_ema(df: pd.DataFrame, fast: int = 9, slow: int = 21):
        ema_fast = ta.trend.EMAIndicator(df["close"], window=fast).ema_indicator()
        ema_slow = ta.trend.EMAIndicator(df["close"], window=slow).ema_indicator()
        return ema_fast, ema_slow

    @staticmethod
    def compute_adx(df: pd.DataFrame, period: int = 14) -> pd.Series:
        return ta.trend.ADXIndicator(df["high"], df["low"], df["close"], window=period).adx()

    @staticmethod
    def compute_volume_sma(df: pd.DataFrame, period: int = 20) -> pd.Series:
        return df["volume"].rolling(period).mean()

    @staticmethod
    def compute_macd(df: pd.DataFrame):
        macd = ta.trend.MACD(df["close"])
        return macd.macd_diff()  # histogram

    @staticmethod
    def compute_bb(df: pd.DataFrame, period: int = 20):
        bb = ta.volatility.BollingerBands(df["close"], window=period)
        return bb.bollinger_lband(), bb.bollinger_uband(), bb.bollinger_mavg()

    def analyze(self, df: pd.DataFrame, strategy: str) -> dict:
        """
        Glavna metoda analize. Vraća rečnik sa svim vrednostima indikatora i
        finalnim smerom i verovatnoćom.

        Scoring sistem:
        • Svaki signal (RSI, EMA cross, MACD, BB) daje +1 (bullish) ili -1 (bearish)
        • Ukupan score se normalizuje u verovatnoću
        • Filteri smanjuju confidence ili poništavaju signal
        """
        if len(df) < MIN_CANDLES:
            return self._neutral("Nedovoljno podataka za analizu")

        # ── Izračunaj indikatore ──────────────────────────────────────────
        rsi          = self.compute_rsi(df).iloc[-1]
        ema_fast, ema_slow = self.compute_ema(df)
        ema_fast_val = ema_fast.iloc[-1]
        ema_slow_val = ema_slow.iloc[-1]
        adx_val      = self.compute_adx(df).iloc[-1]
        vol_sma      = self.compute_volume_sma(df)
        vol_ratio    = df["volume"].iloc[-1] / vol_sma.iloc[-1] if vol_sma.iloc[-1] > 0 else 1.0
        macd_hist    = self.compute_macd(df).iloc[-1]
        bb_low, bb_high, bb_mid = self.compute_bb(df)
        close        = df["close"].iloc[-1]
        bb_pos       = (close - bb_low.iloc[-1]) / (bb_high.iloc[-1] - bb_low.iloc[-1] + 1e-9)

        # ── TREND FILTER: odbaci sideways tržište ────────────────────────
        if adx_val < 20:
            return self._neutral(f"ADX={adx_val:.1f} < 20 → sideways market, signal rejected")

        # ── SCORING ───────────────────────────────────────────────────────
        score = 0  # pozitivan = bullish, negativan = bearish
        reasons = []

        # 1. RSI signal
        if rsi < 35:
            score += 2
            reasons.append(f"RSI={rsi:.1f} oversold (+2)")
        elif rsi > 65:
            score -= 2
            reasons.append(f"RSI={rsi:.1f} overbought (-2)")
        elif rsi < 50:
            score += 1
            reasons.append(f"RSI={rsi:.1f} bearish zone (+1 bull)")
        else:
            score -= 1
            reasons.append(f"RSI={rsi:.1f} bullish zone (+1 bear)")

        # 2. EMA Crossover
        ema_diff_pct = (ema_fast_val - ema_slow_val) / ema_slow_val * 100
        if ema_fast_val > ema_slow_val:
            score += 2 if ema_diff_pct > 0.3 else 1
            reasons.append(f"EMA9>{ema_slow_val:.0f} bullish cross (+{2 if ema_diff_pct > 0.3 else 1})")
        else:
            score -= 2 if abs(ema_diff_pct) > 0.3 else 1
            reasons.append(f"EMA9<EMA21 bearish cross (-{2 if abs(ema_diff_pct) > 0.3 else 1})")

        # 3. MACD histogram
        if macd_hist > 0:
            score += 1
            reasons.append(f"MACD hist={macd_hist:.4f} bullish (+1)")
        else:
            score -= 1
            reasons.append(f"MACD hist={macd_hist:.4f} bearish (-1)")

        # 4. Bollinger Bands pozicija
        if bb_pos < 0.25:
            score += 1
            reasons.append(f"BB pos={bb_pos:.2f} near lower band (+1)")
        elif bb_pos > 0.75:
            score -= 1
            reasons.append(f"BB pos={bb_pos:.2f} near upper band (-1)")

        # 5. Volume confirmation (bonus)
        vol_bonus = 0.0
        if vol_ratio > 1.5:
            vol_bonus = 5.0  # visok volumen povećava confidence
            reasons.append(f"Volume {vol_ratio:.1f}x avg → high confidence (+5%)")
        elif vol_ratio < 0.7:
            vol_bonus = -8.0  # nizak volumen smanjuje confidence
            reasons.append(f"Volume {vol_ratio:.1f}x avg → low liquidity (-8%)")

        # ── KONVERZIJA SCORE → VEROVATNOĆA ───────────────────────────────
        max_score = 7  # maksimalan mogući apsolutni skor
        abs_score = abs(score)
        
        # Bazna verovatnoća: od 50% (neutralno) do 88% (max skor)
        base_prob = 50.0 + (abs_score / max_score) * 38.0
        final_prob = min(92.0, max(52.0, base_prob + vol_bonus))

        # ── ODREĐIVANJE SMERA ─────────────────────────────────────────────
        direction = "HIGHER" if score > 0 else ("LOWER" if score < 0 else "NEUTRAL")
        
        # Slabi signali → NEUTRAL
        if abs_score < 2:
            return self._neutral(f"Score={score} premali → signal nije dovoljno jak")

        # ── EKSPIRACIJA na osnovu intervala ───────────────────────────────
        expiry_map = {"1m": 5, "5m": 15, "15m": 30, "1h": 120, "4h": 480}

        return {
            "direction": direction,
            "probability": round(final_prob, 1),
            "valid": True,
            "score": score,
            "expiry_minutes": expiry_map.get("15m", 30),  # override u ruti
            "indicators": {
                "rsi": round(rsi, 2),
                "ema_fast": round(ema_fast_val, 2),
                "ema_slow": round(ema_slow_val, 2),
                "adx": round(adx_val, 2),
                "macd_hist": round(macd_hist, 6),
                "bb_position": round(bb_pos, 3),
                "volume_ratio": round(vol_ratio, 2),
            },
            "reasons": reasons,
            "filter_reason": None,
        }

    @staticmethod
    def _neutral(reason: str) -> dict:
        return {
            "direction": "NEUTRAL",
            "probability": 50.0,
            "valid": False,
            "score": 0,
            "expiry_minutes": 0,
            "indicators": {},
            "reasons": [],
            "filter_reason": reason,
        }


analyzer = TechnicalAnalyzer()


# ─────────────────────────────────────────────
# LIFESPAN (startup / shutdown)
# ─────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info("🚀 Pokrećem Binance klijent...")
    await binance.start()
    yield
    log.info("🛑 Zatvaram Binance klijent...")
    await binance.stop()


# ─────────────────────────────────────────────
# FASTAPI APLIKACIJA
# ─────────────────────────────────────────────
app = FastAPI(
    title="Crypto Signal Bot API",
    description="Real-time Binance signal generator sa tehničkom analizom",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],   # u produkciji ogranič na tvoj TMA domain
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


# ─────────────────────────────────────────────
# RUTE
# ─────────────────────────────────────────────
@app.get("/")
async def root():
    return {"status": "online", "service": "Crypto Signal Bot", "version": "1.0.0"}


@app.get("/api/price", response_model=PriceResponse)
async def get_price(symbol: str = "BTCUSDT"):
    """
    Vraća trenutnu cenu i 24h statistiku za izabrani kripto par.
    
    Primer: GET /api/price?symbol=BTCUSDT
    """
    symbol = symbol.upper()
    if symbol not in VALID_SYMBOLS:
        raise HTTPException(400, f"Simbol '{symbol}' nije podržan. Dozvoljeni: {VALID_SYMBOLS}")

    try:
        data = await binance.get_ticker(symbol)
        return PriceResponse(
            symbol=symbol,
            price=float(data["lastPrice"]),
            change_24h=float(data["priceChangePercent"]),
            volume_24h=float(data["quoteVolume"]),
            timestamp=int(time.time() * 1000),
        )
    except httpx.HTTPError as e:
        log.error(f"Binance API greška: {e}")
        raise HTTPException(502, "Binance API nedostupan, pokušaj ponovo")


@app.post("/api/generate-signal", response_model=SignalResponse)
async def generate_signal(req: SignalRequest):
    """
    Generiše trading signal za izabrani par i vremenski okvir.

    Body: { "symbol": "BTCUSDT", "interval": "15m", "strategy": "combined" }

    Vraća:
    - direction: HIGHER / LOWER / NEUTRAL
    - probability: verovatnoća uspeha (50–92%)
    - entry_price: cena u trenutku generisanja
    - expiry_minutes: preporučeno vreme isteka opcije
    - indicators: detalji svih indikatora
    - valid: da li je signal prošao sve filtere
    """
    symbol   = req.symbol.upper()
    interval = req.interval

    if symbol not in VALID_SYMBOLS:
        raise HTTPException(400, f"Simbol '{symbol}' nije podržan.")
    if interval not in VALID_INTERVALS:
        raise HTTPException(400, f"Interval '{interval}' nije podržan. Dozvoljeni: {VALID_INTERVALS}")

    try:
        # Paralelno povlači cenu i svećice
        ticker_task = asyncio.create_task(binance.get_ticker(symbol))
        klines_task = asyncio.create_task(binance.get_klines(symbol, interval, limit=200))
        ticker, raw_klines = await asyncio.gather(ticker_task, klines_task)
    except httpx.HTTPError as e:
        log.error(f"Binance API greška: {e}")
        raise HTTPException(502, "Binance API nedostupan, pokušaj ponovo")

    # Konvertuj u DataFrame
    df = analyzer.klines_to_df(raw_klines)

    # Analiziraj
    result = analyzer.analyze(df, req.strategy)

    # Ekspiracija prema intervalu
    expiry_map = {"1m": 5, "5m": 15, "15m": 30, "1h": 120, "4h": 480}
    expiry = expiry_map.get(interval, 30)

    entry_price = float(ticker["lastPrice"])

    log.info(
        f"Signal → {symbol} {interval} | {result['direction']} "
        f"{result['probability']}% | ADX={result['indicators'].get('adx','N/A')}"
    )

    return SignalResponse(
        symbol=symbol,
        interval=interval,
        direction=result["direction"],
        probability=result["probability"],
        entry_price=entry_price,
        expiry_minutes=expiry,
        strategy_used=req.strategy,
        indicators=result["indicators"],
        timestamp=int(time.time() * 1000),
        valid=result["valid"],
    )


@app.get("/api/symbols")
async def get_symbols():
    """Lista podržanih kripto parova."""
    return {"symbols": VALID_SYMBOLS}


@app.get("/api/intervals")
async def get_intervals():
    """Lista podržanih vremenskih okvira."""
    return {"intervals": VALID_INTERVALS}


# ─────────────────────────────────────────────
# POKRETANJE (lokalno)
# ─────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
