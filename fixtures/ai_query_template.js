function getFunctionDescription(functionCode) {
  return `I want to extract the description of the function in JavaScript source code.  Sample output in JSON format is:
{
  "description": "The function is used to describe the function"
}

If no description found, please return output as below:
{
  "description": ""
}

Please describe the function for below code in more business terms, and return the full JSON format in one response, without other text, comment or markdown syntax.
---------------
\`\`\`javascript
${functionCode}
\`\`\`
`;
}

function getFunctionDependencies(functionCode) {
  return `I want to extract the global instance and its method call information (excluding the local instance and its method call) in JavaScript function source code.  Sample output in JSON format is:
{
  "dependencies": [
    {
      "instanceName": "headerUtil",
      "method": "parseOperatorByModelName",
      "usage": "headerUtil.parseOperatorByModelName(operator, model)"
    },
    {
      "instanceName": "Model",
      "method": "updateMany",
      "usage": "Model.updateMany(_convertWhere(where, Model), data)"
    },
    {
      "instanceName": "organizationModel",
      "field": "localName"
    }
  ]
}

Example 1, for function \`async function getDescendants(req, res) { const descendants = await graphService.getDescendants(req.query); res.json(descendants); }\`, the output should NOT be:
{
  "dependencies": [
    {
      "instanceName": "graphService",
      "method": "getDescendants",
      "usage": "graphService.getDescendants(req.query)"
    },
    {
      "instanceName": "res",
      "method": "json",
      "usage": "res.json(descendants)"
    },
    {
      "instanceName": "req",
      "method": "query",
      "usage": "req.query"
    }
  ]
}

But should be as below because it excludes the local instance, \`res\` with its method call \`res.json(descendants)\`, and \`req\` with its method call \`req.query\`:
{
  "dependencies": [
    {
      "instanceName": "graphService",
      "method": "getDescendants",
      "usage": "graphService.getDescendants(req.query)"
    }
  ]
}

If no dependencies found, please return output as below:
{
  "dependencies": []
}

Please do the extraction for below code, and return the full JSON format in one response, without other text, comment or markdown syntax.
---------------
\`\`\`javascript
${functionCode}
\`\`\`
`;
}

function getRequiredModuleDependencies(moduleCode) {
  return `I want to extract the required modules based on the \`require\` or ES6 \`import\` syntax statements in JavaScript source code.
Example 1, \`const stringify = require('csv-stringify/lib/sync');\`, the output should be:
{
  "dependencies": [
    {
      "moduleName": "stringify",
      "modulePath": "csv-stringify/lib/sync"
    }
  ]
}

Example 2, \`const { v4: uuidv4 } = require('uuid');\`, the output should be:
{
  "dependencies": [
    {
      "moduleName": "uuid",
      "modulePath": "uuid",
      "moduleInstance": "v4",
      "instanceAlias": "uuidv4"
    }
  ]
}

Example 3, \`const { Transform } = require('stream');\`, the output should be:
{
  "dependencies": [
    {
      "moduleName": "stream",
      "modulePath": "node:stream",
      "moduleInstance": "Transform"
    }
  ]
}

Example 4, \`const { throwError, INVALID_XXX } = require('../../common/utils/serviceErrorCode');\`, the output should be:
{
  "dependencies": [
    {
      "moduleName": "serviceErrorCode",
      "modulePath": "../../common/utils/serviceErrorCode",
      "moduleInstance": "Transform"
    },
    {
      "moduleName": "serviceErrorCode",
      "modulePath": "../../common/utils/serviceErrorCode",
      "moduleInstance": "INVALID_XXX"
    }
  ]
}

Example 5, \`import { GraphBuilder } from '../../../graph-builder.js';\`, the output should be:
{
  "dependencies": [
    {
      "moduleName": "GraphBuilder",
      "modulePath": "../../../graph-builder.js",
      "moduleInstance": "GraphBuilder"
    }
  ]
}

Example 6, \`import { default as config} from '../../../sample.config.js';\`, the output should be:
{
  "dependencies": [
    {
      "moduleName": "config",
      "modulePath": "../../../sample.config.js",
      "instanceAlias": "config"
    }
  ]
}

If no dependencies found, please return output as below:
{
  "dependencies": []
}

Please do the extraction for below code, and return the full JSON format in one response, without other text, comment or markdown syntax.
-------------
\`\`\`javascript
${moduleCode}
\`\`\`
`;
}

export default {
  getFunctionDescription,
  getFunctionDependencies,
  getRequiredModuleDependencies,
};
