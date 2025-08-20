/**
 * 批量翻译工具 - 文件整理功能
 * 
 * @description 支持源文件和目标文件的整理、还原、备份管理功能
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export class BatchTranslateOrganizeCommand {
  private currentPanel: vscode.WebviewPanel | undefined;

  // 常量定义
  private static readonly BACKUP_EXTENSION = '.backup';

  /**
   * 构造函数
   * 初始化当前面板为 undefined
   */
  constructor() {
    this.currentPanel = undefined;
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
   * 生成时间戳字符串
   * 格式：YYYY-MM-DD-HH-MM-SS
   * @returns 格式化的时间戳字符串
   */
  private generateTimestamp(): string {
    const now = new Date();
    return [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
      String(now.getHours()).padStart(2, '0'),
      String(now.getMinutes()).padStart(2, '0'),
      String(now.getSeconds()).padStart(2, '0')
    ].join('-');
  }

  /**
   * 检查是否应该创建备份文件
   * @param backupDir 备份目录路径
   * @param fileName 文件名（不含扩展名）
   * @returns 是否应该创建备份
   */
  private shouldCreateBackup(backupDir: string, fileName: string): boolean {
    if (!fs.existsSync(backupDir)) {
      return true; // 备份目录不存在，需要创建备份
    }

    const existingBackups = fs.readdirSync(backupDir).filter(file =>
      file.startsWith(fileName) && file.endsWith(BatchTranslateOrganizeCommand.BACKUP_EXTENSION)
    );

    return existingBackups.length === 0; // 没有现有备份时创建
  }

  /**
   * 创建备份文件
   * @param originalContent 原始文件内容
   * @param backupDir 备份目录路径
   * @param fileName 文件名（不含扩展名）
   * @returns 备份文件路径
   */
  private createBackupFile(originalContent: string, backupDir: string, fileName: string): string {
    // 确保备份目录存在
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    // 生成带时间戳的备份文件名
    const timestamp = this.generateTimestamp();
    const backupFileName = `${fileName}_${timestamp}${BatchTranslateOrganizeCommand.BACKUP_EXTENSION}`;
    const backupPath = path.join(backupDir, backupFileName);

    // 写入备份文件
    fs.writeFileSync(backupPath, originalContent, 'utf-8');

    return backupPath;
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
   * 发送错误消息到前端
   * @param panel WebView 面板实例
   * @param command 命令名称
   * @param message 错误消息
   */
  private sendErrorMessage(panel: vscode.WebviewPanel, command: string, message: string) {
    panel.webview.postMessage({
      command: command,
      success: false,
      message: message
    });
  }

  /**
   * 获取目标文件列表
   * @param baseDir 基础目录
   * @param sourceFile 源文件名
   * @param execFile 执行文件配置
   * @returns 目标文件列表
   */
  private getTargetFiles(baseDir: string, sourceFile: string, execFile: string): string[] {
    if (execFile === 'all') {
      return fs.readdirSync(baseDir)
        .filter(file => (file.endsWith('.ts') || file.endsWith('.js')) && file !== sourceFile);
    } else {
      const execFileStr = String(execFile);
      return execFileStr.split(',').map((f: string) => f.trim()).filter((f: string) => f);
    }
  }

  /**
   * 执行批量翻译工具命令
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
      'batchTranslateOrganize',
      '批量翻译工具 - 文件整理',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true
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
    panel.webview.html = this.getWebviewContent();

    // 监听来自 WebView 的消息
    panel.webview.onDidReceiveMessage(
      async message => {
        switch (message.command) {
          case 'organizeSource':
            await this.handleOrganizeSource(panel);
            break;
          case 'organizeTarget':
            await this.handleOrganizeTarget(panel);
            break;
          case 'restoreSource':
            await this.handleRestoreSource(panel, message.backupFile);
            break;
          case 'restoreTarget':
            await this.handleRestoreTarget(panel, message.backupFile);
            break;
          case 'cleanBackupSource':
            await this.handleCleanBackupSource(panel, message.backupFile);
            break;
          case 'cleanBackupTarget':
            await this.handleCleanBackupTarget(panel, message.backupFile);
            break;
          case 'getFileList':
            await this.handleGetFileList(panel);
            break;
          case 'getBackupList':
            await this.handleGetBackupList(panel, message.type);
            break;
          case 'getCleanBackupList':
            await this.handleGetCleanBackupList(panel, message.type);
            break;
          case 'backupSource':
            await this.handleBackupSource(panel);
            break;
          case 'backupTarget':
            await this.handleBackupTarget(panel);
            break;
        }
      },
      undefined,
      []
    );
  }

  /**
   * 处理整理源文件命令
   * 读取源文件，进行格式化整理，并保存
   * @param panel WebView 面板实例
   */
  private async handleOrganizeSource(panel: vscode.WebviewPanel) {
    try {
      // 获取配置和工作区路径
      const config = this.getConfig();
      const workspacePath = this.getWorkspacePath();
      const baseDir = path.join(workspacePath, config.translatePath);
      const sourceFilePath = path.join(baseDir, config.sourceFile);

      // 检查源文件是否存在
      if (!fs.existsSync(sourceFilePath)) {
        this.sendErrorMessage(panel, 'organizeSourceResult', `源文件不存在: ${sourceFilePath}`);
        return;
      }

      // 读取源文件内容并统计原始信息
      const originalContent = fs.readFileSync(sourceFilePath, 'utf-8');
      const originalKeys = this.countKeys(originalContent);
      const originalLines = originalContent.split('\n').length;

      // 格式化源文件内容
      const formattedContent = this.formatTranslationFile(originalContent);
      const formattedKeys = this.countKeys(formattedContent);
      const formattedLines = formattedContent.split('\n').length;

      // 检查是否有内容变化
      const hasChanges = originalContent !== formattedContent;

      // 检查是否需要自动备份
      const backupDir = path.join(path.dirname(sourceFilePath), 'backups');
      const fileName = path.basename(config.sourceFile, path.extname(config.sourceFile));
      const backupFileName = this.shouldCreateBackup(backupDir, fileName) ?
        this.createBackupFile(originalContent, backupDir, fileName) : '';

      // 如果有变化，保存格式化后的内容
      if (hasChanges) {
        fs.writeFileSync(sourceFilePath, formattedContent, 'utf-8');
      }

      // 发送整理结果给前端
      panel.webview.postMessage({
        command: 'organizeSourceResult',
        success: true,
        originalLines: originalLines,
        formattedLines: formattedLines,
        originalKeys: originalKeys,
        formattedKeys: formattedKeys,
        hasChanges: hasChanges,
        sourceInfo: {
          name: config.sourceFile,
          totalKeys: formattedKeys,
          totalLines: formattedLines
        }
      });

      // 刷新翻译文件列表
      this.refreshTranslationFiles();

    } catch (error) {
      // 发送错误信息给前端
      this.sendErrorMessage(panel, 'organizeSourceResult', `整理源文件失败: ${error}`);
    }
  }

  /**
   * 处理整理目标文件命令
   * 按照源文件的结构重新组织目标文件
   * @param panel WebView 面板实例
   */
  private async handleOrganizeTarget(panel: vscode.WebviewPanel) {
    try {
      // 获取配置和工作区路径
      const config = this.getConfig();
      const workspacePath = this.getWorkspacePath();
      const baseDir = path.join(workspacePath, config.translatePath);
      const sourceFilePath = path.join(baseDir, config.sourceFile);

      // 检查源文件是否存在
      if (!fs.existsSync(sourceFilePath)) {
        panel.webview.postMessage({
          command: 'organizeTargetResult',
          success: false,
          message: `源文件不存在: ${sourceFilePath}`
        });
        return;
      }

      // 读取源文件内容
      const sourceContent = fs.readFileSync(sourceFilePath, 'utf-8');
      const sourceStructure = this.parseTranslationStructure(sourceContent);

      // 获取目标文件列表
      const targetFiles = this.getTargetFiles(baseDir, config.sourceFile, config.execFile);

      const results: any[] = [];

      // 整理每个目标文件
      for (const targetFileName of targetFiles) {
        const targetFilePath = path.join(baseDir, targetFileName);
        if (!fs.existsSync(targetFilePath)) {
          continue;
        }

        try {
          const targetContent = fs.readFileSync(targetFilePath, 'utf-8');
          const originalKeys = this.countKeys(targetContent);
          const originalLines = targetContent.split('\n').length;

          // 按照源文件结构重新组织目标文件
          const organizedContent = this.organizeTargetFile(sourceContent, targetContent);
          const organizedKeys = this.countKeys(organizedContent);
          const organizedLines = organizedContent.split('\n').length;

          // 计算统计信息并获取具体的键值对信息
          const sourceKeyValues = this.getAllKeyValues(sourceContent);
          const targetKeyValues = this.getAllKeyValues(targetContent);

          // 获取具体的缺失键值对和多余键值对
          const missingKeyList = sourceKeyValues.filter(sourceKV =>
            !targetKeyValues.some(targetKV => targetKV.key === sourceKV.key)
          );
          const redundantKeyList = targetKeyValues.filter(targetKV =>
            !sourceKeyValues.some(sourceKV => sourceKV.key === targetKV.key)
          );

          // 计算缺失键数和多余键数（基于实际的键名差异，而不是数量差异）
          const missingKeys = missingKeyList.length;
          const redundantKeys = redundantKeyList.length;

          // 检查是否需要自动备份
          const backupDir = path.join(path.dirname(targetFilePath), 'backups');
          const fileName = path.basename(targetFileName, path.extname(targetFileName));
          const backupFileName = this.shouldCreateBackup(backupDir, fileName) ?
            this.createBackupFile(targetContent, backupDir, fileName) : '';

          // 保存整理后的内容
          fs.writeFileSync(targetFilePath, organizedContent, 'utf-8');

          results.push({
            name: targetFileName,
            status: '已整理',
            originalLines,
            organizedLines,
            originalKeys,
            organizedKeys,
            missingKeys,
            redundantKeys,
            missingKeyList: missingKeyList, // 显示所有缺失键
            redundantKeyList: redundantKeyList // 显示所有多余键
          });
        } catch (error) {
          results.push({
            name: targetFileName,
            status: '整理失败',
            error: String(error)
          });
        }
      }

      // 发送整理结果
      panel.webview.postMessage({
        command: 'organizeTargetResult',
        success: true,
        results: results,
        sourceFile: config.sourceFile
      });

      // 刷新翻译文件列表
      this.refreshTranslationFiles();

    } catch (error) {
      this.sendErrorMessage(panel, 'organizeTargetResult', `整理目标文件失败: ${error}`);
    }
  }

  /**
   * 处理还原源文件命令
   * 从备份文件还原源文件
   * @param panel WebView 面板实例
   * @param specifiedBackupFile 指定的备份文件名（可选）
   */
  private async handleRestoreSource(panel: vscode.WebviewPanel, specifiedBackupFile?: string) {
    try {
      // 获取配置和工作区路径
      const config = this.getConfig();
      const workspacePath = this.getWorkspacePath();
      const baseDir = path.join(workspacePath, config.translatePath);
      const sourceFilePath = path.join(baseDir, config.sourceFile);
      const backupDir = path.join(baseDir, 'backups');

      // 查找备份文件
      let backupPath = '';
      if (specifiedBackupFile) {
        // 使用指定的备份文件
        backupPath = path.join(backupDir, specifiedBackupFile);
      } else if (fs.existsSync(backupDir)) {
        // 查找最新的备份文件
        const backupFiles = fs.readdirSync(backupDir)
          .filter(file => file.startsWith(path.basename(config.sourceFile, path.extname(config.sourceFile))) && file.endsWith('.backup'))
          .sort()
          .reverse();

        if (backupFiles.length > 0) {
          backupPath = path.join(backupDir, backupFiles[0]);
        }
      }

      // 检查备份文件是否存在
      if (!backupPath || !fs.existsSync(backupPath)) {
        panel.webview.postMessage({
          command: 'restoreSourceResult',
          success: false,
          message: '备份文件不存在'
        });
        return;
      }

      // 从备份文件还原
      const backupContent = fs.readFileSync(backupPath, 'utf-8');
      fs.writeFileSync(sourceFilePath, backupContent, 'utf-8');

      // 获取备份文件名（不含路径）
      const backupFileName = path.basename(backupPath);

      // 发送还原结果
      panel.webview.postMessage({
        command: 'restoreSourceResult',
        success: true,
        message: '源文件已成功还原',
        sourceFile: config.sourceFile,
        backupFile: backupFileName
      });

      // 刷新翻译文件列表
      this.refreshTranslationFiles();

    } catch (error) {
      panel.webview.postMessage({
        command: 'restoreSourceResult',
        success: false,
        message: `还原源文件失败: ${error}`
      });
    }
  }

  /**
   * 处理还原目标文件命令
   * 从备份文件还原所有目标文件
   * @param panel WebView 面板实例
   * @param specifiedBackupFile 指定的备份文件名（可选）
   */
  private async handleRestoreTarget(panel: vscode.WebviewPanel, specifiedBackupFile?: string) {
    try {
      // 获取配置和工作区路径
      const config = this.getConfig();
      const workspacePath = this.getWorkspacePath();
      const baseDir = path.join(workspacePath, config.translatePath);

      // 获取目标文件列表
      const targetFiles = this.getTargetFiles(baseDir, config.sourceFile, config.execFile);

      const results: any[] = [];

      // 还原每个目标文件
      for (const targetFileName of targetFiles) {
        const targetFilePath = path.join(baseDir, targetFileName);
        const backupDir = path.join(baseDir, 'backups');

        // 查找备份文件
        let backupPath = '';
        if (specifiedBackupFile) {
          // 使用指定的备份文件
          backupPath = path.join(backupDir, specifiedBackupFile);
        } else if (fs.existsSync(backupDir)) {
          // 查找最新的备份文件
          const backupFiles = fs.readdirSync(backupDir)
            .filter(file => file.startsWith(path.basename(targetFileName, path.extname(targetFileName))) && file.endsWith('.backup'))
            .sort()
            .reverse();

          if (backupFiles.length > 0) {
            backupPath = path.join(backupDir, backupFiles[0]);
          }
        }

        if (backupPath && fs.existsSync(backupPath)) {
          try {
            const backupContent = fs.readFileSync(backupPath, 'utf-8');
            fs.writeFileSync(targetFilePath, backupContent, 'utf-8');

            const backupFileName = path.basename(backupPath);
            results.push({
              name: targetFileName,
              status: '已还原',
              backupFile: backupFileName
            });
          } catch (error) {
            results.push({
              name: targetFileName,
              status: '还原失败',
              error: String(error)
            });
          }
        } else {
          results.push({
            name: targetFileName,
            status: '无备份文件'
          });
        }
      }

      // 发送还原结果
      panel.webview.postMessage({
        command: 'restoreTargetResult',
        success: true,
        results: results
      });

      // 刷新翻译文件列表
      this.refreshTranslationFiles();

    } catch (error) {
      panel.webview.postMessage({
        command: 'restoreTargetResult',
        success: false,
        message: `还原目标文件失败: ${error}`
      });
    }
  }

  /**
   * 处理清理备份文件命令
   * 删除所有备份文件
   * @param panel WebView 面板实例
   */
  private async handleCleanBackup(panel: vscode.WebviewPanel) {
    try {
      // 获取配置信息
      const config = vscode.workspace.getConfiguration('multilang-tools');
      const translatePath = config.get('translatePath', 'src/lang/locales');

      const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!workspacePath) {
        panel.webview.postMessage({
          command: 'cleanBackupResult',
          success: false,
          message: '无法获取工作区路径'
        });
        return;
      }

      const baseDir = path.join(workspacePath, translatePath);

      // 扫描所有备份文件
      const allFiles = fs.readdirSync(baseDir);
      const backupFiles = allFiles.filter(file => file.endsWith('.backup'));

      const results: any[] = [];

      // 删除每个备份文件
      for (const backupFile of backupFiles) {
        const backupPath = path.join(baseDir, backupFile);

        try {
          fs.unlinkSync(backupPath);
          results.push({
            name: backupFile,
            status: '已删除'
          });
        } catch (error) {
          results.push({
            name: backupFile,
            status: '删除失败',
            error: String(error)
          });
        }
      }

      // 发送清理结果
      panel.webview.postMessage({
        command: 'cleanBackupResult',
        success: true,
        results: results,
        message: `共清理了 ${results.filter(r => r.status === '已删除').length} 个备份文件`
      });

    } catch (error) {
      panel.webview.postMessage({
        command: 'cleanBackupResult',
        success: false,
        message: `清理备份文件失败: ${error}`
      });
    }
  }

  /**
   * 处理获取文件列表命令
   * 扫描翻译文件目录，统计每个文件的基本信息
   * 动态获取配置中的源文件和目标文件列表
   * @param panel WebView 面板实例
   */
  private async handleGetFileList(panel: vscode.WebviewPanel) {
    try {
      // 获取配置和工作区路径
      const config = this.getConfig();
      const workspacePath = this.getWorkspacePath();
      const baseDir = path.join(workspacePath, config.translatePath);

      if (!fs.existsSync(baseDir)) {
        panel.webview.postMessage({
          command: 'fileListResult',
          success: false,
          message: `目录不存在: ${baseDir}`
        });
        return;
      }

      // 获取目标文件列表
      const targetFiles = this.getTargetFiles(baseDir, config.sourceFile, config.execFile);

      // 扫描目录获取所有翻译文件信息
      const allFiles = fs.readdirSync(baseDir)
        .filter(file => file.endsWith('.ts') || file.endsWith('.js'))
        .map(file => {
          const filePath = path.join(baseDir, file);
          const content = fs.readFileSync(filePath, 'utf-8');
          const keys = this.countKeys(content);
          const lines = content.split('\n').length;

          return {
            name: file,
            keys: keys,
            lines: lines,
            isSource: file === config.sourceFile,
            isTarget: targetFiles.includes(file)
          };
        });

      // 发送文件列表给前端，包含源文件和目标文件信息
      panel.webview.postMessage({
        command: 'fileListResult',
        success: true,
        files: allFiles,
        sourceFile: config.sourceFile,
        targetFiles: targetFiles,
        sourceFileInfo: allFiles.find(f => f.isSource) || null
      });

    } catch (error) {
      // 发送错误信息给前端
      panel.webview.postMessage({
        command: 'fileListResult',
        success: false,
        message: `获取文件列表失败: ${error}`
      });
    }
  }

  /**
 * 格式化翻译文件内容
 * 主要功能：
 * 1. 删除空行
 * 2. 单引号转双引号
 * 3. 处理包含双引号的值（使用反引号包围）
 * 4. 统一冒号后空格格式
 * @param content 原始文件内容
 * @returns 格式化后的文件内容
 */
  private formatTranslationFile(content: string): string {
    const lines = content.split('\n');
    const out: string[] = [];

    for (const line of lines) {
      if (line.trim() === '') continue; // 跳过空行

      let processedLine = line;

      // 处理包含冒号的行（键值对）
      if (line.includes(':')) {
        const parts = line.split(':');
        if (parts.length === 2) {
          // 保留原有的缩进
          const leadingWhitespace = line.match(/^\s*/)?.[0] || '';
          let key = parts[0].trim();
          let value = parts[1].trim();

          // 处理键：确保键被双引号包围
          if (key.startsWith("'") && key.endsWith("'")) {
            // 单引号键转双引号
            key = `"${key.slice(1, -1)}"`;
          } else if (!key.startsWith('"') || !key.endsWith('"')) {
            // 没有引号的键加上双引号
            key = `"${key.replace(/"/g, '\\"')}"`;
          }

          // 处理以单引号包围且以逗号结尾的值
          if (value.startsWith("'") && value.endsWith("',")) {
            // 移除单引号和逗号
            value = value.slice(1, -2);
            if (value.includes('"')) {
              // 如果值包含双引号，用反引号包围
              value = `\`${value}\``;
            } else {
              // 否则用双引号包围
              value = `"${value}"`;
            }
            value += ',';
          } else if (value.startsWith("'") && value.endsWith("'")) {
            // 处理以单引号包围的值（无逗号）
            value = value.slice(1, -1);
            if (value.includes('"')) {
              // 如果值包含双引号，用反引号包围
              value = `\`${value}\``;
            } else {
              // 否则用双引号包围
              value = `"${value}"`;
            }
          }

          // 重新组合键值对，保持原有缩进
          processedLine = `${leadingWhitespace}${key}: ${value}`;
        }
      }

      out.push(processedLine);
    }

    // 移除末尾的空行
    while (out.length > 0 && out[out.length - 1] === '') {
      out.pop();
    }

    return out.join('\n');
  }

  /**
   * 统计翻译文件中的键数
   * 递归遍历对象结构，只统计叶子节点（最终的翻译值）
   * @param content 文件内容
   * @returns 键的总数，解析失败时返回 0
   */
  private countKeys(content: string): number {
    try {
      // 清理文件内容，移除 export default 和结尾分号
      const cleanContent = content
        .replace(/export\s+default\s*/, '')
        .replace(/;$/, '');

      // 标准化模板字符串，然后解析为对象
      const normalized = this.normalizeTemplateLiterals(cleanContent);
      const structure = new Function('return (' + normalized + ')')();

      // 递归统计键数
      return this.countKeysRecursive(structure);
    } catch (error) {
      // 解析失败时返回 0
      return 0;
    }
  }

  /**
   * 标准化模板字符串
   * 将简单的模板字符串（不包含 ${} 占位符）转换为普通双引号字符串
   * 避免在解析时出现语法错误
   * @param code 代码字符串
   * @returns 标准化后的代码字符串
   */
  private normalizeTemplateLiterals(code: string): string {
    return code.replace(/`([^`$]*)`/g, (_m, inner) => {
      const escaped = String(inner)
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"');
      return '"' + escaped + '"';
    });
  }

  /**
   * 递归统计对象中的键数
   * 只统计叶子节点（最终的翻译值），忽略中间的对象节点
   * @param obj 要统计的对象
   * @returns 叶子节点的总数
   */
  private countKeysRecursive(obj: any): number {
    let count = 0;
    for (const key in obj) {
      if (typeof obj[key] === 'object' && obj[key] !== null) {
        // 如果是对象，递归计算子对象的键数
        count += this.countKeysRecursive(obj[key]);
      } else {
        // 如果是叶子节点（字符串值），计数加1
        count++;
      }
    }
    return count;
  }

  /**
   * 解析翻译文件结构
   * 将文件内容解析为 JavaScript 对象
   * @param content 文件内容
   * @returns 解析后的对象结构
   */
  private parseTranslationStructure(content: string): any {
    try {
      // 清理文件内容，移除 export default 和结尾分号
      const cleanContent = content
        .replace(/export\s+default\s*/, '')
        .replace(/;$/, '');

      // 标准化模板字符串，然后解析为对象
      const normalized = this.normalizeTemplateLiterals(cleanContent);
      const structure = new Function('return (' + normalized + ')')();
      return structure;
    } catch (error) {
      throw new Error(`解析文件结构失败: ${error}`);
    }
  }

  /**
 * 整理目标文件
 * 按照源文件的结构重新组织目标文件
 * @param sourceContent 源文件内容
 * @param targetContent 目标文件内容
 * @returns 整理后的内容
 */
  private organizeTargetFile(sourceContent: string, targetContent: string): string {
    try {
      // 解析源文件和目标文件
      const sourceData = this.parseFileData(sourceContent);
      const targetData = this.parseFileData(targetContent);

      // 按照源文件结构重新生成目标文件
      const organizedLines: string[] = [];

      // 添加 export default
      organizedLines.push('export default {');

      // 遍历源文件的每个顶层键
      const sourceTopLevelKeys = Object.keys(sourceData);
      for (let k = 0; k < sourceTopLevelKeys.length; k++) {
        const topLevelKey = sourceTopLevelKeys[k];
        const isLastTopLevelKey = k === sourceTopLevelKeys.length - 1;

        // 添加顶层键开始
        organizedLines.push(`  "${topLevelKey}": {`);

        // 获取源文件该键下的所有子键
        const sourceSubKeys = sourceData[topLevelKey] ? Object.keys(sourceData[topLevelKey]) : [];

        // 遍历源文件的每个子键
        for (let i = 0; i < sourceSubKeys.length; i++) {
          const sourceSubKey = sourceSubKeys[i];
          const isLast = i === sourceSubKeys.length - 1;

          // 检查目标文件是否有这个键
          if (targetData[topLevelKey] && targetData[topLevelKey][sourceSubKey]) {
            const targetValue = targetData[topLevelKey][sourceSubKey];

            if (typeof targetValue === 'string') {
              // 处理字符串值
              let formattedValue = targetValue.replace(/\n/g, '\\n');
              if (formattedValue.includes('"')) {
                formattedValue = `"${formattedValue.replace(/"/g, '\\"')}"`;
              } else {
                formattedValue = `"${formattedValue}"`;
              }
              organizedLines.push(`    "${sourceSubKey}": ${formattedValue}${isLast ? '' : ','}`);
            } else if (typeof targetValue === 'object' && targetValue !== null) {
              // 处理嵌套对象
              organizedLines.push(`    "${sourceSubKey}": {`);

              const sourceNestedKeys = sourceData[topLevelKey][sourceSubKey] ? Object.keys(sourceData[topLevelKey][sourceSubKey]) : [];

              // 遍历源文件的每个嵌套键
              for (let j = 0; j < sourceNestedKeys.length; j++) {
                const sourceNestedKey = sourceNestedKeys[j];
                const isNestedLast = j === sourceNestedKeys.length - 1;

                // 检查目标文件是否有这个嵌套键
                if (targetValue[sourceNestedKey]) {
                  const nestedValue = targetValue[sourceNestedKey];
                  if (typeof nestedValue === 'string') {
                    let formattedNestedValue = nestedValue.replace(/\n/g, '\\n');
                    if (formattedNestedValue.includes('"')) {
                      formattedNestedValue = `"${formattedNestedValue.replace(/"/g, '\\"')}"`;
                    } else {
                      formattedNestedValue = `"${formattedNestedValue}"`;
                    }
                    organizedLines.push(`      "${sourceNestedKey}": ${formattedNestedValue}${isNestedLast ? '' : ','}`);
                  }
                }
              }

              organizedLines.push(`    }${isLast ? '' : ','}`);
            }
          }
        }

        // 结束顶层键
        if (isLastTopLevelKey) {
          organizedLines.push('  }'); // 最后一个顶层键，不加逗号
        } else {
          organizedLines.push('  },'); // 不是最后一个顶层键，加逗号
        }
      }

      // 添加结束括号
      organizedLines.push('};');

      // 生成整理后的内容
      let organizedContent = organizedLines.join('\n');

      // 提取源文件注释并在最后阶段添加
      const sourceComments = this.extractSourceComments(sourceContent);
      organizedContent = this.addCommentsToOrganizedContent(organizedContent, sourceComments);

      return organizedContent;
    } catch (error) {
      console.error('整理目标文件失败:', error);
      return targetContent; // 失败时返回原内容
    }
  }

  /**
   * 解析文件内容，提取所有数据
   * @param content 文件内容
   * @returns 解析后的对象
   */
  private parseFileData(content: string): any {
    try {
      const cleanContent = content
        .replace(/export\s+default\s*/, '')
        .replace(/;$/, '');

      const parsed = new Function('return (' + cleanContent + ')')();
      return parsed;
    } catch (error) {
      console.error('解析文件失败:', error);
      return {};
    }
  }

  /**
   * 提取源文件的注释信息
   * @param sourceContent 源文件内容
   * @returns 注释映射对象，键为注释所在行的键名，值为注释内容
   */
  private extractSourceComments(sourceContent: string): Map<string, string> {
    const comments = new Map<string, string>();
    const lines = sourceContent.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // 检查是否是注释行
      if (line.startsWith('//') || line.startsWith('/*') || line.startsWith('*')) {
        // 查找下一行的键名
        for (let j = i + 1; j < lines.length; j++) {
          const nextLine = lines[j].trim();
          if (nextLine.includes('":')) {
            // 提取键名
            const keyMatch = nextLine.match(/"([^"]+)":/);
            if (keyMatch) {
              const key = keyMatch[1];
              comments.set(key, line);
            }
            break;
          }
        }
      }
    }

    return comments;
  }

  /**
   * 在整理后的内容中添加注释
   * @param organizedContent 整理后的内容
   * @param sourceComments 源文件注释映射
   * @returns 添加注释后的内容
   */
  private addCommentsToOrganizedContent(organizedContent: string, sourceComments: Map<string, string>): string {
    const lines = organizedContent.split('\n');
    const resultLines: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // 检查是否是键值对行
      if (line.includes('":')) {
        const keyMatch = line.match(/"([^"]+)":/);
        if (keyMatch) {
          const key = keyMatch[1];

          // 查找是否有对应的注释
          if (sourceComments.has(key)) {
            const comment = sourceComments.get(key)!;
            resultLines.push(`    ${comment}`);
          }
        }
      }

      resultLines.push(line);
    }

    return resultLines.join('\n');
  }

  /**
   * 获取源文件顶层键的顺序
   * @param sourceContent 源文件内容
   * @returns 顶层键的数组
   */
  private getSourceTopLevelKeys(sourceContent: string): string[] {
    try {
      const cleanContent = sourceContent
        .replace(/export\s+default\s*/, '')
        .replace(/;$/, '');

      const normalized = this.normalizeTemplateLiterals(cleanContent);
      const parsed = new Function('return (' + normalized + ')')();

      // 只获取顶层键
      return Object.keys(parsed);
    } catch (error) {
      console.error('解析源文件结构失败:', error);
      return [];
    }
  }

  /**
 * 解析目标文件为 sections
 * 基于对象结构而不是缩进来识别顶层键
 * @param targetContent 目标文件内容
 * @returns 按顶层键分组的行数组
 */
  private parseTargetFileSections(targetContent: string): Map<string, string[]> {
    const targetSections = new Map<string, string[]>();

    try {
      // 首先尝试解析整个文件，获取对象结构
      const cleanContent = targetContent
        .replace(/export\s+default\s*/, '')
        .replace(/;$/, '');

      const parsed = new Function('return (' + cleanContent + ')')();
      const topLevelKeys = Object.keys(parsed);

      // 现在按照对象结构来分割文件内容
      const lines = targetContent.split('\n');
      let currentSection: string | null = null;
      let currentSectionLines: string[] = [];
      let braceCount = 0;
      let inSection = false;
      let foundKeys = new Set<string>();

      for (const line of lines) {
        const trimmedLine = line.trim();

        // 跳过 export default 和结束括号
        if (trimmedLine === 'export default {' || trimmedLine === '}') {
          continue;
        }

        // 检查是否是新的顶层键
        const sectionMatch = trimmedLine.match(/^("?)([^":]+)\1:\s*\{/);
        if (sectionMatch) {
          const keyName = sectionMatch[2];

          // 检查这个键是否在解析出的顶层键列表中
          if (topLevelKeys.includes(keyName) && !foundKeys.has(keyName)) {
            // 保存前一个section
            if (currentSection && currentSectionLines.length > 0) {
              targetSections.set(currentSection, [...currentSectionLines]);
            }

            // 开始新的section
            currentSection = keyName;
            currentSectionLines = [line];
            inSection = true;
            braceCount = 1;
            foundKeys.add(keyName);
          } else {
            // 继续添加到当前section，并更新大括号计数
            if (inSection) {
              currentSectionLines.push(line);
              if (line.includes('{')) {
                braceCount++;
              }
              if (line.includes('}')) {
                braceCount--;
              }
            }
          }
        } else if (inSection) {
          // 添加到当前section
          currentSectionLines.push(line);

          // 计算大括号数量
          if (line.includes('{')) {
            braceCount++;
          }
          if (line.includes('}')) {
            braceCount--;
          }

          // 如果大括号数量为0，说明当前section结束
          if (braceCount === 0) {
            inSection = false;
          }
        }
      }

      // 保存最后一个section
      if (currentSection && currentSectionLines.length > 0) {
        targetSections.set(currentSection, [...currentSectionLines]);
      }

    } catch (error) {
      console.error('解析目标文件sections失败:', error);
    }

    return targetSections;
  }

  /**
   * 获取 WebView 的 HTML 内容
   * 从模板文件中读取 HTML 内容并返回
   * @returns HTML 内容字符串，失败时返回错误页面
   */
  private getWebviewContent(): string {
    try {
      // 获取扩展的根目录路径
      const extensionPath = vscode.extensions.getExtension('lande.multilang-tools')?.extensionPath;
      if (!extensionPath) {
        throw new Error('无法获取扩展路径');
      }

      // 构建模板文件路径
      const templatePath = path.join(extensionPath, 'out', 'templates', 'batchTranslateOrganize.html');

      // 检查模板文件是否存在
      if (!fs.existsSync(templatePath)) {
        throw new Error(`模板文件不存在: ${templatePath}`);
      }

      // 读取并返回 HTML 内容
      const htmlContent = fs.readFileSync(templatePath, 'utf-8');
      return htmlContent;
    } catch (error) {
      // 记录错误并返回错误页面
      console.error('加载模板文件失败:', error);
      return '<h2>无法加载页面</h2><p>错误信息: ' + error + '</p>';
    }
  }

  /**
   * 处理清理源文件备份命令
   * 删除源文件的所有备份文件或指定的备份文件
   * @param panel WebView 面板实例
   * @param specifiedBackupFile 指定的备份文件名（可选）
   */
  private async handleCleanBackupSource(panel: vscode.WebviewPanel, specifiedBackupFile?: string) {
    try {
      // 获取配置和工作区路径
      const config = this.getConfig();
      const workspacePath = this.getWorkspacePath();
      const baseDir = path.join(workspacePath, config.translatePath);
      const backupDir = path.join(baseDir, 'backups');

      if (!fs.existsSync(backupDir)) {
        panel.webview.postMessage({
          command: 'cleanBackupSourceResult',
          success: true,
          results: [],
          message: '没有找到备份文件夹'
        });
        return;
      }

      const results: any[] = [];

      if (specifiedBackupFile) {
        // 删除指定的备份文件
        const backupPath = path.join(backupDir, specifiedBackupFile);
        if (fs.existsSync(backupPath)) {
          try {
            fs.unlinkSync(backupPath);
            results.push({
              name: specifiedBackupFile,
              status: '已删除'
            });
          } catch (error) {
            results.push({
              name: specifiedBackupFile,
              status: '删除失败',
              error: String(error)
            });
          }
        } else {
          results.push({
            name: specifiedBackupFile,
            status: '文件不存在'
          });
        }
      } else {
        // 删除所有源文件备份
        const allFiles = fs.readdirSync(backupDir);
        const backupFiles = allFiles.filter(file =>
          file.startsWith(path.basename(config.sourceFile, path.extname(config.sourceFile))) &&
          file.endsWith('.backup')
        );

        // 删除每个备份文件
        for (const backupFile of backupFiles) {
          const backupPath = path.join(backupDir, backupFile);

          try {
            fs.unlinkSync(backupPath);
            results.push({
              name: backupFile,
              status: '已删除'
            });
          } catch (error) {
            results.push({
              name: backupFile,
              status: '删除失败',
              error: String(error)
            });
          }
        }
      }

      // 发送清理结果
      panel.webview.postMessage({
        command: 'cleanBackupSourceResult',
        success: true,
        results: results,
        message: `共清理了 ${results.filter(r => r.status === '已删除').length} 个源文件备份`
      });

      // 刷新翻译文件列表
      this.refreshTranslationFiles();

    } catch (error) {
      panel.webview.postMessage({
        command: 'cleanBackupSourceResult',
        success: false,
        message: `清理源文件备份失败: ${error}`
      });
    }
  }

  /**
   * 处理清理目标文件备份命令
   * 删除目标文件的所有备份文件或指定的备份文件
   * @param panel WebView 面板实例
   * @param specifiedBackupFile 指定的备份文件名（可选）
   */
  private async handleCleanBackupTarget(panel: vscode.WebviewPanel, specifiedBackupFile?: string) {
    try {
      // 获取配置和工作区路径
      const config = this.getConfig();
      const workspacePath = this.getWorkspacePath();
      const baseDir = path.join(workspacePath, config.translatePath);
      const backupDir = path.join(baseDir, 'backups');

      if (!fs.existsSync(backupDir)) {
        panel.webview.postMessage({
          command: 'cleanBackupTargetResult',
          success: true,
          results: [],
          message: '没有找到备份文件夹'
        });
        return;
      }

      const results: any[] = [];

      if (specifiedBackupFile) {
        // 删除指定的备份文件
        const backupPath = path.join(backupDir, specifiedBackupFile);
        if (fs.existsSync(backupPath)) {
          try {
            fs.unlinkSync(backupPath);
            results.push({
              name: specifiedBackupFile,
              status: '已删除'
            });
          } catch (error) {
            results.push({
              name: specifiedBackupFile,
              status: '删除失败',
              error: String(error)
            });
          }
        } else {
          results.push({
            name: specifiedBackupFile,
            status: '文件不存在'
          });
        }
      } else {
        // 删除所有目标文件备份
        const targetFiles = this.getTargetFiles(baseDir, config.sourceFile, config.execFile);

        // 扫描目标文件的备份文件
        for (const targetFileName of targetFiles) {
          const allFiles = fs.readdirSync(backupDir);
          const backupFiles = allFiles.filter(file =>
            file.startsWith(path.basename(targetFileName, path.extname(targetFileName))) &&
            file.endsWith('.backup')
          );

          // 删除每个备份文件
          for (const backupFile of backupFiles) {
            const backupPath = path.join(backupDir, backupFile);

            try {
              fs.unlinkSync(backupPath);
              results.push({
                name: backupFile,
                status: '已删除'
              });
            } catch (error) {
              results.push({
                name: backupFile,
                status: '删除失败',
                error: String(error)
              });
            }
          }
        }
      }

      // 发送清理结果
      panel.webview.postMessage({
        command: 'cleanBackupTargetResult',
        success: true,
        results: results,
        message: `共清理了 ${results.filter(r => r.status === '已删除').length} 个目标文件备份`
      });

      // 刷新翻译文件列表
      this.refreshTranslationFiles();

    } catch (error) {
      panel.webview.postMessage({
        command: 'cleanBackupTargetResult',
        success: false,
        message: `清理目标文件备份失败: ${error}`
      });
    }
  }

  /**
   * 处理获取备份文件列表命令
   * 扫描备份文件夹，返回指定类型的备份文件列表
   * @param panel WebView 面板实例
   * @param type 备份类型 ('source' 或 'target')
   */
  private async handleGetBackupList(panel: vscode.WebviewPanel, type: string) {
    try {
      // 获取配置和工作区路径
      const config = this.getConfig();
      const workspacePath = this.getWorkspacePath();
      const baseDir = path.join(workspacePath, config.translatePath);
      const backupDir = path.join(baseDir, 'backups');

      if (!fs.existsSync(backupDir)) {
        panel.webview.postMessage({
          command: 'backupListResult',
          success: true,
          type: type,
          backups: []
        });
        return;
      }

      const allFiles = fs.readdirSync(backupDir);
      let backups: any[] = [];

      if (type === 'source') {
        // 获取源文件的备份
        const sourceBackups = allFiles
          .filter(file =>
            file.startsWith(path.basename(config.sourceFile, path.extname(config.sourceFile))) &&
            file.endsWith('.backup')
          )
          .map(file => {
            const match = file.match(/(.+)_(\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2})\.backup$/);
            if (match) {
              return {
                fileName: file,
                displayName: `${match[1]}.backup`,
                timestamp: match[2]
              };
            }
            return null;
          })
          .filter(backup => backup !== null)
          .sort((a, b) => b.timestamp.localeCompare(a.timestamp)); // 按时间倒序排列

        backups = sourceBackups;
      } else if (type === 'target') {
        // 获取目标文件的备份
        const targetFiles = this.getTargetFiles(baseDir, config.sourceFile, config.execFile);

        const targetBackups: any[] = [];
        for (const targetFileName of targetFiles) {
          const targetBackupFiles = allFiles
            .filter(file =>
              file.startsWith(path.basename(targetFileName, path.extname(targetFileName))) &&
              file.endsWith('.backup')
            )
            .map(file => {
              const match = file.match(/(.+)_(\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2})\.backup$/);
              if (match) {
                return {
                  fileName: file,
                  displayName: `${match[1]}.backup`,
                  timestamp: match[2]
                };
              }
              return null;
            })
            .filter(backup => backup !== null);

          targetBackups.push(...targetBackupFiles);
        }

        backups = targetBackups.sort((a, b) => b.timestamp.localeCompare(a.timestamp)); // 按时间倒序排列
      }

      // 发送备份文件列表
      panel.webview.postMessage({
        command: 'backupListResult',
        success: true,
        type: type,
        backups: backups
      });

    } catch (error) {
      panel.webview.postMessage({
        command: 'backupListResult',
        success: false,
        message: `获取备份文件列表失败: ${error}`
      });
    }
  }

  /**
   * 处理获取清理备份文件列表命令
   * 复用获取备份文件列表的逻辑，但返回不同的命令类型
   * @param panel WebView 面板实例
   * @param type 备份类型 ('source' 或 'target')
   */
  private async handleGetCleanBackupList(panel: vscode.WebviewPanel, type: string) {
    try {
      // 获取配置和工作区路径
      const config = this.getConfig();
      const workspacePath = this.getWorkspacePath();
      const baseDir = path.join(workspacePath, config.translatePath);
      const backupDir = path.join(baseDir, 'backups');

      if (!fs.existsSync(backupDir)) {
        panel.webview.postMessage({
          command: 'cleanBackupListResult',
          success: true,
          type: type,
          backups: []
        });
        return;
      }

      const allFiles = fs.readdirSync(backupDir);
      let backups: any[] = [];

      if (type === 'source') {
        // 获取源文件的备份
        const sourceBackups = allFiles
          .filter(file =>
            file.startsWith(path.basename(config.sourceFile, path.extname(config.sourceFile))) &&
            file.endsWith('.backup')
          )
          .map(file => {
            const match = file.match(/(.+)_(\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2})\.backup$/);
            if (match) {
              return {
                fileName: file,
                displayName: `${match[1]}.backup`,
                timestamp: match[2]
              };
            }
            return null;
          })
          .filter(backup => backup !== null)
          .sort((a, b) => b.timestamp.localeCompare(a.timestamp)); // 按时间倒序排列

        backups = sourceBackups;
      } else if (type === 'target') {
        // 获取目标文件的备份
        const targetFiles = this.getTargetFiles(baseDir, config.sourceFile, config.execFile);

        const targetBackups: any[] = [];
        for (const targetFileName of targetFiles) {
          const targetBackupFiles = allFiles
            .filter(file =>
              file.startsWith(path.basename(targetFileName, path.extname(targetFileName))) &&
              file.endsWith('.backup')
            )
            .map(file => {
              const match = file.match(/(.+)_(\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2})\.backup$/);
              if (match) {
                return {
                  fileName: file,
                  displayName: `${match[1]}.backup`,
                  timestamp: match[2]
                };
              }
              return null;
            })
            .filter(backup => backup !== null);

          targetBackups.push(...targetBackupFiles);
        }

        backups = targetBackups.sort((a, b) => b.timestamp.localeCompare(a.timestamp)); // 按时间倒序排列
      }

      // 发送清理备份文件列表
      panel.webview.postMessage({
        command: 'cleanBackupListResult',
        success: true,
        type: type,
        backups: backups
      });

    } catch (error) {
      panel.webview.postMessage({
        command: 'cleanBackupListResult',
        success: false,
        message: `获取清理备份文件列表失败: ${error}`
      });
    }
  }

  /**
   * 处理手动备份源文件命令
   * @param panel WebView 面板实例
   */
  private async handleBackupSource(panel: vscode.WebviewPanel) {
    try {
      // 获取配置和工作区路径
      const config = this.getConfig();
      const workspacePath = this.getWorkspacePath();
      const sourceFilePath = path.join(workspacePath, config.translatePath, config.sourceFile);

      if (!fs.existsSync(sourceFilePath)) {
        panel.webview.postMessage({
          command: 'backupSourceResult',
          success: false,
          message: `源文件不存在: ${config.sourceFile}`
        });
        return;
      }

      // 读取源文件内容
      const sourceContent = fs.readFileSync(sourceFilePath, 'utf-8');

      // 创建备份文件夹
      const backupDir = path.join(workspacePath, config.translatePath, 'backups');
      if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
      }

      // 生成备份文件名
      const timestamp = this.generateTimestamp();
      const backupFileName = `${path.basename(config.sourceFile, path.extname(config.sourceFile))}_${timestamp}.backup`;
      const backupPath = path.join(backupDir, backupFileName);

      // 备份源文件
      fs.writeFileSync(backupPath, sourceContent, 'utf-8');

      // 发送备份结果
      panel.webview.postMessage({
        command: 'backupSourceResult',
        success: true,
        backupFile: backupFileName,
        sourceFile: config.sourceFile,
        message: `源文件备份成功: ${backupFileName}`
      });

      // 刷新翻译文件列表
      this.refreshTranslationFiles();

    } catch (error) {
      panel.webview.postMessage({
        command: 'backupSourceResult',
        success: false,
        message: `备份源文件失败: ${error}`
      });
    }
  }

  /**
   * 处理手动备份目标文件命令
   * @param panel WebView 面板实例
   */
  private async handleBackupTarget(panel: vscode.WebviewPanel) {
    try {
      // 获取配置和工作区路径
      const config = this.getConfig();
      const workspacePath = this.getWorkspacePath();
      const baseDir = path.join(workspacePath, config.translatePath);

      // 获取目标文件列表
      const targetFiles = this.getTargetFiles(baseDir, config.sourceFile, config.execFile);
      const results: any[] = [];

      // 创建备份文件夹
      const backupDir = path.join(baseDir, 'backups');
      if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
      }

      // 备份每个目标文件
      for (const targetFileName of targetFiles) {
        const targetFilePath = path.join(baseDir, targetFileName);
        if (!fs.existsSync(targetFilePath)) {
          continue;
        }

        try {
          const targetContent = fs.readFileSync(targetFilePath, 'utf-8');

          // 生成备份文件名
          const timestamp = this.generateTimestamp();
          const backupFileName = `${path.basename(targetFileName, path.extname(targetFileName))}_${timestamp}.backup`;
          const backupPath = path.join(backupDir, backupFileName);

          // 备份目标文件
          fs.writeFileSync(backupPath, targetContent, 'utf-8');

          results.push({
            name: targetFileName,
            status: '已备份',
            backupFile: backupFileName
          });

        } catch (error) {
          results.push({
            name: targetFileName,
            status: '备份失败',
            error: String(error)
          });
        }
      }

      // 发送备份结果
      panel.webview.postMessage({
        command: 'backupTargetResult',
        success: true,
        results: results,
        message: `共备份了 ${results.filter(r => r.status === '已备份').length} 个目标文件`
      });

      // 刷新翻译文件列表
      this.refreshTranslationFiles();

    } catch (error) {
      panel.webview.postMessage({
        command: 'backupTargetResult',
        success: false,
        message: `备份目标文件失败: ${error}`
      });
    }
  }

  /**
 * 获取文件中的所有键值对（包括嵌套键）
 * @param content 文件内容
 * @returns 键值对数组
 */
  private getAllKeyValues(content: string): Array<{ key: string, value: string }> {
    try {
      // 解析文件内容 - 处理 export default 语法
      let cleanContent = content.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

      // 如果包含 export default，提取对象部分
      if (cleanContent.includes('export default')) {
        const match = cleanContent.match(/export\s+default\s*(\{[\s\S]*\})/);
        if (match) {
          cleanContent = match[1];
        }
      }



      const parsed = new Function('return (' + cleanContent + ')')();

      const keyValues: Array<{ key: string, value: string }> = [];

      // 递归获取所有键值对
      const extractKeyValues = (obj: any, prefix: string = '') => {
        if (typeof obj === 'object' && obj !== null) {
          for (const key in obj) {
            const fullKey = prefix ? `${prefix}.${key}` : key;
            if (typeof obj[key] === 'string') {
              // 只保存字符串类型的值（翻译文本）
              keyValues.push({
                key: fullKey,
                value: obj[key]
              });
            } else if (typeof obj[key] === 'object' && obj[key] !== null) {
              // 递归处理嵌套对象
              extractKeyValues(obj[key], fullKey);
            }
          }
        }
      };

      extractKeyValues(parsed);

      return keyValues;
    } catch (error) {
      console.error('获取键值对失败:', error);
      console.error('文件内容前200字符:', content.substring(0, 200));
      return [];
    }
  }
} 