import * as vscode from "vscode";
import type { LinkEntry, KnarrMeta } from "../types";

/** Top-level node: a project folder that has .knarr/state.json */
export class ProjectItem extends vscode.TreeItem {
  constructor(
    public readonly projectLabel: string,
    public readonly projectPath: string,
    packageNames: string[]
  ) {
    super(projectLabel, vscode.TreeItemCollapsibleState.Expanded);
    this.description = packageNames.join(", ");
    this.iconPath = new vscode.ThemeIcon("folder");
    this.contextValue = "knarrProject";
    this.resourceUri = vscode.Uri.file(projectPath);
  }
}

/** Second-level node: a linked package within a project */
export class PackageItem extends vscode.TreeItem {
  constructor(
    public readonly packageName: string,
    public readonly link: LinkEntry,
    public readonly projectPath: string,
    storeMeta?: KnarrMeta
  ) {
    super(packageName, vscode.TreeItemCollapsibleState.Collapsed);

    const stale = storeMeta && storeMeta.contentHash !== link.contentHash;

    this.description = stale ? `${link.version} \u2022 stale` : link.version;
    this.iconPath = new vscode.ThemeIcon(
      stale ? "warning" : "package",
      stale
        ? new vscode.ThemeColor("editorWarning.foreground")
        : undefined
    );
    this.contextValue = "knarrPackage";

    // Click → open source folder
    this.command = {
      command: "knarr.openSource",
      title: "Open Source Folder",
      arguments: [link.sourcePath],
    };

    // Rich tooltip
    const lines = [
      `**${packageName}** @ ${link.version}`,
      ``,
      `Source: \`${shortenPath(link.sourcePath)}\``,
      `Linked: ${formatRelativeTime(link.linkedAt)}`,
    ];
    if (link.buildId) lines.push(`Build: \`${link.buildId}\``);
    if (stale && storeMeta?.buildId) {
      lines.push(``, `Store has newer build: \`${storeMeta.buildId}\``);
      lines.push("Run `knarr update` or `knarr push` to sync");
    } else if (storeMeta) {
      lines.push(``, `In sync with store`);
    }
    lines.push(`Backup: ${link.backupExists ? "available" : "none"}`);

    const md = new vscode.MarkdownString(lines.join("\n"));
    md.isTrusted = true;
    this.tooltip = md;
  }
}

/** Leaf node: a metadata field of a linked package */
export class MetadataItem extends vscode.TreeItem {
  constructor(label: string, value: string, icon?: string) {
    super(`${label}: ${value}`, vscode.TreeItemCollapsibleState.None);
    this.iconPath = icon ? new vscode.ThemeIcon(icon) : undefined;
    this.contextValue = "knarrMetadata";
  }
}

/** Helper: build metadata children for a linked package */
export function buildMetadataItems(link: LinkEntry, storeMeta?: KnarrMeta): MetadataItem[] {
  const items: MetadataItem[] = [];
  items.push(new MetadataItem("Source", shortenPath(link.sourcePath), "folder"));
  items.push(new MetadataItem("Linked", formatRelativeTime(link.linkedAt), "clock"));
  if (link.buildId) {
    items.push(new MetadataItem("Build", link.buildId, "tag"));
  }

  // Staleness
  if (storeMeta) {
    const inSync = storeMeta.contentHash === link.contentHash;
    items.push(
      new MetadataItem(
        "Store",
        inSync ? "in sync" : `stale (store: ${storeMeta.buildId ?? "unknown"})`,
        inSync ? "pass" : "warning"
      )
    );
  }

  items.push(
    new MetadataItem(
      "Backup",
      link.backupExists ? "\u2713" : "\u2717",
      link.backupExists ? "pass" : "warning"
    )
  );
  return items;
}

function shortenPath(p: string): string {
  const home = process.env.HOME || process.env.USERPROFILE || "";
  const normalized = p.replace(/\\/g, "/");
  const normalizedHome = home.replace(/\\/g, "/");
  if (normalizedHome && normalized.startsWith(normalizedHome)) {
    return "~" + normalized.slice(normalizedHome.length);
  }
  return normalized;
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
