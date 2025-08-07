import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export class FileOrganizeCommand {
  private currentPanel: vscode.WebviewPanel | undefined;

  constructor() { }

  public async execute() {
    if (this.currentPanel) {
      this.currentPanel.reveal(vscode.ViewColumn.One);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'fileOrganize',
      '整理文件',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true
      }
    );

    this.currentPanel = panel;
    this.fillPanel(panel);

    panel.onDidDispose(() => {
      this.currentPanel = undefined;
    });
  }

  private fillPanel(panel: vscode.WebviewPanel) {
    // 设置HTML内容
    const htmlPath = path.join(__dirname, '../../templates/fileOrganize.html');
    let html = fs.readFileSync(htmlPath, 'utf8');

    // 替换资源路径
    html = html.replace(/src="([^"]+)"/g, (match, src) => {
      if (src.startsWith('http')) {
        return match;
      }
      const uri = vscode.Uri.file(path.join(__dirname, '../../templates', src));
      return `src="${panel.webview.asWebviewUri(uri)}"`;
    });

    panel.webview.html = html;

    // 处理消息
    panel.webview.onDidReceiveMessage(
      async (message) => {
        switch (message.command) {
          case 'getFileInfo':
            await this.handleGetFileInfo(panel);
            break;
          case 'organizeSourceFile':
            await this.handleOrganizeSourceFile(panel);
            break;
          case 'organizeTargetFiles':
            await this.handleOrganizeTargetFiles(panel);
            break;
        }
      }
    );
  }

  private async handleGetFileInfo(panel: vscode.WebviewPanel) {
    try {
      const config = vscode.workspace.getConfiguration('multilang-tools');
      const dirPath = config.get<string>('errorCodePath', 'public/errCode');
      const sourceFile = config.get<string>('errorCodeSourceFile', 'zh-CN.js');
      const execFile = config.get<string>('errorCodeExecFile', 'all');

      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!workspaceRoot) {
        panel.webview.postMessage({
          command: 'fileInfoResult',
          success: false,
          message: '无法获取工作区路径'
        });
        return;
      }

      const sourceDir = path.join(workspaceRoot, dirPath);
      if (!fs.existsSync(sourceDir)) {
        panel.webview.postMessage({
          command: 'fileInfoResult',
          success: false,
          message: `源目录不存在: ${sourceDir}`
        });
        return;
      }

      // 获取目标文件列表
      const targetFiles = this.getTargetFiles(sourceDir, sourceFile, execFile);

      panel.webview.postMessage({
        command: 'fileInfoResult',
        success: true,
        sourceFile: sourceFile,
        files: targetFiles
      });
    } catch (error) {
      panel.webview.postMessage({
        command: 'fileInfoResult',
        success: false,
        message: `获取文件信息失败: ${error}`
      });
    }
  }

  private async handleOrganizeSourceFile(panel: vscode.WebviewPanel) {
    try {
      const config = vscode.workspace.getConfiguration('multilang-tools');
      const dirPath = config.get<string>('errorCodePath', 'public/errCode');
      const sourceFile = config.get<string>('errorCodeSourceFile', 'zh-CN.js');

      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!workspaceRoot) {
        panel.webview.postMessage({
          command: 'organizeResult',
          success: false,
          message: '无法获取工作区路径'
        });
        return;
      }

      const sourceDir = path.join(workspaceRoot, dirPath);
      const sourceFilePath = path.join(sourceDir, sourceFile);

      if (!fs.existsSync(sourceFilePath)) {
        panel.webview.postMessage({
          command: 'organizeResult',
          success: false,
          message: `源文件不存在: ${sourceFilePath}`
        });
        return;
      }

      // 读取源文件内容
      const content = fs.readFileSync(sourceFilePath, 'utf8');
      const organizedContent = this.organizeFileContent(content);

      // 写回文件
      fs.writeFileSync(sourceFilePath, organizedContent, 'utf8');

      panel.webview.postMessage({
        command: 'organizeResult',
        success: true,
        message: `源文件 ${sourceFile} 整理完成`,
        file: sourceFile,
        type: 'source'
      });
    } catch (error) {
      panel.webview.postMessage({
        command: 'organizeResult',
        success: false,
        message: `整理源文件失败: ${error}`
      });
    }
  }

  private async handleOrganizeTargetFiles(panel: vscode.WebviewPanel) {
    try {
      const config = vscode.workspace.getConfiguration('multilang-tools');
      const dirPath = config.get<string>('errorCodePath', 'public/errCode');
      const sourceFile = config.get<string>('errorCodeSourceFile', 'zh-CN.js');
      const execFile = config.get<string>('errorCodeExecFile', 'all');

      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!workspaceRoot) {
        panel.webview.postMessage({
          command: 'organizeResult',
          success: false,
          message: '无法获取工作区路径'
        });
        return;
      }

      const sourceDir = path.join(workspaceRoot, dirPath);
      const targetFiles = this.getTargetFiles(sourceDir, sourceFile, execFile);
      const results: Array<{ file: string, success: boolean, message: string }> = [];

      for (const targetFile of targetFiles) {
        try {
          if (!fs.existsSync(targetFile.path)) {
            results.push({
              file: targetFile.name,
              success: false,
              message: `文件不存在: ${targetFile.path}`
            });
            continue;
          }

          // 读取源文件内容作为参考
          const sourceFilePath = path.join(sourceDir, sourceFile);
          const sourceContent = fs.readFileSync(sourceFilePath, 'utf8');

          // 读取目标文件内容
          const content = fs.readFileSync(targetFile.path, 'utf8');
          const organizedContent = this.organizeFileContent(content, sourceContent);

          // 写回文件
          fs.writeFileSync(targetFile.path, organizedContent, 'utf8');

          results.push({
            file: targetFile.name,
            success: true,
            message: `整理完成`
          });
        } catch (error) {
          results.push({
            file: targetFile.name,
            success: false,
            message: `整理失败: ${error}`
          });
        }
      }

      panel.webview.postMessage({
        command: 'organizeResult',
        success: true,
        message: `目标文件整理完成`,
        results: results,
        type: 'target'
      });
    } catch (error) {
      panel.webview.postMessage({
        command: 'organizeResult',
        success: false,
        message: `整理目标文件失败: ${error}`
      });
    }
  }

  private getTargetFiles(sourceDir: string, sourceFile: string, execFile: string): Array<{ name: string, path: string }> {
    const files: Array<{ name: string, path: string }> = [];
    if (execFile === 'all') {
      return fs.readdirSync(sourceDir)
        .filter(file => file.endsWith('.js') && file !== sourceFile)
        .map(file => ({ name: file, path: path.join(sourceDir, file) }));
    } else {
      const fileNames = (execFile as string).split(',').map((name: string) => name.trim());
      for (const fileName of fileNames) {
        const execFilePath = path.join(sourceDir, fileName);
        if (fs.existsSync(execFilePath)) {
          files.push({ name: fileName, path: execFilePath });
        }
      }
    }
    return files;
  }

  private organizeFileContent(content: string, sourceContent?: string): string {
    // 如果是源文件（zh-CN.js），按模块分组排序
    if (!sourceContent) {
      return this.organizeSourceFile(content);
    }

    // 如果是其他语言文件，按源文件排序
    return this.organizeTargetFile(content, sourceContent);
  }

  private organizeSourceFile(content: string): string {
    // 按行拆分
    const lines = content.split('\n');

    // 按模块分组处理
    const sections: Array<{
      moduleComment?: string,
      errorCodes: Array<{ code: string, line: string }>,
      otherLines: string[]
    }> = [];

    let currentSection = {
      errorCodes: [] as Array<{ code: string, line: string }>,
      otherLines: [] as string[]
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmedLine = line.trim();

      // 检查是否是模块注释
      if (trimmedLine.startsWith('//') && (trimmedLine.includes('模块') || trimmedLine.includes('-'))) {
        // 保存当前section
        if (currentSection.errorCodes.length > 0 || currentSection.otherLines.length > 0) {
          sections.push({ ...currentSection });
        }
        // 开始新section
        currentSection = {
          errorCodes: [],
          otherLines: [line] // 模块注释作为otherLines
        };
      } else {
        // 检查是否是错误码行
        const match = trimmedLine.match(/['"`]([^'"`]+)['"`]\s*:\s*['"`]/);
        if (match) {
          currentSection.errorCodes.push({
            code: match[1],
            line: line
          });
        } else {
          currentSection.otherLines.push(line);
        }
      }
    }

    // 添加最后一个section
    if (currentSection.errorCodes.length > 0 || currentSection.otherLines.length > 0) {
      sections.push(currentSection);
    }

    // 重新构建文件内容
    let organizedContent = '';

    for (const section of sections) {
      // 先输出非错误码行（包括模块注释）
      for (const line of section.otherLines) {
        organizedContent += line + '\n';
      }

      // 对当前模块的错误码排序
      if (section.errorCodes.length > 0) {
        section.errorCodes.sort((a, b) => {
          // 如果错误码是纯数字，按数值排序
          const aNum = parseInt(a.code);
          const bNum = parseInt(b.code);
          if (!isNaN(aNum) && !isNaN(bNum)) {
            return aNum - bNum;
          }
          // 否则按字符串排序
          return a.code.localeCompare(b.code);
        });

        // 输出排序后的错误码
        for (const errorCode of section.errorCodes) {
          organizedContent += errorCode.line + '\n';
        }
      }
    }

    return organizedContent;
  }

  private organizeTargetFile(content: string, sourceContent: string): string {
    // 解析源文件，获取错误码顺序
    const sourceLines = sourceContent.split('\n');
    const sourceErrorCodes: string[] = [];

    for (const line of sourceLines) {
      const trimmedLine = line.trim();
      const match = trimmedLine.match(/['"`]([^'"`]+)['"`]\s*:\s*['"`]/);
      if (match) {
        sourceErrorCodes.push(match[1]);
      }
    }

    // 解析目标文件
    const targetLines = content.split('\n');
    const targetErrorCodes = new Map<string, string>(); // code -> line
    const nonErrorCodeLines: string[] = [];

    for (const line of targetLines) {
      const trimmedLine = line.trim();
      const match = trimmedLine.match(/['"`]([^'"`]+)['"`]\s*:\s*['"`]/);
      if (match) {
        targetErrorCodes.set(match[1], line);
      } else {
        nonErrorCodeLines.push(line);
      }
    }

    // 按源文件顺序重建
    let organizedContent = '';
    let nonErrorCodeIndex = 0;

    for (const line of sourceLines) {
      const trimmedLine = line.trim();
      const match = trimmedLine.match(/['"`]([^'"`]+)['"`]\s*:\s*['"`]/);

      if (match) {
        // 错误码行：按源文件顺序输出
        const code = match[1];
        const targetLine = targetErrorCodes.get(code);
        if (targetLine) {
          organizedContent += targetLine + '\n';
        }
      } else {
        // 非错误码行：保持原样
        if (nonErrorCodeIndex < nonErrorCodeLines.length) {
          organizedContent += nonErrorCodeLines[nonErrorCodeIndex] + '\n';
          nonErrorCodeIndex++;
        } else {
          organizedContent += line + '\n';
        }
      }
    }

    // 移除末尾的多余空行
    return organizedContent.replace(/\n+$/, '\n');
  }
} 