import type {
  ChatCommandDefinition,
  ClawdbotPluginApi,
  PluginHookMessageContext,
  PluginHookMessageReceivedEvent,
} from "clawdbot/plugin-sdk";
import { emptyPluginConfigSchema } from "clawdbot/plugin-sdk";

import {
  configureContactStore,
  closeContactStore,
} from "./src/contacts/index.js";
import { registerContactsCli } from "./src/cli/contacts-cli.js";
import { registerSearchCli } from "./src/cli/search-cli.js";
import { handleSearchCommand } from "./src/commands/search-command.js";
import { indexInboundMessage } from "./src/hooks/message-indexer.js";

const SEARCH_COMMAND: ChatCommandDefinition = {
  key: "search",
  description: "Search messages across platforms.",
  textAliases: ["/search"],
  scope: "text",
  acceptsArgs: true,
  args: [
    {
      name: "query",
      description: "Search query",
      type: "string",
      required: true,
      captureRemaining: true,
    },
  ],
};

const contactsSearchPlugin = {
  id: "contacts-search",
  name: "Contacts + Search",
  description: "Unified contact graph with cross-platform message search",
  configSchema: emptyPluginConfigSchema(),
  register(api: ClawdbotPluginApi) {
    const stateDir = api.runtime.state.resolveStateDir();
    configureContactStore({ stateDir });

    api.registerCli(
      ({ program }) => {
        registerContactsCli(program);
        registerSearchCli(program);
      },
      { commands: ["contacts", "search"] },
    );

    api.registerChatCommand(SEARCH_COMMAND, handleSearchCommand);

    api.on(
      "message_received",
      (event: PluginHookMessageReceivedEvent, ctx: PluginHookMessageContext) => {
        indexInboundMessage({ event, ctx, logger: api.logger });
      },
    );

    api.registerService({
      id: "contacts-search",
      start: () => {},
      stop: () => {
        closeContactStore();
      },
    });
  },
};

export default contactsSearchPlugin;
