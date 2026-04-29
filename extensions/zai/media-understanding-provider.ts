import type { Api, Model } from "@mariozechner/pi-ai";
import {
  describeImageWithModelTransform,
  describeImagesWithModelTransform,
  type MediaUnderstandingProvider,
} from "openclaw/plugin-sdk/media-understanding";

const ZAI_PROVIDER_ID = "zai";
const ZAI_CODING_ENDPOINT_BASE_URL_PATTERN = /\/api\/coding\/paas\/(v\d+)$/i;

export function resolveZaiVisionStandardBaseUrl(baseUrl: string): string | undefined {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  const standardBaseUrl = trimmed.replace(ZAI_CODING_ENDPOINT_BASE_URL_PATTERN, "/api/paas/$1");
  return standardBaseUrl === trimmed ? undefined : standardBaseUrl;
}

export function routeZaiVisionModelToStandardEndpoint(model: Model<Api>): Model<Api> {
  if (model.provider.toLowerCase() !== ZAI_PROVIDER_ID || !model.input.includes("image")) {
    return model;
  }
  const baseUrl = resolveZaiVisionStandardBaseUrl(model.baseUrl);
  return baseUrl ? { ...model, baseUrl } : model;
}

export const zaiMediaUnderstandingProvider: MediaUnderstandingProvider = {
  id: "zai",
  capabilities: ["image"],
  defaultModels: { image: "glm-4.6v" },
  autoPriority: { image: 60 },
  describeImage: (request) =>
    describeImageWithModelTransform(request, routeZaiVisionModelToStandardEndpoint),
  describeImages: (request) =>
    describeImagesWithModelTransform(request, routeZaiVisionModelToStandardEndpoint),
};
