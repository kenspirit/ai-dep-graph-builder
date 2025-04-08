import _ from 'lodash';
import fs from 'fs';
import Parser from 'tree-sitter';
import JavaScript from 'tree-sitter-javascript';

function _oneDescendantOfType(node, type) {
  const descendants = node.descendantsOfType(type);
  if (!_.isEmpty(descendants)) {
    return descendants[0];
  }
}

function _oneChildrenOfType(node, type) {
  return _.find(node.children, child => child.type === type);
}

function _allChildrenOfType(node, type) {
  return _.filter(node.children, child => child.type === type);
}

function _setDependencyTypeBasedOnNodeType(dependency, node) {
  if (['string', 'template_string'].includes(node.type)) {
    dependency.$type = 'string';
    dependency.$sourceCode = node.text;
  } else if (node.type === 'array') {
    dependency.$type = 'array';
  }
  dependency.$value = node.text; // string value here;
}

function _programHandler(scopeInstanceName, node, requiredModuleDependencies, instanceAndfunctionDependencies, level, localScopeVariables) {
  const sectionNodes = node.children;
  for (let i = 0; i < sectionNodes.length; i++) {
    _walkAndBuildDependency('', sectionNodes[i], requiredModuleDependencies, instanceAndfunctionDependencies, level, localScopeVariables);
  }
}

function _getRequireSource(node) {
  if (node.type === 'call_expression') {
    if (node.children[0].text === 'require') {
      const source = _oneChildrenOfType(node.children[1], 'string');
      if (source) {
        let path = source.children[1].text;
        if (path.indexOf('.') > -1 && !path.endsWith('.js')) {
          path += '.js';
        }
        return path;
      }
    } else if (node.children[0].type === 'member_expression') {
      // require('xxxx').xyz
      return _getRequireSource(node.children[0].children[0]);
    } else {
      return _getRequireSource(node.children[0]);
    }
  }
}

function _requireCallExpressionHandler(variableNode, assignmentNode, requiredModuleDependencies, scopeInstanceName, localScopeVariables) {
  const sourceName = _getRequireSource(assignmentNode);
  if (!sourceName) {
    return;
  }

  if (variableNode.type === 'identifier') {
    requiredModuleDependencies[variableNode.text] = { source: sourceName, isDefault: true };
  } else if (variableNode.type === 'object_pattern') {
    // Destructuring assignment
    // const { export1, export2: alias2 } = require('module-name');
    for (const child of variableNode.children) {
      if (OPERATORS_OR_KEYWORDS.includes(child.type)) {
        continue;
      }

      let assignmentIdentifier;
      if (child.type === 'shorthand_property_identifier_pattern') {
        assignmentIdentifier = child.text;
      } else if (child.type === 'pair_pattern') {
        assignmentIdentifier = child.children[2].text;
      }

      requiredModuleDependencies[assignmentIdentifier] = { source: sourceName };
      if (child.type === 'pair_pattern') {
        requiredModuleDependencies[assignmentIdentifier].sourceProperty = child.children[0].text;
      }
    }
  } else if (variableNode.type === 'array_pattern') {
    // TODO: Should not have array pattern for require call.
  }

  return sourceName;
}

function _importStatementHandler(scopeInstanceName, node, requiredModuleDependencies, instanceAndfunctionDependencies, level, localScopeVariables) {
  const importClause = node.children[1];
  let source = node.childrenForFieldName('source');
  source = source[0].text.replace(/['"]/g, '');

  for (const child of importClause.children) {
    if (child.type === 'identifier') {
      // import defaultExport from "module-name";
      requiredModuleDependencies[child.text] = { isDefault: true, source };
    } else if (child.type === 'named_imports') {
      // import { export1, export2 } from "module-name";
      const namedImports = child.children;
      for (const namedImport of namedImports) {
        if (OPERATORS_OR_KEYWORDS.includes(namedImport.text)) {
          continue;
        }

        if (namedImport.children.length === 3) {
          // import { export1 as alias1 } from "module-name";
          requiredModuleDependencies[namedImport.children[2].text] = { source, sourceProperty: namedImport.children[0].text };
          if (namedImport.children[0].text === 'default') {
            requiredModuleDependencies[namedImport.children[2].text].isDefault = true;
          }
        } else {
          requiredModuleDependencies[namedImport.text] = { source };
        }
      }
    } else if (child.type === 'namespace_import') {
      // import * as name from "module-name";
      // name.default refers to the default export
      const alias = child.children[2].text;
      requiredModuleDependencies[alias] = { source, isNamespace: true };
    } else if (child.type === 'string_fragment') {
      // import "module-name";
      // it runs the module's global code, but doesn't actually import any values
      requiredModuleDependencies[source] = { source, sideEffect: true };
      instanceAndfunctionDependencies[source] = { $name: source, $module: source };
    }
  }
}

function _lexicalDeclarationHandler(scopeInstanceName, node, requiredModuleDependencies, instanceAndfunctionDependencies, level, localScopeVariables) {
  const declarators = _allChildrenOfType(node, 'variable_declarator');
  if (!declarators) {
    return;
  }

  // variable names should be collected in local scope variables
  const identifiers = [];

  for (const declarator of declarators) {
    const variableNode = declarator.children[0];
    const assignmentNode = declarator.children[2];
    if (!assignmentNode) {
      continue;
    }

    const requireSource = _requireCallExpressionHandler(variableNode, assignmentNode, requiredModuleDependencies, scopeInstanceName, localScopeVariables);
    if (requireSource) {
      // require call: const Query = require('module-name');
      // require call: const { Query } = require('module-name');
      // Dependency is captured in _requireCallExpressionHandler already
      continue;
    }

    // object_pattern: const {Query, Parser} = binding;
    // array_pattern: const [Query, Parser] = binding;
    // identifier: const Query = binding;
    // identifier: const Query = { ... } / [];
    const variableIdentifiers = _walkAndBuildDependency(scopeInstanceName, variableNode, requiredModuleDependencies, instanceAndfunctionDependencies, level, localScopeVariables);
    identifiers.push(...variableIdentifiers);
    if (scopeInstanceName) {
      localScopeVariables.push(...variableIdentifiers);
    }

    let assignmentIdentifiers;

    if (['object_pattern', 'array_pattern'].includes(variableNode.type)) {
      // Assuming right side is expression or identifier, but NOT object / array.  Should have only one identifier resolved
      // Dependency relationship should be captured as the variable fields depends / uses the resolved identifier or elements contained in the object / array
      assignmentIdentifiers = _walkAndBuildDependency(scopeInstanceName, assignmentNode, requiredModuleDependencies, instanceAndfunctionDependencies, level, localScopeVariables);

      for (const variableIdentifier of variableIdentifiers) {
        if (localScopeVariables.includes(variableIdentifier) || localScopeVariables.includes(assignmentIdentifiers[0])) {
          delete instanceAndfunctionDependencies[variableIdentifier];
          continue;
        }

        const dependency = _captureDependency(instanceAndfunctionDependencies, variableIdentifier);

        if (dependency.$sourceProperty) {
          // If alias is used, current property is dependent on the alias field of scopeInstanceName
          dependency[dependency.$sourceProperty] = { $name: dependency.$sourceProperty, $usage: '$property', $module: assignmentIdentifiers[0] };
          delete dependency.$module;
        } else {
          dependency.$module = assignmentIdentifiers[0];
        }
      }
    } else {
      // Assuming left side is always identifier
      const variableIdentifier = variableIdentifiers[0];
      let dependency;

      if (localScopeVariables.includes(variableIdentifier)) {
        dependency = instanceAndfunctionDependencies;
      } else {
        dependency = _captureDependency(instanceAndfunctionDependencies, variableIdentifier);
        if (variableIdentifier && assignmentNode.type === 'array') {
          dependency.$type = 'array';
        }
      }

      assignmentIdentifiers = _walkAndBuildDependency(scopeInstanceName, assignmentNode, requiredModuleDependencies, instanceAndfunctionDependencies, level, localScopeVariables);
      if (assignmentNode.type === 'new_expression') {
        const variableDependency = _captureDependency(instanceAndfunctionDependencies, variableIdentifier);
        variableDependency.$constructor = assignmentIdentifiers[0];
      } else if (assignmentNode.type === 'function_expression' || assignmentNode.type === 'arrow_function') {
        dependency.$sourceCode = assignmentNode.text;
        dependency.$type = 'method';
      }
    }

    identifiers.push(...assignmentIdentifiers);
  }

  return identifiers;
}

function _functionNodeHander(scopeInstanceName, node, requiredModuleDependencies, instanceAndfunctionDependencies, level, localScopeVariables) {
  // Local arguments that are not required to put in dependencies
  // Function or Method
  let identifier = _oneChildrenOfType(node, 'identifier') ||
    _oneChildrenOfType(node, 'property_identifier') ||
    _oneChildrenOfType(node, 'private_property_identifier');
  if (identifier && node.type !== 'arrow_function') {
    identifier = identifier.text;
  } else {
    identifier = '';
  }

  // Local arguments that are not required to put in dependencies
  let funArgs = _oneChildrenOfType(node, 'formal_parameters');
  let funArgIdentifiers = [];
  if (!funArgs) {
    // arrow_function definition that only has one argument, such as `a => {}`
    if (node.type === 'arrow_function' && node.children[0].type === 'identifier') {
      funArgIdentifiers.push(node.children[0].text);
    }
  } else {
    funArgIdentifiers = funArgs.descendantsOfType('identifier').map(arg => arg.text);
  }

  let dependency = instanceAndfunctionDependencies;
  if (identifier) {
    // Anonymous function is ignored
    dependency = _captureDependency(instanceAndfunctionDependencies, identifier);
    dependency.$sourceCode = node.text;
    dependency.$type = 'method';
  }

  _walkAndBuildDependency(identifier || scopeInstanceName, _oneChildrenOfType(node, 'statement_block'), requiredModuleDependencies, dependency, level, funArgIdentifiers.concat(localScopeVariables));

  return identifier;
}

function _memberExpressionHandler(scopeInstanceName, node, requiredModuleDependencies, instanceAndfunctionDependencies, level, localScopeVariables) {
  const dependentIdentifer = _walkAndBuildDependency(scopeInstanceName, node.children[0], requiredModuleDependencies, instanceAndfunctionDependencies, level + 1, localScopeVariables)[0] +
    '.' +
    _walkAndBuildDependency(scopeInstanceName, node.children[2], requiredModuleDependencies, instanceAndfunctionDependencies, level + 1, localScopeVariables)[0];

  if (!localScopeVariables.includes(dependentIdentifer.split('.')[0])) {
    _captureDependencyWithScope(scopeInstanceName, dependentIdentifer, instanceAndfunctionDependencies, node, level);
  }

  return dependentIdentifer;
}

function _newExpressionHandler(scopeInstanceName, node, requiredModuleDependencies, instanceAndfunctionDependencies, level, localScopeVariables) {
  const dependentIdentifer = _walkAndBuildDependency(scopeInstanceName, node.children[1], requiredModuleDependencies, instanceAndfunctionDependencies, level, localScopeVariables)[0];

  const dependency = _captureDependency(instanceAndfunctionDependencies, dependentIdentifer, node);
  dependency.$type = 'constructor';

  // Handle arguments
  _walkAndBuildDependency(scopeInstanceName, node.children[2], requiredModuleDependencies, instanceAndfunctionDependencies, level, localScopeVariables);

  return dependentIdentifer;
}

function _callExpressionHandler(scopeInstanceName, node, requiredModuleDependencies, instanceAndfunctionDependencies, level, localScopeVariables) {
  const dependentIdentifer = _walkAndBuildDependency(scopeInstanceName, node.children[0], requiredModuleDependencies, instanceAndfunctionDependencies, level, localScopeVariables)[0] || '';

  // If first children is member expression, it's captured in instanceAndfunctionDependencies above already
  if (instanceAndfunctionDependencies[dependentIdentifer]) {
    instanceAndfunctionDependencies[dependentIdentifer].$usage = node.text;
  } else if (dependentIdentifer.indexOf('.') === -1) {
    // Not a member expression, then it's a function call
    _captureDependencyWithScope(scopeInstanceName, dependentIdentifer, instanceAndfunctionDependencies, node, level);
  }

  // Handle arguments
  _walkAndBuildDependency(scopeInstanceName || dependentIdentifer, node.children[1], requiredModuleDependencies, instanceAndfunctionDependencies, level, localScopeVariables);

  return dependentIdentifer;
}

function _identifierHandler(scopeInstanceName, node, requiredModuleDependencies, instanceAndfunctionDependencies, level, localScopeVariables) {
  return node.text;
}

function _forStatementHandler(scopeInstanceName, node, requiredModuleDependencies, instanceAndfunctionDependencies, level, localScopeVariables) {
  // Resolve the local variables, it can be simple identifier or destructuring assignment, such as [x, y] or { x, y }
  const identifiers = _walkAndBuildDependency(scopeInstanceName, _oneChildrenOfType(node, 'lexical_declaration'), requiredModuleDependencies, instanceAndfunctionDependencies, level, localScopeVariables);
  for (const identifier of identifiers) {
    localScopeVariables.push(identifier);
    delete instanceAndfunctionDependencies[identifier];
  }

  // statement_block
  _walkAndBuildDependency(scopeInstanceName, node.children[node.children.length - 1], requiredModuleDependencies, instanceAndfunctionDependencies, level, localScopeVariables);
}

function _forInStatementHandler(scopeInstanceName, node, requiredModuleDependencies, instanceAndfunctionDependencies, level, localScopeVariables) {
  // Resolve the local variables, it can be simple identifier or destructuring assignment, such as [x, y] or { x, y }
  const identifiers = _walkAndBuildDependency(scopeInstanceName, node.children[3], requiredModuleDependencies, instanceAndfunctionDependencies, level, localScopeVariables);
  for (const identifier of identifiers) {
    localScopeVariables.push(identifier);
    delete instanceAndfunctionDependencies[identifier];
  }

  // statement_block
  _walkAndBuildDependency(scopeInstanceName, node.children[node.children.length - 1], requiredModuleDependencies, instanceAndfunctionDependencies, level, localScopeVariables);
}

const OPERATORS_OR_KEYWORDS = ['{', '}', ',', ';', '@', 'export', 'return', 'await', 'comment', 'if', 'else', 'delete', 'const', 'for', 'of', 'while', 'instanceof', 'static', 'yield', 'try', 'throw', 'continue_statement', 'break_statement', 'empty_statement', 'typeof', 'undefined', 'null', 'true', 'false', 'number', '...', '=', '\'', '"', '+', '-', '*', '/', '?', '%', '??', ':', '[', ']', '(', ')', '>', '<', '>=', '<=', '==', '===', '!=', '!==', '&&', '||', '!', '++', '--', '+=', '-='];

function _moduleExportHandler(scopeInstanceName, node, requiredModuleDependencies, instanceAndfunctionDependencies, level, localScopeVariables) {
  const children = node.children;
  const exportValueIdentifiers = _walkAndBuildDependency('', children[2], requiredModuleDependencies, instanceAndfunctionDependencies, level, localScopeVariables);

  if (children[0].text === 'module.exports') {
    // module.exports = Parser / { ... };
    for (const identifier of exportValueIdentifiers) {
      const dependency = _captureDependency(instanceAndfunctionDependencies, identifier);
      dependency.$public = true;

      if (dependency.$module) {
        // If module is already defined, then it's a re-assignment
        dependency[identifier] = { $name: identifier, $module: dependency.$module, $usage: '$assignment' };
        dependency.$usage = '$assignment';
        dependency.$module = '$file';
      }
    }
  } else {
    // module.exports.Query = Query;
    // module.exports.Query = DifferentName;
    const exportedFieldIdentifier = children[0].text.replace('module.exports.', '');

    const dependency = _captureDependency(instanceAndfunctionDependencies, exportedFieldIdentifier);
    if (dependency.$module) {
      // If module is already defined, then it's a re-assignment
      dependency[exportedFieldIdentifier] = { $name: exportedFieldIdentifier, $module: dependency.$module, $usage: '$assignment' };
    } else if (exportValueIdentifiers.length > 1) {
      // module.exports.Query = { ... };
      // TODO: Rare case, exported field depends on each object key and makes them public
      for (const identifier of exportValueIdentifiers) {
        const objField = instanceAndfunctionDependencies[identifier];
        if (!objField) {
          continue;
        }

        dependency[identifier] = objField;
        objField.$public = true;
        dependency.$public = true;
        dependency.$usage = '$assignment';
      }
    } else if (exportValueIdentifiers.length === 1 && exportedFieldIdentifier !== exportValueIdentifiers[0]) {
      // DifferentName should be captured in instanceAndfunctionDependencies or requiredModuleDependencies already
      const valueName = exportValueIdentifiers[0];
      dependency[valueName] = { $name: valueName, $public: true, $usage: '$assignment' };
    }

    dependency.$module = '$file';
    dependency.$usage = '$assignment';
    dependency.$public = true;
  }
}

function _assignmentExpressionHandler(scopeInstanceName, node, requiredModuleDependencies, instanceAndfunctionDependencies, level, localScopeVariables) {
  const children = node.children;
  const assignedNode = children[0];

  if (assignedNode.type === 'member_expression' && assignedNode.text.indexOf('module.exports') === 0) {
    // special type of assignment
    return _moduleExportHandler(scopeInstanceName, node, requiredModuleDependencies, instanceAndfunctionDependencies, level, localScopeVariables);
  }

  _walkAndBuildDependency(scopeInstanceName, assignedNode, requiredModuleDependencies, instanceAndfunctionDependencies, level, localScopeVariables);

  _walkAndBuildDependency(scopeInstanceName, children[2], requiredModuleDependencies, instanceAndfunctionDependencies, level, localScopeVariables);
}

function _catchClauseHandler(scopeInstanceName, node, requiredModuleDependencies, instanceAndfunctionDependencies, level, localScopeVariables) {
  const parameter = _oneChildrenOfType(node, 'identifier');
  if (parameter) {
    localScopeVariables.push(parameter.text);
  }

  _walkAndBuildDependency(scopeInstanceName, node.children[node.children.length - 1], requiredModuleDependencies, instanceAndfunctionDependencies, level, localScopeVariables);
}

function _generalExpressionHandler(scopeInstanceName, node, requiredModuleDependencies, instanceAndfunctionDependencies, level, localScopeVariables) {
  if (node.type === 'subscript_expression' && node.text.indexOf('(') === -1) {
    // If not a function call, then it's possible a member accessment like: xxx.yyy.zzz[0]
    // Temply ignore the content inside bracket
    // TODO: Go deep
    return node.text.replace(/\[.*\]/, '');
  }

  const children = node.children;
  for (let child of children) {
    if (OPERATORS_OR_KEYWORDS.indexOf(child.type) !== -1) {
      // Skipping those `return`, `await`, ;, operators (e.g. >), etc
      continue;
    }

    _walkAndBuildDependency(scopeInstanceName, child, requiredModuleDependencies, instanceAndfunctionDependencies, level, localScopeVariables);
  }
}

function _objectPairHandler(scopeInstanceName, node, requiredModuleDependencies, instanceAndfunctionDependencies, level, localScopeVariables) {
  let identifier = _oneChildrenOfType(node, 'property_identifier');
  if (identifier) {
    identifier = identifier.text;
  }

  if (level === 0) {
    if (scopeInstanceName) {
      identifier = scopeInstanceName + '.' + identifier;
    } else {
      // TODO: Could this happen?  Top level object definition without assigning to any variable?
    }
  } else {
    identifier = scopeInstanceName;
  }

  _walkAndBuildDependency(scopeInstanceName, node.children[2], requiredModuleDependencies, instanceAndfunctionDependencies, level, localScopeVariables);
}

function _classDeclarationHandler(scopeInstanceName, node, requiredModuleDependencies, instanceAndfunctionDependencies, level, localScopeVariables) {
  const className = _oneChildrenOfType(node, 'identifier').text;
  const heritage = _oneChildrenOfType(node, 'class_heritage');

  // Class in JS file is a top level object
  const dependency = _captureDependency(instanceAndfunctionDependencies, className);
  dependency.$type = 'class';
  dependency.$sourceCode = node.text;

  if (heritage) {
    dependency['$heritage'] = {
      $usage: `${heritage.children[0].text}`,
      $parent: heritage.children[1].text
    };
  }

  const classBody = _oneChildrenOfType(node, 'class_body');

  for (const child of classBody.children) {
    if (OPERATORS_OR_KEYWORDS.indexOf(child.type) !== -1) {
      // Skipping those `return`, `await`, ;, operators (e.g. >), etc
      continue;
    }

    let identifier;
    let isPrivate = false;

    if (child.type === 'method_definition' || child.type === 'field_definition') {
      let propertyName = _oneChildrenOfType(child, 'property_identifier');
      if (!propertyName) {
        propertyName = _oneChildrenOfType(child, 'private_property_identifier');
        isPrivate = true;
      }

      identifier = propertyName.text;
    } else if (child.type === 'class_static_block') {
      identifier = 'static_block';
    }

    dependency[identifier] = {
      $name: identifier,
      $type: child.type.replace('_definition', '')
    };
    if (!isPrivate) {
      dependency[identifier].$public = true;
    }

    _walkAndBuildDependency(['static_block', 'constructor'].includes(identifier) ? identifier : '', child, requiredModuleDependencies, dependency, 0);
  }

  return className;
}

function _exportStatementHandler(scopeInstanceName, node, requiredModuleDependencies, instanceAndfunctionDependencies, level, localScopeVariables) {
  // TODO: Re-exporting / Aggregating is not handled yet, such as:
  // export * from "module-a";
  // export * as agg1 from "module-b";
  // export { import1 as agg2, /* …, */ aggN } from "module-c";
  // export { default, /* …, */ } from "module-e";
  // export { default as agg3 } from "module-f";

  const children = node.children;

  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (OPERATORS_OR_KEYWORDS.indexOf(child.type) !== -1) {
      // Skipping those `return`, `await`, ;, operators (e.g. >), etc
      continue;
    }

    if (child.type === 'default') {
      // Next sibling is the exported object
      const defaultDependency = _captureDependency(instanceAndfunctionDependencies, 'default');

      _walkAndBuildDependency('', children[i + 1], requiredModuleDependencies, defaultDependency, level, localScopeVariables);

      break;
    } else {
      const identifiers = _walkAndBuildDependency('', child, requiredModuleDependencies, instanceAndfunctionDependencies, level, localScopeVariables);
      for (const identifier of identifiers) {
        if (instanceAndfunctionDependencies[identifier]) {
          instanceAndfunctionDependencies[identifier].$public = true;
        }
      }
    }
  }
}

function _exportClauseHandler(scopeInstanceName, node, requiredModuleDependencies, instanceAndfunctionDependencies, level, localScopeVariables) {
  // export { variable1 as name6, variable2 as name7 };
  const exportSpecifiers = _allChildrenOfType(node, 'export_specifier');
  for (const exportSpecifier of exportSpecifiers) {
    let identifier = exportSpecifier.children[0].text;
    let sourceProperty;
    if (exportSpecifier.children.length === 3) {
      sourceProperty = identifier;
      identifier = exportSpecifier.children[2].text;
    }

    const dependency = _captureDependency(instanceAndfunctionDependencies, identifier);
    dependency.$public = true;

    if (sourceProperty) {
      dependency.$sourceProperty = sourceProperty;
    }
  }
}

function _arrayHandler(scopeInstanceName, node, requiredModuleDependencies, instanceAndfunctionDependencies, level, localScopeVariables) {
  const children = node.children;
  let index = 0;
  for (let child of children) {
    if (OPERATORS_OR_KEYWORDS.indexOf(child.type) !== -1) {
      // Skipping those `return`, `await`, ;, operators (e.g. >), etc
      continue;
    }

    index++;
    if (scopeInstanceName === instanceAndfunctionDependencies.$name) {
      instanceAndfunctionDependencies.$index = index;
    }

    if (['string', 'template_string'].includes(child.type)) {
      const dependency = _captureDependency(instanceAndfunctionDependencies, child.text);
      dependency.$type = 'string';
      dependency.$value = child.text;
      dependency.$index = index;
    } else if (child.type === 'identifier' && !localScopeVariables.includes(child.text)) {
      _captureDependency(instanceAndfunctionDependencies, child.text);
    } else {
      _walkAndBuildDependency(scopeInstanceName, child, requiredModuleDependencies, instanceAndfunctionDependencies, level, localScopeVariables);
    }
  }
}

function _arrayPatternHandler(scopeInstanceName, node, requiredModuleDependencies, instanceAndfunctionDependencies, level, localScopeVariables) {
  // const [a = default, , b, ...rest] = array;
  // const [a, b, ...{ pop, push }] = array;
  // const [a, b, ...[c, d]] = array;

  if (requiredModuleDependencies[scopeInstanceName] || level === 0) {
    const children = node.children;
    for (const child of children) {
      const type = child.type;
      if (OPERATORS_OR_KEYWORDS.includes(type)) {
        continue;
      }

      let identifier;
      switch (type) {
        case 'assignment_pattern':
          identifier = child.children[0].text;
          if (scopeInstanceName) {
            localScopeVariables.push(identifier);
          }
          _captureDependencyWithScope(scopeInstanceName, identifier, instanceAndfunctionDependencies, node, level);

          _walkAndBuildDependency(scopeInstanceName, child.children[2], requiredModuleDependencies, instanceAndfunctionDependencies, level, localScopeVariables);
          break;
        case 'rest_pattern':
          _walkAndBuildDependency(scopeInstanceName, child.children[1], requiredModuleDependencies, instanceAndfunctionDependencies, level, localScopeVariables);
          break;
        case 'identifier':
          identifier = child.text;
          break;
        default:
          break;
      }
    }
  }
}

function _objectPatternHandler(scopeInstanceName, node, requiredModuleDependencies, instanceAndfunctionDependencies, level, localScopeVariables) {
  // Must return the identifiers for object so that it can be marked $public in case it's exported
  const identifiers = [];

  if (requiredModuleDependencies[scopeInstanceName] || level === 0 || instanceAndfunctionDependencies.$name === 'default') {
    // Possible cases:
    // 1. Simple object declaration, such as { name1, name2 } to pass to function
    // 2. Top level object pattern is considered as dependency
    // Object Pattern, such as:
    // const { fieldA, fieldB: aliasB } = topModule;
    // export const { name3, name3bar: bar } = o;
    // export const [, , ...{ pop, push }] = array1;

    // Object, such as:
    // export default { ... }
    for (const child of node.children) {
      if (OPERATORS_OR_KEYWORDS.includes(child.type)) {
        continue;
      }

      let identifier;
      if (child.type === 'shorthand_property_identifier' || child.type === 'shorthand_property_identifier_pattern') {
        identifier = child.text;

        const dependency = _captureDependency(instanceAndfunctionDependencies, identifier);
        dependency.$usage = '$property';
      } else if (child.type === 'pair_pattern') {
        // On the left side of object pattern, such as:
        // { name3 = '', name3bar: bar } = xxx;
        if (child.children[2].type === 'assignment_pattern') {
          identifier = child.children[2].children[0].text;
        } else {
          identifier = child.children[2].text;
        }

        const dependency = _captureDependency(instanceAndfunctionDependencies, identifier);
        dependency.$usage = '$property';

        if (child.children[0].type !== identifier) {
          dependency.$sourceProperty = child.children[0].text;
        }
      } else if (child.type === 'method_definition') {
        // { method1() {} }
        _walkAndBuildDependency(scopeInstanceName, child, requiredModuleDependencies, instanceAndfunctionDependencies, level, localScopeVariables);
      } else if (child.type === 'pair') {
        // Simple object declaration or on the right side of statement as object:
        // { xxx: ... }
        identifier = _oneChildrenOfType(child, 'property_identifier') || _oneChildrenOfType(child, 'private_property_identifier') || child.children[0];
        identifier = identifier.text;
        if (instanceAndfunctionDependencies.$type === 'array') {
          identifier = `[${instanceAndfunctionDependencies.$index}]${identifier}`;
        }
        if (scopeInstanceName) {
          // The object is declared inside a function, its name should have the function name as prefix
          identifier = scopeInstanceName + '#' + identifier;
        }
        const dependency = _captureDependency(instanceAndfunctionDependencies, identifier, child);
        _setDependencyTypeBasedOnNodeType(dependency, child.children[2]);

        // Capture dependency in advance and so no need return the identifier
        if (['arrow_function', 'function_expression'].includes(child.children[2].type)) {
          _walkAndBuildDependency(identifier, child.children[2], requiredModuleDependencies, dependency, level, localScopeVariables);
          dependency.$sourceCode = child.children[2].text;
        } else {
          _walkAndBuildDependency(scopeInstanceName, child.children[2], requiredModuleDependencies, instanceAndfunctionDependencies, level, localScopeVariables);
        }
      }

      if (identifier) {
        identifiers.push(identifier);
      }
    }
  }

  return identifiers;
}

function _ignoreHandler() {
  // Ignore comment
}

const NODE_TYPE_HANDLERS = {
  program: _programHandler,
  import_statement: _importStatementHandler,
  lexical_declaration: _lexicalDeclarationHandler,
  variable_declaration: _lexicalDeclarationHandler,
  function_declaration: _functionNodeHander,
  function_expression: _functionNodeHander,
  arrow_function: _functionNodeHander,
  statement_block: _generalExpressionHandler,
  member_expression: _memberExpressionHandler,
  new_expression: _newExpressionHandler,
  call_expression: _callExpressionHandler,
  identifier: _identifierHandler,
  property_identifier: _identifierHandler,
  private_property_identifier: _identifierHandler,
  shorthand_property_identifier: _identifierHandler,
  arguments: _generalExpressionHandler,
  array: _arrayHandler,
  return_statement: _generalExpressionHandler,
  update_expression: _generalExpressionHandler,
  await_expression: _generalExpressionHandler,
  binary_expression: _generalExpressionHandler,
  expression_statement: _generalExpressionHandler,
  ternary_expression: _generalExpressionHandler,
  unary_expression: _generalExpressionHandler,
  for_statement: _forStatementHandler,
  for_in_statement: _forInStatementHandler,
  update_statement: _generalExpressionHandler,
  if_statement: _generalExpressionHandler,
  else_clause: _generalExpressionHandler,
  while_statement: _generalExpressionHandler,
  try_statement: _generalExpressionHandler,
  catch_clause: _catchClauseHandler,
  'finally': _generalExpressionHandler,
  finally_clause: _generalExpressionHandler,
  throw_statement: _generalExpressionHandler,
  spread_element: _generalExpressionHandler,
  parenthesized_expression: _generalExpressionHandler,
  object: _objectPatternHandler,
  pair: _objectPairHandler,
  export_statement: _exportStatementHandler,
  decorator: _generalExpressionHandler,
  class: _classDeclarationHandler,
  class_declaration: _classDeclarationHandler,
  method_definition: _functionNodeHander,
  generator_function_declaration: _functionNodeHander,
  field_definition: _generalExpressionHandler,
  class_static_block: _generalExpressionHandler,
  assignment_expression: _assignmentExpressionHandler,
  subscript_expression: _generalExpressionHandler,
  augmented_assignment_expression: _generalExpressionHandler,
  yield_expression: _generalExpressionHandler,
  regex: _identifierHandler,
  this: _identifierHandler,
  super: _identifierHandler,
  string: _identifierHandler, // template_string and string literal is captured as identifier because it's sometimes used as important dependency, such as URL path
  template_string: _identifierHandler,
  export_clause: _exportClauseHandler,
  object_pattern: _objectPatternHandler,
  array_pattern: _arrayPatternHandler,
  comment: _ignoreHandler
};

function _captureDependency(instanceAndfunctionDependencies, instanceName, node) {
  if (!instanceName) {
    return instanceAndfunctionDependencies;
  }
  instanceAndfunctionDependencies[instanceName] = instanceAndfunctionDependencies[instanceName] || { $name: instanceName };
  if (node) {
    instanceAndfunctionDependencies[instanceName].$usage = node.text;
  }
  return instanceAndfunctionDependencies[instanceName];
}

function _walkAndBuildDependency(scopeInstanceName, node, requiredModuleDependencies = {}, instanceAndfunctionDependencies = {}, level = 0, localScopeVariables = ['constructor', 'console']) {
  if (!node) {
    return [];
  }

  // console.log(`scope in ${scopeInstanceName} - ${node.type} ` + node.text + ' children: ', node.children);

  let dependentIdentifer = '';
  const handler = NODE_TYPE_HANDLERS[node.type];
  if (handler) {
    dependentIdentifer = handler(scopeInstanceName, node, requiredModuleDependencies, instanceAndfunctionDependencies, level, localScopeVariables) || '';
  } else if (!OPERATORS_OR_KEYWORDS.includes(node.type)) {
    console.warn('====== Unhandled node type: ', node.type, node.text);
  }

  if (!dependentIdentifer) {
    return [];
  }

  return [].concat(dependentIdentifer);
}

function _captureDependencyWithScope(scopeInstanceName, dependentIdentifer, instanceAndfunctionDependencies, node, level) {
  if (_.isEmpty(dependentIdentifer)) {
    return instanceAndfunctionDependencies;
  }

  if (_.isArray(dependentIdentifer)) {
    dependentIdentifer.map(identifier => _captureDependencyWithScope(scopeInstanceName, identifier, instanceAndfunctionDependencies, node, level));
    return instanceAndfunctionDependencies;
  }

  let dependency;
  let $public;
  if (scopeInstanceName && instanceAndfunctionDependencies.$name !== scopeInstanceName) {
    dependency = _captureDependency(instanceAndfunctionDependencies, scopeInstanceName);
    $public = dependency.$public
  } else {
    dependency = instanceAndfunctionDependencies;
  }

  dependency[dependentIdentifer] = dependency[dependentIdentifer] || { $name: dependentIdentifer, $usage: node.text, $public };
  if (['string', 'template_string'].includes(node.type)) {
    delete dependency[dependentIdentifer];
    dependency.$usage = 'string';
    dependency.$value = dependentIdentifer; // string value here;
  } else if (node.type === 'array') {
    // Child dependency of array might possibly need this info and add index as part of identifier
    dependency[dependentIdentifer].$type = 'array';
  } else if (['call_expression'].includes(node.type) && !_.endsWith(dependency[dependentIdentifer].$usage, ')')) {
    dependency[dependentIdentifer].$usage = `${dependency[dependentIdentifer].$usage}()`;
    dependency[dependentIdentifer].$type = 'method';
  }

  return dependency;
}

function _getDependencyNames(node) {
  return _.filter(Object.keys(node), key => key.indexOf('$') !== 0);
}

function _nodeType(node) {
  if (node.$type) {
    return node.$type;
  }
  return (node.$usage || '').indexOf('(') > 0 ? 'method' : 'field';
}

const COMMON_JS_TYPES = ['String', 'Number', 'Boolean', 'Date', 'Object', 'Array', 'Map', 'Set', 'Error',
  'console', 'Promise', 'JSON', 'Math', 'WeakMap', 'WeakSet', 'Symbol', 'Function', 'RegExp', 'EvalError'
];

function _isCommonDependency(dependencyName) {
  return _.some(COMMON_JS_TYPES, type => {
    return type === dependencyName || dependencyName.startsWith(type + '.');
  })
}

function _convertDependencyStructure(node, requiredModuleDependencies, instanceAndfunctionDependencies, level) {
  if (!node.$name || _isCommonDependency(node.$name)) {
    return;
  }

  let module = node.$module || 'this';
  let externalSource;

  const usage = node.$usage || node.$type || '';
  let dependencyName = (node.$name || '');
  const topLevelName = dependencyName.indexOf('.') > 0 ? dependencyName.split('.')[0] : dependencyName;
  if (topLevelName === 'this') {
    dependencyName = dependencyName.replace('this.', '');
    module = 'this';
  }

  let externalModuleDependency = requiredModuleDependencies[topLevelName] || requiredModuleDependencies[module];

  const dependency = {
    module,
    instanceName: dependencyName,
    type: _nodeType(node),
    public: node.$public,
    usage,
    sourceCode: node.$sourceCode,
    externalSource,
    dependencies: []
  };

  if (usage === 'string') {
    // String literal
    dependency.module = 'string';
    const parts = dependency.instanceName.match(/\[(\d+)\](\w+)/);
    if (parts) {
      dependency.instanceName = `${parts[2]}: ${node.$value}`;
      dependency.$index = parts[1];
    } else if (node.$name !== node.$value) {
      dependency.instanceName = `${node.$name}: ${node.$value}`;
    } else {
      dependency.instanceName = node.$value;
    }
  } else if (usage === '$assignment' && dependency.module !== '$file' && externalModuleDependency) {
    // Real property field from other module is assigned to this module
    dependency.module = externalModuleDependency.source;
    dependency.externalSource = externalModuleDependency;
    dependency.public = true;
  } else if (externalModuleDependency) {
    // External Module Dependency
    dependency.externalSource = externalModuleDependency;
    dependency.module = externalModuleDependency.source;
    dependency.public = true;

    if (usage === '$property') {
      dependency.instanceName = dependency.$sourceProperty || dependency.instanceName;
    } else if (dependency.instanceName.indexOf('.') > 0) {
      dependency.instanceName = dependencyName.replace(`${topLevelName}.`, '');
    } else if (externalModuleDependency.isDefault || externalModuleDependency.isNamespace) {
      dependency.instanceName = 'default';
      // TODO: Handle various situation, including default export and namespace export
      // 1. Directly reference to module.  Should use external module name (or 'default'?) as instanceName instead of alias in file
      // 2. External module is not default export, then it's a field of the module, keep it as it is
    }
  } else if (dependencyName !== topLevelName && instanceAndfunctionDependencies[topLevelName]) {
    // Internal reference to xxx.yyy.  xxx can be either exported or not
    const topLevelModule = instanceAndfunctionDependencies[topLevelName];

    if (topLevelModule.$constructor) {
      dependency.instanceName = dependencyName.replace(`${topLevelName}.`, `${topLevelModule.$constructor}.`);
    }
  }

  return dependency;
}

function _collectInnerDependencies(node, requiredModuleDependencies, instanceAndfunctionDependencies, level = 0) {
  let dependencies = [];
  if (!node) {
    return dependencies;
  }

  const dependency = _convertDependencyStructure(node, requiredModuleDependencies, instanceAndfunctionDependencies, level);
  if (dependency) {
    dependencies.push(dependency);
  }

  // Special properties like $name, $type, $public are not dependencies
  const scopeForChildren = _.merge({}, instanceAndfunctionDependencies, node);
  const dependencyNames = _getDependencyNames(node);
  let childDependencies = [];
  for (let dependencyName of dependencyNames) {
    childDependencies.push(..._collectInnerDependencies(node[dependencyName], requiredModuleDependencies, scopeForChildren, level));
  }

  if (node.$type === 'array' && _.every(childDependencies, child => child.usage === 'string')) {
    // Group child dependencies of same index if the child is simple string
    const grouped = _.groupBy(childDependencies, '$index');
    childDependencies = _.map(grouped, (value, index) => {
      const innerDependency = value[0];
      innerDependency.instanceName = _.map(value, 'instanceName').join(', ');
      innerDependency.module = 'string';
      return innerDependency;
    });
  }

  (dependency ? dependency.dependencies : dependencies).push(...childDependencies);

  return dependencies;
}

class AstParser {
  constructor() {
    this.parser = new Parser();
    this.parser.setLanguage(JavaScript);
  }

  parse(code) {
    return this.parser.parse(code);
  }

  extractFunctionSignature(code = '') {
    const functionRegex = /function\s+(\w+)\s*\(/;

    // For arrow functions or methods in object literals
    const arrowOrMethodRegex = /(?:const|let|var)?\s*(\w+)\s*[=:]\s*(?:function|\([^)]*\)\s*=>)/;

    let match = code.match(functionRegex) || code.match(arrowOrMethodRegex);

    if (match && match[1]) {
      return match[1];
    }

    return null; // Return null if no function name is found
  }

  async initializeLSP() {
  }

// moduleDependencyMap format:
//  {
//    [identifier]: { [source], isDefault: true/false, sourceProperty: [sourceProperty] },
//    "_": { "isDefault": true, "source": "lodash" },
//    "aliasTwo": { "source": "../util/special", "sourceProperty": "specialTwo" }
//  }

  // Function Dependency format:
  // {
  //   "dependencies": [
  //     {
  //       "module": "edgeService",
  //       "instanceName": "getEdge",
  //       "usage": "edgeService.getEdge(from, to)",
  //       "externalSource": { "source": "" }
  //     },
  //     {
  //       "module": "organizationModel",
  //       "instanceName": "localName"
  //     }
  //   ]
  // }
  getDependencies(sourceFile, rawContent) {
    try {
      const tree = this.parser.parse(rawContent);
      const rootNode = tree.rootNode;
      const requiredModuleDependencies = {};
      const instanceAndfunctionDependencies = {};

      _walkAndBuildDependency('', rootNode, requiredModuleDependencies, instanceAndfunctionDependencies);
      fs.writeFileSync('./externalModules.js.json', JSON.stringify(requiredModuleDependencies, null, 2));
      fs.writeFileSync('./ast.js.json', JSON.stringify(instanceAndfunctionDependencies, null, 2));

      // Resolve real dependency name based on requiredModuleDependencies
      const massagedResult = { dependencies: [] };

      _.each(instanceAndfunctionDependencies, (value, key) => {
        value.$module = value.$module || '$file';
      });

      massagedResult.dependencies.push(..._collectInnerDependencies(instanceAndfunctionDependencies, requiredModuleDependencies, instanceAndfunctionDependencies));
      fs.writeFileSync('./dependencies.js.json', JSON.stringify(massagedResult, null, 2));
      return { requiredModuleDependencies, instanceAndfunctionDependencies: massagedResult };
    } catch (error) {
      console.error(`Error parsing code: \n${rawContent}`, error);
      throw error;
    }
  }
}

export {
  AstParser
}
