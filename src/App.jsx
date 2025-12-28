import { ArrowLeft, BarChart3, DollarSign, Play } from "lucide-react";
import { useEffect, useState } from "react";
import { BenchmarkRunner } from "./BenchmarkRunner";
import { Charts } from "./Charts";

export default function App() {
  const [runs, setRuns] = useState([]);
  const [selectedRunId, setSelectedRunId] = useState(null);
  const [selectedRunData, setSelectedRunData] = useState(null);
  const [showRunner, setShowRunner] = useState(false);
  const [showCharts, setShowCharts] = useState(false);
  const [loading, setLoading] = useState(true);

  const [selectedTournament, setSelectedTournament] = useState("All");

  // Load Manifest logic
  const fetchManifest = async () => {
    try {
      const res = await fetch("/logs/manifest.json");
      if (res.ok) {
        const data = await res.json();
        setRuns(data);
      } else {
        // If 404, implies no logs yet.
        setRuns([]);
      }
    } catch (e) {
      console.error("Failed to load manifest", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchManifest();
  }, []);

  // Load specific run
  useEffect(() => {
    if (selectedRunId) {
      fetch(`/logs/run_${selectedRunId}.json`)
        .then((res) => res.json())
        .then((data) => setSelectedRunData(data))
        .catch((err) => console.error(err));
    } else {
      setSelectedRunData(null);
    }
  }, [selectedRunId]);

  // Derived state for filtering
  const tournaments = ["All", ...new Set(runs.map(r => r.tournament || "Uncategorized").filter(Boolean))];
  const filteredRuns = selectedTournament === "All"
    ? runs
    : runs.filter(r => (r.tournament || "Uncategorized") === selectedTournament);

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 font-sans">
      <header className="bg-slate-950 border-b border-slate-800 p-4 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <h1 className="text-xl font-bold flex items-center gap-2 text-emerald-400">
            <DollarSign className="w-6 h-6" />
            LowbaLLM{" "}
            <span className="text-slate-500 font-normal text-sm ml-2">
              Benchmark Viewer
            </span>
          </h1>

          <div className="flex gap-4">
            {!showRunner && !selectedRunId && !showCharts && (
              <>
                <button
                  onClick={() => setShowCharts(true)}
                  className="text-sm bg-slate-800 hover:bg-slate-700 text-white px-3 py-1 rounded flex items-center gap-1 transition-colors border border-slate-700"
                >
                  <BarChart3 className="w-3 h-3" /> Analytics
                </button>
                <button
                  onClick={() => setShowRunner(true)}
                  className="text-sm bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1 rounded flex items-center gap-1 transition-colors font-medium border border-emerald-500/50 shadow-lg shadow-emerald-900/20"
                >
                  <Play className="w-3 h-3" /> New Benchmark Run
                </button>
              </>
            )}

            {(selectedRunId || showRunner || showCharts) && (
              <button
                onClick={() => {
                  setSelectedRunId(null);
                  setShowRunner(false);
                  setShowCharts(false);
                  if (showRunner) fetchManifest(); // Refresh list on exit
                }}
                className="text-sm bg-slate-800 hover:bg-slate-700 px-3 py-1 rounded flex items-center gap-1 transition-colors"
              >
                <ArrowLeft className="w-4 h-4" /> Back to List
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto p-4 md:p-8">
        {showCharts ? (
          <Charts onBack={() => setShowCharts(false)} />
        ) : showRunner ? (
          <BenchmarkRunner
            onBack={() => {
              setShowRunner(false);
              fetchManifest();
            }}
            onComplete={() => {
              // Optional: could show toast or just stay on runner page
            }}
          />
        ) : loading ? (
          <div className="text-center py-20 text-slate-500 animate-pulse">
            Loading negotiation logs...
          </div>
        ) : !selectedRunId ? (
          <div className="space-y-6">
            <div className="flex justify-between items-end">
              <div>
                <h2 className="text-2xl font-semibold">Recent Negotiations</h2>
                {tournaments.length > 1 && ( // Show if we have any data (All + Uncategorized = 2)
                  <div className="flex gap-2 mt-2 flex-wrap">
                    {tournaments.map(t => (
                      <button
                        key={t}
                        onClick={() => setSelectedTournament(t)}
                        className={`text-xs px-2 py-1 rounded border ${selectedTournament === t ? 'bg-slate-700 border-emerald-500 text-white' : 'bg-transparent border-slate-700 text-slate-400 hover:border-slate-500'}`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <button
                onClick={fetchManifest}
                className="text-xs text-blue-400 hover:underline"
              >
                Refresh
              </button>
            </div>

            {filteredRuns.length === 0 && (
              <div className="p-10 border border-dashed border-slate-700 rounded text-center text-slate-500">
                {selectedTournament !== "All" ? "No matches in this tournament." :
                  <>
                    No negotiations found. Run the CLI to generate data.
                    <br />
                    <code className="bg-slate-800 px-2 py-1 rounded text-orange-300 mt-2 block w-fit mx-auto">
                      npm start
                    </code>{" "}
                    (in benchmark-cli) OR click "New Benchmark Run" above.
                  </>}
              </div>
            )}

            <div className="grid gap-4">
              {filteredRuns.map((run) => (
                <div
                  key={run.id}
                  onClick={() => setSelectedRunId(run.id)}
                  className="bg-slate-800/50 border border-slate-700 p-4 rounded-lg hover:bg-slate-800 cursor-pointer transition-all hover:border-emerald-500/50 group"
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="flex items-center gap-2">
                        <div className="font-medium text-lg text-slate-200 group-hover:text-white">
                          {run.item || "Unknown Item"}
                        </div>
                        {run.tournament && (
                          <span className="text-[10px] bg-slate-900 text-slate-500 px-1.5 py-0.5 rounded uppercase tracking-wider">
                            {run.tournament}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-400 mt-1">
                        {new Date(run.date).toLocaleString()}
                      </div>
                    </div>
                    <div className="text-right justify-end flex flex-col items-end">
                      <div className="text-xs text-slate-500 mb-1">
                        True Value: ${run.trueValue}
                      </div>
                      {/** align the deal price to the right */}
                      <div
                        className={`text-sm font-bold px-2 py-0.5 rounded ${run.dealReached ? "bg-emerald-900/50 text-emerald-400" : "bg-red-900/50 text-red-400"} w-fit`}
                      >
                        {run.dealReached
                          ? `Sold: $${run.dealPrice}`
                          : "NO DEAL"}
                      </div>
                      <div className="text-xs text-slate-500 mt-1">
                        ID: {run.id}
                      </div>
                    </div>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-4 text-sm bg-slate-900/50 p-3 rounded border border-slate-700/50">
                    <div>
                      <div className="text-xs text-slate-500 uppercase font-bold">
                        Buyer
                      </div>
                      <div
                        className="text-slate-300 truncate"
                        title={run.buyer.name}
                      >
                        {run.buyer.name || "Unknown"}
                      </div>
                      <div
                        className={
                          getScoreColor(run.buyer.score) + " text-xs font-mono"
                        }
                      >
                        Score: {(run.buyer.score * 100).toFixed(1)}%
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-500 uppercase font-bold">
                        Seller
                      </div>
                      <div
                        className="text-slate-300 truncate"
                        title={run.seller.name}
                      >
                        {run.seller.name || "Unknown"}
                      </div>
                      <div
                        className={
                          getScoreColor(run.seller.score) + " text-xs font-mono"
                        }
                      >
                        Score: {(run.seller.score * 100).toFixed(1)}%
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : selectedRunData ? (
          <div>
            <div className="grid md:grid-cols-2 gap-6 mb-8">
              {/* Buyer Card */}
              <div className="bg-slate-800 border-l-4 border-blue-500 p-4 rounded">
                <div className="text-blue-400 text-xs uppercase tracking-wider font-bold mb-1">
                  Buyer
                </div>
                <div className="text-xl font-medium">
                  {selectedRunData.buyer.name}
                </div>
                <div className="text-sm text-slate-400 font-mono mt-1">
                  {selectedRunData.buyer.model}
                </div>
                <div className="mt-4 text-sm">
                  <div className="flex justify-between border-b border-slate-700 pb-1 mb-1">
                    <span>Estimate</span>
                    <span className="text-slate-300">
                      ${selectedRunData.buyer.estimate}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Score</span>
                    <span
                      className={`font-bold ${getScoreColor(selectedRunData.buyer.score)}`}
                    >
                      {(selectedRunData.buyer.score * 100).toFixed(1)}%
                    </span>
                  </div>
                </div>
              </div>

              {/* Seller Card */}
              <div className="bg-slate-800 border-l-4 border-orange-500 p-4 rounded">
                <div className="text-orange-400 text-xs uppercase tracking-wider font-bold mb-1">
                  Seller
                </div>
                <div className="text-xl font-medium">
                  {selectedRunData.seller.name}
                </div>
                <div className="text-sm text-slate-400 font-mono mt-1">
                  {selectedRunData.seller.model}
                </div>
                <div className="mt-4 text-sm">
                  <div className="flex justify-between border-b border-slate-700 pb-1 mb-1">
                    <span>Estimate</span>
                    <span className="text-slate-300">
                      ${selectedRunData.seller.estimate}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Score</span>
                    <span
                      className={`font-bold ${getScoreColor(selectedRunData.seller.score)}`}
                    >
                      {(selectedRunData.seller.score * 100).toFixed(1)}%
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-4 max-w-3xl mx-auto">
              <div className="text-center text-xs text-slate-500 uppercase tracking-widest my-6">
                Negotiation Start • True Value: ${selectedRunData.trueValue}
              </div>

              {selectedRunData.logs.map((log, i) => (
                <div
                  key={i}
                  className={`flex ${log.role === "buyer" ? "justify-start" : "justify-end"}`}
                >
                  <div
                    className={`max-w-[80%] rounded-2xl p-4 ${log.role === "buyer"
                      ? "bg-blue-900/20 text-blue-100 rounded-tl-sm"
                      : "bg-orange-900/20 text-orange-100 rounded-tr-sm"
                      }`}
                  >
                    <div className="text-xs opacity-50 mb-1 font-bold">
                      {log.sender}
                    </div>

                    {log.content.thought && (
                      <div className="text-xs bg-black/20 p-2 rounded mb-2 italic text-slate-400/80 border-l-2 border-slate-600">
                        "{log.content.thought}"
                      </div>
                    )}

                    <div className="whitespace-pre-wrap">
                      {log.content.message}
                    </div>

                    <div
                      className={`mt-3 flex flex-col gap-2 justify-${log.role === "buyer" ? "end" : "start"} items-${log.role === "buyer" ? "end" : "start"}`}
                    >
                      {log.content.offer !== null && (
                        <div className="text-sm font-bold bg-white/10 inline-block px-2 py-1 rounded">
                          Proposed: ${log.content.offer}
                        </div>
                      )}
                      {log.content.deal && (
                        <div className="text-sm font-bold text-emerald-400 flex items-center gap-1">
                          <div className="w-2 h-2 rounded-full bg-emerald-400"></div>
                          ACCEPTS DEAL
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}

              <div className="text-center text-xs text-slate-500 uppercase tracking-widest my-6">
                {selectedRunData.dealReached
                  ? `Deal Concluded at $${selectedRunData.dealPrice}`
                  : "Negotiation Failed (Max Turns)"}
              </div>
            </div>
          </div>
        ) : null}
      </main>
    </div>
  );
}

function getScoreColor(score) {
  if (score > 0.1) return "text-emerald-400";
  if (score > 0) return "text-emerald-200";
  if (score > -0.1) return "text-yellow-200";
  return "text-red-400";
}
