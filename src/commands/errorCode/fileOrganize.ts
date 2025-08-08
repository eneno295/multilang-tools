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
        message: `源文件整理完成`,
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
    const lines = content.split('\n');

    // 1. 解析文件结构，识别所有模块和错误码
    const { sections, allErrorCodes } = this.parseSectionsAndCodes(lines);

    // 2. 基于错误码语义分析，识别模块规则
    const { moduleRules, misplacedCodes } = this.semanticAnalyzeErrorCodeDistribution(sections, allErrorCodes);

    // 3. 重新分配错误码到正确的模块
    const reorganizedSections = this.reorganizeErrorCodes(sections, moduleRules, misplacedCodes);

    // 4. 对每个模块内的错误码进行排序
    this.sortSections(reorganizedSections);

    // 5. 重建文件
    return this.rebuildFile(reorganizedSections);
  }

  private parseSectionsAndCodes(lines: string[]): { sections: Array<{ comment: string, errorCodes: Array<{ code: string, line: string }> }>, allErrorCodes: Array<{ code: string, line: string, section: string }> } {
    const sections: Array<{ comment: string, errorCodes: Array<{ code: string, line: string }> }> = [];
    const allErrorCodes: Array<{ code: string, line: string, section: string }> = [];
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
      if (trimmed.startsWith('//') && (trimmed.includes('模块') || trimmed.includes('报错'))) {
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
      if (match && currentSection) {
        const errorCode = {
          code: match[1],
          line: line,
          section: currentSection
        };
        currentErrorCodes.push({ code: match[1], line: line });
        allErrorCodes.push(errorCode);
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

    return { sections, allErrorCodes };
  }

  private semanticAnalyzeErrorCodeDistribution(sections: Array<{ comment: string, errorCodes: Array<{ code: string, line: string }> }>, allErrorCodes: Array<{ code: string, line: string, section: string }>): { moduleRules: { [key: string]: string[] }, misplacedCodes: Array<{ code: string, line: string, currentSection: string, shouldBeIn: string }> } {
    // 基于语义分析错误码分布
    const moduleRules: { [key: string]: string[] } = {};
    const misplacedCodes: Array<{ code: string, line: string, currentSection: string, shouldBeIn: string }> = [];

    // 第一步：分析每个模块中错误码的前缀模式，但排除明显错误分配的错误码
    for (const section of sections) {
      if (section.errorCodes.length === 0) continue;

      const sectionName = section.comment;
      const codes = section.errorCodes.map(ec => ec.code);

      // 分析这个模块中错误码的前缀模式
      const prefixes = this.analyzePrefixPattern(codes);

      if (prefixes.length > 0) {
        moduleRules[sectionName] = prefixes;
      }
    }

    // 第二步：基于语义规则识别每个模块的主要前缀
    const semanticRules = this.identifySemanticRules(sections, moduleRules);

    // 第三步：检查每个错误码是否在正确的模块中
    for (const section of sections) {
      if (section.errorCodes.length === 0) continue;

      const sectionName = section.comment;

      for (const errorCode of section.errorCodes) {
        const code = errorCode.code;
        const correctModule = this.findCorrectModuleBySemantic(code, semanticRules);

        if (correctModule && correctModule !== sectionName) {
          misplacedCodes.push({
            ...errorCode,
            currentSection: sectionName,
            shouldBeIn: correctModule
          });
        }
      }
    }

    return { moduleRules: semanticRules, misplacedCodes };
  }

  private analyzePrefixPattern(codes: string[]): string[] {
    // 分析错误码的前缀模式
    const prefixes = new Set<string>();

    for (const code of codes) {
      // 提取前缀（前4位数字）
      if (code.length >= 4) {
        const prefix = code.substring(0, 4);
        prefixes.add(prefix);
      }
      // 也考虑更短的前缀（前2位数字）
      if (code.length >= 2) {
        const shortPrefix = code.substring(0, 2);
        prefixes.add(shortPrefix);
      }
    }

    return Array.from(prefixes);
  }

  private identifySemanticRules(sections: Array<{ comment: string, errorCodes: Array<{ code: string, line: string }> }>, moduleRules: { [key: string]: string[] }): { [key: string]: string[] } {
    // 基于语义规则识别模块前缀
    const semanticRules: { [key: string]: string[] } = {};

    for (const section of sections) {
      if (section.errorCodes.length === 0) continue;

      const sectionName = section.comment;
      const codes = section.errorCodes.map(ec => ec.code);

      // 基于模块名称和错误码分布识别语义规则
      if (sectionName.includes('验证码') || sectionName.includes('报错')) {
        // 验证码模块：通常包含 0000, 0001, 6202, 6204, 6205, 6206 等
        const verificationPrefixes = codes.filter(code =>
          code.startsWith('000') || code.startsWith('620')
        ).map(code => code.substring(0, Math.min(4, code.length)));

        if (verificationPrefixes.length > 0) {
          semanticRules[sectionName] = [...new Set(verificationPrefixes)];
        }
      } else if (sectionName.includes('系统')) {
        // 系统模块：通常包含 1002 开头的错误码
        semanticRules[sectionName] = ['1002'];
      } else if (sectionName.includes('会员')) {
        // 会员模块：通常包含 1003 开头的错误码
        semanticRules[sectionName] = ['1003'];
      } else if (sectionName.includes('运营')) {
        // 运营模块：通常包含 1005 开头的错误码
        semanticRules[sectionName] = ['1005'];
      } else if (sectionName.includes('信息')) {
        // 信息模块：通常包含 1006 开头的错误码
        semanticRules[sectionName] = ['1006'];
      } else {
        // 其他模块：基于现有分布
        const prefixes = this.analyzePrefixPattern(codes);
        if (prefixes.length > 0) {
          semanticRules[sectionName] = prefixes.filter(p => p.length === 4);
        }
      }
    }

    return semanticRules;
  }

  private findCorrectModuleBySemantic(code: string, semanticRules: { [key: string]: string[] }): string | null {
    // 根据错误码前缀找到应该属于的模块
    for (const [sectionName, prefixes] of Object.entries(semanticRules)) {
      for (const prefix of prefixes) {
        if (code.startsWith(prefix)) {
          return sectionName;
        }
      }
    }
    return null;
  }

  private reorganizeErrorCodes(sections: Array<{ comment: string, errorCodes: Array<{ code: string, line: string }> }>, moduleRules: { [key: string]: string[] }, misplacedCodes: Array<{ code: string, line: string, currentSection: string, shouldBeIn: string }>): Array<{ comment: string, errorCodes: Array<{ code: string, line: string }> }> {
    // 重新组织错误码，将错误分配的错误码移动到正确的模块
    const reorganizedSections = sections.map(section => ({
      ...section,
      errorCodes: [...section.errorCodes]
    }));

    for (const misplacedCode of misplacedCodes) {
      const correctSection = misplacedCode.shouldBeIn;
      if (correctSection) {
        // 从当前模块移除
        const currentSection = reorganizedSections.find(s => s.comment === misplacedCode.currentSection);
        if (currentSection) {
          currentSection.errorCodes = currentSection.errorCodes.filter(ec => ec.code !== misplacedCode.code);
        }

        // 添加到正确模块
        const targetSection = reorganizedSections.find(s => s.comment === correctSection);
        if (targetSection) {
          targetSection.errorCodes.push({
            code: misplacedCode.code,
            line: misplacedCode.line
          });
        }
      }
    }

    return reorganizedSections;
  }

  private sortSections(sections: Array<{ comment: string, errorCodes: Array<{ code: string, line: string }> }>): void {
    for (const section of sections) {
      if (section.errorCodes.length > 0) {
        section.errorCodes.sort((a, b) => parseInt(a.code) - parseInt(b.code));
      }
    }
  }

  private rebuildFile(sections: Array<{ comment: string, errorCodes: Array<{ code: string, line: string }> }>): string {
    const result: string[] = [];

    for (const section of sections) {
      result.push(section.comment);

      for (const errorCode of section.errorCodes) {
        result.push(errorCode.line);
      }
    }

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
      if (trimmed.startsWith('//') && (trimmed.includes('模块') || trimmed.includes('报错') || trimmed.includes('活动'))) {
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
      if (match && currentSection) {
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
} 