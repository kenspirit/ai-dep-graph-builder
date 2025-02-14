import { GraphBuilder } from './graph-builder.js';
import config from './sample.config.js';
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const graphBuilder = new GraphBuilder(config.graph.type, config.graph.connectionOptions);

const server = new McpServer({
  name: 'Code Dependency Retrieval',
  version: '1.0.0'
});

server.tool('getAllDependencies',
  `Fetch all dependent code components in call chain to analyze change required based on code dependency.`,
  {
    name: z.string().describe('Name of the component.  Normally the function name.'),
    microService: z.string().describe('Name of the microservice.  Project root folder name could be used.'),
    systemModule: z.string().describe('Name of the module.  Relative file path could be used.'),
    sourceCode: z.string().describe('Source code of the function.'),
  },
  async (vertex) => {
    try {
      vertex.category = 'component';
      const descendants = await graphBuilder.getDescendants(vertex);
      const ancestors = await graphBuilder.getAncestors(vertex);

      const allIds = ancestors.concat(descendants).reduce((acc, item) => {
        acc.push(...item.paths);
        return acc;
      }, []);
      const uniqueIds = [...new Set(allIds)];
      const vertices = uniqueIds.length > 0 ? await graphBuilder.getVerticesByIds(uniqueIds) : [];

      if (vertices.length === 0) {
        return {
          content: [{ type: 'text', text: 'No related code components are found.' }]
        };
      }

      const result = vertices.reduce((acc, vertex) => {
        return `${acc}

**Source File:** ${vertex.name} in ${vertex.systemModule}
\`\`\`javascript
${vertex.sourceCode}
\`\`\`
    `;
      }, 'Below code components in each file are all related to provided component.\n\n');

      return {
        content: [{ type: 'text', text: String(result) }]
      };
    } catch (error) {
      console.error(error);
      return {
        content: [{ type: 'text', text: error.message || 'Error' }]
      };
    }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
