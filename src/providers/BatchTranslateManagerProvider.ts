import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export class BatchTranslateButton extends vscode.TreeItem {
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
    this.contextValue = 'batchTranslateButton';
  }
}

export class TranslationFile extends vscode.TreeItem {
  constructor(
    public readonly fileName: string,
    public readonly filePath: string,
    public readonly translationCount: number,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState
  ) {
    super(`${fileName} (${translationCount} 个翻译)`, collapsibleState);

    this.tooltip = `${fileName} (${translationCount} 个翻译)`;
    this.contextValue = 'translationFile';
  }
}

export class TranslationFilesRoot extends vscode.TreeItem {
  constructor() {
    super('翻译文件:', vscode.TreeItemCollapsibleState.Expanded);
    this.iconPath = new vscode.ThemeIcon('folder');
    this.contextValue = 'translationFilesRoot';
  }
}

export class BatchTranslateManagerProvider implements vscode.TreeDataProvider<BatchTranslateButton | TranslationFile | TranslationFilesRoot> {
  private _onDidChangeTreeData: vscode.EventEmitter<BatchTranslateButton | TranslationFile | TranslationFilesRoot | undefined | null | void> = new vscode.EventEmitter<BatchTranslateButton | TranslationFile | TranslationFilesRoot | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<BatchTranslateButton | TranslationFile | TranslationFilesRoot | undefined | null | void> = this._onDidChangeTreeData.event;

  constructor(private workspaceRoot: string | undefined) { }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: BatchTranslateButton | TranslationFile | TranslationFilesRoot): vscode.TreeItem {
    return element;
  }

  getChildren(element?: BatchTranslateButton | TranslationFile | TranslationFilesRoot): Thenable<(BatchTranslateButton | TranslationFile | TranslationFilesRoot)[]> {
    if (!this.workspaceRoot) {
      return Promise.resolve([]);
    }

    if (element instanceof TranslationFilesRoot) {
      return this.getTranslationFiles();
    }

    if (element) {
      return Promise.resolve([]);
    }

    // 返回根级别的项目：按钮 + 翻译文件根节点
    const items: (BatchTranslateButton | TranslationFilesRoot)[] = [
      new BatchTranslateButton('文件路径配置', 'multilang-tools.batchConfigPath', vscode.TreeItemCollapsibleState.None),
      new BatchTranslateButton('批量翻译', 'multilang-tools.batchTranslate', vscode.TreeItemCollapsibleState.None),
      new BatchTranslateButton('整理文件', 'multilang-tools.batchOrganizeFile', vscode.TreeItemCollapsibleState.None),
      new TranslationFilesRoot()
    ];

    return Promise.resolve(items);
  }

  private async getTranslationFiles(): Promise<TranslationFile[]> {
    const files: TranslationFile[] = [];

    try {
      if (!this.workspaceRoot) {
        console.log('BatchTranslateManagerProvider: 工作区路径不存在');
        return files;
      }

      // 获取配置的目录路径
      const config = vscode.workspace.getConfiguration('multilang-tools');
      const dirPath = config.get('translatePath', 'src/lang/locales');
      const fullPath = path.join(this.workspaceRoot, dirPath);

      console.log('BatchTranslateManagerProvider: 翻译文件目录路径:', fullPath);

      if (!fs.existsSync(fullPath)) {
        console.log('BatchTranslateManagerProvider: 目录不存在:', fullPath);
        return files;
      }

      const fileList = fs.readdirSync(fullPath);
      console.log('BatchTranslateManagerProvider: 目录中的文件:', fileList);

      for (const fileName of fileList) {
        if (fileName.endsWith('.ts') || fileName.endsWith('.js')) {
          const filePath = path.join(fullPath, fileName);
          const stats = fs.statSync(filePath);

          if (stats.isFile()) {
            try {
              const content = fs.readFileSync(filePath, 'utf8');
              const translationCount = this.countTranslations(content);

              files.push(new TranslationFile(
                fileName,
                filePath,
                translationCount,
                vscode.TreeItemCollapsibleState.None
              ));
            } catch (error) {
              // 如果读取文件失败，仍然显示文件但标记为0个翻译
              files.push(new TranslationFile(
                fileName,
                filePath,
                0,
                vscode.TreeItemCollapsibleState.None
              ));
            }
          }
        }
      }

      // 按文件名排序
      files.sort((a, b) => a.fileName.localeCompare(b.fileName));

      console.log('BatchTranslateManagerProvider: 找到的翻译文件:', files.map(f => `${f.fileName} (${f.tooltip})`));

    } catch (error) {
      console.error('获取翻译文件列表失败:', error);
    }

    return files;
  }

  private countTranslations(content: string): number {
    const lines = content.split('\n');
    let count = 0;

    for (const line of lines) {
      const trimmed = line.trim();

      // 支持多种格式：
      // 1. 直接的键值对: "key": "value"
      // 2. 对象属性: key: "value"
      // 3. 嵌套对象中的键值对

      // 匹配 "key": "value" 格式
      let match = trimmed.match(/^["']([^"']+)["']\s*:\s*["']/);
      if (match) {
        count++;
        continue;
      }

      // 匹配 key: "value" 格式
      match = trimmed.match(/^([a-zA-Z_$][a-zA-Z0-9_$]*)\s*:\s*["']/);
      if (match) {
        count++;
        continue;
      }

      // 匹配嵌套对象中的键值对
      match = trimmed.match(/^\s*["']([^"']+)["']\s*:\s*["']/);
      if (match) {
        count++;
        continue;
      }
    }

    return count;
  }
} 