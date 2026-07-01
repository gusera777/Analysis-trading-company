// ============================================================
// analysis.js (backend) — port 1:1 dari logika di script.js frontend
// supaya sinyal yang dikirim lewat push notification SAMA PERSIS
// dengan yang akan muncul kalau user buka app & tap "Generate Data".
// ============================================================

const SWING_N = 3;
const DISPLACEMENT_THRESHOLD = 0.55;
const STRONG_DISPLACEMENT = 0.70;

async function fetchCandlesH1(apiKey, apiSymbol) {
  const limit = 220;
  const symbol = encodeURIComponent(apiSymbol);
  const url = `https://api.twelvedata.com/time_series?symbol=${symbol}&interval=1h&outputsize=${limit}&apikey=${apiKey}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.status === 'error' || !data.values) {
    throw new Error(data.message || 'Failed to fetch Twelve Data');
  }
  const candles = data.values.map(v => ({
    time: new Date(v.datetime.replace(' ', 'T') + 'Z').getTime(),
    open: parseFloat(v.open),
    high: parseFloat(v.high),
    low: parseFloat(v.low),
    close: parseFloat(v.close),
  }));
  candles.sort((a, b) => a.time - b.time);
  return candles;
}

function analyzeSwings(candles, n) {
  const highs = [], lows = [];
  for (let i = n; i < candles.length - n; i++) {
    const c = candles[i];
    let isHigh = true, isLow = true;
    for (let j = i - n; j <= i + n; j++) {
      if (j === i) continue;
      if (candles[j].high >= c.high) isHigh = false;
      if (candles[j].low <= c.low) isLow = false;
      if (!isHigh && !isLow) break;
    }
    if (isHigh) highs.push({ value: c.high, time: c.time, idx: i });
    if (isLow) lows.push({ value: c.low, time: c.time, idx: i });
  }
  if (!highs.length || !lows.length) return { swingHigh: null, swingLow: null, trend: null };

  const recentFrom = candles.length - 1 - 40;
  const recentHighs = highs.filter(p => p.idx >= recentFrom);
  const recentLows = lows.filter(p => p.idx >= recentFrom);
  const poolH = recentHighs.length ? recentHighs : highs;
  const poolL = recentLows.length ? recentLows : lows;
  const swingHigh = poolH.reduce((best, p) => (p.value > best.value ? p : best));
  const swingLow = poolL.reduce((best, p) => (p.value < best.value ? p : best));

  let trend = null;
  if (highs.length >= 2 && lows.length >= 2) {
    const h1v = highs[highs.length - 2].value, h2v = highs[highs.length - 1].value;
    const l1v = lows[lows.length - 2].value, l2v = lows[lows.length - 1].value;
    if (h2v > h1v && l2v > l1v) trend = 'up';
    else if (h2v < h1v && l2v < l1v) trend = 'down';
    else trend = 'range';
  }
  return { swingHigh, swingLow, trend };
}

function getCandleConfirmation(candles, trend) {
  if (!candles || candles.length < 3) return { confirmed: false, reason: 'Not enough H1 candle data.' };
  if (trend !== 'up' && trend !== 'down') return { confirmed: false, reason: 'No clear trend to confirm.' };

  const lastClosed = candles.length - 2;
  let bestBodyPct = 0, bestDisplacement = null;
  for (let i = Math.max(1, lastClosed - 4); i <= lastClosed; i++) {
    const c = candles[i];
    const range = c.high - c.low;
    if (range <= 0) continue;
    const body = Math.abs(c.close - c.open);
    const bodyPct = body / range;
    const bullish = c.close > c.open;
    const dirMatch = (trend === 'up' && bullish) || (trend === 'down' && !bullish);
    if (dirMatch && bodyPct >= DISPLACEMENT_THRESHOLD && bodyPct > bestBodyPct) {
      bestBodyPct = bodyPct;
      bestDisplacement = { candle: c, bodyPct, bullish };
    }
  }
  if (!bestDisplacement) {
    return { confirmed: false, reason: 'No H1 displacement found.', bodyPercent: 0 };
  }
  return {
    confirmed: true,
    highProbability: bestBodyPct >= STRONG_DISPLACEMENT,
    bodyPercent: bestBodyPct,
    isBullish: bestDisplacement.bullish,
    time: bestDisplacement.candle.time,
  };
}

function calcEMA200(candles) {
  const closes = candles.map(c => c.close);
  const period = Math.min(200, closes.length);
  if (period < 2) return null;
  let ema = closes.slice(0, period).reduce((s, v) => s + v, 0) / period;
  const k = 2 / (period + 1);
  for (let i = period; i < closes.length; i++) ema = closes[i] * k + ema * (1 - k);
  const lastClose = closes[closes.length - 1];
  return { ema: parseFloat(ema.toFixed(2)), period, aboveEma: lastClose > ema, lastClose };
}

// Jalankan satu siklus analisis penuh, return signal valid (atau null kalau belum valid).
async function runAnalysisCycle(apiKey, apiSymbol) {
  const candles = await fetchCandlesH1(apiKey, apiSymbol);
  const { swingHigh, swingLow, trend } = analyzeSwings(candles, SWING_N);
  if (!swingHigh || !swingLow || (trend !== 'up' && trend !== 'down')) return null;

  const confirmation = getCandleConfirmation(candles, trend);
  if (!confirmation.confirmed) return null;

  const ema = calcEMA200(candles);
  const emaOk = !!ema && ((trend === 'up' && ema.aboveEma) || (trend === 'down' && !ema.aboveEma));
  if (!emaOk) return null;

  return {
    trend,
    swingHigh: swingHigh.value,
    swingLow: swingLow.value,
    confirmation,
    ema,
    signature: `${trend}|${confirmation.time}|${Math.round(confirmation.bodyPercent * 100)}`,
  };
}

module.exports = { runAnalysisCycle };
