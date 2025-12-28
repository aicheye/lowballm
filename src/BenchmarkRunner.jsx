import { Play, Power, Terminal } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

export function BenchmarkRunner({ onBack, onComplete }) {
  const [rounds, setRounds] = useState(1);
  const [selectedModels, setSelectedModels] = useState({
    OPUS_4_5: true,
    HAIKU_4_5: true,
    SONNET_4_5: false,
    GPT_5: false,
    GPT_5_MINI: true,
    GPT_5_1: false,
    GPT_5_2: true,
    GEMINI_2_5_PRO: false,
    GEMINI_2_5_FLASH: true,
    GEMINI_FLASH_PREVIEW: true
  });
  const [logs, setLogs] = useState([]);
  const [isRunning, setIsRunning] = useState(false);
  const [serverStatus, setServerStatus] = useState('checking'); // checking, connected, error
  const [tournamentName, setTournamentName] = useState('');
  const logsEndRef = useRef(null);
  const eventSourceRef = useRef(null);

  useEffect(() => {
    // Check server health
    fetch('/api/health')
      .then(res => {
        if (res.ok) setServerStatus('connected');
        else setServerStatus('error');
      })
      .catch(() => setServerStatus('error'));
  }, []);

  const toggleModel = (m) => setSelectedModels(prev => ({ ...prev, [m]: !prev[m] }));

  const startBenchmark = async () => {
    setIsRunning(true);
    setLogs([]);

    const models = Object.keys(selectedModels).filter(k => selectedModels[k]).join(',');
    // Note: The vite proxy /api -> http://localhost:3001 needs to be active
    const url = `/api/benchmark/start?rounds=${rounds}&models=${models}&tournamentName=${encodeURIComponent(tournamentName)}`;

    const evtSource = new EventSource(url);

    evtSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'log') {
          setLogs(prev => [...prev, data.text]);
        } else if (data.type === 'error') {
          setLogs(prev => [...prev, `ERROR: ${data.text}`]);
          evtSource.close();
          setIsRunning(false);
        } else if (data.type === 'complete') {
          setLogs(prev => [...prev, '\nBenchmark Run Complete.']);
          evtSource.close();
          setIsRunning(false);
          if (onComplete) onComplete();
        }
      } catch (e) {
        console.error("Parse error", e);
      }
    };

    evtSource.onerror = (err) => {
      // EventSource often triggers onerror on normal close if not handled perfectly, 
      // but usually we close it on 'complete' message.
      if (evtSource.readyState !== EventSource.CLOSED) {
        console.error("EventSource error:", err);
        setLogs(prev => [...prev, 'Connection interrupted.']);
        evtSource.close();
        setIsRunning(false);
        eventSourceRef.current = null;
      }
    };

    eventSourceRef.current = evtSource;
  };

  // Clean up
  useEffect(() => {
    return () => {
      if (eventSourceRef.current) eventSourceRef.current.close();
    };
  }, []);

  // Auto-scroll
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-semibold text-slate-100">Run New Benchmark</h2>
        <button onClick={onBack} disabled={isRunning} className="text-sm text-slate-400 hover:text-white disabled:opacity-50">
          Cancel / Back
        </button>
      </div>

      {/* Configuration */}
      <div className="bg-slate-800 p-6 rounded-lg border border-slate-700">
        <div className="grid md:grid-cols-2 gap-8">
          <div>
            <label className="block text-sm font-medium text-slate-400 mb-3">Participating Models (Round Robin)</label>
            <div className="space-y-2">
              <div className="space-y-2 h-64 overflow-y-auto custom-scrollbar border border-slate-700 rounded p-2 bg-slate-900/50">
                {[
                  'OPUS_4_5', 'HAIKU_4_5', 'SONNET_4_5',
                  'GPT_5', 'GPT_5_MINI', 'GPT_5_1', 'GPT_5_2',
                  'GEMINI_FLASH_PREVIEW', 'GEMINI_2_5_PRO', 'GEMINI_2_5_FLASH'
                ].map(m => (
                  <label key={m} className="flex items-center gap-2 cursor-pointer hover:bg-slate-700/50 p-2 rounded transition-colors">
                    <input
                      type="checkbox"
                      checked={selectedModels[m]}
                      onChange={() => toggleModel(m)}
                      disabled={isRunning}
                      className="rounded border-slate-600 bg-slate-700 text-emerald-500 focus:ring-emerald-500/50"
                    />
                    <span className="font-mono text-slate-200 text-xs">{m}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-400 mb-3">Number of Rounds</label>
            <div className="flex items-center gap-4 mb-4">
              <input
                type="number"
                min="1"
                max="50"
                value={rounds}
                onChange={(e) => setRounds(parseInt(e.target.value) || 1)}
                disabled={isRunning}
                className="bg-slate-900 border border-slate-700 text-white rounded px-4 py-2 w-24 focus:ring-2 focus:ring-emerald-500 outline-none"
              />
              <span className="text-slate-500 text-sm">
                Total matches: <strong>{(() => {
                  const N = Object.values(selectedModels).filter(v => v).length;
                  const total = N * (N - 1) * rounds;
                  return total > 0 ? total : 0;
                })()}</strong>
              </span>
            </div>

            <label className="block text-sm font-medium text-slate-400 mb-3">Tournament Name (Optional)</label>
            <input
              type="text"
              value={tournamentName}
              onChange={(e) => setTournamentName(e.target.value)}
              placeholder="e.g. 'Winter Championship'"
              disabled={isRunning}
              className="bg-slate-900 border border-slate-700 text-white rounded px-4 py-2 w-full mb-4 focus:ring-2 focus:ring-emerald-500 outline-none"
            />
          </div>
        </div>
        <div className="flex gap-4 mt-4">
          <button
            onClick={startBenchmark}
            disabled={isRunning || serverStatus !== 'connected' || Object.values(selectedModels).filter(v => v).length < 2}
            className="flex-1 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 disabled:text-slate-500 text-white font-bold py-3 px-4 rounded flex items-center justify-center gap-2 transition-all shadow-lg shadow-emerald-900/20"
          >
            {isRunning ? <Power className="animate-pulse w-5 h-5" /> : <Play className="w-5 h-5" />}
            {isRunning ? 'Benchmark Running...' : serverStatus === 'checking' ? 'Connecting...' : serverStatus === 'error' ? 'Backend Offline' : 'Start Benchmark'}
          </button>

          {isRunning && (
            <button
              onClick={() => {
                // User manual stop
                setLogs(prev => [...prev, '\nStopping benchmark...']);
                setIsRunning(false);

                // Close local connection
                if (eventSourceRef.current) {
                  eventSourceRef.current.close();
                  eventSourceRef.current = null;
                }

                // Tell server to abort using the new endpoint
                fetch('/api/benchmark/stop', { method: 'POST' })
                  .catch(err => console.error("Failed to send stop command:", err));
              }}
              className="bg-red-900/50 hover:bg-red-900/80 text-red-200 border border-red-800 rounded px-6 font-bold"
            >
              Stop
            </button>
          )}
        </div>
        {serverStatus === 'error' && (
          <div className="text-red-400 text-xs mt-2 text-center">
            Cannot connect to benchmark server. Ensure `node server/server.js` is running.
          </div>
        )}
      </div>

      {/* Output Console */}
      <div className="bg-slate-950 rounded-lg border border-slate-800 p-4 font-mono text-xs md:text-sm h-96 overflow-y-auto shadow-inner custom-scrollbar">
        <div className="flex items-center gap-2 text-slate-500 border-b border-slate-900 pb-2 mb-2">
          <Terminal className="w-4 h-4" />
          <span>Console Output</span>
          {isRunning && <span className="flex h-2 w-2 rounded-full bg-emerald-500 animate-ping ml-auto" />}
        </div>
        <div className="space-y-1">
          {logs.length === 0 && (
            serverStatus === 'checking' ? <span className="text-slate-500 italic">Checking server connection...</span> :
              serverStatus === 'connected' ? <span className="text-emerald-500/50 italic">Backend Connected. Ready to start.</span> :
                <span className="text-red-500 italic">Backend Offline. Check console for details.</span>
          )}
          {logs.map((L, i) => {
            // Helper to highlight offers
            const renderLog = (text) => {
              if (text.includes('DEAL REACHED')) return <span className="text-emerald-400 font-bold">{text}</span>;
              if (text.includes('NO DEAL')) return <span className="text-red-400 font-bold">{text}</span>;
              if (text.includes('Starting Match')) return <span className="text-blue-400 mt-4 block border-t border-slate-800 pt-2">{text}</span>;

              const match = text.match(/^(.+?): (.*)/);
              if (match && !text.startsWith('Matchup:')) {
                const name = match[1];
                const rest = match[2];
                // Check for [Offer: ...]
                const offerMatch = rest.match(/(.*)(\[Offer:.*?\])(.*)/);

                if (offerMatch) {
                  return (
                    <span>
                      <span className="text-pink-400 font-bold">{name}:</span>
                      <span> {offerMatch[1]}</span>
                      <span className="text-yellow-400 font-bold">{offerMatch[2]}</span>
                      {offerMatch[3]}
                    </span>
                  );
                } else {
                  return (
                    <span>
                      <span className="text-pink-400 font-bold">{name}:</span>
                      <span> {rest}</span>
                    </span>
                  );
                }
              }

              // Fallback for Offer check if not in Name: format (unlikely but safe)
              const offerMatch = text.match(/(.*)(\[Offer:.*?\])(.*)/);
              if (offerMatch) {
                return (
                  <span>
                    {offerMatch[1]}
                    <span className="text-yellow-400 font-bold">{offerMatch[2]}</span>
                    {offerMatch[3]}
                  </span>
                );
              }
              return text;
            };

            return (
              <div key={i} className="whitespace-pre-wrap break-all text-slate-300">
                {renderLog(L)}
              </div>
            );
          })}
          <div ref={logsEndRef} />
        </div>
      </div>
    </div>
  );
}
