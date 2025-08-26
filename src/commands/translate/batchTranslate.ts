/**
 * 批量翻译工具 - 批量翻译功能
 * 
 * @description 支持多语言文件的批量翻译，自动检测缺失的翻译并翻译
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { translateWithFallback } from '../../utils/translator';

export class BatchTranslateTranslateCommand {
  private currentPanel: vscode.WebviewPanel | undefined;
  private context: vscode.ExtensionContext;

  /**
   * 构造函数
   * @param context 扩展上下文
   */
  constructor(context: vscode.ExtensionContext) {
    this.currentPanel = undefined;
    this.context = context;
  }

  /**
   * 刷新翻译文件列表
   * 通知左侧的翻译文件管理器刷新显示
   */
  private refreshTranslationFiles() {
    try {
      const batchTranslateProvider = (globalThis as any).multilangBatchTranslateProvider;
      if (batchTranslateProvider && typeof batchTranslateProvider.refresh === 'function') {
        batchTranslateProvider.refresh();
        console.log('已刷新翻译文件列表');
      }
    } catch (error) {
      console.log('刷新翻译文件列表失败:', error);
    }
  }

  /**
   * 获取配置信息
   * @returns 配置对象
   */
  private getConfig() {
    const config = vscode.workspace.getConfiguration('multilang-tools');
    return {
      translatePath: config.get('translatePath', 'src/lang/locales'),
      sourceFile: config.get('translateSourceFile', 'zh-CN.ts'),
      execFile: config.get('translateExecFile', 'all')
    };
  }

  /**
   * 获取工作区路径
   * @returns 工作区路径，失败时抛出错误
   */
  private getWorkspacePath(): string {
    const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspacePath) {
      throw new Error('无法获取工作区路径');
    }
    return workspacePath;
  }

  /**
   * 获取目标文件列表
   * @param baseDir 基础目录
   * @param sourceFile 源文件名
   * @param execFile 执行文件配置
   * @returns 目标文件列表
   */
  private getTargetFiles(baseDir: string, sourceFile: string, execFile: string): Array<{ name: string, path: string }> {
    const files: Array<{ name: string, path: string }> = [];

    if (execFile === 'all') {
      // 如果配置为 'all'，则包含所有 .ts 文件（除了源文件）
      return fs.readdirSync(baseDir)
        .filter(file => file.endsWith('.ts') && file !== sourceFile)
        .map(file => ({
          name: file,
          path: path.join(baseDir, file)
        }));
    } else {
      // 处理多个文件（用逗号分隔）
      const fileNames = (execFile as string).split(',').map((name: string) => name.trim());

      for (const fileName of fileNames) {
        const execFilePath = path.join(baseDir, fileName);
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

  /**
   * 执行批量翻译命令
   * 创建或显示 WebView 面板
   */
  async execute() {
    // 如果面板已存在，直接显示
    if (this.currentPanel) {
      this.currentPanel.reveal(vscode.ViewColumn.One);
      return;
    }

    // 创建新的 WebView 面板
    const panel = vscode.window.createWebviewPanel(
      'batchTranslate',
      '批量翻译工具 - 批量翻译',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(this.context.extensionUri, 'out', 'resources')
        ]
      }
    );

    this.currentPanel = panel;
    this.setWebviewContent(panel);

    // 监听面板关闭事件
    panel.onDidDispose(() => {
      this.currentPanel = undefined;
    });
  }

  /**
   * 设置 WebView 面板内容
   * @param panel WebView 面板实例
   */
  private setWebviewContent(panel: vscode.WebviewPanel) {
    // 设置 HTML 内容
    panel.webview.html = this.getWebviewContent(panel);

    // 监听来自 WebView 的消息
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

  /**
   * 获取 WebView HTML 内容
   * @param panel WebView 面板实例
   * @returns HTML 内容字符串
   */
  private getWebviewContent(panel: vscode.WebviewPanel): string {
    try {
      // 使用 __dirname 获取模板文件路径（保持原来的方式）
      const currentFilePath = __filename;
      const templatePath = path.join(currentFilePath, '..', '..', '..', 'templates', 'batchTranslateTranslate.html');

      if (!fs.existsSync(templatePath)) {
        throw new Error(`模板文件不存在: ${templatePath}`);
      }

      const htmlContent = fs.readFileSync(templatePath, 'utf-8');

      // 按照建议的方法：对文件算 URI，别对目录算
      const resourcesPath = (p: string) => {
        const resourceUri = vscode.Uri.joinPath(this.context.extensionUri, 'out', 'resources', p);
        return panel.webview.asWebviewUri(resourceUri).toString();
      };

      // 替换所有资源路径
      return htmlContent
        .replace(/\.\.\/resources\/google\.png/g, resourcesPath('google.png'))
        .replace(/\.\.\/resources\/myMemory\.png/g, resourcesPath('myMemory.png'))
        .replace(/\.\.\/resources\/icon\.png/g, resourcesPath('icon.png'));

    } catch (error) {
      console.error('加载模板文件失败:', error);
      return '<h2>无法加载页面</h2><p>错误信息: ' + error + '</p>';
    }
  }

  /**
   * 处理获取源文件命令
   * 获取源文件和目标文件信息
   * @param panel WebView 面板实例
   */
  private async handleGetSourceFiles(panel: vscode.WebviewPanel) {
    try {
      const config = this.getConfig();
      const workspacePath = this.getWorkspacePath();
      const baseDir = path.join(workspacePath, config.translatePath);
      const sourceFile = config.sourceFile;

      if (!fs.existsSync(baseDir)) {
        panel.webview.postMessage({
          command: 'fileInfoResult',
          success: false,
          message: `翻译目录不存在: ${baseDir}`
        });
        return;
      }

      const sourceFilePath = path.join(baseDir, sourceFile);
      if (!fs.existsSync(sourceFilePath)) {
        panel.webview.postMessage({
          command: 'fileInfoResult',
          success: false,
          message: `源文件不存在: ${sourceFilePath}`
        });
        return;
      }

      const files = this.getTargetFiles(baseDir, sourceFile, config.execFile);

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
   * 处理预览计划命令
   * 分析源文件和目标文件，生成翻译计划
   * @param panel WebView 面板实例
   */
  private async handlePreviewPlan(panel: vscode.WebviewPanel) {
    try {
      const config = this.getConfig();
      const workspacePath = this.getWorkspacePath();
      const baseDir = path.join(workspacePath, config.translatePath);
      const sourceFile = config.sourceFile;

      const sourceFilePath = path.join(baseDir, sourceFile);

      if (!fs.existsSync(sourceFilePath)) {
        panel.webview.postMessage({
          command: 'previewResult',
          success: false,
          message: `源文件不存在: ${sourceFilePath}`
        });
        return;
      }

      // 读取源文件翻译内容
      const sourceContent = fs.readFileSync(sourceFilePath, 'utf-8');
      const sourceTranslations = this.parseTranslations(sourceContent);

      // 获取目标文件列表
      const targetFileObjects = this.getTargetFiles(baseDir, sourceFile, config.execFile);
      const targetFiles = targetFileObjects.map(file => file.name);

      // 检查每个目标文件
      const results = [];
      for (const targetFile of targetFiles) {
        const targetFilePath = path.join(baseDir, targetFile);
        let missingCount = 0;
        let missingTranslations: Array<{ key: string, value: string, lineNumber: number }> = [];

        if (fs.existsSync(targetFilePath)) {
          const targetContent = fs.readFileSync(targetFilePath, 'utf-8');
          const targetTranslations = this.parseTranslations(targetContent);
          const targetKeys = new Set(targetTranslations.map(item => item.key));

          // 找出缺少的翻译并获取行号
          const missingTranslationItems = sourceTranslations.filter(item => !targetKeys.has(item.key));
          missingCount = missingTranslationItems.length;

          // 为每个缺少的翻译找到行号
          for (const missingItem of missingTranslationItems) {
            const lineNumber = this.findTranslationLine(sourceContent.split('\n'), missingItem.key);
            missingTranslations.push({
              key: missingItem.key,
              value: missingItem.value,
              lineNumber: lineNumber
            });
          }
        } else {
          // 如果目标文件不存在，所有源翻译都缺失
          missingCount = sourceTranslations.length;
          for (const sourceItem of sourceTranslations) {
            const lineNumber = this.findTranslationLine(sourceContent.split('\n'), sourceItem.key);
            missingTranslations.push({
              key: sourceItem.key,
              value: sourceItem.value,
              lineNumber: lineNumber
            });
          }
        }

        results.push({
          file: targetFile,
          missingCount: missingCount,
          missingTranslations: missingTranslations
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

  /**
   * 处理开始翻译命令
   * 开始批量翻译所有目标文件
   * @param panel WebView 面板实例
   */
  private async handleStartTranslate(panel: vscode.WebviewPanel) {
    try {
      const config = this.getConfig();
      const workspacePath = this.getWorkspacePath();
      const baseDir = path.join(workspacePath, config.translatePath);
      const sourceFile = config.sourceFile;

      const sourceFilePath = path.join(baseDir, sourceFile);
      if (!fs.existsSync(sourceFilePath)) {
        throw new Error(`源文件不存在: ${sourceFilePath}`);
      }

      // 读取源文件内容
      const sourceContent = fs.readFileSync(sourceFilePath, 'utf-8');
      const sourceTranslations = this.parseTranslations(sourceContent);

      // 获取目标文件列表
      const targetFiles = this.getTargetFiles(baseDir, sourceFile, config.execFile);

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
            sourceTranslations,
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

      // 翻译完成后刷新翻译文件提供者
      setTimeout(() => {
        this.refreshTranslationFiles();
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

  /**
   * 解析翻译文件内容
   * @param content 文件内容
   * @returns 翻译项数组
   */
  private parseTranslations(content: string): Array<{ key: string, finalKey: string, value: string }> {
    const translations: Array<{ key: string, finalKey: string, value: string }> = [];

    try {
      // 清理注释
      let cleanContent = content.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

      // 如果包含 export default，提取对象部分
      if (cleanContent.includes('export default')) {
        const match = cleanContent.match(/export\s+default\s*(\{[\s\S]*\})/);
        if (match) {
          cleanContent = match[1];
        }
      }

      const parsed = new Function('return (' + cleanContent + ')')();

      // 递归提取所有键值对，保留完整路径和最终键名
      const extractKeyValues = (obj: any, prefix: string = '') => {
        if (typeof obj === 'object' && obj !== null) {
          for (const key in obj) {
            if (typeof obj[key] === 'string') {
              // 保留完整路径，包含所有层级
              const fullKey = prefix ? `${prefix}.${key}` : key;
              translations.push({
                key: fullKey,        // 完整路径，用于查找缺失
                finalKey: key,       // 最终键名，用于添加翻译
                value: obj[key]
              });
            } else if (typeof obj[key] === 'object' && obj[key] !== null) {
              // 递归处理嵌套对象，传递当前路径作为前缀
              extractKeyValues(obj[key], prefix ? `${prefix}.${key}` : key);
            }
          }
        }
      };

      extractKeyValues(parsed);
    } catch (error) {
      console.error('解析翻译文件失败:', error);
    }

    return translations;
  }

  /**
   * 翻译单个文件
   * @param sourceTranslations 源翻译列表
   * @param targetFilePath 目标文件路径
   * @param targetLanguage 目标语言
   * @param translationService 翻译服务
   * @param panel WebView 面板实例
   * @returns 翻译结果
   */
  private async translateFile(
    sourceTranslations: Array<{ key: string, finalKey: string, value: string }>,
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

      // 解析目标文件中的现有翻译
      const existingTranslations = this.parseTranslations(targetContent);
      const existingKeys = new Set(existingTranslations.map(item => item.key));

      // 找出缺少的翻译
      const missingTranslations: Array<{ key: string, finalKey: string, value: string }> = [];

      for (const sourceItem of sourceTranslations) {
        if (!existingKeys.has(sourceItem.key)) {
          missingTranslations.push(sourceItem);
        }
      }

      if (missingTranslations.length === 0) {
        return {
          file: fileName,
          success: true,
          translated: 0,
          errors: []
        };
      }

      // 读取源文件内容用于获取行号
      const config = this.getConfig();
      const workspacePath = this.getWorkspacePath();
      const baseDir = path.join(workspacePath, config.translatePath);
      const sourceFile = config.sourceFile;
      const sourceFilePath = path.join(baseDir, sourceFile);
      const sourceContent = fs.readFileSync(sourceFilePath, 'utf-8');

      // 翻译缺少的翻译项
      const translatedItems: Array<{ key: string, finalKey: string, value: string, lineNumber: number }> = [];
      let translatedCount = 0;
      const errors: string[] = [];

      for (const missingItem of missingTranslations) {
        try {
          // 使用真实的翻译API
          const translationResult = await translateWithFallback(
            missingItem.value,
            targetLanguage,
            'zh-cn'
          );

          if (translationResult.text) {
            // 找到源文件中这个翻译的行号
            const lineNumber = this.findTranslationLine(sourceContent.split('\n'), missingItem.key);

            translatedItems.push({
              key: missingItem.key,
              finalKey: missingItem.finalKey,
              value: translationResult.text,
              lineNumber: lineNumber
            });
            translatedCount++;

            // 发送翻译成功的消息
            if (panel) {
              panel.webview.postMessage({
                command: 'translateProgress',
                type: 'success',
                file: fileName,
                key: missingItem.key,
                translatedValue: translationResult.text,
                lineNumber: lineNumber,
                code: missingItem.key, // 添加 code 字段用于显示
                translator: translationResult.service || 'google' // 添加翻译工具信息
              });
            }
          } else {
            const errorMsg = `翻译键 ${missingItem.key} 失败: 翻译服务无响应`;
            errors.push(errorMsg);

            // 发送翻译失败的消息
            if (panel) {
              panel.webview.postMessage({
                command: 'translateProgress',
                type: 'error',
                file: fileName,
                key: missingItem.key,
                error: '翻译服务无响应',
                lineNumber: this.findTranslationLine(sourceContent.split('\n'), missingItem.key),
                code: missingItem.key // 添加 code 字段用于显示
              });
            }
          }
        } catch (error) {
          const errorMsg = `翻译键 ${missingItem.key} 失败: ${error}`;
          errors.push(errorMsg);

          // 发送翻译失败的消息
          if (panel) {
            panel.webview.postMessage({
              command: 'translateProgress',
              type: 'error',
              file: fileName,
              key: missingItem.key,
              error: error instanceof Error ? error.message : String(error),
              lineNumber: this.findTranslationLine(sourceContent.split('\n'), missingItem.key),
              code: missingItem.key // 添加 code 字段用于显示
            });
          }
        }
      }

      // 按行号排序，确保按源文件顺序插入
      translatedItems.sort((a, b) => a.lineNumber - b.lineNumber);

      // 更新目标文件，在对应行号插入
      if (translatedItems.length > 0) {
        const updatedContent = this.updateTargetFileWithLineNumber(targetContent, translatedItems);
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

  /**
   * 更新目标文件，在对应行号插入翻译
   * @param content 目标文件内容
   * @param translatedItems 翻译项列表
   * @returns 更新后的内容
   */
  private updateTargetFileWithLineNumber(content: string, translatedItems: Array<{ key: string, finalKey: string, value: string, lineNumber: number }>): string {
    // 如果文件为空，创建新的翻译对象
    if (!content.trim()) {
      const translationsText = translatedItems
        .map(item => `  "${item.key}": "${item.value}"`)
        .join(',\n');
      return `export default {\n${translationsText}\n};`;
    }

    const lines = content.split('\n');
    const newLines = [...lines];

    // 按行号排序，确保按源文件顺序插入
    translatedItems.sort((a, b) => a.lineNumber - b.lineNumber);

    // 为每个翻译的项在对应行号插入
    for (const translatedItem of translatedItems) {
      const lineNumber = translatedItem.lineNumber;

      // 在对应行号插入新翻译
      if (lineNumber > 0 && lineNumber < newLines.length) {
        // 根据嵌套层级计算正确的缩进
        const correctIndent = this.calculateCorrectIndent(translatedItem.key, lines, lineNumber);

        const insertLine = `${correctIndent}"${translatedItem.finalKey}": "${translatedItem.value}",`;
        // lineNumber 是从1开始的行号，需要转换为从0开始的索引
        newLines.splice(lineNumber - 1, 0, insertLine);
      }
    }

    return newLines.join('\n');
  }

  /**
   * 计算正确的缩进
   * @param fullKey 完整的键路径（如 active.salary.fenglu）
   * @param lines 文件的所有行
   * @param lineNumber 插入位置的行号
   * @returns 正确的缩进字符串
   */
  private calculateCorrectIndent(fullKey: string, lines: string[], lineNumber: number): string {
    // 计算嵌套层级（点号的数量 + 1）
    const nestingLevel = fullKey.split('.').length;

    // 智能检测基础缩进单位
    const baseIndent = this.detectBaseIndent(lines);

    // 根据嵌套层级计算缩进
    // 第1层：baseIndent，第2层：baseIndent*2，第3层：baseIndent*3
    const indent = baseIndent.repeat(nestingLevel);

    return indent;
  }

  /**
   * 检测文件的基础缩进
   * 获取第一个变量的缩进作为默认缩进
   * @param lines 文件的所有行
   * @returns 基础缩进字符串
   */
  private detectBaseIndent(lines: string[]): string {
    for (const line of lines) {
      // 跳过空行、注释行和 export default
      if (line.trim() === '' ||
        line.trim().startsWith('//') ||
        line.trim().startsWith('/*') ||
        line.trim() === 'export default {' ||
        line.trim() === '};') {
        continue;
      }

      // 获取行首缩进
      const indentMatch = line.match(/^(\s+)/);
      if (indentMatch) {
        const indent = indentMatch[1];
        // 返回第一个找到的缩进作为基础缩进
        return indent;
      }
    }

    return '  '; // 默认使用2个空格
  }

  /**
   * 根据文件名获取语言代码
   * @param fileName 文件名
   * @returns 语言代码
   */
  private getLanguageFromFileName(fileName: string): string {
    // 根据文件名映射到语言代码
    const languageMap: { [key: string]: string } = {
      'en-US.ts': 'en',
      'es-ES.ts': 'es',
      'hi-IN.ts': 'hi',
      'id-ID.ts': 'id',
      'ja-JP.ts': 'ja',
      'ms-MY.ts': 'ms',
      'pt-BR.ts': 'pt',
      'th-TH.ts': 'th',
      'vi-VN.ts': 'vi'
    };

    return languageMap[fileName] || 'en';
  }

  /**
   * 查找翻译键在文件中的行号
   * @param lines 文件的所有行
   * @param key 翻译键
   * @returns 行号（从1开始）
   */
  private findTranslationLine(lines: string[], key: string): number {
    // 处理嵌套键，如 games.name -> 查找 name: "value"
    const keyParts = key.split('.');
    const lastKey = keyParts[keyParts.length - 1];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      // 支持多种格式：key: "value" 或 "key": "value"
      if (line.includes(`"${key}":`) || line.includes(`${key}:`) ||
        line.includes(`"${lastKey}":`) || line.includes(`${lastKey}:`)) {
        return i + 1; // 返回行号（从1开始）
      }
    }
    return 1; // 如果没找到，返回第1行而不是0
  }
} 