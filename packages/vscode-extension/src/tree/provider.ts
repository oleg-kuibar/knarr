import * as vscode from "vscode";
import type { KnarrStateWatcher } from "../state-watcher";
import type { LinkEntry } from "../types";
import {
  ProjectItem,
  PackageItem,
  MetadataItem,
  buildMetadataItems,
} from "./items";

type TreeNode = ProjectItem | PackageItem | MetadataItem;

export class KnarrTreeProvider implements vscode.TreeDataProvider<TreeNode> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<
    TreeNode | undefined | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private readonly watcher: KnarrStateWatcher) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: TreeNode): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: TreeNode): Promise<TreeNode[]> {
    if (!element) {
      const projects = await this.watcher.readAllProjects();
      if (projects.length === 0) return [];

      if (projects.length === 1) {
        const { state, projectPath } = projects[0];
        if (!state.links) return [];
        return this.buildPackageItems(state.links, projectPath);
      }

      return projects.map(
        (p) =>
          new ProjectItem(
            p.label,
            p.projectPath,
            Object.keys(p.state.links)
          )
      );
    }

    if (element instanceof ProjectItem) {
      const projects = await this.watcher.readAllProjects();
      const project = projects.find(
        (p) => p.projectPath === element.projectPath
      );
      if (!project?.state.links) return [];
      return this.buildPackageItems(project.state.links, element.projectPath);
    }

    if (element instanceof PackageItem) {
      const storeMeta = await this.watcher.readStoreMeta(
        element.packageName,
        element.link.version
      );
      return buildMetadataItems(element.link, storeMeta);
    }

    return [];
  }

  private async buildPackageItems(
    links: Record<string, LinkEntry>,
    projectPath: string
  ): Promise<PackageItem[]> {
    const entries = Object.entries(links).sort(([a], [b]) =>
      a.localeCompare(b)
    );

    // Fetch store meta in parallel for staleness badges
    const items = await Promise.all(
      entries.map(async ([name, link]) => {
        const storeMeta = await this.watcher.readStoreMeta(name, link.version);
        return new PackageItem(name, link, projectPath, storeMeta);
      })
    );

    return items;
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose();
  }
}
