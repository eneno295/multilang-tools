/**
 * 文件路径配置命令（公共）
 * 
 * @description 用于配置文件路径，包括错误码文件路径、翻译文件路径等
 * 
 * @argument
 * prefix: 变量前缀，如 errorCode/translate
 * defaultDir: 默认目录，如 public/errCode
 * defaultSourceFile: 默认源文件，如 zh-CN.js
 * defaultExecFile: 默认执行文件，如 all
 * fileExt: 文件扩展名，如 .js/.ts
 * title: 标题，如 错误码文件配置
 * descList: 描述列表，如 错误码文件目录：存放错误码文件的根目录路径
 * dirLabel: 目录标签，如 错误码文件目录：
 * dirPlaceholder: 目录占位符，如 例如：public/errCode
 * dirDesc: 目录描述，如 相对于项目根目录的路径
 * sourceFileLabel: 源文件标签，如 错误码源文件：
 * sourceFilePlaceholder: 源文件占位符，如 例如：zh-CN.js
 * sourceFileDesc: 源文件描述，如 默认中文：zh-CN.js
 * execFileLabel: 执行文件标签，如 错误码执行文件：
 * execFilePlaceholder: 执行文件占位符，如 例如：en-US.js,es-ES.js
 * execFileDesc: 执行文件描述，如 默认错误码文件目录下的全部文件：all
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export interface FileConfigOptions {
  prefix: string; // 变量前缀，如 errorCode/translate
  defaultDir: string;
  defaultSourceFile: string;
  defaultExecFile: string;
  fileExt: string; // .js/.ts
  title: string;
  descList: string[];
  dirLabel: string;
  dirPlaceholder: string;
  dirDesc: string;
  sourceFileLabel: string;
  sourceFilePlaceholder: string;
  sourceFileDesc: string;
  execFileLabel: string;
  execFilePlaceholder: string;
  execFileDesc: string;
}

export class FileConfigCommand {
  protected options: FileConfigOptions;
  constructor(options: FileConfigOptions) {
    this.options = options;
  }

  fillPanel(panel: vscode.WebviewPanel) {
    // 获取当前配置
    const config = vscode.workspace.getConfiguration('multilang-tools');
    const currentConfig = {
      dir: config.get(`${this.options.prefix}Path`, this.options.defaultDir),
      sourceFile: config.get(`${this.options.prefix}SourceFile`, this.options.defaultSourceFile),
      execFile: config.get(`${this.options.prefix}ExecFile`, this.options.defaultExecFile)
    };
    panel.webview.html = this.getWebviewContent();
    panel.webview.postMessage({
      command: 'setConfig',
      config: currentConfig,
      options: this.options
    });
    panel.webview.onDidReceiveMessage(
      async message => {
        switch (message.command) {
          case 'saveConfig':
            await this.handleSaveConfig(message.config, panel);
            break;
          case 'testPath':
            await this.handleTestPath(message, panel);
            break;
          case 'getConfig':
            this.sendCurrentConfig(panel);
            break;

        }
      },
      undefined,
      []
    );
  }

  private getWebviewContent(): string {
    try {
      // 从 out/templates 目录读取模板文件
      const currentFilePath = __dirname;
      const templatePath = path.join(currentFilePath, '..', 'templates', 'fileConfig.html');

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

  private async handleSaveConfig(config: any, panel: vscode.WebviewPanel) {
    try {
      console.log('保存配置:', config);
      const vscodeConfig = vscode.workspace.getConfiguration('multilang-tools');

      await vscodeConfig.update(`${this.options.prefix}Path`, config.dir, vscode.ConfigurationTarget.Workspace);
      await vscodeConfig.update(`${this.options.prefix}SourceFile`, config.sourceFile, vscode.ConfigurationTarget.Workspace);
      await vscodeConfig.update(`${this.options.prefix}ExecFile`, config.execFile, vscode.ConfigurationTarget.Workspace);

      console.log('配置保存成功');

      // 保存成功后通知前端显示成功提示并清除其他提示
      panel.webview.postMessage({
        command: 'saveSuccess',
        message: `${this.options.title}已保存！`
      });
    } catch (error) {
      console.error('保存配置失败:', error);
      vscode.window.showErrorMessage(`保存配置失败: ${error}`);
    }
  }

  private async handleTestPath(message: any, panel: vscode.WebviewPanel) {
    try {
      const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!workspacePath) {
        panel.webview.postMessage({ command: 'testResult', success: false, message: '无法获取工作区路径' });
        return;
      }
      let baseDir = '';
      if (message.field === 'dir') {
        baseDir = path.join(workspacePath, message.path);
      } else {
        baseDir = path.join(workspacePath, message.dir || '');
      }
      let testPath: string;
      let resultMessage: string;
      let success: boolean;
      let isDirectory: boolean = false;
      let extraInfo: string = '';
      if (message.field === 'execFile' && message.path === 'all') {
        if (fs.existsSync(baseDir)) {
          const files = fs.readdirSync(baseDir)
            .filter(file => file.endsWith(this.options.fileExt) && file !== message.sourceFile)
            .map(file => path.basename(file, this.options.fileExt));
          if (files.length > 0) {
            success = true;
            resultMessage = `找到 ${files.length} 个文件: ${files.join(', ')}`;
            extraInfo = files.join(', ');
          } else {
            success = false;
            resultMessage = `目录中没有找到其他 ${this.options.fileExt} 文件`;
          }
        } else {
          success = false;
          resultMessage = `${this.options.title}目录不存在`;
        }
        panel.webview.postMessage({ command: 'testResult', field: message.field, success, message: resultMessage, extraInfo });
        return;
      }
      if (message.field === 'execFile') {
        // 多文件名检测
        const files = message.path.split(',').map((f: string) => f.trim()).filter((f: string) => f);
        if (files.length === 0) {
          panel.webview.postMessage({ command: 'testResult', field: message.field, success: false, message: '请输入文件名' });
          return;
        }
        const notExist: string[] = [];
        const exist: string[] = [];
        for (const file of files) {
          const filePath = path.join(baseDir, file);
          if (fs.existsSync(filePath)) {
            exist.push(file);
          } else {
            notExist.push(file);
          }
        }
        if (notExist.length === 0) {
          resultMessage = `文件存在：${exist.join(', ')}`;
          success = true;
        } else {
          resultMessage = `以下文件不存在：${notExist.join(', ')}${exist.length > 0 ? '，已存在：' + exist.join(', ') : ''}`;
          success = false;
        }
        panel.webview.postMessage({ command: 'testResult', field: message.field, success, message: resultMessage });
        return;
      }
      switch (message.field) {
        case 'dir':
          testPath = baseDir;
          success = fs.existsSync(testPath);
          isDirectory = success ? fs.statSync(testPath).isDirectory() : false;
          resultMessage = success ? `路径存在: ${testPath}` : `路径不存在: ${testPath}`;
          break;
        case 'sourceFile':
          testPath = path.join(baseDir, message.path);
          success = fs.existsSync(testPath);
          isDirectory = success ? fs.statSync(testPath).isDirectory() : false;
          resultMessage = success ? `文件存在: ${testPath}` : `文件不存在: ${testPath}`;
          break;
        default:
          success = false;
          resultMessage = '未知字段';
          break;
      }
      panel.webview.postMessage({ command: 'testResult', field: message.field, success, message: resultMessage, extraInfo });
    } catch (err) {
      panel.webview.postMessage({ command: 'testResult', field: message.field, success: false, message: String(err) });
    }
  }

  private sendCurrentConfig(panel: vscode.WebviewPanel) {
    const config = vscode.workspace.getConfiguration('multilang-tools');
    const currentConfig = {
      dir: config.get(`${this.options.prefix}Path`, this.options.defaultDir),
      sourceFile: config.get(`${this.options.prefix}SourceFile`, this.options.defaultSourceFile),
      execFile: config.get(`${this.options.prefix}ExecFile`, this.options.defaultExecFile)
    };
    panel.webview.postMessage({ command: 'setConfig', config: currentConfig, options: this.options });
  }
} 