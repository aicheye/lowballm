import fs from "fs";
import path from "path";
import { fileURLToPath } from 'url';
import { Agent } from "./agents.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Go up one level from 'server' to 'results-viewer' root, then 'public/logs'
const VIEWER_LOGS_DIR = path.resolve(__dirname, "../public/logs");

export const MODELS = {
  OPUS_4_5: "claude-opus-4-5-20251101",
  HAIKU_4_5: "claude-haiku-4-5-20251001",
  SONNET_4_5: "claude-sonnet-4-5-20250929",
  GEMINI_FLASH_PREVIEW: "gemini-3-flash-preview",
  GEMINI_2_5_PRO: "gemini-2.5-pro",
  GEMINI_2_5_FLASH: "gemini-2.5-flash",
  GPT_5_2: "gpt-5.2",
  GPT_5_1: "gpt-5.1",
  GPT_5: "gpt-5",
  GPT_5_MINI: "gpt-5-mini"
};


const SCENARIOS = [
  { item: "Vintage Rolex Watch", value: 38000, variance: 0.1 },
  { item: "Used 2020 Tesla Model 3", value: 25000, variance: 0.15 },
  { item: "Premium Domain Name 'AI-Agent.com'", value: 50000, variance: 0.4 },
  { item: "Enterprise SaaS Contract (Annual)", value: 120000, variance: 0.2 },
  { item: "Rare Digital Art NFT", value: 15000, variance: 0.5 }
];

function ensureLogsDir() {
  if (!fs.existsSync(VIEWER_LOGS_DIR)) {
    fs.mkdirSync(VIEWER_LOGS_DIR, { recursive: true });
  }
}

async function runMatch(runId, buyerConf, sellerConf, logger, tournamentId = null, options = {}) {
  logger(`\nStarting Match ${runId}...`);
  logger(`Matchup: ${buyerConf.name} (Buyer) vs ${sellerConf.name} (Seller)`);

  // Randomized Scenario
  const scenario = SCENARIOS[Math.floor(Math.random() * SCENARIOS.length)];
  const item = scenario.item;
  const trueValue = scenario.value;
  
  // Randomize Estimates based on Scenario Variance
  // Seller usually wants more, Buyer usually wants less? Or just random noise?
  // Let's create a "ZOPA" (Zone of Possible Agreement) or potential Gap.
  // Seller Estimate: TrueValue * (1 + random(-var, +var))
  const sellerEst = Math.round(trueValue * (1 + ((Math.random() * 2 - 1) * scenario.variance)));
  const buyerEst = Math.round(trueValue * (1 + ((Math.random() * 2 - 1) * scenario.variance)));

  logger(`Item: ${item} | True Val: $${trueValue}`);
  logger(`Seller Est: $${sellerEst} | Buyer Est: $${buyerEst}`);

  // Instantiate Agents
  // We pass 'trueValue' as the public knowledge (if any) or just for consistent object shape,
  // but importantly we pass the randomized estimate as the 'privateEstimate' (last arg) which the agent uses.
  const seller = new Agent(
    sellerConf.name,
    sellerConf.modelId,
    "seller",
    item,
    sellerEst 
  );
  
  const buyer = new Agent(
    buyerConf.name,
    buyerConf.modelId,
    "buyer",
    item,
    buyerEst
  );

  let turns = 0;
  const maxTurns = 12;
  let dealReached = false;
  let dealPrice = null;
  let logs = [];
  
  if (options && options.signal && options.signal.aborted) throw new Error("Benchmark Aborted");

  let lastMessage = "The negotiation has started. Please make your opening statement.";
  let lastOffer = null;
  let lastOfferBy = null; // Track who made the offer to prevent self-dealing
  let consecutiveNulls = 0;
  let activeAgent = seller;
  let passiveAgent = buyer;

  while (turns < maxTurns && !dealReached) {
    if (options && options.signal && options.signal.aborted) throw new Error("Benchmark Aborted");
    turns++;
    
    // Log intent to client?? No, just wait for response.
    const response = await activeAgent.generateResponse(lastMessage);

    const logMsg = `${activeAgent.name}: ${response.message} [Offer: ${response.offer || 'None'}]`;
    logger(logMsg);

    if (response.deal) {
      // Check if there IS a last offer, AND it wasn't made by this same agent (self-deal prevention)
      if (lastOffer !== null && lastOfferBy !== activeAgent.role) {
          if (response.offer === lastOffer) {
            dealPrice = response.offer;
            dealReached = true;
          } else {
            logger(`[System] Rejected deal: Offer ${response.offer} does not match previous ${lastOffer}`);
            dealReached = false;
            response.deal = false;
          }
      } else {
          logger(`[System] Rejected deal: No valid offer from opponent to accept.`);
          dealReached = false;
          response.deal = false;
      }
    } 
    
    // Process new offer if present
    // Note: If they said deal=true, we checked matches above. 
    // If deal=false, they might be proposing a new offer.
    if (!dealReached) {
        if (response.offer !== null) {
            lastOffer = response.offer;
            lastOfferBy = activeAgent.role;
            consecutiveNulls = 0;
        } else {
            consecutiveNulls++;
            if (consecutiveNulls >= 2) {
                logger(`[System] Negotiation ended: Two consecutive turns with no offer.`);
                break; // End loop, no deal
            }
        }
    }

    logs.push({
      turn: turns,
      sender: activeAgent.name + " (" + activeAgent.role + ")",
      role: activeAgent.role,
      content: { ...response, usage: undefined }, // Keep log clean? Or keep usage? Let's hide usage in simple log.
    });

    // Track Tokens
    if (activeAgent.trackTokens && response.usage) {
        activeAgent.trackTokens(response.usage);
    }

    lastMessage = response.message;
    [activeAgent, passiveAgent] = [passiveAgent, activeAgent];
  }

  // SCORING UPDATE:
  // No Deal = 0.0 (Neutral). Walking away is better than a bad deal.
  // Deal = (Profit) / Estimate.
  
  let sellerScore = 0.0;
  let buyerScore = 0.0;

  if (dealReached && dealPrice) {
    logger(`DEAL REACHED at $${dealPrice}!`);
    sellerScore = (dealPrice - sellerEst) / sellerEst;
    buyerScore = (buyerEst - dealPrice) / buyerEst;
  } else {
    logger(`NO DEAL REACHED.`);
  }

  const result = {
    id: runId,
    tournament: tournamentId,
    date: new Date().toISOString(),
    item,
    trueValue,
    seller: {
      name: seller.name,
      model: seller.modelId,
      estimate: sellerEst,
      score: sellerScore,
      thinkingTokens: seller.totalTokens || 0
    },
    buyer: {
      name: buyer.name,
      model: buyer.modelId,
      estimate: buyerEst,
      score: buyerScore,
      thinkingTokens: buyer.totalTokens || 0
    },
    dealReached,
    dealPrice,
    turns,
    logs,
  };

  // Save Log
  ensureLogsDir();
  fs.writeFileSync(
    path.join(VIEWER_LOGS_DIR, `run_${runId}.json`),
    JSON.stringify(result, null, 2)
  );

  // Update Manifest
  const manifestPath = path.join(VIEWER_LOGS_DIR, "manifest.json");
  let manifest = [];
  if (fs.existsSync(manifestPath)) {
    try {
        manifest = JSON.parse(fs.readFileSync(manifestPath));
    } catch (e) {}
  }
  manifest.unshift({
    id: runId,
    tournament: tournamentId,
    date: result.date,
    item,
    trueValue,
    dealReached,
    dealPrice,
    seller: {
      name: seller.name,
      model: seller.modelId,
      estimate: sellerEst,
      score: sellerScore,
    },
    buyer: {
      name: buyer.name,
      model: buyer.modelId,
      estimate: buyerEst,
      score: buyerScore,
    },
  });
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  return result;
}

export async function runTournament(options, logger) {
    const rounds = options.rounds || 1;
    const selectedModels = options.models || ['OPUS 4.5', 'HAIKU 4.5', 'SONNET 4.5', 'GPT 5', 'GEMINI 2.5 PRO'];
    
    // Generate Pairs (Round Robin)
    // For each unique pair of models, run 2 games (swapping roles).
    // If models = [A, B, C]
    // Pairs: AB, AC, BC
    // Matches: 
    // 1. A(Seller) vs B(Buyer)
    // 2. B(Seller) vs A(Buyer)
    // 3. A(Seller) vs C(Buyer)
    // 4. C(Seller) vs A(Buyer)
    // 5. B(Seller) vs C(Buyer)
    // 6. C(Seller) vs B(Buyer)
    
    // Multiply by 'rounds'
    
    // Resolve model IDs
    const modelMap = {};
    for (const m of selectedModels) {
        // Strip ' 4.5' suffix if present to find the key in MODELS
        const cleanKey = m.replace(' 4.5', '');
        if (MODELS[cleanKey]) modelMap[m] = MODELS[cleanKey];
        else modelMap[m] = m; // Assume raw ID
    }
    const modelKeys = Object.keys(modelMap);
    
    // Random Name Generator for Default Tournaments
    const adjectives = ['Silent', 'Brave', 'Calm', 'Swift', 'Wise', 'Eager', 'Bold', 'Bright', 'Wild', 'Grand'];
    const nouns = ['Badger', 'Eagle', 'Owl', 'Tiger', 'Wolf', 'Bear', 'Fox', 'Hawk', 'Lion', 'Falcon'];
    const randomName = `${adjectives[Math.floor(Math.random() * adjectives.length)]} ${nouns[Math.floor(Math.random() * nouns.length)]} ${Math.floor(Math.random() * 100)}`;

    const tournamentId = options.tournamentName || randomName;
    
    logger(`Starting Tournament '${tournamentId}' with ${rounds} rounds for models: ${modelKeys.join(', ')}`);

    for (let r = 0; r < rounds; r++) {
        if (options.signal && options.signal.aborted) break;
        logger(`\n--- ROUND ${r + 1} ---`);
        for (let i = 0; i < modelKeys.length; i++) {
            for (let j = i + 1; j < modelKeys.length; j++) {
                if (options.signal && options.signal.aborted) break;
                const m1 = modelKeys[i];
                const m2 = modelKeys[j];

                // M1 Seller vs M2 Buyer
                const runId1 = Date.now().toString() + "_1";
                try {
                    await runMatch(
                        runId1,
                        { name: m2, modelId: modelMap[m2] }, // Buyer
                        { name: m1, modelId: modelMap[m1] }, // Seller
                        logger,
                        tournamentId,
                        options
                    );
                } catch (e) {
                    if (e.message === "Benchmark Aborted") throw e;
                    console.error(e);
                }
                
                if (options.signal && options.signal.aborted) break;

                // M2 Seller vs M1 Buyer
                const runId2 = Date.now().toString() + "_2";
                try {
                    await runMatch(
                        runId2,
                        { name: m1, modelId: modelMap[m1] }, // Buyer
                        { name: m2, modelId: modelMap[m2] }, // Seller
                        logger,
                        tournamentId,
                        options
                    );
                } catch (e) {
                     if (e.message === "Benchmark Aborted") throw e;
                     console.error(e);
                }
            }
        }
    }
    logger("\nTournament Complete.");
}
