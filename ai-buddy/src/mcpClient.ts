import * as vscode from 'vscode';
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export async function getMcpClient(): Promise<Client | undefined> {
  const mcpServerPath = vscode.workspace.getConfiguration().get('aiBuddy.mcpServerPath');
  if (!mcpServerPath) {
    vscode.window.showErrorMessage('MCP Server path is not set. Please configure the MCP Server path first.');
    return;
  }

  const transport = new StdioClientTransport({
    command: "node",
    args: [mcpServerPath as string]
  });

  const client = new Client(
    {
      name: "ai-buddy-client",
      version: "1.0.0"
    },
    {
      capabilities: {
        prompts: {},
        resources: {},
        tools: {}
      }
    }
  );

  await client.connect(transport);

  return client;
}
