import { getBundledChannelPlugin } from "../../channels/plugins/bundled.js";
import { getChannelPlugin } from "../../channels/plugins/index.js";
import { normalizeAnyChannelId } from "../../channels/registry.js";
import { findBundledPackageChannelMetadata } from "../../plugins/bundled-package-channel-metadata.js";
import type { PluginPackageChannelDoctorCapabilities } from "../../plugins/manifest.js";
import type { AllowFromMode } from "./shared/allow-from-mode.types.js";

export type DoctorGroupModel = "sender" | "route" | "hybrid";

export type DoctorChannelCapabilities = {
  dmAllowFromMode: AllowFromMode;
  groupModel: DoctorGroupModel;
  supportsGroupChats: boolean;
  groupAllowFromFallbackToAllowFrom: boolean;
  groupOwnerAllowFromFallbackToAllowFrom: boolean;
  groupOwnerAllowFromFallbackToAllowFromExplicit?: boolean;
  commandGroupAllowFromFallbackToAllowFrom?: boolean;
  commandAllowFromFallbackToAllowFrom: boolean;
  commandAllowFromFallbackToAllowFromExplicit?: boolean;
  elevatedAllowFromFallbackToAllowFrom: boolean;
  warnOnEmptyGroupSenderAllowlist: boolean;
};

const DEFAULT_DOCTOR_CHANNEL_CAPABILITIES: DoctorChannelCapabilities = {
  dmAllowFromMode: "topOnly",
  groupModel: "sender",
  supportsGroupChats: true,
  groupAllowFromFallbackToAllowFrom: true,
  groupOwnerAllowFromFallbackToAllowFrom: true,
  commandAllowFromFallbackToAllowFrom: true,
  // Elevated fallback is implemented only by a channel runtime hook, so doctor
  // must not warn unless channel metadata explicitly declares it.
  elevatedAllowFromFallbackToAllowFrom: false,
  warnOnEmptyGroupSenderAllowlist: true,
};

export function mergeDoctorChannelCapabilities(
  capabilities?: PluginPackageChannelDoctorCapabilities,
  options: { supportsGroupChats?: boolean } = {},
): DoctorChannelCapabilities {
  return {
    dmAllowFromMode:
      capabilities?.dmAllowFromMode ?? DEFAULT_DOCTOR_CHANNEL_CAPABILITIES.dmAllowFromMode,
    groupModel: capabilities?.groupModel ?? DEFAULT_DOCTOR_CHANNEL_CAPABILITIES.groupModel,
    supportsGroupChats:
      options.supportsGroupChats ?? DEFAULT_DOCTOR_CHANNEL_CAPABILITIES.supportsGroupChats,
    groupAllowFromFallbackToAllowFrom:
      capabilities?.groupAllowFromFallbackToAllowFrom ??
      DEFAULT_DOCTOR_CHANNEL_CAPABILITIES.groupAllowFromFallbackToAllowFrom,
    groupOwnerAllowFromFallbackToAllowFrom:
      capabilities?.groupOwnerAllowFromFallbackToAllowFrom ??
      DEFAULT_DOCTOR_CHANNEL_CAPABILITIES.groupOwnerAllowFromFallbackToAllowFrom,
    ...(capabilities?.groupOwnerAllowFromFallbackToAllowFrom !== undefined
      ? { groupOwnerAllowFromFallbackToAllowFromExplicit: true }
      : {}),
    ...(capabilities?.commandGroupAllowFromFallbackToAllowFrom !== undefined
      ? {
          commandGroupAllowFromFallbackToAllowFrom:
            capabilities.commandGroupAllowFromFallbackToAllowFrom,
        }
      : {}),
    commandAllowFromFallbackToAllowFrom:
      capabilities?.commandAllowFromFallbackToAllowFrom ??
      DEFAULT_DOCTOR_CHANNEL_CAPABILITIES.commandAllowFromFallbackToAllowFrom,
    ...(capabilities?.commandAllowFromFallbackToAllowFrom !== undefined
      ? { commandAllowFromFallbackToAllowFromExplicit: true }
      : {}),
    elevatedAllowFromFallbackToAllowFrom:
      capabilities?.elevatedAllowFromFallbackToAllowFrom ??
      DEFAULT_DOCTOR_CHANNEL_CAPABILITIES.elevatedAllowFromFallbackToAllowFrom,
    warnOnEmptyGroupSenderAllowlist:
      capabilities?.warnOnEmptyGroupSenderAllowlist ??
      DEFAULT_DOCTOR_CHANNEL_CAPABILITIES.warnOnEmptyGroupSenderAllowlist,
  };
}

function resolveSupportsGroupChats(
  plugin:
    | {
        capabilities?: { chatTypes?: readonly string[] };
      }
    | undefined,
): boolean | undefined {
  const chatTypes = plugin?.capabilities?.chatTypes;
  return Array.isArray(chatTypes) ? chatTypes.some((chatType) => chatType !== "direct") : undefined;
}

function getManifestDoctorCapabilities(
  channelId: string,
): PluginPackageChannelDoctorCapabilities | undefined {
  return findBundledPackageChannelMetadata(channelId)?.doctorCapabilities;
}

export function getDoctorChannelCapabilities(channelName?: string): DoctorChannelCapabilities {
  if (!channelName) {
    return DEFAULT_DOCTOR_CHANNEL_CAPABILITIES;
  }

  const manifestCapabilities = getManifestDoctorCapabilities(channelName);
  if (manifestCapabilities) {
    return mergeDoctorChannelCapabilities(manifestCapabilities);
  }

  const channelId = normalizeAnyChannelId(channelName);
  if (!channelId) {
    return DEFAULT_DOCTOR_CHANNEL_CAPABILITIES;
  }
  const plugin = getChannelPlugin(channelId) ?? getBundledChannelPlugin(channelId);
  if (plugin?.doctor) {
    return mergeDoctorChannelCapabilities(plugin.doctor, {
      supportsGroupChats: resolveSupportsGroupChats(plugin),
    });
  }
  return mergeDoctorChannelCapabilities(getManifestDoctorCapabilities(channelId));
}
