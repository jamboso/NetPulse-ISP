import OpenAI from "openai";

let client: OpenAI | undefined;

/**
 * Lazily constructs the OpenAI client on first use, instead of at module
 * import time. This lets the server boot normally in environments where the
 * AI integration hasn't been provisioned (e.g. self-hosted installs); the
 * error is only thrown when a route actually tries to use the client.
 */
function getOpenAiClient(): OpenAI {
  if (client) return client;

  if (!process.env.AI_INTEGRATIONS_OPENAI_BASE_URL) {
    throw new Error(
      "AI_INTEGRATIONS_OPENAI_BASE_URL must be set. Did you forget to provision the OpenAI AI integration?",
    );
  }

  if (!process.env.AI_INTEGRATIONS_OPENAI_API_KEY) {
    throw new Error(
      "AI_INTEGRATIONS_OPENAI_API_KEY must be set. Did you forget to provision the OpenAI AI integration?",
    );
  }

  client = new OpenAI({
    apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
    baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  });
  return client;
}

export const openai = new Proxy({} as OpenAI, {
  get(_target, prop, receiver) {
    return Reflect.get(getOpenAiClient(), prop, receiver);
  },
});
