import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import { runTournament } from './benchmark.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Health Check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
});

// Global controller to manage the active benchmark
let activeController = null;

app.post('/api/benchmark/stop', (req, res) => {
    if (activeController) {
        console.log('Stop request received. Aborting active benchmark...');
        activeController.abort();
        activeController = null;
        res.json({ status: 'stopped' });
    } else {
        res.json({ status: 'no_active_benchmark' });
    }
});

// Streaming endpoint for benchmark
app.get('/api/benchmark/start', async (req, res) => {
    // We use GET with query params for EventSource ease, 
    // or we could use POST and careful client handling. 
    // EventSource usually does GET.
    // Params: rounds, models (comma separated)
    
    const rounds = parseInt(req.query.rounds) || 1;
    const modelsParam = req.query.models;
    const models = modelsParam.split(',');
    const tournamentName = req.query.tournamentName || '';
    
    // Set headers for SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    const sendMessage = (text) => {
        // Format: data: <content>\n\n
        const msg = JSON.stringify({ type: 'log', text });
        res.write(`data: ${msg}\n\n`);
    };
    
    const sendError = (text) => {
        const msg = JSON.stringify({ type: 'error', text });
        res.write(`data: ${msg}\n\n`);
    };
    
    const sendComplete = () => {
        const msg = JSON.stringify({ type: 'complete' });
        res.write(`data: ${msg}\n\n`);
        res.end();
    };
    
    try {
        // Cancel previous if any (though usually UI prevents this)
        if (activeController) {
            activeController.abort();
        }

        const controller = new AbortController();
        activeController = controller;
        
        // Handle client disconnect (Stop button)
        req.on('close', () => {
            console.log('Client disconnected connection.');
            // We don't necessarily abort here if we rely on explicit stop, 
            // but it's good practice. However, if 'stop' endpoint is called, 
            // the controller is already aborted.
            if (activeController === controller) {
                 // activeController.abort(); // Optional: depend on explicit stop? 
                 // Let's keep it safe.
                 activeController = null; 
            }
        });

        sendMessage(`Initializing Benchmark: ${rounds} rounds, Models: ${models.join(', ')}` + (tournamentName ? `, Tournament: ${tournamentName}` : ''));
        
        await runTournament({ rounds, models, tournamentName, signal: controller.signal }, (logText) => {
            sendMessage(logText);
        });
        
        sendComplete();
    } catch (error) {
        console.error("Benchmark failed:", error);
        sendError(error.toString());
        res.end();
    }
});

// If we need any other API, add here.
// For now, serving static logs is done by Vite in dev or Express in prod.
// If prod, we might want:
// app.use(express.static('dist')); 
// app.use('/logs', express.static('public/logs'));

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
