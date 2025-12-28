import Anthropic from "@anthropic-ai/sdk/index.js";
import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config();

// Initialize clients
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Gemini init
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

export class Agent {
  constructor(name, modelId, role, item, privateEstimate) {
    this.name = name;
    this.modelId = modelId;
    this.role = role; // "buyer" or "seller"
    this.item = item;
    this.privateEstimate = privateEstimate;
    this.history = [];
    this.systemPrompt = this.createSystemPrompt();
    this.totalTokens = 0; // Output/Reasoning tokens
  }

  trackTokens(usage) {
    if (!usage) return;
    // Normalize: usually we want output_tokens or completion_tokens
    const out = usage.output_tokens || usage.completion_tokens || usage.candidatesTokenCount || 0;
    this.totalTokens += out;
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
3. If the deal is not good for you based on your private estimate, do not accept it.
4. It is BETTER to walk away (end with no deal) than to accept a price that causes you to lose value relative to your estimate.
5. You have a maximum of 6 turns to reach a deal. If no deal is reached, you get a score of 0 (Neutral). 
This is better than a negative score from a bad deal.
6. If you believe a fair deal is reached, you can accept.

Output Format:
You MUST output your response in valid JSON format ONLY, with two fields:
{
  "thought": "Internal reasoning about the offer and strategy",
  "message": "The actual message to send to the opponent",
  "offer": number | null, // The numerical value of the price being discussed/agreed upon.
  "deal": boolean // Set to true ONLY if you are ACCEPTING the opponent's previous offer.
}
IMPORTANT: 
- If you are making a proposal, counter-offer, or starting the negotiation: "deal" MUST be false.
- "deal": true means "I accept your price and the negotiation is over."
- If you set "deal": true, the "offer" field must equal previous price of the opponent.
`;
  }

  async generateResponse(opponentMessage) {
    // Add opponent's message to history if it exists
    if (opponentMessage) {
      this.history.push({ role: "user", content: opponentMessage });
    }

    let textResponse = "";

    try {
      // Temperature Logic: GPT-5 (gpt-4o) likes 1.0, others prefer 0.7 for stability
      const isGPT5 = this.modelId.includes('gpt-5') || this.modelId.includes('gpt-4o');
      const temp = isGPT5 ? 1.0 : 0.7;

      // 1. Determine Provider
      if (this.modelId.startsWith("gpt")) {
        // --- OpenAI ---
        const completion = await openai.chat.completions.create({
          model: this.modelId,
          messages: [
            { role: "system", content: this.systemPrompt },
            ...this.history
          ],
          temperature: temp,
          max_completion_tokens: 2048,
          response_format: { type: "json_object" },
        });
        textResponse = completion.choices[0].message.content;
        this.lastUsage = completion.usage;

      } else if (this.modelId.startsWith("gemini")) {
        // --- Google Gemini ---
        const model = genAI.getGenerativeModel({ model: this.modelId });
        
        // Gemini has slightly different message format (parts: [{text: ...}])
        // And system instruction is separate in latest SDK, or prepended.
        // Let's prepend system prompt to history for simplicity or use systemInstruction if available in version.
        // We'll use the chat object.
        
        // Convert history to Gemini format: user/model
        const geminiHistory = this.history.map(m => ({
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.content }]
        }));

        // Use generateContent statelessly with full prompt context for best results
        let prompt = `SYSTEM:\n${this.systemPrompt}\n\nCONVERSATION:\n`;
        this.history.forEach(h => {
          prompt += `${h.role.toUpperCase()}: ${h.content}\n`;
        });
        prompt += `ASSISTANT:`; // Cue

        const result = await model.generateContent({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: {
                maxOutputTokens: 2048,
                temperature: temp,
            }
        });
        const response = await result.response;
        textResponse = response.text();
        this.lastUsage = response.usageMetadata;

      } else {
        // --- Anthropic (Default) ---
        const response = await anthropic.messages.create({
          model: this.modelId,
          max_tokens: 2048,
          temperature: temp,
          system: this.systemPrompt,
          messages: this.history,
        });
        textResponse = response.content[0].text;
        this.lastUsage = response.usage;
      }

      // --- JSON Parsing Logic ---
      let data;
      try {
        // Attempt to find JSON block if model wraps it in markdown
        const jsonMatch = textResponse.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          data = JSON.parse(jsonMatch[0]);
        } else {
          data = JSON.parse(textResponse);
        }
      } catch (e) {
        console.warn(`[${this.name}] Failed to parse JSON. Raw: ${textResponse.slice(0, 100)}...`);
        data = {
          thought: "Failed to parse JSON output",
          message: textResponse,
          offer: null,
          deal: false,
        };
      }

      // Add self response to history
      this.history.push({ role: "assistant", content: textResponse });

      // Return usage alongside data
      // Normalize usage object for easier consumption
      // OpenAI: completion.usage
      // Anthropic: response.usage
      // Gemini: result.response.usageMetadata
      
      // We need to capture the specific usage object from the block above.
      // Refactoring slightly to access it here or attach it.
      // Let's modify the blocks above to return { text, usage }
      
      return { ...data, usage: this.lastUsage };
    } catch (error) {
      console.error(`[${this.name}] API Error:`, error);
      throw error;
    }
  }
}
