/**
 * 添加错误码功能
 * 
 * @description 用于添加错误码到错误码文件中
 * 
 * @example 
 * 添加错误码：
 * 1. 读取错误码源文件
 * 2. 解析错误码数据
 * 3. 将错误码按数字顺序插入到错误码源文件中
 * 4. 刷新错误码文件列表
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export class ErrorCodeAddCommand {
  private currentPanel: vscode.WebviewPanel | undefined;

  async execute() {
    if (this.currentPanel) {
      this.currentPanel.reveal(vscode.ViewColumn.One);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'errorCodeAdd',
      '添加错误码',
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
    panel.webview.html = this.getWebviewContent();

    panel.webview.onDidReceiveMessage(
      async message => {
        switch (message.command) {
          case 'errorCodeAdd':
            await this.handleAddErrorCodes(message.errorCodes);
            break;
        }
      },
      undefined,
      []
    );
  }

  private getWebviewContent(): string {
    try {
      const currentFilePath = __dirname;
      const templatePath = path.join(currentFilePath, '..', '..', 'templates', 'errorCodeAdd.html');

      if (!fs.existsSync(templatePath)) {
        throw new Error(`模板文件不存在: ${templatePath}`);
      }

      const htmlContent = fs.readFileSync(templatePath, 'utf-8');
      return htmlContent;
    } catch (error) {
      console.error('加载模板文件失败:', error);
      return '<h2>无法加载页面</h2><p>错误信息: ' + error + '</p>';
    }
  }

  private async handleAddErrorCodes(errorCodes: Array<{ code: string, message: string }>) {
    try {
      console.log('添加错误码数据:', errorCodes);

      // 获取源文件路径
      const sourceFilePath = this.getSourceFilePath();

      // 检查源文件是否存在
      if (!fs.existsSync(sourceFilePath)) {
        this.sendResultToWebview({
          success: false,
          message: `源文件不存在: ${sourceFilePath}`,
          stats: { added: 0, exists: 0, failed: 1 }
        });
        return;
      }

      // 读取文件内容并按行分割
      const lines = fs.readFileSync(sourceFilePath, 'utf-8').split('\n');

      // 处理错误码（分类新错误码和已存在的错误码）
      const { newErrorCodes, existingCodes } = this.processErrorCodes(lines, errorCodes);

      // 插入新错误码到文件中
      this.insertErrorCodes(lines, newErrorCodes);

      // 写入文件
      fs.writeFileSync(sourceFilePath, lines.join('\n'));

      // 获取新添加错误码的行数信息
      const addedWithLines = newErrorCodes.map(({ code, message }) => {
        const lineNumber = this.findErrorCodeLine(lines, code);
        return { code, message, lineNumber };
      });

      // 发送成功结果到Webview
      this.sendResultToWebview({
        success: true,
        message: '批量添加完成!',
        stats: {
          added: newErrorCodes.length,
          exists: existingCodes.length,
          failed: 0
        },
        details: {
          added: addedWithLines,
          exists: existingCodes,
          failed: []
        }
      });

      // 添加完成后刷新侧边栏统计
      setTimeout(() => {
        this.refreshErrorCodeProvider();
      }, 200);

    } catch (error) {
      console.error('添加错误码失败:', error);
      // 发送错误结果到Webview
      this.sendResultToWebview({
        success: false,
        message: `❌ 添加错误码失败: ${error}`,
        stats: { added: 0, exists: 0, failed: errorCodes.length }
      });
    }
  }

  /**
   * 获取错误码源文件的完整路径
   * @returns {string} 源文件的完整路径
   */
  private getSourceFilePath(): string {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      throw new Error('无法获取工作区路径');
    }
    const config = vscode.workspace.getConfiguration('multilang-tools');
    const errorCodePath = config.get('errorCodePath', 'public/errCode');
    const sourceFile = config.get('errorCodeSourceFile', 'zh-CN.js');
    return path.join(workspaceRoot, errorCodePath, sourceFile);
  }

  /**
   * 处理错误码，分类新错误码和已存在的错误码
   * @param {string[]} lines - 文件的所有行
   * @param {Array<{code: string, message: string}>} errorCodes - 要处理的错误码数组
   * @returns {object} 包含newErrorCodes和existingCodes的对象
   */
  private processErrorCodes(lines: string[], errorCodes: Array<{ code: string, message: string }>) {
    // 创建现有错误码的Set集合，用于快速查找
    const existingCodeSet = new Set<number>();

    // 解析现有错误码，提取数字部分
    for (const line of lines) {
      const codeMatch = line.trim().match(/^"(\d+)":\s*"([^"]+)"/);
      if (codeMatch) {
        existingCodeSet.add(parseInt(codeMatch[1]));
      }
    }

    // 分类新错误码和已存在的错误码
    const newErrorCodes: Array<{ code: string; message: string }> = [];
    const existingCodes: Array<{ code: string; message: string }> = [];

    for (const { code, message } of errorCodes) {
      if (existingCodeSet.has(parseInt(code))) {
        // 错误码已存在
        existingCodes.push({ code, message });
      } else {
        // 错误码不存在，需要添加
        newErrorCodes.push({ code, message });
      }
    }

    // 对新错误码按数字排序
    newErrorCodes.sort((a, b) => parseInt(a.code) - parseInt(b.code));

    return { newErrorCodes, existingCodes };
  }

  /**
   * 将新错误码插入到文件中的合适位置
   * @param {string[]} lines - 文件的所有行
   * @param {Array<{code: string, message: string}>} newErrorCodes - 要插入的新错误码数组
   */
  private insertErrorCodes(lines: string[], newErrorCodes: Array<{ code: string; message: string }>) {
    for (const newErrorCode of newErrorCodes) {
      // 找到合适的插入位置
      const insertIndex = this.findInsertPosition(lines, newErrorCode.code);

      // 判断是否是最后一个错误码
      const isLastErrorCode = this.isLastErrorCode(lines, insertIndex);

      // 根据位置决定是否添加逗号
      const errorCodeLine = isLastErrorCode
        ? `  "${newErrorCode.code}": "${newErrorCode.message}"`
        : `  "${newErrorCode.code}": "${newErrorCode.message}",`;

      // 插入新错误码
      lines.splice(insertIndex, 0, errorCodeLine);

      // 确保前面的错误码有逗号
      this.ensurePreviousComma(lines, insertIndex);
    }
  }

  /**
   * 查找新错误码的插入位置
   * @param {string[]} lines - 文件的所有行
   * @param {string} newCode - 新错误码
   * @returns {number} 插入位置的索引
   */
  private findInsertPosition(lines: string[], newCode: string): number {
    // 查找合适的位置（按数字顺序）
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // 跳过注释行和空行
      if (line.startsWith('//') || line === '') continue;

      // 如果是错误码行，检查数字大小
      const codeMatch = line.match(/^"(\d+)":/);
      if (codeMatch && parseInt(newCode) < parseInt(codeMatch[1])) {
        return i;
      }
    }

    // 如果没找到合适位置，插入到文件末尾
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (line && line !== '}' && !line.startsWith('//')) {
        return i + 1;
      }
    }

    return lines.length;
  }

  /**
   * 判断插入位置是否是最后一个错误码
   * @param {string[]} lines - 文件的所有行
   * @param {number} insertIndex - 插入位置
   * @returns {boolean} 是否是最后一个错误码
   */
  private isLastErrorCode(lines: string[], insertIndex: number): boolean {
    for (let i = insertIndex; i < lines.length; i++) {
      const line = lines[i].trim();

      // 如果遇到结束大括号，说明是最后一个
      if (line === '}') return true;

      // 如果遇到其他错误码行，说明不是最后一个
      if (line && !line.startsWith('//') && line !== '' && line.match(/^"\d+":/)) {
        return false;
      }
    }
    return true;
  }

  /**
   * 确保前面的错误码有逗号
   * @param {string[]} lines - 文件的所有行
   * @param {number} insertIndex - 插入位置
   */
  private ensurePreviousComma(lines: string[], insertIndex: number) {
    if (insertIndex > 0) {
      const prevLine = lines[insertIndex - 1].trim();

      // 检查前面的行是否是错误码行且没有逗号
      if (prevLine.match(/^"\d+":\s*"[^"]*"$/) && !prevLine.endsWith(',')) {
        // 添加逗号
        lines[insertIndex - 1] = lines[insertIndex - 1] + ',';
      }
    }
  }

  /**
   * 发送结果到Webview
   * @param {object} result - 结果对象
   */
  private sendResultToWebview(result: {
    success: boolean;
    message: string;
    stats: { added: number; exists: number; failed: number };
    details?: {
      added: Array<{ code: string; message: string }>;
      exists: Array<{ code: string; message: string }>;
      failed: Array<{ code: string; message: string }>;
    };
  }) {
    if (this.currentPanel) {
      this.currentPanel.webview.postMessage({
        command: 'showResult',
        result: result
      });
    }
  }

  /**
   * 查找错误码在文件中的行号
   * @param {string[]} lines - 文件的所有行
   * @param {string} code - 错误码
   * @returns {number} 行号（从1开始）
   */
  private findErrorCodeLine(lines: string[], code: string): number {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.match(new RegExp(`^"${code}":`))) {
        return i + 1; // 返回行号（从1开始）
      }
    }
    return 0; // 如果没找到返回0
  }

  /**
   * 刷新错误码提供者
   */
  private refreshErrorCodeProvider() {
    try {
      // 通过全局变量刷新错误码提供者
      (globalThis as any).multilangErrorCodeProvider?.refresh();
    } catch (error) {
      console.error('刷新错误码提供者失败:', error);
    }
  }
} 