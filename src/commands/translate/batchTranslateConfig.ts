/**
 * 批量翻译工具文件路径配置功能
 * 
 * @description 用于配置批量翻译工具的文件路径，包括翻译文件目录、翻译源文件、翻译目标文件
 * 
 * @example 
 * 翻译文件目录：存放翻译文件的根目录路径，默认：public/errCode
 * 翻译源文件：原始翻译的文件名，默认：zh-CN.js
 * 翻译目标文件：需要翻译的目标文件名，默认：all，表示翻译翻译文件目录下的全部文件
 */
import { FileConfigCommand, FileConfigOptions } from '../fileConfigCommand';
import * as vscode from 'vscode';

const batchTranslateOptions: FileConfigOptions = {
  prefix: 'translate',
  defaultDir: 'src/lang/locales',
  defaultSourceFile: 'zh-CN.ts',
  defaultExecFile: 'all',
  fileExt: '.ts',
  title: '翻译文件配置',
  descList: [
    '<strong>翻译文件目录：</strong>存放翻译文件的根目录路径',
    '<strong>翻译源文件：</strong>原始翻译的文件名',
    '<strong>翻译目标文件：</strong>需要翻译的目标文件名'
  ],
  dirLabel: '翻译文件目录：',
  dirPlaceholder: '例如：src/lang/locales',
  dirDesc: '相对于项目根目录的路径',
  sourceFileLabel: '翻译源文件：',
  sourceFilePlaceholder: '例如：zh-CN.ts',
  sourceFileDesc: '默认中文：zh-CN.ts',
  execFileLabel: '翻译目标文件：',
  execFilePlaceholder: '例如：en-US.ts,es-ES.ts',
  execFileDesc: '默认翻译文件目录下的全部文件：all'
};

export class BatchTranslateConfigCommand extends FileConfigCommand {
  private currentPanel: vscode.WebviewPanel | undefined;

  constructor() {
    super(batchTranslateOptions);
    this.currentPanel = undefined;
  }

  async execute() {
    if (this.currentPanel) {
      this.currentPanel.reveal(vscode.ViewColumn.One);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      `${batchTranslateOptions.prefix}Config`,
      batchTranslateOptions.title,
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true
      }
    );

    this.currentPanel = panel;

    // 使用基类的 fillPanel 方法
    super.fillPanel(panel);

    // 重写消息监听器，在基类逻辑基础上添加我们的刷新逻辑
    panel.webview.onDidReceiveMessage(
      async message => {
        if (message.command === 'saveConfig') {
          // 调用我们自己的保存方法，包含刷新逻辑
          await this.handleSaveConfigWithRefresh(message.config, panel);
        } else if (message.command === 'testPath') {
          // 调用基类的测试路径方法
          await (this as any).handleTestPath(message, panel);
        } else if (message.command === 'getConfig') {
          // 调用基类的获取配置方法
          (this as any).sendCurrentConfig(panel);
        }
      },
      undefined,
      []
    );

    panel.onDidDispose(() => {
      this.currentPanel = undefined;
    });
  }



  private async handleSaveConfigWithRefresh(config: any, panel: vscode.WebviewPanel) {
    try {
      const vscodeConfig = vscode.workspace.getConfiguration('multilang-tools');

      await vscodeConfig.update(`${this.options.prefix}Path`, config.dir, vscode.ConfigurationTarget.Workspace);
      await vscodeConfig.update(`${this.options.prefix}SourceFile`, config.sourceFile, vscode.ConfigurationTarget.Workspace);
      await vscodeConfig.update(`${this.options.prefix}ExecFile`, config.execFile, vscode.ConfigurationTarget.Workspace);

      // 保存成功后通知前端显示成功提示
      panel.webview.postMessage({
        command: 'saveSuccess',
        message: `${this.options.title}已保存！`
      });

      // 保存成功后立即刷新翻译文件列表
      this.refreshTranslationFiles();

    } catch (error) {
      console.error('保存翻译配置失败:', error);
      vscode.window.showErrorMessage(`保存配置失败: ${error}`);
    }
  }

  private refreshTranslationFiles() {
    // 获取全局的批量翻译管理器提供者并刷新
    const batchTranslateProvider = (globalThis as any).multilangBatchTranslateProvider;
    if (batchTranslateProvider && typeof batchTranslateProvider.refresh === 'function') {
      batchTranslateProvider.refresh();
    }
  }
} 