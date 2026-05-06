import { describe, expect, it } from "vitest";
import {
  parseRenderedClawtributorEntries,
  renderClawtributorsBlock,
} from "../../scripts/update-clawtributors-render.js";

describe("scripts/update-clawtributors-render", () => {
  it("renders explicit avatar dimensions for every entry", () => {
    const block = renderClawtributorsBlock(
      [
        {
          display: "Andy",
          html_url: "https://github.com/andyk-ms",
          avatar_url: "https://avatars.githubusercontent.com/u/91510251?v=4&s=48",
        },
        {
          display: "Rajat Joshi",
          html_url: "https://github.com/18-RAJAT",
          avatar_url: "https://avatars.githubusercontent.com/u/78920780?v=4&s=48",
        },
      ],
      {
        perLine: 10,
        avatarSize: 48,
        startMarker: "<!-- clawtributors:start -->",
        endMarker: "<!-- clawtributors:end -->",
      },
    );

    expect(block).toContain('width="48"');
    expect(block).toContain('height="48"');
    expect(block).toContain(
      '<a href="https://github.com/18-RAJAT"><img src="https://avatars.githubusercontent.com/u/78920780?v=4&amp;s=48" width="48" height="48" alt="Rajat Joshi" title="Rajat Joshi"/></a>',
    );
  });

  it("round-trips rendered html entries without losing contributors", () => {
    const entries = [
      {
        display: "Andy",
        html_url: "https://github.com/andyk-ms",
        avatar_url: "https://avatars.githubusercontent.com/u/91510251?v=4&s=48",
      },
      {
        display: "Rajat Joshi",
        html_url: "https://github.com/18-RAJAT",
        avatar_url: "https://avatars.githubusercontent.com/u/78920780?v=4&s=48",
      },
      {
        display: 'Tom & "Jerry"',
        html_url: "https://github.com/example",
        avatar_url: "https://avatars.githubusercontent.com/u/1?v=4&s=48",
      },
    ];

    const block = renderClawtributorsBlock(entries, {
      perLine: 2,
      avatarSize: 48,
      startMarker: "<!-- clawtributors:start -->",
      endMarker: "<!-- clawtributors:end -->",
    });
    const parsed = parseRenderedClawtributorEntries(block);

    expect(parsed).toEqual(entries);
  });

  it("parses legacy markdown entries for seed compatibility", () => {
    const parsed = parseRenderedClawtributorEntries(
      "[![Rajat Joshi](https://avatars.githubusercontent.com/u/78920780?v=4&s=48)](https://github.com/18-RAJAT)",
    );

    expect(parsed).toEqual([
      {
        display: "Rajat Joshi",
        html_url: "https://github.com/18-RAJAT",
        avatar_url: "https://avatars.githubusercontent.com/u/78920780?v=4&s=48",
      },
    ]);
  });

  it("keeps rendered contributor count aligned with the input set", () => {
    const entries = Array.from({ length: 3 }, (_, index) => ({
      display: `Contributor ${index + 1}`,
      html_url: `https://github.com/example-${index + 1}`,
      avatar_url: `https://avatars.githubusercontent.com/u/${index + 1}?v=4&s=48`,
    }));

    const block = renderClawtributorsBlock(entries, {
      perLine: 2,
      avatarSize: 48,
      startMarker: "<!-- clawtributors:start -->",
      endMarker: "<!-- clawtributors:end -->",
    });

    expect(parseRenderedClawtributorEntries(block)).toHaveLength(entries.length);
  });
});
