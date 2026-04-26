import * as vscode from "vscode";
import { KnarrStateWatcher } from "./state-watcher";
import { KnarrTreeProvider } from "./tree/provider";
import { GraphPanel } from "./graph/panel";

let stateWatcher: KnarrStateWatcher | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) return;

  stateWatcher = new KnarrStateWatcher(workspaceRoot);
  context.subscriptions.push(stateWatcher);

  // Tree view
  const treeProvider = new KnarrTreeProvider(stateWatcher);
  const treeView = vscode.window.createTreeView("knarr.linkedPackages", {
    treeDataProvider: treeProvider,
  });
  context.subscriptions.push(treeView, treeProvider);

  // Auto-refresh tree on any state change
  stateWatcher.onDidChange(() => {
    treeProvider.refresh();
  });

  // Refresh command
  context.subscriptions.push(
    vscode.commands.registerCommand("knarr.refresh", () => {
      treeProvider.refresh();
    })
  );

  // Open source package.json on click
  context.subscriptions.push(
    vscode.commands.registerCommand("knarr.openSource", async (sourcePath: string) => {
      const pkgJson = vscode.Uri.file(
        sourcePath.replace(/\\/g, "/") + "/package.json"
      );
      try {
        const doc = await vscode.workspace.openTextDocument(pkgJson);
        await vscode.window.showTextDocument(doc, { preview: true });
      } catch {
        // If package.json doesn't exist, reveal the folder in explorer
        vscode.commands.executeCommand("revealInExplorer", vscode.Uri.file(sourcePath));
      }
    })
  );

  // Graph panel
  const graphPanel = new GraphPanel(context.extensionUri, stateWatcher);
  context.subscriptions.push(graphPanel);

  context.subscriptions.push(
    vscode.commands.registerCommand("knarr.showGraph", () => {
      graphPanel.show();
    })
  );
}

export function deactivate(): void {
  stateWatcher = undefined;
}
