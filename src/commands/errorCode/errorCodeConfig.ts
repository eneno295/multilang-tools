/**
 * 错误码文件路径配置功能
 * 
 * @description 用于配置错误码文件路径，包括错误码文件目录、错误码源文件、错误码执行文件
 * 
 * @example 
 * 错误码文件目录：存放错误码文件的根目录路径，默认：public/errCode
 * 错误码源文件：原始错误码的文件名，默认：zh-CN.js
 * 错误码执行文件：需要执行错误码文件的文件名，默认：all，表示执行错误码文件目录下的全部文件
 */
import { FileConfigCommand, FileConfigOptions } from '../fileConfigCommand';
import * as vscode from 'vscode';

const errorCodeOptions: FileConfigOptions = {
  prefix: 'errorCode',
  defaultDir: 'public/errCode',
  defaultSourceFile: 'zh-CN.js',
  defaultExecFile: 'all',
  fileExt: '.js',
  title: '错误码文件配置',
  descList: [
    '<strong>错误码文件目录：</strong>存放错误码文件的根目录路径',
    '<strong>错误码源文件：</strong>原始错误码的文件名',
    '<strong>错误码执行文件：</strong>需要执行错误码文件的文件名'
  ],
  dirLabel: '错误码文件目录：',
  dirPlaceholder: '例如：public/errCode',
  dirDesc: '相对于项目根目录的路径',
  sourceFileLabel: '错误码源文件：',
  sourceFilePlaceholder: '例如：zh-CN.js',
  sourceFileDesc: '默认中文：zh-CN.js',
  execFileLabel: '错误码执行文件：',
  execFilePlaceholder: '例如：en-US.js,es-ES.js',
  execFileDesc: '默认错误码文件目录下的全部文件：all'
};

export class ErrorCodeConfigCommand extends FileConfigCommand {
  private currentPanel: vscode.WebviewPanel | undefined;

  constructor() {
    super(errorCodeOptions);
    this.currentPanel = undefined;
  }
  async execute() {
    if (this.currentPanel) {
      this.currentPanel.reveal(vscode.ViewColumn.One);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      `${errorCodeOptions.prefix}Config`,
      errorCodeOptions.title,
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


}