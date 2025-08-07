import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export class ErrorManagerButton extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly commandId: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState
  ) {
    super(label, collapsibleState);

    this.command = {
      command: commandId,
      title: label
    };
    this.iconPath = new vscode.ThemeIcon('symbol-method');
    this.contextValue = 'errorManagerButton';
  }
}

export class ErrorCodeFile extends vscode.TreeItem {
  constructor(
    public readonly fileName: string,
    public readonly filePath: string,
    public readonly errorCount: number,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState
  ) {
    super(`${fileName} (${errorCount} 个错误码)`, collapsibleState);

    this.tooltip = `${fileName} (${errorCount} 个错误码)`;
    this.contextValue = 'errorCodeFile';
  }
}

export class ErrorCodeFilesRoot extends vscode.TreeItem {
  constructor() {
    super('错误码文件:', vscode.TreeItemCollapsibleState.Expanded);
    this.iconPath = new vscode.ThemeIcon('folder');
    this.contextValue = 'errorCodeFilesRoot';
  }
}

export class ErrorCodeManagerProvider implements vscode.TreeDataProvider<ErrorManagerButton | ErrorCodeFile | ErrorCodeFilesRoot> {
  private _onDidChangeTreeData: vscode.EventEmitter<ErrorManagerButton | ErrorCodeFile | ErrorCodeFilesRoot | undefined | null | void> = new vscode.EventEmitter<ErrorManagerButton | ErrorCodeFile | ErrorCodeFilesRoot | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<ErrorManagerButton | ErrorCodeFile | ErrorCodeFilesRoot | undefined | null | void> = this._onDidChangeTreeData.event;

  constructor(private workspaceRoot: string | undefined) { }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: ErrorManagerButton | ErrorCodeFile | ErrorCodeFilesRoot): vscode.TreeItem {
    return element;
  }

  getChildren(element?: ErrorManagerButton | ErrorCodeFile | ErrorCodeFilesRoot): Thenable<(ErrorManagerButton | ErrorCodeFile | ErrorCodeFilesRoot)[]> {
    if (!this.workspaceRoot) {
      return Promise.resolve([]);
    }

    if (element instanceof ErrorCodeFilesRoot) {
      return this.getErrorCodeFiles();
    }

    if (element) {
      return Promise.resolve([]);
    }

    // 返回根级别的项目：按钮 + 错误码文件根节点
    const items: (ErrorManagerButton | ErrorCodeFilesRoot)[] = [
      new ErrorManagerButton('文件路径配置', 'multilang-tools.configPath', vscode.TreeItemCollapsibleState.None),
      new ErrorManagerButton('添加错误码', 'multilang-tools.addSourceFile', vscode.TreeItemCollapsibleState.None),
      new ErrorManagerButton('批量翻译', 'multilang-tools.translateFile', vscode.TreeItemCollapsibleState.None),
      new ErrorManagerButton('整理文件', 'multilang-tools.organizeFile', vscode.TreeItemCollapsibleState.None),
      new ErrorCodeFilesRoot()
    ];

    return Promise.resolve(items);
  }

  private async getErrorCodeFiles(): Promise<ErrorCodeFile[]> {
    const files: ErrorCodeFile[] = [];

    try {
      if (!this.workspaceRoot) {
        return files;
      }

      // 获取配置的目录路径
      const config = vscode.workspace.getConfiguration('multilang-tools');
      const dirPath = config.get('errorCodePath', 'public/errCode');
      const fullPath = path.join(this.workspaceRoot, dirPath);

      if (!fs.existsSync(fullPath)) {
        return files;
      }

      const fileList = fs.readdirSync(fullPath);

      for (const file of fileList) {
        if (file.endsWith('.js') || file.endsWith('.ts')) {
          const filePath = path.join(fullPath, file);
          const fullFileName = path.basename(file); // 保留完整文件名（包括后缀）

          // 计算错误码数量
          const errorCount = this.getErrorCodeCount(filePath);

          const treeItem = new ErrorCodeFile(
            fullFileName,
            filePath,
            errorCount,
            vscode.TreeItemCollapsibleState.None
          );

          // 使用文件 URI 来设置图标，这样会显示 VSCode 默认的文件类型图标
          treeItem.resourceUri = vscode.Uri.file(filePath);

          // 添加命令，点击时打开文件
          treeItem.command = {
            command: 'vscode.open',
            title: '打开文件',
            arguments: [vscode.Uri.file(filePath)]
          };

          files.push(treeItem);
        }
      }
    } catch (error) {
      console.error('获取错误码文件失败:', error);
    }

    return files;
  }

  private getErrorCodeCount(filePath: string): number {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const matches = content.match(/"\d+":/g);
      const count = matches ? matches.length : 0;
      console.log(`文件 ${filePath} 统计到 ${count} 个错误码`);
      return count;
    } catch (error) {
      console.error(`读取文件失败 ${filePath}:`, error);
      return 0;
    }
  }
} 