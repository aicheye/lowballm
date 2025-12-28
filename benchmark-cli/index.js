import chalk from "chalk";
import fs from "fs";
import path from "path";
import { Agent } from "./agents.js";

// Configuration
const VIEWER_LOGS_DIR = path.resolve("../results-viewer/public/logs");

// Models
const MODELS = {
  OPUS_4_5: "claude-opus-4-5-20251101",
  HAIKU_4_5: "claude-haiku-4-5-20251001",
  SONNET_4_5: "claude-sonnet-4-5-20250929"
};

async function runMatch(runId) {
  console.log(chalk.cyan(`\nStarting Match ${runId}...`));

  // Setup Scenario
  const item = "Vintage Rolex Watch";
  const trueValue = 38000;
  // +/- 10%
  const sellerEst = Math.round(trueValue * (1 + (Math.random() * 0.2 - 0.1)));
  const buyerEst = Math.round(trueValue * (1 + (Math.random() * 0.2 - 0.1)));

  console.log(chalk.gray(`Item: ${item} | True Val: $${trueValue}`));
  console.log(
    chalk.gray(`Seller Est: $${sellerEst} | Buyer Est: $${buyerEst}`),
  );

  // specific requests: Opus 4.5 vs Haiku 4.5
  // Let's randomize who is buyer/seller or fix it?
  // MVP: Match 1 -> Opus Seller, Haiku Buyer.
  // We can swap in typical tournament fashion. For MVP, let's do one focused config per run call.

  // Config: Buyer = Opus, Seller = Haiku
  const seller = new Agent(
    "Opus 4.5",
    MODELS.OPUS,
    "seller",
    item,
    sellerEst 
  );
  const buyer = new Agent(
    "Haiku 4.5",
    MODELS.HAIKU,
    "buyer",
    item,
    buyerEst
  );

  let turns = 0;
  const maxTurns = 12; // 6 turns per agent x 2 agents = 12 total messages.
  let dealReached = false;
  let dealPrice = null;
  let logs = [];

  // Conversation State
  let lastMessage =
    "The negotiation has started. Please make your opening statement.";
  let lastOffer = null;
  // Usually Buyer starts asking price, or Seller lists price.
  // Let's have Seller open.
  let activeAgent = seller;
  let passiveAgent = buyer;

  // Initial prompt for opener (no previous message)

  while (turns < maxTurns && !dealReached) {
    turns++;
    const response = await activeAgent.generateResponse(lastMessage);

    console.log(
      chalk.bold(`${activeAgent.name}:`) +
        ` ${response.message} ` +
        chalk.yellow(`[Offer: ${response.offer}]`),
    );
    if (response.deal) {
      if (lastOffer !== null && response.offer == lastOffer) {
        dealPrice = response.offer;
        dealReached = true;
      } else {
        console.log(
          chalk.red(
            `[System] Rejected deal: Offer ${response.offer} does not match previous ${lastOffer}`,
          ),
        );
        dealReached = false;
        response.deal = false;
      }
    } else if (response.offer !== null) {
      lastOffer = response.offer;
    }

    // Log
    const logEntry = {
      turn: turns,
      sender: activeAgent.name,
      role: activeAgent.role,
      content: response,
    };
    logs.push(logEntry);

    lastMessage = response.message; // Pass text content to next

    // Swap
    [activeAgent, passiveAgent] = [passiveAgent, activeAgent];
  }

  // Scoring
  let sellerScore = -0.5; // Penalty default
  let buyerScore = -0.5; // Penalty default

  if (dealReached && dealPrice) {
    console.log(chalk.green(`\nDEAL REACHED at $${dealPrice}!`));
    // Seller Score: (P - Est) / Est
    sellerScore = (dealPrice - sellerEst) / sellerEst;
    // Buyer Score: (Est - P) / Est
    buyerScore = (buyerEst - dealPrice) / buyerEst;
  } else {
    console.log(chalk.red(`\nNO DEAL REACHED.`));
  }

  const result = {
    id: runId,
    date: new Date().toISOString(),
    item,
    trueValue,
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
    dealReached,
    dealPrice,
    turns,
    logs,
  };

  // Save Log
  if (!fs.existsSync(VIEWER_LOGS_DIR)) {
    fs.mkdirSync(VIEWER_LOGS_DIR, { recursive: true });
  }
  fs.writeFileSync(
    path.join(VIEWER_LOGS_DIR, `run_${runId}.json`),
    JSON.stringify(result, null, 2),
  );

  // Update Manifest
  const manifestPath = path.join(VIEWER_LOGS_DIR, "manifest.json");
  let manifest = [];
  if (fs.existsSync(manifestPath)) {
    manifest = JSON.parse(fs.readFileSync(manifestPath));
  }
  manifest.unshift({
    id: runId,
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

  console.log(chalk.blue(`Result saved to logs.`));
}

// Simple Runner
const runId = Date.now().toString();
runMatch(runId).catch(console.error);
