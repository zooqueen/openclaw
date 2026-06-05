// SubCLI descriptor tests cover metadata for registered nested command groups.
import { afterEach, describe, expect, it, vi } from "vitest";

async function importSubCliDescriptors() {
  vi.resetModules();
  return import("./subcli-descriptors.js");
}

function descriptorNames(descriptors: ReadonlyArray<{ name: string }>): string[] {
  return descriptors.map((descriptor) => descriptor.name);
}

describe("sub-cli descriptors", () => {
  const originalExperimentalQaCli = process.env.OPENCLAW_ENABLE_EXPERIMENTAL_QA_CLI;

  afterEach(() => {
    if (originalExperimentalQaCli === undefined) {
      delete process.env.OPENCLAW_ENABLE_EXPERIMENTAL_QA_CLI;
    } else {
      process.env.OPENCLAW_ENABLE_EXPERIMENTAL_QA_CLI = originalExperimentalQaCli;
    }
    vi.resetModules();
  });

  it("keeps the exported descriptor list aligned with experimental QA visibility when disabled", async () => {
    delete process.env.OPENCLAW_ENABLE_EXPERIMENTAL_QA_CLI;

    const { SUB_CLI_DESCRIPTORS, getSubCliEntries } = await importSubCliDescriptors();
    const exportedNames = descriptorNames(SUB_CLI_DESCRIPTORS);

    expect(exportedNames).toEqual(descriptorNames(getSubCliEntries()));
    expect(exportedNames).not.toContain("qa");
  });

  it("keeps all sub-cli filter surfaces aligned when experimental QA is disabled", async () => {
    delete process.env.OPENCLAW_ENABLE_EXPERIMENTAL_QA_CLI;

    const {
      SUB_CLI_DESCRIPTORS,
      getSubCliCommandsWithSubcommands,
      getSubCliParentDefaultHelpCommands,
    } = await importSubCliDescriptors();
    const exportedNames = descriptorNames(SUB_CLI_DESCRIPTORS);

    expect(exportedNames).not.toContain("qa");
    expect(getSubCliCommandsWithSubcommands()).not.toContain("qa");
    expect(getSubCliParentDefaultHelpCommands()).not.toContain("qa");
  });

  it("includes qa in the exported descriptor list when experimental QA is enabled", async () => {
    process.env.OPENCLAW_ENABLE_EXPERIMENTAL_QA_CLI = "1";

    const {
      SUB_CLI_DESCRIPTORS,
      getSubCliCommandsWithSubcommands,
      getSubCliEntries,
      getSubCliParentDefaultHelpCommands,
    } = await importSubCliDescriptors();
    const exportedNames = descriptorNames(SUB_CLI_DESCRIPTORS);

    expect(exportedNames).toEqual(descriptorNames(getSubCliEntries()));
    expect(exportedNames).toContain("qa");
    expect(getSubCliCommandsWithSubcommands()).toContain("qa");
    expect(getSubCliParentDefaultHelpCommands()).not.toContain("qa");
  });
});
