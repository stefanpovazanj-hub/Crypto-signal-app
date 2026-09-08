# Crypto Signal Bot — Telegram Mini App

Arhitektura: Python FastAPI backend + React TMA frontend  
Podaci: Binance Public API (bez API ključa, besplatno)  
Analiza: RSI + EMA Cross + MACD + Bollinger Bands + ADX filter

---

## Struktura projekta

```
crypto-signal-app/
├── backend/
│   ├── main.py           # FastAPI server (TA logika, Binance API)
│   └── requirements.txt
└── frontend/
    ├── index.html        # Telegram WebApp SDK tag ovde
    ├── vite.config.js
    ├── package.json
    ├── .env.example
    └── src/
        ├── main.jsx
        └── App.jsx       # Kompletna TMA aplikacija
```

---

## 1. Pokretanje backend-a

```bash
cd backend

# Kreiraj virtuelno okruženje
python -m venv venv
source venv/bin/activate      # Windows: venv\Scripts\activate

# Instaliraj zavisnosti
pip install -r requirements.txt

# Pokreni server
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

Backend je dostupan na: http://localhost:8000  
Swagger docs: http://localhost:8000/docs

### Testiranje API-ja

```bash
# Trenutna cena
curl http://localhost:8000/api/price?symbol=BTCUSDT

# Generiši signal
curl -X POST http://localhost:8000/api/generate-signal \
  -H "Content-Type: application/json" \
  -d '{"symbol":"BTCUSDT","interval":"15m","strategy":"combined"}'
```

---

## 2. Pokretanje frontend-a

```bash
cd frontend

# Instaliraj Node zavisnosti
npm install

# Pokreni Vite dev server
npm run dev
```

Aplikacija je dostupna na: http://localhost:5173

> Vite proxy automatski prosleđuje `/api/*` pozive na backend (port 8000),
> tako da nema CORS problema lokalno.

---

## 3. Telegram Mini App integracija

### Lokalno testiranje bez Telegram-a
Aplikacija radi normalno u browseru — `useTelegram()` hook vraća `isTelegram: false`
i sve Telegram-specifične stvari su tiho preskočene.

### Deployment za pravi Telegram bot

**Korak A — Deployuj backend** (npr. Railway.app, Render, Fly.io):
```bash
# Primer za Railway
railway init
railway up
# Zabeležj URL: https://your-app.railway.app
```

**Korak B — Deployuj frontend** (Vercel, Netlify, GitHub Pages):
```bash
# Postavi env varijablu u Vercel dashboard:
# VITE_API_BASE = https://your-app.railway.app

npm run build
# Uploaduj /dist folder
```

**Korak C — Registruj TMA kod @BotFather**:
```
/newbot → napravi bota
/newapp → poveži sa botom
  App URL: https://your-frontend.vercel.app
```

**Korak D — ngrok za lokalno testiranje sa Telegramom**:
```bash
ngrok http 5173
# Rezultat: https://abc123.ngrok.io
# Postavi taj URL u @BotFather kao App URL
```

---

## Tehnička analiza — objašnjenje

### Scoring sistem (0–7 bodova)
| Indikator     | Bullish signal    | Bearish signal    | Bodovi |
|---------------|-------------------|-------------------|--------|
| RSI (14)      | < 35 (oversold)   | > 65 (overbought) | 1–2    |
| EMA 9/21 cross| Fast > Slow       | Fast < Slow       | 1–2    |
| MACD Histogram| > 0               | < 0               | 1      |
| BB pozicija   | < 25% (dno)       | > 75% (vrh)       | 1      |
| Volume ratio  | > 1.5× avg        | < 0.7× avg        | bonus  |

### Filteri (odbacuju signal)
- **ADX < 20** → bočno tržište → signal nije validan (NEUTRAL)
- **Skor < 2** → nedovoljno jak signal → NEUTRAL

### Verovatnoća
- Bazna: 50% + (score/7) × 38% = opseg 50–88%
- Volume bonus: ±5–8%
- Maksimum: 92% (nikad 100% — tržište je uvek nepredvidivo)

---

## Napomene

- Binance Public API ne zahteva API ključ za read-only operacije
- Rate limit: ~1200 zahteva/minuta (daleko iznad potreba ove app)
- Za produkciju dodaj Redis cache za klines podatke (smanjuje latency)
- Aplikacija NE izvršava naloge — samo generiše signale
