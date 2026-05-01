import type { GatewayBrowserClient } from "../gateway.ts";

export type TtsProviderOption = {
  id: string;
  name: string;
  configured: boolean;
  voices: string[];
};

export type TtsState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  ttsLoading: boolean;
  ttsError: string | null;
  ttsEnabled: boolean;
  ttsProvider: string | null;
  ttsVoiceByProvider: Record<string, string>;
  ttsProviders: TtsProviderOption[];
  ttsProvidersLoading: boolean;
  ttsPreviewBusy: boolean;
  ttsPreviewError: string | null;
};

export async function loadTtsStatus(state: TtsState): Promise<void> {
  if (!state.client || !state.connected) {
    return;
  }
  if (state.ttsLoading) {
    return;
  }
  state.ttsLoading = true;
  state.ttsError = null;
  try {
    const res = await state.client.request<{
      enabled: boolean;
      provider: string | null;
      voiceByProvider?: Record<string, string>;
    }>("tts.status");
    state.ttsEnabled = res.enabled ?? false;
    state.ttsProvider = res.provider ?? null;
    state.ttsVoiceByProvider = res.voiceByProvider ?? {};
  } catch (err) {
    state.ttsError = String(err);
  } finally {
    state.ttsLoading = false;
  }
}

export async function loadTtsProviders(state: TtsState): Promise<void> {
  if (!state.client || !state.connected) {
    return;
  }
  if (state.ttsProvidersLoading) {
    return;
  }
  state.ttsProvidersLoading = true;
  try {
    const res = await state.client.request<{
      providers: TtsProviderOption[];
    }>("tts.providers");
    state.ttsProviders = Array.isArray(res?.providers) ? res.providers : [];
  } catch {
    state.ttsProviders = [];
  } finally {
    state.ttsProvidersLoading = false;
  }
}

export async function setTtsEnabled(state: TtsState, enabled: boolean): Promise<void> {
  if (!state.client || !state.connected) {
    return;
  }
  const method = enabled ? "tts.enable" : "tts.disable";
  try {
    await state.client.request(method);
    state.ttsEnabled = enabled;
  } catch (err) {
    state.ttsError = String(err);
  }
}

export async function setTtsProvider(state: TtsState, provider: string): Promise<void> {
  if (!state.client || !state.connected) {
    return;
  }
  try {
    await state.client.request("tts.setProvider", { provider });
    state.ttsProvider = provider;
  } catch (err) {
    state.ttsError = String(err);
  }
}

export async function setTtsVoice(
  state: TtsState,
  provider: string,
  voice: string | null,
): Promise<void> {
  if (!state.client || !state.connected) {
    return;
  }
  try {
    await state.client.request("tts.setVoice", { provider, voice });
    const next = { ...state.ttsVoiceByProvider };
    if (voice) {
      next[provider] = voice;
    } else {
      delete next[provider];
    }
    state.ttsVoiceByProvider = next;
  } catch (err) {
    state.ttsError = String(err);
  }
}

export async function playTtsPreview(
  state: TtsState,
  provider: string | null,
  voice: string | null,
): Promise<void> {
  if (!state.client || !state.connected || state.ttsPreviewBusy) {
    return;
  }
  state.ttsPreviewBusy = true;
  state.ttsPreviewError = null;
  try {
    const res = await state.client.request<{ audioDataUrl: string }>("tts.preview", {
      text: "Hello! This is a text-to-speech preview.",
      ...(provider ? { provider } : {}),
      ...(voice ? { voice } : {}),
    });
    if (res?.audioDataUrl) {
      const audio = new Audio(res.audioDataUrl);
      await audio.play();
    }
  } catch (err) {
    state.ttsPreviewError = String(err);
  } finally {
    state.ttsPreviewBusy = false;
  }
}
