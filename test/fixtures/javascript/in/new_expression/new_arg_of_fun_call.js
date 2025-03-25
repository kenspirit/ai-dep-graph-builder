import _ from 'lodash';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

function getMcpServer() {
  return new McpServer({
    name: 'Code Dependency Retrieval',
    version: _.uniqueId('1.0.')
  });
}

module.exports = {
  getMcpServer
};
