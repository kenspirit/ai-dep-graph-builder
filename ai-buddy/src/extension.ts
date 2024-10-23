import * as vscode from 'vscode';
import axios from 'axios';

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

export function activate(context: vscode.ExtensionContext) {
  let disposable = vscode.commands.registerCommand('extension.changeAndAffected', async () => {
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      const selection = editor.selection;
      const selectedText = editor.document.getText(selection);
      const pathComponents = editor.document.uri.path.split('/');
      const fileName = pathComponents.pop();
      const systemModule = pathComponents.pop();
      const microService = 'dep-graph-builder';

      const userInput = await vscode.window.showInputBox({
        prompt: 'Please describe your requirement',
        placeHolder: 'Type here...'
      });

      if (!userInput) {
        vscode.window.showInformationMessage('No input provided');
        return;
      }

      const functionName = extractFunctionName(selectedText);
      if (!functionName) {
        vscode.window.showInformationMessage('Not a valid function.');
        return;
      }

      try {
        const payload = {
          component: {
            category: 'component',
            name: functionName,
            microService,
            systemModule: `/${systemModule}/${fileName}`,
            sourceCode: selectedText
          },
          changeDescription: userInput
        };
        const response = await axios.post('http://localhost:3000/api/ai/affected-from-component', payload);

        // Open a new tab and show the markdown content
        const document = await vscode.workspace.openTextDocument({ content: response.data.data, language: 'markdown' });
        await vscode.window.showTextDocument(document, { preview: false, viewColumn: vscode.ViewColumn.Beside });
      } catch (error: any) {
        vscode.window.showErrorMessage(`API call failed: ${error.message}`);
      }

      vscode.window.showInformationMessage(`Selected text: ${selectedText}`);
    } else {
      vscode.window.showInformationMessage('No editor is active');
    }
  });

  context.subscriptions.push(disposable);
}

export function deactivate() { }
