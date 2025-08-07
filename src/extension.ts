import * as vscode from 'vscode';
import { ErrorCodeConfigCommand } from './commands/errorCode/errorCodeConfig';
import { ErrorCodeAddCommand } from './commands/errorCode/errorCodeAdd';
import { BatchTranslateCommand } from './commands/errorCode/batchTranslate';
import { FileOrganizeCommand } from './commands/errorCode/fileOrganize';
import { ErrorCodeManagerProvider } from './providers/ErrorCodeManagerProvider';

export function activate(context: vscode.ExtensionContext) {
  console.log('多语言开发工具扩展已激活！');

  // 创建命令实例
  const errorCodeConfig = new ErrorCodeConfigCommand();
  const errorCodeAdd = new ErrorCodeAddCommand();
  const batchTranslate = new BatchTranslateCommand();
  const fileOrganize = new FileOrganizeCommand();

  // 创建错误码管理器提供者
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const errorCodeManagerProvider = new ErrorCodeManagerProvider(workspaceRoot);

  // 注册 TreeDataProvider 到 errorManager 视图
  vscode.window.registerTreeDataProvider('errorManager', errorCodeManagerProvider);

  // 设置为全局变量，供其他命令访问
  (globalThis as any).multilangErrorCodeProvider = errorCodeManagerProvider;

  // 监听文件保存事件，自动刷新错误码文件列表
  const fileSaveListener = vscode.workspace.onDidSaveTextDocument((document) => {
    // 检查是否是错误码文件
    const config = vscode.workspace.getConfiguration('multilang-tools');
    const errorCodePath = config.get('errorCodePath', 'public/errCode');

    if (document.fileName.includes(errorCodePath) && document.fileName.endsWith('.js')) {
      console.log('检测到错误码文件保存:', document.fileName);
      // 延迟刷新，确保文件写入完成
      setTimeout(() => {
        errorCodeManagerProvider.refresh();
      }, 100);
    }
  });

  // 注册命令
  const configPathCommand = vscode.commands.registerCommand('multilang-tools.configPath', () => {
    errorCodeConfig.execute();
  });

  const addSourceFileCommand = vscode.commands.registerCommand('multilang-tools.addSourceFile', () => {
    errorCodeAdd.execute();
  });

  const translateFileCommand = vscode.commands.registerCommand('multilang-tools.translateFile', () => {
    batchTranslate.execute();
  });

  const organizeFileCommand = vscode.commands.registerCommand('multilang-tools.organizeFile', () => {
    fileOrganize.execute();
  });



  // 批量翻译工具命令
  const batchConfigPathCommand = vscode.commands.registerCommand('multilang-tools.batchConfigPath', () => {
    vscode.window.showInformationMessage('批量翻译工具 - 文件路径配置功能');
  });

  const batchTranslateCommand = vscode.commands.registerCommand('multilang-tools.batchTranslate', () => {
    vscode.window.showInformationMessage('批量翻译工具 - 批量翻译功能');
  });

  const batchOrganizeFileCommand = vscode.commands.registerCommand('multilang-tools.batchOrganizeFile', () => {
    fileOrganize.execute();
  });

  // 刷新错误码文件列表
  const refreshNumberCodeFilesCommand = vscode.commands.registerCommand('multilang-tools.refreshNumberCodeFiles', () => {
    try {
      errorCodeManagerProvider.refresh();
      vscode.window.showInformationMessage('错误码文件刷新成功！');
    } catch (error) {
      vscode.window.showErrorMessage(`刷新失败: ${error}`);
    }
  });

  // 注册所有命令
  context.subscriptions.push(
    configPathCommand,
    addSourceFileCommand,
    translateFileCommand,
    organizeFileCommand,
    batchConfigPathCommand,
    batchTranslateCommand,
    batchOrganizeFileCommand,
    refreshNumberCodeFilesCommand,
    fileSaveListener
  );
}

export function deactivate() {
  console.log('多语言开发工具扩展已停用！');
} 