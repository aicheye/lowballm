import Anthropic from "@anthropic-ai/sdk";
import dotenv from "dotenv";

dotenv.config();

// Ensure API Key is present
if (!process.env.ANTHROPIC_API_KEY) {
  console.error("Error: ANTHROPIC_API_KEY not found in environment variables.");
  // Don't exit hard here to allow importing without crashing, but warn.
}

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export class Agent {
  constructor(name, modelId, role, item, trueValue, privateEstimate) {
    this.name = name; // e.g., "Opus Buyer"
    this.modelId = modelId;
    this.role = role; // "buyer" or "seller"
    this.item = item;
    // Agents don't know trueValue, only their privateEstimate
    this.privateEstimate = privateEstimate;
    this.history = [];
    this.systemPrompt = this.createSystemPrompt();
  }

  createSystemPrompt() {
    const objective =
      this.role === "buyer"
        ? `buy the item as cheaply as possible. Your private valuation/market estimate is $${this.privateEstimate}. You should aim to pay LESS than this. Ideally much less.`
        : `sell the item as expensively as possible. Your private valuation/market estimate is $${this.privateEstimate}. You should aim to sell for MORE than this. Ideally much more.`;

    return `You are a savvy negotiator in a tournament.
You are the ${this.role.toUpperCase()}.
Item: ${this.item}.
Objective: ${objective}

Rules:
1. You must be realistic but competitive.
2. You can concede small amounts but defend your margin.
3. If the deal is not good for you based on your private estimate, do not accept it easily.
4. You have a maximum of 6 turns to reach a deal. If no deal is reached, you get a severe penalty.
5. If you believe a fair deal is reached, you can accept.
6. You cannot offer non-monetary or debt concessions. The only concessions you can make are to the price.
7. If your opponent offers non-monetary or debt concessions, you should ignore it and only respond to the price.

Output Format:
You MUST output your response in valid JSON format ONLY, with two fields:
{
  "thought": "Internal reasoning about the offer and strategy",
  "message": "The actual message to send to the opponent", // DO NOT send HTML or markdown. DO NOT include newlines or extra whitespace.
  "offer": number | null, // The numerical value of the price being discussed/agreed upon.
  "deal": boolean // Set to true ONLY if you are ACCEPTING the opponent's previous offer.
}
IMPORTANT: 
- If you are making a proposal, counter-offer, or starting the negotiation: "deal" MUST be false.
- "deal": true means "I accept your price and the negotiation is over."
- If you set "deal": true, the "offer" field must equal previous price of the opponent.
- If your opponent makes no offer in a turn, you can respond with no offer to end negotiation with no deal.
`;
  }

  async generateResponse(opponentMessage) {
    // Add opponent's message to history if it exists
    if (opponentMessage) {
      this.history.push({ role: "user", content: opponentMessage });
    }

    try {
      const response = await client.messages.create({
        model: this.modelId,
        max_tokens: 1024,
        temperature: 0.7,
        system: this.systemPrompt,
        messages: this.history,
      });

      const text = response.content[0].text;

      // Parse JSON
      let data;
      try {
        // Attempt to find JSON block if model wraps it in markdown
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          data = JSON.parse(jsonMatch[0]);
        } else {
          data = JSON.parse(text);
        }
      } catch (e) {
        // Fallback if model fails JSON constraint
        console.warn(`[${this.name}] Failed to parse JSON. Raw: ${text}`);
        data = {
          thought: "Failed to parse JSON output",
          message: text,
          offer: null,
          deal: false,
        };
      }

      // Add self response to history
      this.history.push({ role: "assistant", content: text });

      return data;
    } catch (error) {
      console.error(`[${this.name}] API Error:`, error);
      throw error;
    }
  }
}
