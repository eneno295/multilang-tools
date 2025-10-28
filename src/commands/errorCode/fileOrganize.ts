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
      '错误码-整理文件',
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
          case 'backupSource':
            await this.handleBackupSource(panel);
            break;
          case 'backupTarget':
            await this.handleBackupTarget(panel);
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
          case 'getBackupList':
            await this.handleGetBackupList(panel, message.type);
            break;
          case 'getCleanBackupList':
            await this.handleGetCleanBackupList(panel, message.type);
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

      // 获取源文件信息
      let sourceInfo = null;
      const sourceFilePath = path.join(sourceDir, sourceFile);
      if (fs.existsSync(sourceFilePath)) {
        try {
          const sourceContent = fs.readFileSync(sourceFilePath, 'utf-8');
          const sourceKeys = this.countKeys(sourceContent);
          const sourceLines = sourceContent.split('\n').length;

          sourceInfo = {
            name: sourceFile,
            lines: sourceLines,
            keys: sourceKeys
          };
        } catch (error) {
          console.error(`读取源文件失败: ${error}`);
        }
      }

      panel.webview.postMessage({
        command: 'fileInfoResult',
        success: true,
        sourceFile: sourceFile,
        files: targetFiles,
        sourceInfo: sourceInfo
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

      // 检查是否需要创建备份
      const backupDir = path.join(sourceDir, 'backups', 'source');
      let backupCreated = false;

      if (!fs.existsSync(backupDir) || fs.readdirSync(backupDir).length === 0) {
        // 没有备份，创建备份
        if (!fs.existsSync(backupDir)) {
          fs.mkdirSync(backupDir, { recursive: true });
        }

        const timestamp = this.generateTimestamp();
        const backupFileName = `${path.basename(sourceFile, path.extname(sourceFile))}_${timestamp}.backup`;
        const backupPath = path.join(backupDir, backupFileName);

        fs.copyFileSync(sourceFilePath, backupPath);
        backupCreated = true;
      }

      // 读取源文件内容，获取整理前的信息
      const originalContent = fs.readFileSync(sourceFilePath, 'utf8');
      const originalInfo = this.getFileInfo(originalContent);

      // 整理内容
      const organizedContent = this.organizeFileContent(originalContent);

      // 写回文件
      fs.writeFileSync(sourceFilePath, organizedContent, 'utf8');

      // 重新读取整理后的文件内容，计算统计信息
      const finalContent = fs.readFileSync(sourceFilePath, 'utf8');
      const finalInfo = this.getFileInfo(finalContent);

      const message = backupCreated
        ? `源文件整理完成，已自动创建备份`
        : `源文件整理完成，已有备份无需创建`;

      panel.webview.postMessage({
        command: 'organizeResult',
        success: true,
        message: message,
        file: sourceFile,
        type: 'source',
        sourceInfo: {
          name: sourceFile,
          originalLines: originalInfo.lines,
          organizedLines: finalInfo.lines,
          originalKeys: originalInfo.keys.length,
          organizedKeys: finalInfo.keys.length
        }
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
      const sourceFilePath = path.join(sourceDir, sourceFile);

      // 获取源文件信息
      const sourceContent = fs.readFileSync(sourceFilePath, 'utf8');
      const sourceInfo = this.getFileInfo(sourceContent);

      const targetFiles = this.getTargetFiles(sourceDir, sourceFile, execFile);

      // 检查每个目标文件是否都有备份
      const backupDir = path.join(sourceDir, 'backups', 'target');
      let backupCreated = false;
      const filesNeedingBackup: string[] = [];

      if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
      }

      // 检查每个目标文件是否都有对应的备份
      for (const targetFile of targetFiles) {
        if (fs.existsSync(targetFile.path)) {
          const targetFileName = path.basename(targetFile.name, path.extname(targetFile.name));
          const existingBackups = fs.readdirSync(backupDir)
            .filter(file => file.startsWith(targetFileName) && file.endsWith('.backup'));

          if (existingBackups.length === 0) {
            // 这个文件没有备份，需要创建
            filesNeedingBackup.push(targetFile.name);
          }
        }
      }

      // 为没有备份的文件创建备份
      if (filesNeedingBackup.length > 0) {
        const timestamp = this.generateTimestamp();
        for (const fileName of filesNeedingBackup) {
          const targetFile = targetFiles.find(tf => tf.name === fileName);
          if (targetFile && fs.existsSync(targetFile.path)) {
            const backupFileName = `${path.basename(fileName, path.extname(fileName))}_${timestamp}.backup`;
            const backupPath = path.join(backupDir, backupFileName);
            fs.copyFileSync(targetFile.path, backupPath);
          }
        }
        backupCreated = true;
      }
      const results: Array<{
        file: string,
        success: boolean,
        message: string,
        originalLines?: number,
        organizedLines?: number,
        originalKeys?: number,
        organizedKeys?: number,
        missingKeys?: number,
        redundantKeys?: number,
        missingKeyList?: Array<{ key: string, value: string }>,
        redundantKeyList?: Array<{ key: string, value: string }>
      }> = [];

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

          // 读取目标文件内容
          const content = fs.readFileSync(targetFile.path, 'utf8');
          const originalInfo = this.getFileInfo(content);

          // 在整理前计算缺失和多余的键（基于原始内容）
          const missingKeysResult = this.calculateMissingKeys(sourceInfo.keys, originalInfo.keys);
          const redundantKeysResult = this.calculateRedundantKeys(sourceInfo.keys, originalInfo.keys);

          // 整理文件
          const organizedContent = this.organizeFileContent(content, sourceContent);
          const organizedInfo = this.getFileInfo(organizedContent);

          // 获取缺失键的值（从源文件）
          const missingKeyList = missingKeysResult.keys.map(key => {
            const sourceKeyIndex = sourceInfo.keys.indexOf(key);
            const value = sourceKeyIndex >= 0 ? sourceInfo.values[sourceKeyIndex] : '';
            return { key, value };
          });

          // 获取多余键的值（从原始目标文件）
          const redundantKeyList = redundantKeysResult.keys.map(key => {
            const targetKeyIndex = originalInfo.keys.indexOf(key);
            const value = targetKeyIndex >= 0 ? originalInfo.values[targetKeyIndex] : '';
            return { key, value };
          });

          // 写回文件
          fs.writeFileSync(targetFile.path, organizedContent, 'utf8');

          results.push({
            file: targetFile.name,
            success: true,
            message: `整理完成`,
            originalLines: originalInfo.lines,
            organizedLines: organizedInfo.lines,
            originalKeys: originalInfo.keys.length,
            organizedKeys: organizedInfo.keys.length,
            missingKeys: missingKeysResult.count,
            redundantKeys: redundantKeysResult.count,
            missingKeyList: missingKeyList,
            redundantKeyList: redundantKeyList
          });
        } catch (error) {
          results.push({
            file: targetFile.name,
            success: false,
            message: `整理失败: ${error}`
          });
        }
      }

      let message: string;
      if (backupCreated) {
        if (filesNeedingBackup.length === targetFiles.length) {
          message = '目标文件整理完成，已为所有文件创建备份';
        } else {
          message = `目标文件整理完成，已为 ${filesNeedingBackup.length} 个文件创建备份`;
        }
      } else {
        message = '目标文件整理完成，所有文件已有备份无需创建';
      }

      panel.webview.postMessage({
        command: 'organizeResult',
        success: true,
        message: message,
        sourceInfo: {
          file: sourceFile,
          lines: sourceInfo.lines,
          keys: sourceInfo.keys.length
        },
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
    const lines = content.split('\n');

    // 1. 遍历所有错误码，组装成数组（包含注释和错误码）
    const allItems = this.parseAllItems(lines);

    // 2. 识别每个模块的前缀规律（前四个字符）
    const modulePrefixes = this.identifyModulePrefixRules(allItems);

    // 3. 检查每个错误码是否在正确位置，重新分配
    const reorganizedItems = this.reassignErrorCodesToCorrectModules(allItems, modulePrefixes);

    // 4. 在每个模块内排序错误码
    const sortedItems = this.sortErrorCodesWithinModules(reorganizedItems);

    // 5. 重建文件
    return this.rebuildFileFromItems(sortedItems);
  }

  /**
   * 遍历所有行，组装成数组（包含注释和错误码）
   */
  private parseAllItems(lines: string[]): Array<{ type: 'header' | 'comment' | 'errorCode' | 'footer', content: string, code?: string, moduleIndex?: number }> {
    const items: Array<{ type: 'header' | 'comment' | 'errorCode' | 'footer', content: string, code?: string, moduleIndex?: number }> = [];
    let currentModuleIndex = -1;

    for (const line of lines) {
      const trimmed = line.trim();

      // 检查是否是头部行（const errCode = {）
      if (trimmed.includes('const errCode = {') || trimmed.includes('var errCode = {') || trimmed.includes('let errCode = {')) {
        items.push({ type: 'header', content: line });
        continue;
      }

      // 检查是否是结尾括号
      if (trimmed === '}') {
        items.push({ type: 'footer', content: line });
        continue;
      }

      // 检查是否是注释行（模块开始）
      if (trimmed.startsWith('//') && (trimmed.includes('模块') || trimmed.includes('报错'))) {
        currentModuleIndex++;
        items.push({ type: 'comment', content: line, moduleIndex: currentModuleIndex });
        continue;
      }

      // 检查是否是错误码行
      const match = trimmed.match(/^["'](\d+)["']\s*:\s*["']/);
      if (match) {
        items.push({
          type: 'errorCode',
          content: line,
          code: match[1],
          moduleIndex: currentModuleIndex
        });
        continue;
      }

      // 其他行（空行等）
      if (trimmed.length > 0) {
        items.push({ type: 'header', content: line });
      }
    }

    return items;
  }

  /**
   * 识别每个模块的前缀规律（前四个字符）
   */
  private identifyModulePrefixRules(items: Array<{ type: string, content: string, code?: string, moduleIndex?: number }>): Map<number, string[]> {
    const modulePrefixes = new Map<number, string[]>();

    // 按模块分组收集错误码
    const moduleErrorCodes = new Map<number, string[]>();

    for (const item of items) {
      if (item.type === 'errorCode' && item.code && item.moduleIndex !== undefined) {
        if (!moduleErrorCodes.has(item.moduleIndex)) {
          moduleErrorCodes.set(item.moduleIndex, []);
        }
        moduleErrorCodes.get(item.moduleIndex)!.push(item.code);
      }
    }

    // 分析每个模块的前缀规律
    for (const [moduleIndex, codes] of moduleErrorCodes.entries()) {
      const prefixes = new Set<string>();

      for (const code of codes) {
        // 提取前缀（前四个字符）
        if (code.length >= 4) {
          const prefix = code.substring(0, 4);
          prefixes.add(prefix);
        } else if (code.length >= 3) {
          const prefix = code.substring(0, 3);
          prefixes.add(prefix);
        }
      }

      if (prefixes.size > 0) {
        modulePrefixes.set(moduleIndex, Array.from(prefixes));
      }
    }

    return modulePrefixes;
  }

  /**
   * 检查每个错误码是否在正确位置，重新分配到正确模块
   */
  private reassignErrorCodesToCorrectModules(items: Array<{ type: string, content: string, code?: string, moduleIndex?: number }>, modulePrefixes: Map<number, string[]>): Array<{ type: string, content: string, code?: string, moduleIndex?: number }> {
    const result = [...items];

    // 找出所有错误码项
    const errorCodeItems = result.filter(item => item.type === 'errorCode');

    // 检查每个错误码是否在正确的模块
    for (const errorCodeItem of errorCodeItems) {
      if (!errorCodeItem.code || errorCodeItem.moduleIndex === undefined) continue;

      const currentModuleIndex = errorCodeItem.moduleIndex;
      const correctModuleIndex = this.findCorrectModuleIndex(errorCodeItem.code, modulePrefixes);

      // 如果错误码在错误的模块，重新分配
      if (correctModuleIndex !== -1 && correctModuleIndex !== currentModuleIndex) {
        errorCodeItem.moduleIndex = correctModuleIndex;
      }
    }

    return result;
  }

  /**
   * 根据错误码前缀找到正确的模块索引
   * 优先选择前缀更"纯净"的模块（只有该前缀的模块）
   */
  private findCorrectModuleIndex(code: string, modulePrefixes: Map<number, string[]>): number {
    const matchingModules: Array<{ moduleIndex: number, prefixCount: number }> = [];

    // 找到所有匹配的模块
    for (const [moduleIndex, prefixes] of modulePrefixes.entries()) {
      for (const prefix of prefixes) {
        if (code.startsWith(prefix)) {
          matchingModules.push({ moduleIndex, prefixCount: prefixes.length });
          break; // 一个模块只需要匹配一次
        }
      }
    }

    if (matchingModules.length === 0) {
      return -1;
    }

    // 优先选择前缀数量少的模块（更"纯净"的模块）
    matchingModules.sort((a, b) => a.prefixCount - b.prefixCount);
    return matchingModules[0].moduleIndex;
  }

  /**
   * 在每个模块内排序错误码
   */
  private sortErrorCodesWithinModules(items: Array<{ type: string, content: string, code?: string, moduleIndex?: number }>): Array<{ type: string, content: string, code?: string, moduleIndex?: number }> {
    // 按模块分组错误码
    const moduleErrorCodes = new Map<number, Array<{ type: string, content: string, code?: string, moduleIndex?: number }>>();

    for (const item of items) {
      if (item.type === 'errorCode' && item.moduleIndex !== undefined) {
        if (!moduleErrorCodes.has(item.moduleIndex)) {
          moduleErrorCodes.set(item.moduleIndex, []);
        }
        moduleErrorCodes.get(item.moduleIndex)!.push(item);
      }
    }

    // 对每个模块内的错误码排序
    for (const [moduleIndex, errorCodes] of moduleErrorCodes.entries()) {
      errorCodes.sort((a, b) => {
        const codeA = parseInt(a.code || '0');
        const codeB = parseInt(b.code || '0');
        return codeA - codeB;
      });
    }

    return items;
  }

  /**
   * 根据整理后的项目重建文件
   */
  private rebuildFileFromItems(items: Array<{ type: string, content: string, code?: string, moduleIndex?: number }>): string {
    const result: string[] = [];

    // 按模块重新组织
    const modules = new Map<number, { comment: string, errorCodes: Array<{ content: string, code: string }> }>();
    let headerLines: string[] = [];
    let footerLines: string[] = [];

    // 分组收集项目
    for (const item of items) {
      if (item.type === 'header') {
        headerLines.push(item.content);
      } else if (item.type === 'footer') {
        footerLines.push(item.content);
      } else if (item.type === 'comment' && item.moduleIndex !== undefined) {
        if (!modules.has(item.moduleIndex)) {
          modules.set(item.moduleIndex, { comment: item.content, errorCodes: [] });
        } else {
          modules.get(item.moduleIndex)!.comment = item.content;
        }
      } else if (item.type === 'errorCode' && item.moduleIndex !== undefined && item.code) {
        if (!modules.has(item.moduleIndex)) {
          modules.set(item.moduleIndex, { comment: '', errorCodes: [] });
        }
        modules.get(item.moduleIndex)!.errorCodes.push({ content: item.content, code: item.code });
      }
    }

    // 重建文件
    result.push(...headerLines);

    // 按模块索引顺序添加模块
    const sortedModuleIndexes = Array.from(modules.keys()).sort((a, b) => a - b);
    for (const moduleIndex of sortedModuleIndexes) {
      const module = modules.get(moduleIndex)!;

      // 添加注释
      if (module.comment) {
        result.push(module.comment);
      }

      // 排序并添加错误码
      module.errorCodes.sort((a, b) => parseInt(a.code) - parseInt(b.code));
      for (const errorCode of module.errorCodes) {
        result.push(errorCode.content);
      }
    }

    result.push(...footerLines);

    return result.join('\n');
  }

  private organizeTargetFile(content: string, sourceContent: string): string {
    // 1. 先对源文件进行智能整理，获取正确的模块结构
    const organizedSource = this.organizeSourceFile(sourceContent);

    // 2. 解析整理后的源文件结构
    const sourceSections = this.parseSections(organizedSource.split('\n'));

    // 3. 解析目标文件
    const targetSections = this.parseSections(content.split('\n'));

    // 4. 按源文件的模块结构重新组织目标文件
    return this.rebuildTargetFile(sourceSections, targetSections);
  }

  private parseSections(lines: string[]): Array<{ comment: string, errorCodes: Array<{ code: string, line: string }> }> {
    const sections: Array<{ comment: string, errorCodes: Array<{ code: string, line: string }> }> = [];
    let currentSection: string | null = null;
    let currentErrorCodes: Array<{ code: string, line: string }> = [];
    let endBracket: string | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // 检查是否是结尾括号
      if (trimmed === '}') {
        endBracket = line;
        continue;
      }

      // 检查是否是注释行（新的分组）
      if (trimmed.startsWith('//')) {
        // 保存前一个分组
        if (currentSection) {
          sections.push({
            comment: currentSection,
            errorCodes: currentErrorCodes
          });
        }

        // 开始新分组
        currentSection = line;
        currentErrorCodes = [];
        continue;
      }

      // 检查是否是错误码行
      const match = trimmed.match(/^["'](\d+)["']\s*:\s*["']/);
      if (match) {
        // 如果没有当前分组，创建一个默认分组
        if (!currentSection) {
          currentSection = '  // 错误码';
          currentErrorCodes = [];
        }
        currentErrorCodes.push({
          code: match[1],
          line: line
        });
        continue;
      }

      // 其他行（如 const errCode = {）
      if (!currentSection) {
        sections.push({
          comment: line,
          errorCodes: []
        });
      }
    }

    // 保存最后一个分组
    if (currentSection) {
      sections.push({
        comment: currentSection,
        errorCodes: currentErrorCodes
      });
    }

    // 保存结尾括号
    if (endBracket) {
      sections.push({
        comment: endBracket,
        errorCodes: []
      });
    }

    return sections;
  }

  private rebuildTargetFile(sourceSections: Array<{ comment: string, errorCodes: Array<{ code: string, line: string }> }>, targetSections: Array<{ comment: string, errorCodes: Array<{ code: string, line: string }> }>): string {
    // 创建目标文件错误码映射
    const targetErrorCodes = new Map<string, string>();
    for (const section of targetSections) {
      for (const errorCode of section.errorCodes) {
        targetErrorCodes.set(errorCode.code, errorCode.line);
      }
    }

    // 按源文件结构重建目标文件
    const result: string[] = [];

    for (const sourceSection of sourceSections) {
      result.push(sourceSection.comment);

      // 查找目标文件中对应的错误码
      for (const sourceErrorCode of sourceSection.errorCodes) {
        const targetLine = targetErrorCodes.get(sourceErrorCode.code);
        if (targetLine) {
          result.push(targetLine);
        }
      }
    }

    return result.join('\n');
  }

  private countKeys(content: string): number {
    const lines = content.split('\n');
    let count = 0;

    for (const line of lines) {
      const trimmed = line.trim();
      const match = trimmed.match(/^["']([^"']+)["']\s*:\s*["']/);
      if (match) {
        count++;
      }
    }

    return count;
  }

  private getFileInfo(content: string): { lines: number, keys: string[], values: string[] } {
    const lines = content.split('\n');
    const keys: string[] = [];
    const values: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      const match = trimmed.match(/^["']([^"']+)["']\s*:\s*["']([^"']*)["']/);
      if (match) {
        keys.push(match[1]);
        values.push(match[2]);
      }
    }

    return {
      lines: lines.length,
      keys: keys,
      values: values
    };
  }

  private calculateMissingKeys(sourceKeys: string[], targetKeys: string[]): { count: number, keys: string[] } {
    const missingKeys = sourceKeys.filter(key => !targetKeys.includes(key));
    return {
      count: missingKeys.length,
      keys: missingKeys
    };
  }

  private calculateRedundantKeys(sourceKeys: string[], targetKeys: string[]): { count: number, keys: string[] } {
    const redundantKeys = targetKeys.filter(key => !sourceKeys.includes(key));
    return {
      count: redundantKeys.length,
      keys: redundantKeys
    };
  }

  // 备份相关方法
  private async handleBackupSource(panel: vscode.WebviewPanel) {
    try {
      const config = vscode.workspace.getConfiguration('multilang-tools');
      const dirPath = config.get<string>('errorCodePath', 'public/errCode');
      const sourceFile = config.get<string>('errorCodeSourceFile', 'zh-CN.js');

      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!workspaceRoot) {
        panel.webview.postMessage({
          command: 'backupSourceResult',
          success: false,
          message: '无法获取工作区路径'
        });
        return;
      }

      const sourceDir = path.join(workspaceRoot, dirPath);
      const sourceFilePath = path.join(sourceDir, sourceFile);
      const backupDir = path.join(sourceDir, 'backups', 'source');

      if (!fs.existsSync(sourceFilePath)) {
        panel.webview.postMessage({
          command: 'backupSourceResult',
          success: false,
          message: '源文件不存在'
        });
        return;
      }

      // 创建备份目录
      if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
      }

      // 生成备份文件名
      const timestamp = this.generateTimestamp();
      const backupFileName = `${path.basename(sourceFile, path.extname(sourceFile))}_${timestamp}.backup`;
      const backupPath = path.join(backupDir, backupFileName);

      // 复制文件
      fs.copyFileSync(sourceFilePath, backupPath);

      panel.webview.postMessage({
        command: 'backupSourceResult',
        success: true,
        message: '源文件备份成功',
        backupFile: backupFileName,
        sourceFile: sourceFile
      });
    } catch (error) {
      panel.webview.postMessage({
        command: 'backupSourceResult',
        success: false,
        message: `备份源文件失败: ${error}`
      });
    }
  }

  private async handleBackupTarget(panel: vscode.WebviewPanel) {
    try {
      const config = vscode.workspace.getConfiguration('multilang-tools');
      const dirPath = config.get<string>('errorCodePath', 'public/errCode');
      const execFile = config.get<string>('errorCodeExecFile', 'all');

      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!workspaceRoot) {
        panel.webview.postMessage({
          command: 'backupTargetResult',
          success: false,
          message: '无法获取工作区路径'
        });
        return;
      }

      const sourceDir = path.join(workspaceRoot, dirPath);
      const backupDir = path.join(sourceDir, 'backups', 'target');
      const targetFiles = this.getTargetFiles(sourceDir, 'zh-CN.js', execFile);

      // 创建备份目录
      if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
      }

      const results = [];
      for (const targetFile of targetFiles) {
        const targetFilePath = path.join(sourceDir, targetFile.name);
        if (fs.existsSync(targetFilePath)) {
          const timestamp = this.generateTimestamp();
          const backupFileName = `${path.basename(targetFile.name, path.extname(targetFile.name))}_${timestamp}.backup`;
          const backupPath = path.join(backupDir, backupFileName);

          fs.copyFileSync(targetFilePath, backupPath);
          results.push({
            name: targetFile.name,
            status: '已备份',
            backupFile: backupFileName
          });
        } else {
          results.push({
            name: targetFile.name,
            status: '文件不存在',
            error: '目标文件不存在'
          });
        }
      }

      panel.webview.postMessage({
        command: 'backupTargetResult',
        success: true,
        message: '目标文件备份完成',
        results: results
      });
    } catch (error) {
      panel.webview.postMessage({
        command: 'backupTargetResult',
        success: false,
        message: `备份目标文件失败: ${error}`
      });
    }
  }

  private async handleRestoreSource(panel: vscode.WebviewPanel, backupFile: string) {
    try {
      const config = vscode.workspace.getConfiguration('multilang-tools');
      const dirPath = config.get<string>('errorCodePath', 'public/errCode');
      const sourceFile = config.get<string>('errorCodeSourceFile', 'zh-CN.js');

      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!workspaceRoot) {
        panel.webview.postMessage({
          command: 'restoreSourceResult',
          success: false,
          message: '无法获取工作区路径'
        });
        return;
      }

      const sourceDir = path.join(workspaceRoot, dirPath);
      const sourceFilePath = path.join(sourceDir, sourceFile);
      const backupPath = path.join(sourceDir, 'backups', 'source', backupFile);

      if (!fs.existsSync(backupPath)) {
        panel.webview.postMessage({
          command: 'restoreSourceResult',
          success: false,
          message: '备份文件不存在'
        });
        return;
      }

      fs.copyFileSync(backupPath, sourceFilePath);

      panel.webview.postMessage({
        command: 'restoreSourceResult',
        success: true,
        message: '源文件还原成功',
        backupFile: backupFile,
        sourceFile: sourceFile
      });
    } catch (error) {
      panel.webview.postMessage({
        command: 'restoreSourceResult',
        success: false,
        message: `还原源文件失败: ${error}`
      });
    }
  }

  private async handleRestoreTarget(panel: vscode.WebviewPanel, backupFile: string) {
    try {
      const config = vscode.workspace.getConfiguration('multilang-tools');
      const dirPath = config.get<string>('errorCodePath', 'public/errCode');
      const execFile = config.get<string>('errorCodeExecFile', 'all');

      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!workspaceRoot) {
        panel.webview.postMessage({
          command: 'restoreTargetResult',
          success: false,
          message: '无法获取工作区路径'
        });
        return;
      }

      const sourceDir = path.join(workspaceRoot, dirPath);
      const backupPath = path.join(sourceDir, 'backups', 'target', backupFile);
      const targetFiles = this.getTargetFiles(sourceDir, 'zh-CN.js', execFile);

      const results = [];
      for (const targetFile of targetFiles) {
        const targetFilePath = path.join(sourceDir, targetFile.name);
        if (fs.existsSync(backupPath)) {
          try {
            fs.copyFileSync(backupPath, targetFilePath);
            results.push({
              name: targetFile.name,
              status: '已还原',
              backupFile: backupFile
            });
          } catch (error) {
            results.push({
              name: targetFile.name,
              status: '还原失败',
              error: `还原失败: ${error}`
            });
          }
        } else {
          results.push({
            name: targetFile.name,
            status: '无备份文件',
            error: '该文件没有备份，无法还原'
          });
        }
      }

      panel.webview.postMessage({
        command: 'restoreTargetResult',
        success: true,
        message: '目标文件还原完成',
        results: results
      });
    } catch (error) {
      panel.webview.postMessage({
        command: 'restoreTargetResult',
        success: false,
        message: `还原目标文件失败: ${error}`
      });
    }
  }

  private async handleCleanBackupSource(panel: vscode.WebviewPanel, backupFile?: string) {
    try {
      const config = vscode.workspace.getConfiguration('multilang-tools');
      const dirPath = config.get<string>('errorCodePath', 'public/errCode');

      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!workspaceRoot) {
        panel.webview.postMessage({
          command: 'cleanBackupSourceResult',
          success: false,
          message: '无法获取工作区路径'
        });
        return;
      }

      const sourceDir = path.join(workspaceRoot, dirPath);
      const backupDir = path.join(sourceDir, 'backups', 'source');

      if (!fs.existsSync(backupDir)) {
        panel.webview.postMessage({
          command: 'cleanBackupSourceResult',
          success: true,
          message: '没有备份文件需要清理',
          results: []
        });
        return;
      }

      if (backupFile) {
        // 清理单个备份文件
        const backupPath = path.join(backupDir, backupFile);
        if (fs.existsSync(backupPath)) {
          fs.unlinkSync(backupPath);
          panel.webview.postMessage({
            command: 'cleanBackupSourceResult',
            success: true,
            message: '源文件备份清理成功',
            results: [{
              name: backupFile,
              status: '已删除'
            }]
          });
        } else {
          panel.webview.postMessage({
            command: 'cleanBackupSourceResult',
            success: false,
            message: '备份文件不存在',
            results: [{
              name: backupFile,
              status: '文件不存在',
              error: '备份文件不存在'
            }]
          });
        }
      } else {
        // 清理所有备份文件
        const files = fs.readdirSync(backupDir);
        const results = [];

        for (const file of files) {
          try {
            const filePath = path.join(backupDir, file);
            fs.unlinkSync(filePath);
            results.push({
              name: file,
              status: '已删除'
            });
          } catch (error) {
            results.push({
              name: file,
              status: '删除失败',
              error: `删除失败: ${error}`
            });
          }
        }

        panel.webview.postMessage({
          command: 'cleanBackupSourceResult',
          success: true,
          message: '所有源文件备份清理完成',
          results: results
        });
      }
    } catch (error) {
      panel.webview.postMessage({
        command: 'cleanBackupSourceResult',
        success: false,
        message: `清理源文件备份失败: ${error}`,
        results: []
      });
    }
  }

  private async handleCleanBackupTarget(panel: vscode.WebviewPanel, backupFile?: string) {
    try {
      const config = vscode.workspace.getConfiguration('multilang-tools');
      const dirPath = config.get<string>('errorCodePath', 'public/errCode');

      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!workspaceRoot) {
        panel.webview.postMessage({
          command: 'cleanBackupTargetResult',
          success: false,
          message: '无法获取工作区路径'
        });
        return;
      }

      const sourceDir = path.join(workspaceRoot, dirPath);
      const backupDir = path.join(sourceDir, 'backups', 'target');

      if (!fs.existsSync(backupDir)) {
        panel.webview.postMessage({
          command: 'cleanBackupTargetResult',
          success: true,
          message: '没有备份文件需要清理',
          results: []
        });
        return;
      }

      if (backupFile) {
        // 清理单个备份文件
        const backupPath = path.join(backupDir, backupFile);
        if (fs.existsSync(backupPath)) {
          fs.unlinkSync(backupPath);
          panel.webview.postMessage({
            command: 'cleanBackupTargetResult',
            success: true,
            message: '目标文件备份清理成功',
            results: [{
              name: backupFile,
              status: '已删除'
            }]
          });
        } else {
          panel.webview.postMessage({
            command: 'cleanBackupTargetResult',
            success: false,
            message: '备份文件不存在',
            results: [{
              name: backupFile,
              status: '文件不存在',
              error: '备份文件不存在'
            }]
          });
        }
      } else {
        // 清理所有备份文件
        const files = fs.readdirSync(backupDir);
        const results = [];

        for (const file of files) {
          try {
            const filePath = path.join(backupDir, file);
            fs.unlinkSync(filePath);
            results.push({
              name: file,
              status: '已删除'
            });
          } catch (error) {
            results.push({
              name: file,
              status: '删除失败',
              error: `删除失败: ${error}`
            });
          }
        }

        panel.webview.postMessage({
          command: 'cleanBackupTargetResult',
          success: true,
          message: '所有目标文件备份清理完成',
          results: results
        });
      }
    } catch (error) {
      panel.webview.postMessage({
        command: 'cleanBackupTargetResult',
        success: false,
        message: `清理目标文件备份失败: ${error}`,
        results: []
      });
    }
  }

  private async handleGetBackupList(panel: vscode.WebviewPanel, type: string) {
    try {
      const config = vscode.workspace.getConfiguration('multilang-tools');
      const dirPath = config.get<string>('errorCodePath', 'public/errCode');

      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!workspaceRoot) {
        panel.webview.postMessage({
          command: 'backupListResult',
          success: false,
          message: '无法获取工作区路径'
        });
        return;
      }

      const sourceDir = path.join(workspaceRoot, dirPath);
      const backupDir = path.join(sourceDir, 'backups', type);

      if (!fs.existsSync(backupDir)) {
        panel.webview.postMessage({
          command: 'backupListResult',
          success: true,
          backupList: [],
          type: type
        });
        return;
      }

      const files = fs.readdirSync(backupDir);
      const backupFiles: Array<{ fileName: string, displayName: string, timestamp: string }> = [];

      files.forEach(file => {
        const match = file.match(/(.+)_(\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2})\.backup$/);
        if (match) {
          const [, fileName, timestamp] = match;
          backupFiles.push({
            fileName: file,
            displayName: `${fileName} (${this.formatTimestamp(timestamp)})`,
            timestamp: this.formatTimestamp(timestamp)
          });
        }
      });

      panel.webview.postMessage({
        command: 'backupListResult',
        success: true,
        backupList: backupFiles.sort((a, b) => b.timestamp.localeCompare(a.timestamp)),
        type: type
      });
    } catch (error) {
      panel.webview.postMessage({
        command: 'backupListResult',
        success: false,
        message: `获取备份列表失败: ${error}`
      });
    }
  }

  private async handleGetCleanBackupList(panel: vscode.WebviewPanel, type: string) {
    try {
      const config = vscode.workspace.getConfiguration('multilang-tools');
      const dirPath = config.get<string>('errorCodePath', 'public/errCode');

      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!workspaceRoot) {
        panel.webview.postMessage({
          command: 'cleanBackupListResult',
          success: false,
          message: '无法获取工作区路径'
        });
        return;
      }

      const sourceDir = path.join(workspaceRoot, dirPath);
      const backupDir = path.join(sourceDir, 'backups', type);

      if (!fs.existsSync(backupDir)) {
        panel.webview.postMessage({
          command: 'cleanBackupListResult',
          success: true,
          backupList: [],
          type: type
        });
        return;
      }

      const files = fs.readdirSync(backupDir);
      const backupFiles: Array<{ fileName: string, displayName: string, timestamp: string }> = [];

      files.forEach(file => {
        const match = file.match(/(.+)_(\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2})\.backup$/);
        if (match) {
          const [, fileName, timestamp] = match;
          backupFiles.push({
            fileName: file,
            displayName: `${fileName} (${this.formatTimestamp(timestamp)})`,
            timestamp: this.formatTimestamp(timestamp)
          });
        }
      });

      panel.webview.postMessage({
        command: 'cleanBackupListResult',
        success: true,
        backupList: backupFiles.sort((a, b) => b.timestamp.localeCompare(a.timestamp)),
        type: type
      });
    } catch (error) {
      panel.webview.postMessage({
        command: 'cleanBackupListResult',
        success: false,
        message: `获取清理备份列表失败: ${error}`
      });
    }
  }

  // 辅助方法
  private generateTimestamp(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hour = String(now.getHours()).padStart(2, '0');
    const minute = String(now.getMinutes()).padStart(2, '0');
    const second = String(now.getSeconds()).padStart(2, '0');

    return `${year}-${month}-${day}-${hour}-${minute}-${second}`;
  }

  private formatTimestamp(timestamp: string): string {
    try {
      const [year, month, day, hour, minute, second] = timestamp.split('-');
      return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
    } catch (error) {
      return timestamp;
    }
  }
} 