import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { translateWithFallback } from '../../utils/translator';

export class BatchTranslateCommand {
  private currentPanel: vscode.WebviewPanel | undefined;

  async execute() {
    if (this.currentPanel) {
      this.currentPanel.reveal(vscode.ViewColumn.One);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'batchTranslate',
      '批量翻译',
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
          case 'getSourceFiles':
            await this.handleGetSourceFiles(panel);
            break;
          case 'previewPlan':
            await this.handlePreviewPlan(panel);
            break;
          case 'startTranslate':
            await this.handleStartTranslate(panel);
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
      const templatePath = path.join(currentFilePath, '..', '..', 'templates', 'batchTranslate.html');

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

  private async handleGetSourceFiles(panel: vscode.WebviewPanel) {
    try {
      const config = vscode.workspace.getConfiguration('multilang-tools');
      const dirPath = config.get('errorCodePath', 'public/errCode');
      const sourceFile = config.get('errorCodeSourceFile', 'zh-CN.js');
      const execFile = config.get('errorCodeExecFile', 'all');

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

      const files = this.getTargetFiles(sourceDir, sourceFile, execFile);

      panel.webview.postMessage({
        command: 'fileInfoResult',
        success: true,
        sourceFile: sourceFile,
        files: files
      });

    } catch (error) {
      console.error('获取源文件失败:', error);
      panel.webview.postMessage({
        command: 'fileInfoResult',
        success: false,
        message: `获取源文件失败: ${error}`
      });
    }
  }

  /**
   * 获取目标文件列表
   * @param sourceDir 源目录路径
   * @param sourceFile 源文件名
   * @param execFile 执行文件配置
   * @returns 目标文件列表
   */
  private getTargetFiles(sourceDir: string, sourceFile: string, execFile: string): Array<{ name: string, path: string }> {
    const files: Array<{ name: string, path: string }> = [];

    if (execFile === 'all') {
      // 如果配置为 'all'，则包含所有 .js 文件（除了源文件）
      return fs.readdirSync(sourceDir)
        .filter(file => file.endsWith('.js') && file !== sourceFile)
        .map(file => ({
          name: file,
          path: path.join(sourceDir, file)
        }));
    } else {
      // 处理多个文件（用逗号分隔）
      const fileNames = (execFile as string).split(',').map((name: string) => name.trim());

      for (const fileName of fileNames) {
        const execFilePath = path.join(sourceDir, fileName);
        if (fs.existsSync(execFilePath)) {
          files.push({
            name: fileName,
            path: execFilePath
          });
        }
      }
    }

    return files;
  }

  private async handlePreviewPlan(panel: vscode.WebviewPanel) {
    try {
      const config = vscode.workspace.getConfiguration('multilang-tools');
      const dirPath = config.get('errorCodePath', 'public/errCode');
      const sourceFile = config.get('errorCodeSourceFile', 'zh-CN.js');
      const execFile = config.get('errorCodeExecFile', 'all');

      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!workspaceRoot) {
        panel.webview.postMessage({
          command: 'previewResult',
          success: false,
          message: '无法获取工作区路径'
        });
        return;
      }

      const sourceDir = path.join(workspaceRoot, dirPath);
      const sourceFilePath = path.join(sourceDir, sourceFile);

      if (!fs.existsSync(sourceFilePath)) {
        panel.webview.postMessage({
          command: 'previewResult',
          success: false,
          message: `源文件不存在: ${sourceFilePath}`
        });
        return;
      }

      // 读取源文件错误码
      const sourceContent = fs.readFileSync(sourceFilePath, 'utf-8');
      const sourceErrorCodes = this.parseErrorCodes(sourceContent);

      // 获取目标文件列表
      const targetFileObjects = this.getTargetFiles(sourceDir, sourceFile, execFile);
      const targetFiles = targetFileObjects.map(file => file.name);

      // 检查每个目标文件
      const results = [];
      for (const targetFile of targetFiles) {
        const targetFilePath = path.join(sourceDir, targetFile);
        let missingCount = 0;
        let missingCodes: Array<{ code: string, message: string, lineNumber: number }> = [];

        if (fs.existsSync(targetFilePath)) {
          const targetContent = fs.readFileSync(targetFilePath, 'utf-8');
          const targetErrorCodes = this.parseErrorCodes(targetContent);
          const targetCodes = new Set(targetErrorCodes.map(item => item.code));

          // 找出缺少的错误码并获取行号
          const missingErrorCodes = sourceErrorCodes.filter(code => !targetCodes.has(code.code));
          missingCount = missingErrorCodes.length;

          // 为每个缺少的错误码找到行号
          for (const missingCode of missingErrorCodes) {
            const lineNumber = this.findErrorCodeLine(sourceContent.split('\n'), missingCode.code);
            missingCodes.push({
              code: missingCode.code,
              message: missingCode.message,
              lineNumber: lineNumber
            });
          }
        } else {
          // 如果目标文件不存在，所有源错误码都缺失
          missingCount = sourceErrorCodes.length;
          for (const sourceCode of sourceErrorCodes) {
            const lineNumber = this.findErrorCodeLine(sourceContent.split('\n'), sourceCode.code);
            missingCodes.push({
              code: sourceCode.code,
              message: sourceCode.message,
              lineNumber: lineNumber
            });
          }
        }

        results.push({
          file: targetFile,
          missingCount: missingCount,
          missingCodes: missingCodes
        });
      }

      panel.webview.postMessage({
        command: 'previewResult',
        success: true,
        results: results
      });

    } catch (error) {
      console.error('预览计划失败:', error);
      panel.webview.postMessage({
        command: 'previewResult',
        success: false,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async handleStartTranslate(panel: vscode.WebviewPanel) {
    try {
      console.log('开始批量翻译');

      const config = vscode.workspace.getConfiguration('multilang-tools');
      const dirPath = config.get('errorCodePath', 'public/errCode');
      const sourceFile = config.get('errorCodeSourceFile', 'zh-CN.js');
      const execFile = config.get('errorCodeExecFile', 'all');

      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!workspaceRoot) {
        throw new Error('无法获取工作区路径');
      }

      const sourceDir = path.join(workspaceRoot, dirPath);
      const sourceFilePath = path.join(sourceDir, sourceFile);
      if (!fs.existsSync(sourceFilePath)) {
        throw new Error(`源文件不存在: ${sourceFilePath}`);
      }

      // 读取源文件内容
      const sourceContent = fs.readFileSync(sourceFilePath, 'utf-8');
      const sourceErrorCodes = this.parseErrorCodes(sourceContent);

      // 获取目标文件列表
      const targetFiles = this.getTargetFiles(sourceDir, sourceFile, execFile);

      // 开始翻译
      const results = [];
      for (const targetFile of targetFiles) {
        try {
          // 发送开始翻译文件的消息
          panel.webview.postMessage({
            command: 'translateProgress',
            type: 'start',
            file: targetFile.name
          });

          // 根据文件名确定目标语言
          const targetLanguage = this.getLanguageFromFileName(targetFile.name);

          const result = await this.translateFile(
            sourceErrorCodes,
            targetFile.path,
            targetLanguage,
            'google', // 默认使用 Google 翻译
            panel // 传递panel用于发送进度消息
          );
          results.push(result);

          // 发送文件完成消息
          panel.webview.postMessage({
            command: 'translateProgress',
            type: 'fileComplete',
            file: targetFile.name,
            translated: result.translated,
            success: result.success
          });
        } catch (error) {
          results.push({
            file: targetFile.name,
            success: false,
            translated: 0,
            error: error instanceof Error ? error.message : String(error)
          });

          // 发送文件失败消息
          panel.webview.postMessage({
            command: 'translateProgress',
            type: 'fileComplete',
            file: targetFile.name,
            translated: 0,
            success: false
          });
        }
      }

      // 发送翻译结果
      panel.webview.postMessage({
        command: 'translateResult',
        success: true,
        results: results
      });

      // 翻译完成后刷新错误码提供者
      setTimeout(() => {
        this.refreshErrorCodeProvider();
      }, 200);

    } catch (error) {
      console.error('批量翻译失败:', error);
      panel.webview.postMessage({
        command: 'translateResult',
        success: false,
        message: `批量翻译失败: ${error}`
      });
    }
  }

  private parseErrorCodes(content: string): Array<{ code: string, message: string }> {
    const errorCodes: Array<{ code: string, message: string }> = [];
    const lines = content.split('\n');

    for (const line of lines) {
      const match = line.trim().match(/^"(\d+)":\s*"([^"]+)"/);
      if (match) {
        errorCodes.push({
          code: match[1],
          message: match[2]
        });
      }
    }

    return errorCodes;
  }

  private async translateFile(
    sourceErrorCodes: Array<{ code: string, message: string }>,
    targetFilePath: string,
    targetLanguage: string,
    translationService: string,
    panel?: vscode.WebviewPanel
  ): Promise<{ file: string, success: boolean, translated: number, errors: string[] }> {
    const fileName = path.basename(targetFilePath);
    const errors: string[] = [];
    let translatedCount = 0;

    try {
      // 读取目标文件
      let targetContent = '';
      if (fs.existsSync(targetFilePath)) {
        targetContent = fs.readFileSync(targetFilePath, 'utf-8');
      }

      // 解析目标文件中的现有错误码
      const existingErrorCodes = this.parseErrorCodes(targetContent);
      const existingCodes = new Set(existingErrorCodes.map(item => item.code));

      // 找出缺少的错误码
      const missingErrorCodes: Array<{ code: string, message: string }> = [];

      for (const sourceCode of sourceErrorCodes) {
        if (!existingCodes.has(sourceCode.code)) {
          missingErrorCodes.push(sourceCode);
        }
      }

      if (missingErrorCodes.length === 0) {
        return {
          file: fileName,
          success: true,
          translated: 0,
          errors: []
        };
      }

      // 读取源文件内容用于获取行号
      const config = vscode.workspace.getConfiguration('multilang-tools');
      const dirPath = config.get('errorCodePath', 'public/errCode');
      const sourceFile = config.get('errorCodeSourceFile', 'zh-CN.js');
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      const sourceFilePath = path.join(workspaceRoot!, dirPath, sourceFile);
      const sourceContent = fs.readFileSync(sourceFilePath, 'utf-8');

      // 翻译缺少的错误码
      const translatedErrorCodes: Array<{ code: string, message: string, lineNumber: number }> = [];
      let translatedCount = 0;
      const errors: string[] = [];

      for (const missingCode of missingErrorCodes) {
        try {
          // 使用真实的翻译API
          const translationResult = await translateWithFallback(
            missingCode.message,
            targetLanguage,
            'zh-cn'
          );

          if (translationResult.text) {
            // 找到源文件中这个错误码的行号
            const lineNumber = this.findErrorCodeLine(sourceContent.split('\n'), missingCode.code);

            translatedErrorCodes.push({
              code: missingCode.code,
              message: translationResult.text,
              lineNumber: lineNumber
            });
            translatedCount++;

            // 发送翻译成功的消息
            if (panel) {
              panel.webview.postMessage({
                command: 'translateProgress',
                type: 'success',
                file: fileName,
                code: missingCode.code,
                translatedMessage: translationResult.text,
                lineNumber: lineNumber
              });
            }
          } else {
            const errorMsg = `翻译错误码 ${missingCode.code} 失败: 翻译服务无响应`;
            errors.push(errorMsg);

            // 发送翻译失败的消息
            if (panel) {
              panel.webview.postMessage({
                command: 'translateProgress',
                type: 'error',
                file: fileName,
                code: missingCode.code,
                error: '翻译服务无响应',
                lineNumber: this.findErrorCodeLine(sourceContent.split('\n'), missingCode.code)
              });
            }
          }
        } catch (error) {
          const errorMsg = `翻译错误码 ${missingCode.code} 失败: ${error}`;
          errors.push(errorMsg);

          // 发送翻译失败的消息
          if (panel) {
            panel.webview.postMessage({
              command: 'translateProgress',
              type: 'error',
              file: fileName,
              code: missingCode.code,
              error: error instanceof Error ? error.message : String(error),
              lineNumber: this.findErrorCodeLine(sourceContent.split('\n'), missingCode.code)
            });
          }
        }
      }

      // 按行号排序，确保按源文件顺序插入
      translatedErrorCodes.sort((a, b) => a.lineNumber - b.lineNumber);

      // 更新目标文件，在对应行号插入
      if (translatedErrorCodes.length > 0) {
        const updatedContent = this.updateTargetFileWithLineNumber(targetContent, translatedErrorCodes);
        fs.writeFileSync(targetFilePath, updatedContent, 'utf-8');
      }

      return {
        file: fileName,
        success: true,
        translated: translatedCount,
        errors: errors
      };

    } catch (error) {
      return {
        file: fileName,
        success: false,
        translated: 0,
        errors: [error instanceof Error ? error.message : String(error)]
      };
    }
  }

  private updateTargetFileWithLineNumber(content: string, translatedErrorCodes: Array<{ code: string, message: string, lineNumber: number }>): string {
    // 如果文件为空，创建新的错误码对象
    if (!content.trim()) {
      const errorCodesText = translatedErrorCodes
        .map(item => `  "${item.code}": "${item.message}"`)
        .join(',\n');
      return `const errCode = {\n${errorCodesText}\n};`;
    }

    const lines = content.split('\n');
    const newLines = [...lines];

    // 按行号排序，确保按源文件顺序插入
    translatedErrorCodes.sort((a, b) => a.lineNumber - b.lineNumber);

    // 为每个翻译的错误码在对应行号插入
    for (const translatedCode of translatedErrorCodes) {
      const lineNumber = translatedCode.lineNumber;

      // 在对应行号插入新错误码
      if (lineNumber > 0 && lineNumber < newLines.length) {
        const insertLine = `  "${translatedCode.code}": "${translatedCode.message}",`;
        // lineNumber 是从1开始的行号，需要转换为从0开始的索引
        newLines.splice(lineNumber - 1, 0, insertLine);
      }
    }

    return newLines.join('\n');
  }

  private getLanguageFromFileName(fileName: string): string {
    // 根据文件名映射到语言代码
    const languageMap: { [key: string]: string } = {
      'en-US.js': 'en',
      'es-ES.js': 'es',
      'hi-IN.js': 'hi',
      'id-ID.js': 'id',
      'ja-JP.js': 'ja',
      'ms-MY.js': 'ms',
      'pt-BR.js': 'pt',
      'th-TH.js': 'th',
      'vi-VN.js': 'vi'
    };

    return languageMap[fileName] || 'en';
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