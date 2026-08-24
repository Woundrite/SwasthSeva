// @google/genai ships ESM-only from TypeScript's point of view (its
// conditional exports don't resolve cleanly under our CJS project's
// moduleResolution), so it's loaded via a dynamic import rather than a
// static one — Node's own require() resolves it fine, but tsc doesn't.
import type { GoogleGenAI as GoogleGenAIClient } from "@google/genai" with { "resolution-mode": "import" };
import { env } from "../config/env";

// Provider adapter: call sites depend only on this interface, not on the
// Gemini SDK directly, so a different model provider could be swapped in
// without touching pre-visit-summary.ts.
export interface LlmProvider {
  generateJson(input: { systemInstruction: string; prompt: string; schema: object }): Promise<{
    text: string;
    model: string;
  }>;
}

export class GeminiProvider implements LlmProvider {
  private clientPromise: Promise<GoogleGenAIClient> | undefined;

  constructor(private readonly apiKey: string) {}

  private getClient(): Promise<GoogleGenAIClient> {
    if (!this.clientPromise) {
      this.clientPromise = import("@google/genai").then(({ GoogleGenAI }) => new GoogleGenAI({ apiKey: this.apiKey }));
    }
    return this.clientPromise;
  }

  async generateJson(input: { systemInstruction: string; prompt: string; schema: object }): Promise<{
    text: string;
    model: string;
  }> {
    const client = await this.getClient();
    const response = await client.models.generateContent({
      model: env.GEMINI_MODEL,
      contents: input.prompt,
      config: {
        systemInstruction: input.systemInstruction,
        responseMimeType: "application/json",
        responseSchema: input.schema,
        abortSignal: AbortSignal.timeout(env.LLM_TIMEOUT_MS),
      },
    });

    const text = response.text;
    if (!text) {
      throw new Error("Gemini returned an empty response");
    }
    return { text, model: env.GEMINI_MODEL };
  }
}

// LLM_ENABLED=false or a missing API key both mean "don't attempt a call" —
// treated identically so a dev environment without a real key degrades to
// the fallback path instead of a network call doomed to fail.
export function isLlmAvailable(): boolean {
  return env.LLM_ENABLED && env.GEMINI_API_KEY.length > 0;
}

let provider: LlmProvider | undefined;

export function getLlmProvider(): LlmProvider {
  if (!provider) {
    provider = new GeminiProvider(env.GEMINI_API_KEY);
  }
  return provider;
}
