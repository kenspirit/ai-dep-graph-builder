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

async function _formatResult(vertices) {
  const allIds = vertices.reduce((acc, item) => {
    acc.push(...item.paths);
    return acc;
  }, []);
  const uniqueIds = [...new Set(allIds)];
  const uniqueVertices = uniqueIds.length > 0 ? await graphBuilder.getVerticesByIds(uniqueIds) : [];

  if (uniqueVertices.length === 0) {
    return {
      content: [{ type: 'text', text: 'No related code components are found.' }]
    };
  }

  const result = uniqueVertices.reduce((acc, vertex) => {
    return `${acc}

### \`${vertex.name}\` in system module: \`${vertex.systemModule}\` of microservice: \`${vertex.microService}\`

\`\`\`javascript
${vertex.sourceCode}
\`\`\`
    `;
  }, 'Below code components are found.\n\n');

  return {
    content: [{ type: 'text', text: String(result) }]
  };
}

server.tool('listComponents',
  `Find all code components based on name and implemented language.`,
  {
    name: z.string().describe('Name of the component.  Normally the function name.'),
    language: z.enum(['javascript', 'java']).describe('Implemented language of the component.  javascript, java, or others.'),
    systemModule: z.string().optional().describe('Name of the module.  Relative file path could be used.  Partial match is supported.'),
    format: z.enum(['json', 'md']).default('md').describe('Format of the result.  json or md.'),
  },
  async ({ name, language, systemModule, format }) => {
    try {
      const vertices = await graphBuilder.getComponentByNameAndLanguage(name, language, systemModule);

      if (vertices.length === 0) {
        return {
          content: [{ type: 'text', text: format === 'json' ? '[]' : 'No related code components are found.' }]
        };
      }

      const result = vertices.map((vertex, index) => {
        return `${index + 1}. \`${vertex.name}\` in system module: \`${vertex.systemModule}\` of microservice: \`${vertex.microService}\``;
      }).join('\n');

      return {
        content: [{ type: 'text', text: format === 'json' ? JSON.stringify(vertices) : `Below code components are found.\n\n${result}` }]
      };
    } catch (error) {
      console.error(error);
      return {
        content: [{ type: 'text', text: error.message || 'Error' }]
      };
    }
  }
);

server.tool('listUpstreamDependencies',
  `Find upstream code components in the call chain to the provided component based on code dependency.
If interface of the provided component is changed, the upstream components need to be updated.`,
  {
    name: z.string().describe('Name of the component.  Normally the function name.'),
    microService: z.string().describe('Name of the microservice.  Project root folder name could be used.'),
    systemModule: z.string().describe('Name of the module.  Relative file path could be used.'),
    sourceCode: z.string().optional().describe('Source code of the provided component if changed.'),
    dependencyType: z.string().default('Function').describe('Type of the dependency.  Function, Field, or others.'),
    hasSourceCode: z.coerce.boolean().default(true).describe('Whether the dependent component has source code or not.  Normally set to true to exclude external libraries.'),
  },
  async (vertex) => {
    try {
      vertex.category = 'component';
      const ancestors = await graphBuilder.getAncestors(vertex, vertex.dependencyType, vertex.hasSourceCode);

      return _formatResult(ancestors);
    } catch (error) {
      console.error(error);
      return {
        content: [{ type: 'text', text: error.message || 'Error' }]
      };
    }
  }
);

server.tool('listDownstreamDependencies',
  `Find downstream code components in the call chain from the provided component based on code dependency.
If interface of the provided component is NOT changed, only the implementation is changed.  The downstream components should be checked for change.`,
  {
    name: z.string().describe('Name of the component.  Normally the function name.'),
    microService: z.string().describe('Name of the microservice.  Project root folder name could be used.'),
    systemModule: z.string().describe('Name of the module.  Relative file path could be used.'),
    sourceCode: z.string().optional().describe('Source code of the provided component if changed.'),
    dependencyType: z.string().default('Function').describe('Type of the dependency.  Function, Field, or others.'),
    hasSourceCode: z.coerce.boolean().default(true).describe('Whether the dependent component has source code or not.  Normally set to true to exclude external libraries.'),
  },
  async (vertex) => {
    try {
      vertex.category = 'component';
      const descendants = await graphBuilder.getDescendants(vertex, vertex.dependencyType, vertex.hasSourceCode);

      return _formatResult(descendants);
    } catch (error) {
      console.error(error);
      return {
        content: [{ type: 'text', text: error.message || 'Error' }]
      };
    }
  }
);

server.tool('listAllDependencies',
  `Find all dependent code components in call chain to analyze required change based on code dependency.`,
  {
    name: z.string().describe('Name of the component.  Normally the function name.'),
    microService: z.string().describe('Name of the microservice.  Project root folder name could be used.'),
    systemModule: z.string().describe('Name of the module.  Relative file path could be used.'),
    sourceCode: z.string().optional().describe('Source code of the provided component if changed.'),
    dependencyType: z.string().default('Function').describe('Type of the dependency.  Function, Field, or others.'),
    hasSourceCode: z.coerce.boolean().default(true).describe('Whether the dependent component has source code or not.  Normally set to true to exclude external libraries.'),
  },
  async (vertex) => {
    try {
      vertex.category = 'component';
      const descendants = await graphBuilder.getDescendants(vertex, vertex.dependencyType, vertex.hasSourceCode);
      const ancestors = await graphBuilder.getAncestors(vertex, vertex.dependencyType, vertex.hasSourceCode);

      return _formatResult(ancestors.concat(descendants));
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
