import type { AnyMessageContent, MiscMessageGenerationOptions } from "baileys";
import type { NormalizedLocation } from "openclaw/plugin-sdk/channel-inbound";
import type { PollInput } from "openclaw/plugin-sdk/poll-runtime";
import type { WhatsAppIdentity, WhatsAppReplyContext, WhatsAppSelfIdentity } from "../identity.js";
import type { WhatsAppInboundAdmission } from "./admission.js";
import type { WhatsAppSendResult } from "./send-result.js";

export type WebListenerCloseReason = {
  status?: number;
  isLoggedOut: boolean;
  error?: unknown;
};

export type ActiveWebSendOptions = {
  quotedMessageKey?: {
    id: string;
    remoteJid: string;
    fromMe: boolean;
    participant?: string;
    messageText?: string;
  };
  gifPlayback?: boolean;
  accountId?: string;
  fileName?: string;
  asDocument?: boolean;
};

export type ActiveWebListener = {
  sendMessage: (
    to: string,
    text: string,
    mediaBuffer?: Buffer,
    mediaType?: string,
    options?: ActiveWebSendOptions,
  ) => Promise<WhatsAppSendResult>;
  sendPoll: (to: string, poll: PollInput) => Promise<WhatsAppSendResult>;
  sendReaction: (
    chatJid: string,
    messageId: string,
    emoji: string,
    fromMe: boolean,
    participant?: string,
  ) => Promise<WhatsAppSendResult>;
  sendComposingTo: (to: string) => Promise<void>;
  close?: () => Promise<void>;
};

export type WhatsAppStructuredContactContext = {
  kind: "contact" | "contacts";
  total: number;
  contacts: Array<{
    name?: string;
    phones?: string[];
  }>;
};

export type WhatsAppInboundEvent = {
  id?: string;
  timestamp?: number;
  isBatched?: boolean;
};

export type WhatsAppInboundQuote = {
  context?: WhatsAppReplyContext;
  id?: string;
  body?: string;
  sender?: {
    displayName?: string;
    jid?: string;
    e164?: string;
  };
};

export type WhatsAppInboundGroupContext = {
  subject?: string;
  participants?: string[];
  mentions?: {
    text?: string[];
    jids?: string[];
  };
};

export type WhatsAppInboundPayload = {
  body: string;
  media?: {
    path?: string;
    type?: string;
    fileName?: string;
    url?: string;
  };
  location?: NormalizedLocation;
  untrustedStructuredContext?: Array<{
    label: string;
    source?: string;
    type?: string;
    payload: unknown;
  }>;
};

export type WhatsAppInboundPlatform = {
  chatJid: string;
  recipientJid: string;
  sender?: WhatsAppIdentity;
  senderJid?: string;
  senderE164?: string;
  senderName?: string;
  pushName?: string;
  self?: WhatsAppSelfIdentity;
  selfJid?: string | null;
  selfLid?: string | null;
  selfE164?: string | null;
  fromMe?: boolean;
  sendComposing: () => Promise<void>;
  reply: (text: string, options?: MiscMessageGenerationOptions) => Promise<WhatsAppSendResult>;
  sendMedia: (
    payload: AnyMessageContent,
    options?: MiscMessageGenerationOptions,
  ) => Promise<WhatsAppSendResult>;
};

export type WebInboundMessage = {
  admission?: WhatsAppInboundAdmission;
  event: WhatsAppInboundEvent;
  payload: WhatsAppInboundPayload;
  platform: WhatsAppInboundPlatform;
  from: string; // conversation id: E.164 for direct chats, group JID for groups
  conversationId: string; // alias for clarity (same as from)
  accountId: string;
  /** Set by the real inbound monitor after access-control / pairing checks pass. */
  accessControlPassed?: boolean;
  chatType: "direct" | "group";
  quote?: WhatsAppInboundQuote;
  group?: WhatsAppInboundGroupContext;
  wasMentioned?: boolean;
};
