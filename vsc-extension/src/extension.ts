import * as vscode from 'vscode';
import { getMcpClient } from './mcpClient';

async function getCurrentFileNameAndSelectedText(editor: vscode.TextEditor): Promise<{ language: string; fileName: string; sourceCode: string }> {
  const language = editor.document.languageId;
  const pathComponents = editor.document.uri.path.split('/');
  let fileName = pathComponents.pop() || '';

  const selection = editor.selection;
  const selectedText = editor.document.getText(selection);

  if (language === 'java') {
    fileName = fileName.replace('.java', '');
  }

  return { language, fileName, sourceCode: selectedText };
}

async function getCurrentRowNumber(editor: vscode.TextEditor) {
  const selection = editor.selection;
  const rowNumber = selection.start.line + 1;

  return rowNumber;
}

async function getSelectedFunction(editor: vscode.TextEditor) {
  const selectedText = await getCurrentFileNameAndSelectedText(editor);

  if (selectedText) {
    const language = selectedText.language;
    const { AstParser } = await import(`./shared/parsers/${language}`);
    const parser = new AstParser();
    let functionName = parser.extractFunctionSignature(selectedText);

    if (language === 'java') {
      selectedText.fileName = selectedText.fileName.replace('.java', '');
      functionName = selectedText.fileName + '.' + functionName;
    }

    if (!functionName) {
      vscode.window.showInformationMessage('Not a valid function.');
      return;
    }

    return selectedText;
  }
}

interface MCPResponse {
  content: { text: string }[];
}

async function findComponents(mcpClient: any, functionObj: any) {
  const res = await mcpClient.callTool({
    name: "listComponents",
    arguments: {
      name: functionObj.functionName,
      language: functionObj.language,
      systemModule: functionObj.fileName,
      format: 'json'
    }
  }) as MCPResponse;

  return JSON.parse(res.content[0].text);
}

async function findComponentByRowNumber(mcpClient: any, fileName: any, rowNumber: any) {
  const res = await mcpClient.callTool({
    name: "findComponentByRowNumber",
    arguments: {
      rowNumber,
      systemModule: fileName,
      format: 'json'
    }
  }) as MCPResponse;

  return JSON.parse(res.content[0].text);
}

async function obtainDependencies(mcpClient: any, direction: string, language: string, functionName: string, microService: string, systemModule: string): Promise<string> {
  let name = 'listDownstreamDependencies';
  if (direction === 'upstream') {
    name = 'listUpstreamDependencies';
  } else if (direction === 'all') {
    name = 'listAllDependencies';
  }

  const res = await mcpClient.callTool({
    name,
    arguments: {
      name: functionName,
      microService,
      systemModule,
      dependencyType: 'Function',
      hasSourceCode: language === 'javascript'
    }
  }) as MCPResponse;

  return res.content[0].text;
}

function extractJsonCodeBlock(markdown: string): string | null {
  const codeBlockRegex = /```json\s*([\s\S]*?)\s*```/;
  const match = markdown.match(codeBlockRegex);
  return match ? match[1] : null;
}

export function activate(context: vscode.ExtensionContext) {
  //   let disposable = vscode.commands.registerCommand('extension.changeAndAffected', async () => {
  //     // const supportedCommands = await vscode.commands.getCommands(true);
  //     // supportedCommands.filter((command) => command.indexOf('chat.') > -1).forEach((command) => {
  //     //   console.log(command);
  //     // });

  //     // Potential Chat related commands but not possible sending prompt to chat after trial
  //     // workbench.action.chat.open - Open the Chat view
  //     // workbench.action.chat.openInSidebar - Open the Chat view in the sidebar
  //     // workbench.action.chat.openEditSession - Open the Copilot Edits view
  //     // workbench.action.chat.sendToNewChat
  //     // workbench.action.chat.sendToChatEditing - Send a prompt from the Chat view to Copilot Edits
  //     // workbench.action.chat.addParticipant - Add a participant to the Chat view
  //     // workbench.action.chat.focusInput
  //     // workbench.action.chat.newChat
  //     // workbench.action.chat.newEditSession

  //     // await vscode.commands.executeCommand('workbench.action.chat.openInSidebar', 'code-dependency');
  // });

  // context.subscriptions.push(disposable);

  let analyzeCodeDependencyDisposable = vscode.commands.registerCommand('extension.analyzeCodeDependency', async (uri) => {
    if (!uri) {
      vscode.window.showErrorMessage('No folder selected.');
      return;
    }

    const folderPath = uri.fsPath;
    const microServiceName = await vscode.window.showInputBox({
      prompt: 'Please provide micro-service name',
      placeHolder: 'Type here...'
    });

    if (!microServiceName) {
      vscode.window.showInformationMessage('No micro-service provided');
      return;
    }

    const config = vscode.workspace.getConfiguration().get('codeDependency') as any;
    const dbConfig = config.graph;
    if (!dbConfig) {
      vscode.window.showErrorMessage('Graph database configuration is not set. Please configure the database first.');
      return;
    }

    const repoBuilderType = await vscode.window.showQuickPick(['Custom', 'JavaScript', 'Java'], {
      placeHolder: 'Select RepoBuilder Type',
      title: 'RepoBuilder Type'
    });

    let repoBuilderPath;
    switch (repoBuilderType) {
      case 'JavaScript':
        repoBuilderPath = './shared/repo-builders/javascript.js';
        break;
      case 'Java':
        repoBuilderPath = './shared/repo-builder.js';
        break;
      default:
        const customBuilderPath = vscode.workspace.getConfiguration().get('codeDependency.repoBuilderPath') as string;
        if (!customBuilderPath) {
          vscode.window.showErrorMessage('Custom RepoBuilder path is not set. Please configure the path first.');
          return;
        }
        repoBuilderPath = customBuilderPath;
        break;
    }

    const { RepoBuilder } = await import(repoBuilderPath);
    vscode.window.showInformationMessage(`Analyzing code dependency in folder: ${folderPath}`);

    // Show progress notification
    vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: "Analyzing code dependency",
      cancellable: false
    }, async (progress) => {
      progress.report({ increment: 0 });

      try {
        const builder = new RepoBuilder(folderPath, microServiceName, { ...config, vscExtension: true});
        await builder.buildGraph();
        progress.report({ increment: 100, message: "Analysis complete" });
        vscode.window.showInformationMessage(`Analysis complete`);
      } catch (error: any) {
        console.error(error);
        vscode.window.showErrorMessage(`Analysis failed: ${error.message}`);
        progress.report({ increment: 100, message: "Analysis failed" });
      }
    });
  });

  context.subscriptions.push(analyzeCodeDependencyDisposable);

  const handler: vscode.ChatRequestHandler = async (request: vscode.ChatRequest, context: vscode.ChatContext, stream: vscode.ChatResponseStream, token: vscode.CancellationToken) => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      stream.markdown('No active editor found.');
      return;
    }

    if (request.command == 'dependency') {
      const selectedText = await getCurrentFileNameAndSelectedText(editor);
      const rowNumber = await getCurrentRowNumber(editor);
      if (rowNumber === -1) {
        vscode.window.showInformationMessage('Please focus on the code you want to check');
        return;
      }

      const mcpClient = await getMcpClient();
      if (!mcpClient) {
        vscode.window.showErrorMessage('MCP Client not available.');
        return;
      }

      stream.progress('Fetching components ...');

      let prompt = request.prompt || 'all';
      const component = await findComponentByRowNumber(mcpClient, selectedText?.fileName, rowNumber);

      let dependencies = '';

      if (!component) { 
        stream.markdown('No components found');
        return;
      } else {
        stream.progress('Fetching dependencies ...');

        dependencies = await obtainDependencies(mcpClient, prompt, selectedText.language, component.name, component.microService, component.systemModule);
        stream.markdown(dependencies);
      }
    }

    return;
  };

  // create participant
  const tutor = vscode.chat.createChatParticipant("code-dependency", handler);
}

export function deactivate() { }
