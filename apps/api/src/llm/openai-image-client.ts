import { loadConfig } from "../config.js";
import { logger } from "../utils/logger.js";

export interface ImageGenerationOptions {
  model?: string;
  size?: string;
  n?: number;
  quality?: "standard" | "hd";
  responseFormat?: "url" | "b64_json";
}

export interface ImageGenerationResult {
  b64Json?: string;
  url?: string;
  revisedPrompt?: string;
  partialImageIndex?: number;
}

export interface ImageGenerationStreamPartialImage {
  partialImageIndex: number;
  b64Json: string;
}

export interface ImageGenerationStreamEvents {
  onPartialImage?: (data: ImageGenerationStreamPartialImage) => void;
  onComplete?: (result: ImageGenerationResult[]) => void;
  onError?: (error: Error) => void;
}

export function isOpenAIAvailable(): boolean {
  const config = loadConfig();
  return !!(config.OPENAI_API_KEY?.trim());
}

function getOpenAIConfig() {
  const config = loadConfig();
  const apiKey = config.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured. Set it in .env to use GPT Image 2.");
  }
  return {
    baseUrl: config.OPENAI_BASE_URL.replace(/\/+$/, ""),
    apiKey,
    model: config.OPENAI_IMAGE_MODEL || "gpt-image-2",
  };
}

export async function generateImage(
  prompt: string,
  options: ImageGenerationOptions = {},
): Promise<ImageGenerationResult[]> {
  const { baseUrl, apiKey, model } = getOpenAIConfig();

  const body = {
    model: options.model ?? model,
    prompt,
    n: options.n ?? 1,
    size: options.size ?? "1024x1024",
    quality: options.quality,
    response_format: options.responseFormat ?? "b64_json",
  };

  logger.info({ model: body.model, size: body.size, n: body.n },
    "openai generateImage");

  const response = await fetch(`${baseUrl}/v1/images/generations`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "unknown error");
    throw new Error(`OpenAI Images API error ${response.status}: ${errorText}`);
  }

  const data = await response.json() as { data?: Array<Record<string, unknown>> };
  const results: ImageGenerationResult[] = (data.data ?? []).map((item: Record<string, unknown>) => ({
    b64Json: item.b64_json as string | undefined,
    url: item.url as string | undefined,
    revisedPrompt: item.revised_prompt as string | undefined,
  }));

  logger.info({ count: results.length }, "openai generateImage complete");
  return results;
}

export async function streamGenerateImage(
  prompt: string,
  options: ImageGenerationOptions & { partialImages?: number },
  events: ImageGenerationStreamEvents,
): Promise<ImageGenerationResult[]> {
  const { baseUrl, apiKey, model } = getOpenAIConfig();
  const partialImages = options.partialImages ?? 2;

  const body = {
    model: options.model ?? model,
    prompt,
    n: options.n ?? 1,
    size: options.size ?? "1024x1024",
    quality: options.quality,
    response_format: "b64_json",
    stream: true,
    partial_images: partialImages,
  };

  logger.info({ model: body.model, size: body.size, partialImages },
    "openai streamGenerateImage");

  const response = await fetch(`${baseUrl}/v1/images/generations`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "unknown error");
    const err = new Error(`OpenAI Images API error ${response.status}: ${errorText}`);
    events.onError?.(err);
    throw err;
  }

  const finalResults: ImageGenerationResult[] = [];
  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body for streaming");

  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (!data || data === "[DONE]") continue;

        try {
          const event = JSON.parse(data);
          if (event.type === "image_generation.partial_image") {
            events.onPartialImage?.({
              partialImageIndex: event.partial_image_index as number,
              b64Json: event.b64_json as string,
            });
            finalResults.push({
              b64Json: event.b64_json as string,
              partialImageIndex: event.partial_image_index as number,
            });
          }
        } catch {
          // skip unparseable events
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  events.onComplete?.(finalResults);

  logger.info("openai streamGenerateImage complete");
  return finalResults;
}
