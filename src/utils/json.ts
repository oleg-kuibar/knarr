import { readFile } from "node:fs/promises";
import type { OwnRecord, PackageJson } from "../types.js";

export function ownRecord<V>(source?: Readonly<Record<string, V>>): OwnRecord<V> {
  const record = Object.create(null) as OwnRecord<V>;
  if (source) {
    for (const [key, value] of Object.entries(source)) record[key] = value;
  }
  return record;
}

/**
 * Typed JSON access. JSON from disk is untrusted input: package.json files from
 * linked libraries and consumers, lockfiles, state written by older versions.
 * `JSON.parse` returns `any`, which silently disables type checking downstream,
 * so parse to `unknown` here and narrow with the guards below.
 *
 * `JSON.parse` defines "__proto__" as an ordinary own property, so parsed
 * objects can't pollute Object.prototype by themselves. Don't spread or merge
 * them into objects built with literal `{}` keys from user input.
 */
export type JsonObject = { [key: string]: unknown };

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parse JSON to `unknown`; callers must validate before use. */
export function parseJson(text: string): unknown {
  return JSON.parse(text) as unknown;
}

/** Parse JSON that must be an object (package.json, state files). Throws otherwise. */
export function parseJsonObject(text: string, label = "JSON"): JsonObject {
  const value = parseJson(text);
  if (!isJsonObject(value)) {
    throw new Error(`${label} must contain a JSON object`);
  }
  return value;
}

export async function readJsonObject(path: string, label: string = path): Promise<JsonObject> {
  return parseJsonObject(await readFile(path, "utf-8"), label);
}

/** `obj[key]` when it is a string. */
export function stringField(obj: JsonObject, key: string): string | undefined {
  const value = obj[key];
  return typeof value === "string" ? value : undefined;
}

/** `obj[key]` when it is a JSON object. */
export function objectField(obj: JsonObject, key: string): JsonObject | undefined {
  const value = obj[key];
  return isJsonObject(value) ? value : undefined;
}

/** The string-valued entries of `obj[key]` (e.g. package.json "scripts"). */
export function stringRecordField(obj: JsonObject, key: string): OwnRecord<string> {
  const value = objectField(obj, key);
  const result = ownRecord<string>();
  if (!value) return result;
  for (const [k, v] of Object.entries(value)) {
    if (typeof v === "string") result[k] = v;
  }
  return result;
}

/**
 * Narrow a parsed package.json to `PackageJson`. `name` and `version` (the
 * identity used for store paths) must be strings. Other fields stay as parsed
 * and must be checked where they are used.
 */
export function asPackageJson(obj: JsonObject): PackageJson | null {
  if (typeof obj["name"] !== "string" || typeof obj["version"] !== "string") return null;
  return obj as unknown as PackageJson;
}

/** Indentation of an existing JSON document, so rewrites keep its style. */
export function detectJsonIndent(text: string): string {
  return /^(\s+)"/m.exec(text)?.[1] ?? "  ";
}
