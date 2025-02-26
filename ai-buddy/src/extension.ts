import * as vscode from 'vscode';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { getMcpClient } from './mcpClient';

function extractFunctionName(text: string): string | null {
  // This regex looks for 'function' keyword followed by a name
  const functionRegex = /function\s+(\w+)\s*\(/;

  // For arrow functions or methods in object literals
  const arrowOrMethodRegex = /(?:const|let|var)?\s*(\w+)\s*[=:]\s*(?:function|\([^)]*\)\s*=>)/;

  let match = text.match(functionRegex) || text.match(arrowOrMethodRegex);

  if (match && match[1]) {
    return match[1];
  }

  return null; // Return null if no function name is found
}

function getSelectedFunction() {
  const editor = vscode.window.activeTextEditor;

  if (editor) {
    const selection = editor.selection;
    const selectedText = editor.document.getText(selection);
    const functionName = extractFunctionName(selectedText);
    if (!functionName) {
      vscode.window.showInformationMessage('Not a valid function.');
      return;
    }

    const language = editor.document.languageId;
    const pathComponents = editor.document.uri.path.split('/');
    const fileName = pathComponents.pop();

    return { functionName, language, fileName, sourceCode: selectedText };
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

async function obtainDependencies(mcpClient: any, direction: string, functionName: string, microService: string, systemModule: string): Promise<string> {
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
      hasSourceCode: true
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

  //     // await vscode.commands.executeCommand('workbench.action.chat.openInSidebar', 'aiBuddy.code-dependency');
  // });

  // context.subscriptions.push(disposable);

  let analyzeCodeDependencyDisposable = vscode.commands.registerCommand('extension.analyzeCodeDependency', async (uri) => {
    if (!uri) {
      vscode.window.showErrorMessage('No folder selected.');
      return;
    }

    const folderPath = uri.fsPath;

    // Check if package.json or pom.xml exists
    const packageJsonPath = path.join(folderPath, 'package.json');
    const pomXmlPath = path.join(folderPath, 'pom.xml');
    let codeParserType;
    if (fs.existsSync(packageJsonPath)) {
      codeParserType = 'js';
    }
    if (fs.existsSync(pomXmlPath)) {
      codeParserType = 'java';
    }

    if (!codeParserType) {
      vscode.window.showErrorMessage('Currently only support JavaScript and Java projects.');
      return;
    }

    const microServiceName = await vscode.window.showInputBox({
      prompt: 'Please provide micro-service name',
      placeHolder: 'Type here...'
    });

    if (!microServiceName) {
      vscode.window.showInformationMessage('No micro-service provided');
      return;
    }

    const dbConfig = vscode.workspace.getConfiguration().get('aiBuddy.database');
    if (!dbConfig) {
      vscode.window.showErrorMessage('Database configuration is not set. Please configure the database first.');
      return;
    }

    vscode.window.showInformationMessage(`Analyzing code dependency in folder: ${folderPath}`);

    // Show progress notification
    vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: "Analyzing code dependency",
      cancellable: false
    }, async (progress) => {
      progress.report({ increment: 0 });

      try {
        // TODO: Call repo analyzer
        vscode.window.showInformationMessage(`Analysis result: ${response.data}`);
        progress.report({ increment: 100, message: "Analysis complete" });
      } catch (error: any) {
        vscode.window.showErrorMessage(`Analysis failed: ${error.message}`);
        progress.report({ increment: 100, message: "Analysis failed" });
      }
    });
  });

  context.subscriptions.push(analyzeCodeDependencyDisposable);

  const handler: vscode.ChatRequestHandler = async (request: vscode.ChatRequest, context: vscode.ChatContext, stream: vscode.ChatResponseStream, token: vscode.CancellationToken) => {
    if (request.command == 'dependency') {
      const functionObj = getSelectedFunction();
      if (!functionObj) {
        vscode.window.showInformationMessage('No function selected.');
        return;
      }

      const mcpClient = await getMcpClient();
      if (!mcpClient) {
        vscode.window.showErrorMessage('MCP Client not available.');
        return;
      }

      stream.progress('Fetching components ...');

      let prompt = request.prompt || 'all';
      let foundComponents;
      let index = -1;

      if (!isNaN(Number(prompt))) {
        // Index of the components matched in last search
        index = Number(prompt);
        const lastConversation = context.history[context.history.length - 1] as vscode.ChatResponseTurn;
        const lastRequest = context.history[context.history.length - 2] as vscode.ChatRequestTurn;
        prompt = lastRequest.prompt;

        const responseMD = lastConversation.response[0] as vscode.ChatResponseMarkdownPart;
        const lastMatched = extractJsonCodeBlock(responseMD.value.value);
        if (!lastMatched) {
          // Find matched components again
          foundComponents = await findComponents(mcpClient, functionObj);
        } else {
          foundComponents = JSON.parse(lastMatched);
        }
      } else {
        foundComponents = await findComponents(mcpClient, functionObj);
      }

      let dependencies = '';

      if (foundComponents.length === 0) { 
        stream.markdown('No components found');
        return;
      } else if ((index >= 0 && foundComponents[index]) || foundComponents.length === 1) {
        stream.progress('Fetching dependencies ...');

        const component = foundComponents[index] || foundComponents[0];
        dependencies = await obtainDependencies(mcpClient, prompt, component.name, component.microService, component.systemModule);
        stream.markdown(dependencies);
      } else {
        stream.markdown('Multiple components found. Please select one by index (0-based):\n');
        stream.markdown('```json\n');
        stream.markdown(JSON.stringify(foundComponents.map((c: any) => {
          return {
            name: c.name,
            microService: c.microService,
            systemModule: c.systemModule
          }
        }), null, 2) + '\n');
        stream.markdown('```\n');
      }
    }

    return;
  };

  // create participant
  const tutor = vscode.chat.createChatParticipant("aiBuddy.code-dependency", handler);
}

export function deactivate() { }
