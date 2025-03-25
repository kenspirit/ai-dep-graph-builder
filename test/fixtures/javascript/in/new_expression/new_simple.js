import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

function getMcpServer() {
  return new McpServer({
    name: 'Code Dependency Retrieval',
    version: '1.0.0'
  });
}

module.exports = {
  getMcpServer
};
