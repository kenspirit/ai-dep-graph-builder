function getFunctionDescription(functionCode) {
  return `I want to extract the description of the function in JavaScript source code.  Sample output in JSON format is:
{
  "description": "The function is used to describe the function"
}

If no description found, please return output as below:
{
  "description": ""
}
Please describe the function for below code in more business terms.
The response should be a full JSON format in one response, without other text or comment.
---------------
${functionCode}`;
}

function getFunctionDependencies(functionCode) {
  return `I want to extract the global instance and its method call information in JavaScript function source code.  Sample output in JSON format is:
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
    }
  ]
}

If no dependencies found, please return output as below:
{
  "dependencies": []
}

Please do the extraction for below code, and return the full JSON format in one response, without other text or comment.
---------------
${functionCode}`;
}

function getRequiredModuleDependencies(moduleCode) {
  return `I want to extract the required modules based on the \`import\` or \`require\` syntax statements in JavaScript source code.
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

If no dependencies found, please return output as below:
{
  "dependencies": []
}

Please do the extraction for below code, and return the full JSON format in one response, without other text or comment.
-------------
${moduleCode}`;
}

export default {
  getFunctionDescription,
  getFunctionDependencies,
  getRequiredModuleDependencies,
};
