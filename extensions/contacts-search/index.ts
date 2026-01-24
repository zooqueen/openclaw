import type { ClawdbotPluginApi } from "clawdbot/plugin-sdk";
import { emptyPluginConfigSchema } from "clawdbot/plugin-sdk";

import {
  configureContactStore,
  closeContactStore,
} from "./src/contacts/index.js";
import { registerContactsCli } from "./src/cli/contacts-cli.js";
import { registerSearchCli } from "./src/cli/search-cli.js";
import { runSearchCommand } from "./src/commands/search-command.js";
import { indexInboundMessage } from "./src/hooks/message-indexer.js";

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

    api.registerCommand({
      name: "search",
      description: "Search messages across platforms.",
      acceptsArgs: true,
      handler: async (ctx) => ({ text: runSearchCommand(ctx.commandBody) }),
    });

    api.on(
      "message_received",
      (event, ctx) => {
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
