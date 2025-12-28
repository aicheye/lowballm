import _ from 'lodash';
import { BarChart3, RefreshCw } from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis, YAxis
} from 'recharts';

// Helper to extract clean model name from full model ID
// Handles: claude-opus-4-5-xxx -> opus, gpt-5.2 -> gpt-5.2, gemini-2.5-pro -> gemini-2.5-pro
const getModelName = (modelId) => {
  if (!modelId) return 'Unknown';
  // If it's a short name like "gpt-5.2" or "gemini-2.5-pro", return as-is
  if (!modelId.includes('claude-') && !modelId.includes('20251') && !modelId.includes('20250')) {
    return modelId;
  }
  // For Claude models: claude-opus-4-5-20251101 -> opus
  const parts = modelId.split('-');
  if (parts.length >= 2 && parts[0] === 'claude') {
    return parts[1]; // opus, haiku, sonnet
  }
  // Fallback
  return parts[1] || modelId;
};

export function Charts({ onBack }) {
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [runs, setRuns] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const manifestRes = await fetch('/logs/manifest.json');
      if (!manifestRes.ok) throw new Error('Failed to load manifest');
      const manifest = await manifestRes.json();

      setProgress({ current: 0, total: manifest.length });

      const loadedRuns = [];
      const BATCH_SIZE = 10;
      for (let i = 0; i < manifest.length; i += BATCH_SIZE) {
        const batch = manifest.slice(i, i + BATCH_SIZE);
        const promises = batch.map(async (entry) => {
          try {
            const res = await fetch(`/logs/run_${entry.id}.json`);
            if (res.ok) return await res.json();
          } catch (e) {
            console.error(`Failed to load run ${entry.id}`, e);
          }
          return null;
        });

        const results = await Promise.all(promises);
        loadedRuns.push(...results.filter(Boolean));
        setProgress(prev => ({ ...prev, current: Math.min(prev.total, i + BATCH_SIZE) }));
      }

      setRuns(loadedRuns);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  // --- Data Processing for Charts ---

  // 1. Deal rate vs private value gap
  const dealRateData = useMemo(() => {
    const points = [];
    runs.forEach(run => {
      const finalPrice = run.dealPrice || (run.logs[run.logs.length - 1].content.offer);
      if (finalPrice) {
        // Seller: Gap = FinalPrice - SellerEstimate (Positive = Good)
        const sellerGap = finalPrice - run.seller.estimate;
        // Normalize gap by Estimate to handle different item values?
        // Let's stick to raw relative values or normalized? Normalized is safer.
        // But user asked for "price minus estimate". Let's do % deviation.
        const sellerGapPct = (sellerGap / run.seller.estimate) * 100;
        points.push({ gap: sellerGapPct, deal: run.dealReached ? 1 : 0 });

        // Buyer: Gap = BuyerEstimate - FinalPrice (Positive = Good)
        const buyerGap = run.buyer.estimate - finalPrice;
        const buyerGapPct = (buyerGap / run.buyer.estimate) * 100;
        points.push({ gap: buyerGapPct, deal: run.dealReached ? 1 : 0 });
      }
    });

    const buckets = {};
    const binSize = 5; // 5% bins
    points.forEach(p => {
      const bin = Math.floor(p.gap / binSize) * binSize;
      if (!buckets[bin]) buckets[bin] = { bin, total: 0, deals: 0 };
      buckets[bin].total++;
      buckets[bin].deals += p.deal;
    });

    return _.sortBy(Object.values(buckets), 'bin').map(b => ({
      ...b,
      prob: parseFloat((b.deals / b.total).toFixed(2))
    })).filter(b => b.total > 2);
  }, [runs]);

  // 2. Average surplus captured
  const surplusData = useMemo(() => {
    const modelStats = {};
    runs.forEach(run => {
      if (!run.dealReached) return;
      const trueVal = run.trueValue;

      // Surplus = (Value captured) / True Value
      const sellerSurplus = (run.dealPrice - trueVal) / trueVal;
      const sellerModel = getModelName(run.seller.model);
      if (!modelStats[sellerModel]) modelStats[sellerModel] = { name: sellerModel, surplusSum: 0, count: 0 };
      modelStats[sellerModel].surplusSum += sellerSurplus;
      modelStats[sellerModel].count++;

      const buyerSurplus = (trueVal - run.dealPrice) / trueVal;
      const buyerModel = getModelName(run.buyer.model);
      if (!modelStats[buyerModel]) modelStats[buyerModel] = { name: buyerModel, surplusSum: 0, count: 0 };
      modelStats[buyerModel].surplusSum += buyerSurplus;
      modelStats[buyerModel].count++;
    });

    const arr = Object.values(modelStats).map(s => ({
      name: s.name,
      avgSurplus: parseFloat((s.surplusSum / s.count * 100).toFixed(2)),
      count: s.count
    }));

    // Sort descending so largest average surplus appears first (highest -> lowest)
    return _.orderBy(arr, ['avgSurplus'], ['desc']);
  }, [runs]);

  // 3. Pareto efficiency scatter
  const paretoData = useMemo(() => {
    return runs.filter(r => r.dealReached).map(run => {
      const buyerPrivateSurplus = (run.buyer.estimate - run.dealPrice) / run.buyer.estimate;
      const sellerPrivateSurplus = (run.dealPrice - run.seller.estimate) / run.seller.estimate;
      const buyerModel = getModelName(run.buyer.model);
      const sellerModel = getModelName(run.seller.model);
      return {
        x: parseFloat((buyerPrivateSurplus * 100).toFixed(1)),
        y: parseFloat((sellerPrivateSurplus * 100).toFixed(1)),
        pair: `${run.buyer.name} vs ${run.seller.name}`,
        buyerModel,
        sellerModel,
        id: run.id
      };
    });
  }, [runs]);

  // 4. Breakdown rate vs turn count
  const breakdownData = useMemo(() => {
    const turns = {};
    runs.forEach(run => {
      const t = run.logs.length;
      if (!turns[t]) turns[t] = { turn: t, deals: 0, failures: 0 };
      if (run.dealReached) turns[t].deals++;
      else turns[t].failures++;
    });
    return Object.values(turns).sort((a, b) => a.turn - b.turn);
  }, [runs]);

  // 5. Concession curves
  const concessionData = useMemo(() => {
    // Group by Seller Model.
    // X axis: Turn Progress (0 to 1, or just Turn # up to max?)
    // Let's use Turn #.
    // Y axis: Offer Value % relative to First Offer.
    // Only analyze Sellers for consistency (Asking Price dropping).
    // Or Buyers (Offer Price rising). 
    // Let's average "Gap Deviation" or just normalized offer.

    // Normalized Offer: 
    // Sellers: (CurrentOffer - PrivateVal) / (FirstOffer - PrivateVal) starts at 1.0, goes down.
    // Buyers: (PrivateVal - CurrentOffer) / (PrivateVal - FirstOffer) starts at 1.0, goes down?
    // Let's simplify: % of Private Estimate.
    // Sellers start high (>100%), go down towards 100%.
    // Buyers start low (<100%), go up towards 100%.

    const curves = {};

    // Aggregate per-model, per-turn offers (seller role)
    runs.forEach(run => {
      const model = getModelName(run.seller.model);
      if (!curves[model]) curves[model] = {};

      run.logs.forEach((log, idx) => {
        if (log.role === 'seller' && log.content && log.content.offer) {
          const turn = idx + 1;
          const offerPct = (log.content.offer / run.seller.estimate) * 100;

          // Remove extreme outliers (offers more than 500% of estimate)
          if (offerPct > 500 || offerPct < -500) return;

          if (!curves[model][turn]) curves[model][turn] = { sum: 0, count: 0 };
          curves[model][turn].sum += offerPct;
          curves[model][turn].count++;
        }
      });
    });

    // Collect turns and models
    const turns = new Set();
    Object.values(curves).forEach(modelObj => Object.keys(modelObj).forEach(t => turns.add(parseInt(t))));
    const sortedTurns = Array.from(turns).sort((a, b) => a - b);
    const models = Object.keys(curves);

    // Compute per-model total sample counts so we can focus on the most-represented models
    const modelCounts = models.reduce((acc, m) => {
      acc[m] = Object.values(curves[m]).reduce((s, v) => s + (v.count || 0), 0);
      return acc;
    }, {});

    // Show only top N models to reduce visual clutter
    const TOP_N = 6;
    const topModels = models.sort((a, b) => (modelCounts[b] || 0) - (modelCounts[a] || 0)).slice(0, TOP_N);

    // Build raw per-turn series for top models
    const rawSeries = topModels.reduce((acc, m) => {
      acc[m] = sortedTurns.map(t => {
        const v = curves[m][t];
        return v ? parseFloat((v.sum / v.count).toFixed(1)) : null;
      });
      return acc;
    }, {});

    // Simple smoothing (3-point weighted moving average) to make lines easier to read
    const smooth = arr => {
      const out = [];
      for (let i = 0; i < arr.length; i++) {
        const prev = arr[i - 1] || arr[i];
        const cur = arr[i] || (arr[i - 1] || arr[i + 1] || null);
        const next = arr[i + 1] || arr[i];
        if (cur === null) {
          out.push(null);
          continue;
        }
        const s = ( (prev === null ? cur : prev) * 0.25 ) + (cur * 0.5) + ( (next === null ? cur : next) * 0.25 );
        out.push(parseFloat(s.toFixed(1)));
      }
      return out;
    };

    const smoothed = {};
    topModels.forEach(m => {
      smoothed[m] = smooth(rawSeries[m]);
    });

    // Formatting for Recharts: array of { turn: 1, modelA: 150, modelB: 140 ... }
    return sortedTurns.map((t, idx) => {
      const entry = { turn: t };
      topModels.forEach(model => {
        const val = smoothed[model][idx];
        if (val !== null && val !== undefined) entry[model] = val;
      });
      return entry;
    });
  }, [runs]);

  // 6. First offer anchoring strength
  const anchoringData = useMemo(() => {
    // X: Initial Offer distance from Fair Price (True Value)
    // Y: Final Deal Price distance from Fair Price
    // Normalize by True Value
    // Seller: Initial Offer 150 (TV 100) -> +50%. Deal 110 -> +10%.
    // Buyer: Initial Offer 50 (TV 100) -> -50%. Deal 90 -> -10%.
    // We want to see if Higher Initial Offer leads to Higher Deal Price.

    const points = [];
    runs.forEach(run => {
      if (!run.dealReached) return;

      // Analyze Seller Anchors
      const sellerFirst = run.logs.find(l => l.role === 'seller')?.content.offer;
      if (sellerFirst) {
        const anchor = (sellerFirst - run.trueValue) / run.trueValue;
        const outcome = (run.dealPrice - run.trueValue) / run.trueValue;

        const x = parseFloat((anchor * 100).toFixed(1));
        const y = parseFloat((outcome * 100).toFixed(1));

        // Filter extreme outliers beyond +/-500%
        if (Math.abs(x) > 500 || Math.abs(y) > 500) return;

        points.push({
          x,
          y,
          role: 'Seller',
          model: getModelName(run.seller.model)
        });
      }
    });
    return points;
  }, [runs]);

  // 7. Acceptance threshold heatmap
  const heatmapData = useMemo(() => {
    // Rows: Turn # (1..10)
    // Cols: Offer Quality (Offer / PrivateValue). 
    // Bins: 0.8, 0.9, 1.0, 1.1, 1.2
    // Value: Deal Acceptance Rate?
    // Actually, we want to know: "At Turn T, if Offer is X% of Value, what is Prob(Accept)?"
    // We need to look at every turn where an offer is on the table and the DECISION made by the OTHER player.

    // Skew towards unfair deals (lower quality = bad deal for responder)
    const bins = [0.6, 0.7, 0.8, 0.9, 1.0]; // Lower bound - emphasizes unfair offers
    const data = {}; // Key: "Turn-Bin" -> {accepts: 0, total: 0}

    runs.forEach(run => {
      run.logs.forEach((log, idx) => {
        // If this log is a message from A, look at the PREVIOUS offer from B that A is responding to.
        if (idx === 0) return;
        const prevLog = run.logs[idx - 1];
        if (!prevLog.content.offer) return;

        // Current responder is `log.sender`.
        // Offer on table is `prevLog.content.offer`.
        // Is it accepted? `log.content.deal === true`.

        const responderRole = log.role; // 'buyer' or 'seller'
        const estimate = responderRole === 'buyer' ? run.buyer.estimate : run.seller.estimate;
        const offer = prevLog.content.offer;

        // Value Ratio:
        // For Buyer: (PrivateVal - Offer)/PrivateVal ? Or just Offer/PrivateVal?
        // "Offer Quality".
        // For Seller: Offer / Estimate. (High is good).
        // For Buyer: (2*Estimate - Offer) / Estimate ? No that's complex.
        // Let's just use "Surplus Ratio" calculation from Chart 1 logic roughly.
        // Simplification: Ratio = Offer / Estimate.
        // Buyer wants Low Ratio. Seller wants High Ratio.

        let quality = 0;
        if (responderRole === 'seller') {
          // Seller evaluating Buyer offer.
          quality = offer / estimate; // 0.8 means bad, 1.2 means good.
        } else {
          // Buyer evaluating Seller offer. 
          // We map to same scale: "Goodness".
          // Buyer wants low price.
          // Let's invert: If Offer = 0.8*Est, that's GOOD (like 1.2 for seller).
          // Quality = Estimate / Offer. 
          quality = estimate / offer;
        }

        // Find bin - skewed towards unfair deals
        // Bins: 0.6, 0.7, 0.8, 0.9, 1.0 (values below 1.0 are unfair)
        let bin = Math.floor(quality * 10) / 10;
        if (bin < 0.6) bin = 0.6; // Catch-all lowest
        if (bin > 1.0) bin = 1.0; // Cap at 1.0 (fair deal)

        const turn = Math.ceil((idx + 1) / 2); // Round turn
        const key = `${turn}-${bin}`;

        if (!data[key]) data[key] = { accepts: 0, total: 0 };
        data[key].total++;
        if (log.content.deal) data[key].accepts++;
      });
    });

    return data;
  }, [runs]);

  // 8. Win Matrix
  const winMatrix = useMemo(() => {
    // Model vs Model Average Surplus
    const stats = {}; // Key: "ModelA-ModelB"
    const models = new Set();

    runs.forEach(run => {
      if (!run.dealReached) return;
      const buyer = getModelName(run.buyer.model);
      const seller = getModelName(run.seller.model);
      models.add(buyer);
      models.add(seller);

      // Record surpluses
      const buyerSurplus = (run.trueValue - run.dealPrice) / run.trueValue;
      const sellerSurplus = (run.dealPrice - run.trueValue) / run.trueValue;

      // We want (Row Model as Buyer vs Col Model as Seller) AND (Row Model as Seller vs Col Model as Buyer).
      // Let's just create a matrix where Cell(Row, Col) = Avg Surplus of Row Model when playing against Col Model.
      // Requires aggregating both roles? Or separate matrices?
      // "Cell value = average surplus of row model vs column model" usually implies aggregated performance.

      // Row=Buyer, Col=Seller (Buyer's Surplus)
      // Let's do that.

      const key = `${buyer}:${seller}`;
      if (!stats[key]) stats[key] = { sum: 0, count: 0 };
      stats[key].sum += buyerSurplus;
      stats[key].count++;

      // We might also want separate Seller surplus? 
      // Let's simplify: Matrix shows Row Model's surplus against Col Model.
      // But roles matter.
      // Let's make it symmetric-ish: Total Surplus Captured by Row against Col?
      // No, Win Matrix usually means "How much A beats B".
      // Let's use: (A's Surplus) - (B's Surplus) in that match?
      // BuyerSurplus - SellerSurplus.
      // If A is Buyer, B is Seller. Score = BuyS - SellS.
      // If A is Seller, B is Buyer. Score = SellS - BuyS.

      // Store for A vs B
      const k1 = `${buyer}:${seller}`; // A=Buyer
      if (!stats[k1]) stats[k1] = { score: 0, n: 0 };
      stats[k1].score += (buyerSurplus); // Just raw surplus for now
      stats[k1].n++;

      // Also store for Seller?
      // The prompt asks "Win Matrix". 
      // Let's just show "Avg Surplus %" for ROW model when playing against COL model.
      // We need 2 values per cell? Or average across roles?
      // Let's Average across roles.
      // If A plays B.
      // Case 1: A=Buyer, B=Seller. A gets S_buy.
      // Case 2: A=Seller, B=Buyer. A gets S_sell.
      // Average them.

      // Helper to update
      const update = (m1, m2, s) => {
        const k = `${m1}:${m2}`;
        if (!stats[k]) stats[k] = { sum: 0, count: 0 };
        stats[k].sum += s;
        stats[k].count++;
      };

      update(buyer, seller, buyerSurplus);
      update(seller, buyer, sellerSurplus);
    });

    return { models: Array.from(models).sort(), stats };
  }, [runs]);


  // 9. Efficiency (Tokens vs Return)
  const efficiencyData = useMemo(() => {
    // X: Avg Tokens (Thinking)
    // Y: Avg Surplus (Return)
    // Per Model? Or per Run?
    // Per Model allows us to see "Does thinking more help MODEL X?"
    // Or just scatter of all games to see general trend.
    // Let's do Per Model (+ Scatter of games if possible, but let's stick to Aggregated Model dots for clarity or Scatter of All Runs colored by model).
    // Scatter of All Runs colored by Model is best.

    const points = [];
    runs.forEach(run => {
      if (!run.dealReached) return; // Only successful deals? Or all? 
      // If we include failures (score 0), it lowers average. Hard to plot run-by-run if score is 0.
      // Let's plot ALL runs.

      const trueVal = run.trueValue;

      // Seller
      if (run.seller.thinkingTokens) {
        const salary = (run.dealReached && run.dealPrice) ? (run.dealPrice - trueVal) / trueVal : 0;
        // Or usage Score from run?
        points.push({
          x: run.seller.thinkingTokens,
          y: parseFloat((run.seller.score * 100).toFixed(1)),
          model: getModelName(run.seller.model),
          role: 'Seller'
        });
      }

      // Buyer
      if (run.buyer.thinkingTokens) {
        points.push({
          x: run.buyer.thinkingTokens,
          y: parseFloat((run.buyer.score * 100).toFixed(1)),
          model: getModelName(run.buyer.model),
          role: 'Buyer'
        });
      }
    });
    return points;
  }, [runs]);


  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] text-slate-400">
        <RefreshCw className="w-8 h-8 animate-spin mb-4 text-emerald-500" />
        <p>Loading benchmark runs...</p>
        <p className="text-sm mt-2 font-mono">{progress.current} / {progress.total}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8 text-center text-red-400 bg-red-900/10 border border-red-900 rounded">
        Error loading data: {error}
        <button onClick={loadData} className="block mx-auto mt-4 px-4 py-2 bg-slate-800 rounded hover:bg-slate-700 text-white">Retry</button>
      </div>
    );
  }

  // Color palette for lines
  const colors = ["#34d399", "#60a5fa", "#f87171", "#c084fc", "#fbbf24"];

  return (
    <div className="space-y-8 animate-in fade-in duration-500 pb-20">
      <div className="flex items-center gap-4 mb-6 top-0 bg-slate-900/95 backdrop-blur z-20 py-4 border-b border-slate-800">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <BarChart3 className="w-6 h-6 text-emerald-400" />
            Analytics Dashboard
          </h2>
          <span className="text-sm text-slate-500 font-mono">{runs.length} runs analyzed</span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">

        {/* 1. Deal Probability */}
        <div className="bg-slate-800/50 p-6 rounded-xl border border-slate-700">
          <h3 className="text-lg font-semibold mb-2 text-emerald-400">1. Deal Probability vs Value Gap</h3>
          <p className="text-xs text-slate-400 mb-6">X-Axis: % Gap (Private Value vs Final Price). Positive = Good Deal.</p>
          <div className="h-64 text-xs font-sans">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={dealRateData} margin={{ top: 5, right: 20, bottom: 20, left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="bin" stroke="#94a3b8" label={{ value: 'Gap %', position: 'bottom', offset: 0 }} />
                <YAxis stroke="#94a3b8" domain={[0, 1]} label={{ value: 'Prob. of Deal', angle: -90, position: 'insideLeft' }} />
                <Tooltip contentStyle={{ backgroundColor: '#0f172a', color: '#f1f5f9', border: '1px solid #334155', borderRadius: '4px' }} itemStyle={{ color: '#f1f5f9' }} labelStyle={{ color: '#94a3b8' }} />
                <ReferenceLine x={0} stroke="#94a3b8" strokeDasharray="3 3" label={{ value: 'Break Even', position: 'top', fill: '#94a3b8', fontSize: 10 }} />
                <Line type="monotone" dataKey="prob" stroke="#34d399" strokeWidth={2} dot={{ fill: '#34d399' }} activeDot={{ r: 6 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* 2. Surplus */}
        <div className="bg-slate-800/50 p-6 rounded-xl border border-slate-700">
          <h3 className="text-lg font-semibold mb-2 text-blue-400">2. Avg Surplus Captured</h3>
          <p className="text-xs text-slate-400 mb-6">% Value captured relative to True Value. Higher is better.</p>
          <div className="h-64 text-xs">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={surplusData} layout="vertical" margin={{ top: 5, right: 30, bottom: 20, left: 30 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis type="number" stroke="#94a3b8" unit="%" />
                <YAxis dataKey="name" type="category" stroke="#94a3b8" width={80} />
                <Tooltip cursor={{ fill: '#334155', opacity: 0.2 }} contentStyle={{ backgroundColor: '#0f172a', color: '#f1f5f9', border: '1px solid #334155', borderRadius: '4px' }} itemStyle={{ color: '#f1f5f9' }} labelStyle={{ color: '#94a3b8' }} />
                <Bar dataKey="avgSurplus" fill="#60a5fa" radius={[0, 4, 4, 0]} label={{ position: 'right', fill: '#94a3b8', fontSize: 10 }} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* 3. Pareto */}
        <div className="bg-slate-800/50 p-6 rounded-xl border border-slate-700">
          <h3 className="text-lg font-semibold mb-2 text-purple-400">3. Pareto Efficiency</h3>
          <p className="text-xs text-slate-400 mb-6">Buyer vs Seller Private Surplus %. Top-Right is Optimal. Colored by Buyer Model.</p>
          <div className="h-64 text-xs">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 5, right: 20, bottom: 20, left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis type="number" dataKey="x" name="Buyer Surplus" unit="%" stroke="#94a3b8" label={{ value: 'Buyer Surplus %', position: 'bottom', offset: 0 }} />
                <YAxis type="number" dataKey="y" name="Seller Surplus" unit="%" stroke="#94a3b8" label={{ value: 'Seller Surplus %', angle: -90, position: 'insideLeft' }} />
                <Tooltip cursor={{ strokeDasharray: '3 3' }} contentStyle={{ backgroundColor: '#0f172a', color: '#f1f5f9', border: '1px solid #334155', borderRadius: '4px' }} itemStyle={{ color: '#f1f5f9' }} labelStyle={{ color: '#94a3b8' }} />
                <Legend />
                {_.uniq(paretoData.map(d => d.buyerModel)).map((model, i) => (
                  <Scatter
                    key={model}
                    name={model}
                    data={paretoData.filter(d => d.buyerModel === model)}
                    fill={colors[i % colors.length]}
                    fillOpacity={0.6}
                    shape="circle"
                  />
                ))}
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* 4. Breakdown */}
        <div className="bg-slate-800/50 p-6 rounded-xl border border-slate-700">
          <h3 className="text-lg font-semibold mb-2 text-orange-400">4. Breakdown vs Turn Count</h3>
          <p className="text-xs text-slate-400 mb-6">When do negotiations end? Deal vs Fail frequency.</p>
          <div className="h-64 text-xs">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={breakdownData} margin={{ top: 5, right: 20, bottom: 20, left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="turn" stroke="#94a3b8" label={{ value: 'Turn #', position: 'bottom', offset: 0 }} />
                <YAxis stroke="#94a3b8" />
                <Tooltip contentStyle={{ backgroundColor: '#0f172a', color: '#f1f5f9', border: '1px solid #334155', borderRadius: '4px' }} itemStyle={{ color: '#f1f5f9' }} labelStyle={{ color: '#94a3b8' }} />
                <Legend layout="horizontal" verticalAlign="top" align="right" wrapperStyle={{ paddingBottom: '10px' }} />
                <Bar dataKey="deals" stackId="a" fill="#34d399" name="Deals" />
                <Bar dataKey="failures" stackId="a" fill="#f87171" name="Failures" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* 5. Concession Curves */}
        <div className="bg-slate-800/50 p-6 rounded-xl border border-slate-700 md:col-span-2">
          <h3 className="text-lg font-semibold mb-2 text-yellow-400">5. Concession Curves (Seller)</h3>
          <p className="text-xs text-slate-400 mb-6">Average Offer % of Estimate over Turns. Flat = Stubborn. Steep = Panic. Showing top models by sample count.</p>
          <div className="h-64 text-xs">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={concessionData} margin={{ top: 5, right: 20, bottom: 20, left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="turn" stroke="#94a3b8" label={{ value: 'Turn #', position: 'bottom', offset: 0 }} />
                <YAxis stroke="#94a3b8" unit="%" domain={['auto', 'auto']} />
                <Tooltip contentStyle={{ backgroundColor: '#0f172a', color: '#f1f5f9', border: '1px solid #334155', borderRadius: '4px' }} itemStyle={{ color: '#f1f5f9' }} labelStyle={{ color: '#94a3b8' }} />
                <Legend layout="horizontal" verticalAlign="top" align="right" wrapperStyle={{ paddingBottom: '10px' }} />
                {Object.keys(concessionData[0] || {}).filter(k => k !== 'turn').map((model, i) => (
                  <Line
                    key={model}
                    type="monotone"
                    dataKey={model}
                    stroke={colors[i % colors.length]}
                    strokeWidth={3}
                    strokeOpacity={0.95}
                    dot={false}
                    // Slightly smooth rendering and less visual clutter
                    isAnimationActive={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* 6. Anchoring */}
        <div className="bg-slate-800/50 p-6 rounded-xl border border-slate-700">
          <h3 className="text-lg font-semibold mb-2 text-pink-400">6. First Offer Anchoring</h3>
          <p className="text-xs text-slate-400 mb-6">Does a bolder first offer leads to a better deal? (Seller View, colored by model)</p>
          <div className="h-64 text-xs">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 5, right: 20, bottom: 20, left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis type="number" dataKey="x" name="First Offer vs TV" unit="%" stroke="#94a3b8" label={{ value: 'Anchor %', position: 'bottom', offset: 0 }} />
                <YAxis type="number" dataKey="y" name="Deal Price vs TV" unit="%" stroke="#94a3b8" label={{ value: 'Outcome %', angle: -90, position: 'insideLeft' }} />
                <Tooltip cursor={{ strokeDasharray: '3 3' }} contentStyle={{ backgroundColor: '#0f172a', color: '#f1f5f9', border: '1px solid #334155', borderRadius: '4px' }} itemStyle={{ color: '#f1f5f9' }} labelStyle={{ color: '#94a3b8' }} />
                <Legend />
                {_.uniq(anchoringData.map(d => d.model)).map((model, i) => (
                  <Scatter
                    key={model}
                    name={model}
                    data={anchoringData.filter(d => d.model === model)}
                    fill={colors[i % colors.length]}
                    fillOpacity={0.6}
                  />
                ))}
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* 7. Heatmap */}
        <div className="bg-slate-800/50 p-6 rounded-xl border border-slate-700">
          <h3 className="text-lg font-semibold mb-2 text-teal-400">7. Acceptance Heatmap</h3>
          <p className="text-xs text-slate-400 mb-4">Probability of Acceptance by Turn & Offer Quality (1.0 = Fair)</p>

          <div className="grid grid-cols-6 gap-1 text-xs text-center font-mono">
            <div className="col-span-1"></div>
            {/* Headers for Quality Bins - skewed to unfair deals */}
            {['<0.7', '0.7', '0.8', '0.9', '1.0'].map(h => <div key={h} className="text-slate-500 py-1">{h}</div>)}

            {/* Rows */}
            {[1, 2, 3, 4, 5, 6].map(turn => (
              <React.Fragment key={turn}>
                <div className="text-slate-500 flex items-center justify-end pr-2">Turn {turn}</div>
                {['0.6', '0.7', '0.8', '0.9', '1.0'].map(bin => {
                  const key = `${turn}-${bin}`;
                  const stats = heatmapData[key] || { accepts: 0, total: 0 };
                  const hasEnoughData = stats.total > 3; // Only show with >3 datapoints
                  const prob = hasEnoughData ? stats.accepts / stats.total : 0;
                  const alpha = Math.max(0.1, prob * 0.9); // Opacity based on prob

                  return (
                    <div
                      key={bin}
                      className="h-8 rounded flex items-center justify-center border border-slate-700/50 relative group cursor-help"
                      style={{ backgroundColor: hasEnoughData ? `rgba(52, 211, 153, ${alpha})` : 'rgba(30, 41, 59, 0.5)' }}
                    >
                      <span className={hasEnoughData && prob > 0.5 ? 'text-slate-900 font-bold' : 'text-slate-400'}>
                        {hasEnoughData ? (prob * 100).toFixed(0) + '%' : '-'}
                      </span>
                      {/* Tooltip */}
                      <div className="absolute opacity-0 group-hover:opacity-100 bottom-full mb-2 bg-slate-900 text-slate-200 text-[10px] p-2 rounded shadow-xl pointer-events-none w-32 z-10 border border-slate-700">
                        {stats.accepts}/{stats.total} Accepted
                      </div>
                    </div>
                  );
                })}
              </React.Fragment>
            ))}
          </div>
        </div>

        {/* 8. Win Matrix */}
        <div className="bg-slate-800/50 p-6 rounded-xl border border-slate-700 md:col-span-2">
          <h3 className="text-lg font-semibold mb-2 text-indigo-400">8. Model vs Model Surplus Matrix</h3>
          <p className="text-xs text-slate-400 mb-6">Average Surplus % Captured. Reading: Row Model vs Col Model.</p>

          <div className="overflow-x-auto">
            <table className="w-full text-xs font-mono">
              <thead>
                <tr>
                  <th className="p-2 text-left bg-slate-900/50">Model</th>
                  {winMatrix.models.map(m => (
                    <th key={m} className="p-2 bg-slate-900/50">{m}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {winMatrix.models.map(rowModel => (
                  <tr key={rowModel} className="border-t border-slate-700/50">
                    <td className="p-2 font-bold bg-slate-900/30">{rowModel}</td>
                    {winMatrix.models.map(colModel => {
                      if (rowModel === colModel) return <td key={colModel} className="p-2 text-center text-slate-600">-</td>;

                      const key = `${rowModel}:${colModel}`;
                      const stats = winMatrix.stats[key];
                      const val = stats && stats.count > 0 ? (stats.sum / stats.count * 100).toFixed(1) : null;

                      let color = "text-slate-400";
                      if (val) {
                        const num = parseFloat(val);
                        if (num > 5) color = "text-emerald-400 font-bold";
                        else if (num > 0) color = "text-emerald-200";
                        else if (num > -5) color = "text-yellow-200";
                        else color = "text-red-400";
                      }

                      return (
                        <td key={colModel} className={`p-2 text-center ${color}`}>
                          {val ? `${val}%` : 'N/A'}
                          {stats && <span className="text-[9px] text-slate-600 block">{stats.count} games</span>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

      </div>

      {/* 9. Efficiency */}
      < div className="bg-slate-800/50 p-6 rounded-xl border border-slate-700 md:col-span-2" >
        <h3 className="text-lg font-semibold mb-2 text-lime-400">9. Efficiency: Return on Thought</h3>
        <p className="text-xs text-slate-400 mb-6">Does "Thinking Harder" (more output tokens) lead to better Scores? (Scatter by Game)</p>
        <div className="h-64 text-xs">
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 5, right: 20, bottom: 20, left: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis type="number" dataKey="x" name="Thinking Tokens" stroke="#94a3b8" label={{ value: 'Tokens Generated', position: 'bottom', offset: 0 }} />
              <YAxis type="number" dataKey="y" name="Score %" unit="%" stroke="#94a3b8" label={{ value: 'Score %', angle: -90, position: 'insideLeft' }} />
              <Tooltip cursor={{ strokeDasharray: '3 3' }} contentStyle={{ backgroundColor: '#0f172a', color: '#f1f5f9', border: '1px solid #334155', borderRadius: '4px' }} itemStyle={{ color: '#f1f5f9' }} labelStyle={{ color: '#94a3b8' }} />
              <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="3 3" />
              <Legend />
              {/* We need separate Scatters for colors? Or use Cell? 
                       Recharts Scatter doesn't auto-color by category easily without separate Scatter comps.
                       Let's slice by model.
                   */}
              {_.uniq(efficiencyData.map(d => d.model)).map((model, i) => (
                <Scatter
                  key={model}
                  name={model}
                  data={efficiencyData.filter(d => d.model === model)}
                  fill={colors[i % colors.length]}
                  shape="circle"
                />
              ))}
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      </div >
    </div>
  );
}
