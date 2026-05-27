import {
  emptyPluginConfigSchema,
  type OpenClawPluginApi,
  type ReplyPayload,
} from "openclaw/plugin-sdk";
import {
  defineBundledChannelEntry,
  type BundledChannelEntryContract,
} from "openclaw/plugin-sdk/channel-entry-contract";
import type { OpenClawConfig, TelegramAccountConfig } from "openclaw/plugin-sdk/config-contracts";
import {
  defineSingleProviderPluginEntry,
  type SingleProviderPluginOptions,
} from "openclaw/plugin-sdk/provider-entry";
import { defaultRuntime, type RuntimeEnv } from "openclaw/plugin-sdk/runtime-env";

const api = {} as OpenClawPluginApi;
const config = {} as OpenClawConfig;
const telegramAccount = {} as TelegramAccountConfig;
const runtimeEnv: RuntimeEnv = defaultRuntime;
const reply: ReplyPayload = { text: "hello" };

const providerOptions: SingleProviderPluginOptions = {
  id: "sample-provider",
  name: "Sample Provider",
  description: "Sample provider",
};

const providerEntry = defineSingleProviderPluginEntry(providerOptions);
const channelEntry: BundledChannelEntryContract = defineBundledChannelEntry({
  id: "sample-channel",
  name: "Sample Channel",
  description: "Sample channel",
  importMetaUrl: import.meta.url,
  plugin: { specifier: "./channel.js" },
});

void api;
void config;
void telegramAccount;
void runtimeEnv;
void reply;
void providerEntry;
void channelEntry;
void emptyPluginConfigSchema;
