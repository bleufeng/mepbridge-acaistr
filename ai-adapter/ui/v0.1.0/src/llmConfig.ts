// LLM configuration helper for server-backed API calls.

import { LlmConfig } from "./types";

type LlmConfigApiResponse = {
  configured?: boolean;
  success?: boolean;
  provider?: string;
  endpoint?: string | null;
  model?: string | null;
  apiKey?: string | null;
  message?: string;
  warning?: string | null;
  error?: string;
};

function isMaskedApiKey(apiKey: string): boolean {
  return apiKey.includes("...");
}

function toApiPayload(config: LlmConfig): Record<string, string> {
  const payload: Record<string, string> = {
    provider: config.provider,
    endpoint: config.endpoint,
    model: config.modelName
  };

  if (config.provider !== "ollama" && config.apiKey && !isMaskedApiKey(config.apiKey)) {
    payload.apiKey = config.apiKey;
  }

  return payload;
}

async function readJson(response: Response): Promise<LlmConfigApiResponse> {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

/**
 * Load LLM configuration from the server.
 */
export async function getLlmConfig(): Promise<LlmConfig | null> {
  try {
    const response = await fetch("/api/llm-config/load");
    const data = await readJson(response);

    if (!response.ok) {
      throw new Error(data.error || "Failed to load LLM configuration");
    }

    if (!data.configured) {
      return null;
    }

    return {
      provider: data.provider || "openai",
      endpoint: data.endpoint || "",
      apiKey: data.apiKey || "",
      modelName: data.model || ""
    };
  } catch (error) {
    console.error("Failed to load LLM config:", error);
    return null;
  }
}

/**
 * Save LLM configuration to the server.
 */
export async function saveLlmConfig(config: LlmConfig): Promise<{ success: boolean; message: string }> {
  try {
    const validation = validateLlmConfig(config);
    if (!validation.valid) {
      return { success: false, message: validation.error || "Invalid configuration" };
    }

    const response = await fetch("/api/llm-config/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(toApiPayload(config))
    });
    const data = await readJson(response);

    if (!response.ok || data.error) {
      return { success: false, message: data.error || "Failed to save configuration" };
    }

    return { success: true, message: data.message || "Configuration saved" };
  } catch (error) {
    return { success: false, message: `Network error: ${error instanceof Error ? error.message : "Unknown error"}` };
  }
}

/**
 * Server-side clearing is not exposed; this removes legacy browser-only config.
 */
export function clearLlmConfig(): void {
  try {
    localStorage.removeItem("mepbridge_llm_config");
  } catch (error) {
    console.error("Failed to clear legacy LLM config:", error);
  }
}

/**
 * LLM config is server-backed, so request bodies do not need credentials attached.
 */
export function attachLlmConfig<T extends Record<string, unknown>>(requestBody: T): T {
  return requestBody;
}

/**
 * Validate LLM configuration before saving.
 */
export function validateLlmConfig(config: LlmConfig): { valid: boolean; error?: string } {
  if (!config.provider || config.provider.trim() === "") {
    return { valid: false, error: "Provider is required" };
  }

  if (!config.endpoint || config.endpoint.trim() === "") {
    return { valid: false, error: "Endpoint URL is required" };
  }

  try {
    new URL(config.endpoint);
  } catch {
    return { valid: false, error: "Invalid endpoint URL" };
  }

  if (config.provider !== "ollama" && (!config.apiKey || config.apiKey.trim() === "")) {
    return { valid: false, error: "API key is required" };
  }

  if (!config.modelName || config.modelName.trim() === "") {
    return { valid: false, error: "Model name is required" };
  }

  return { valid: true };
}

/**
 * Save then test the LLM configuration through the server.
 */
export async function testLlmConfig(config: LlmConfig): Promise<{ success: boolean; message: string }> {
  const saved = await saveLlmConfig(config);
  if (!saved.success) {
    return saved;
  }

  try {
    const response = await fetch("/api/llm-config/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" }
    });
    const data = await readJson(response);

    if (data.success) {
      return { success: true, message: data.message || "Connection test passed" };
    }

    return { success: false, message: data.error || "Connection test failed" };
  } catch (error) {
    return { success: false, message: `Network error: ${error instanceof Error ? error.message : "Unknown error"}` };
  }
}

/**
 * Get default LLM configuration.
 */
export function getDefaultLlmConfig(): LlmConfig {
  return {
    provider: "openai",
    endpoint: "https://api.openai.com/v1",
    apiKey: "",
    modelName: "gpt-4"
  };
}
