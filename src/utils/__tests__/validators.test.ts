import { describe, it, expect } from "vitest";
import {
  isKnarrMeta,
  isLinkEntry,
  parseConsumerState,
  parseConsumersRegistry,
} from "../validators.js";

describe("isKnarrMeta", () => {
  it("returns true for valid meta", () => {
    expect(
      isKnarrMeta({
        contentHash: "sha256:abc123",
        publishedAt: "2024-01-01T00:00:00Z",
        sourcePath: "/some/path",
      })
    ).toBe(true);
  });

  it("returns false when fields are missing", () => {
    expect(isKnarrMeta({ contentHash: "abc" })).toBe(false);
    expect(isKnarrMeta({ contentHash: "abc", publishedAt: "now" })).toBe(false);
    expect(isKnarrMeta({ publishedAt: "now", sourcePath: "/p" })).toBe(false);
  });

  it("returns false when fields have wrong types", () => {
    expect(
      isKnarrMeta({
        contentHash: 123,
        publishedAt: "2024-01-01T00:00:00Z",
        sourcePath: "/some/path",
      })
    ).toBe(false);
    expect(
      isKnarrMeta({
        contentHash: "abc",
        publishedAt: true,
        sourcePath: "/some/path",
      })
    ).toBe(false);
  });

  it("returns false for null", () => {
    expect(isKnarrMeta(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isKnarrMeta(undefined)).toBe(false);
  });
});

describe("isLinkEntry", () => {
  const validEntry = {
    version: "1.0.0",
    contentHash: "sha256:abc123",
    linkedAt: "2024-01-01T00:00:00Z",
    sourcePath: "/some/path",
    backupExists: true,
    packageManager: "pnpm",
  };

  it("returns true for a valid entry", () => {
    expect(isLinkEntry(validEntry)).toBe(true);
  });

  it("returns true for all valid packageManager values", () => {
    for (const pm of ["npm", "pnpm", "yarn", "bun"]) {
      expect(isLinkEntry({ ...validEntry, packageManager: pm })).toBe(true);
    }
  });

  it("returns false for invalid packageManager values", () => {
    expect(isLinkEntry({ ...validEntry, packageManager: "pip" })).toBe(false);
    expect(isLinkEntry({ ...validEntry, packageManager: "" })).toBe(false);
    expect(isLinkEntry({ ...validEntry, packageManager: 123 })).toBe(false);
  });

  it("returns false when fields are missing", () => {
    const { version: _, ...noVersion } = validEntry;
    expect(isLinkEntry(noVersion)).toBe(false);

    const { backupExists: __, ...noBackup } = validEntry;
    expect(isLinkEntry(noBackup)).toBe(false);
  });
});

describe("parseConsumerState", () => {
  it("parses valid state", () => {
    expect(
      parseConsumerState({
        version: "1",
        links: {
          "my-pkg": {
            version: "1.0.0",
            contentHash: "sha256:abc",
            linkedAt: "2024-01-01T00:00:00Z",
            sourcePath: "/path",
            backupExists: false,
            packageManager: "npm",
          },
        },
      })
    ).not.toBeNull();
  });

  it("parses valid state with empty links", () => {
    expect(parseConsumerState({ version: "1", links: {} })).not.toBeNull();
  });

  it("rejects wrong version", () => {
    expect(parseConsumerState({ version: "2", links: {} })).toBeNull();
    expect(parseConsumerState({ version: 1, links: {} })).toBeNull();
  });

  it("rejects when links contain invalid entries", () => {
    expect(
      parseConsumerState({
        version: "1",
        links: {
          "my-pkg": { version: "1.0.0" }, // incomplete LinkEntry
        },
      })
    ).toBeNull();
  });
});

describe("parseConsumersRegistry", () => {
  it("parses valid registry", () => {
    expect(
      parseConsumersRegistry({
        "my-pkg": ["/path/to/consumer-a", "/path/to/consumer-b"],
        "other-pkg": ["/path/to/consumer-c"],
      })
    ).not.toBeNull();
  });

  it("parses empty registry", () => {
    expect(parseConsumersRegistry({})).not.toBeNull();
  });

  it("rejects when arrays contain non-strings", () => {
    expect(
      parseConsumersRegistry({
        "my-pkg": [123, 456],
      })
    ).toBeNull();
  });

  it("rejects when values are not arrays", () => {
    expect(
      parseConsumersRegistry({
        "my-pkg": "not-an-array",
      })
    ).toBeNull();
  });

  it("rejects null", () => {
    expect(parseConsumersRegistry(null)).toBeNull();
  });
});
