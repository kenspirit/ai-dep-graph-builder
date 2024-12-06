import _ from 'lodash';
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
        return source.children[1].text;
      }
    } else {
      return _getRequireSource(node.children[0]);
    }
  }
}

function _requireCallExpressionHandler(assignmentVariable, node, requiredModuleDependencies, scopeInstanceName, localScopeVariables) {
  if (!node) {
    if (scopeInstanceName) {
      localScopeVariables.push(assignmentVariable);
    }
    return false;
  }

  const sourceName = _getRequireSource(node);

  if (typeof assignmentVariable === 'string') {
    if (sourceName) {
      requiredModuleDependencies[assignmentVariable] = { source: sourceName, isDefault: true };
    }
    if (scopeInstanceName && !sourceName) {
      localScopeVariables.push(assignmentVariable);
    }
  } else if (assignmentVariable.type === 'object_pattern') {
    // Destructuring assignment
    // const { export1, export2: alias2 } = require('module-name');
    for (const child of assignmentVariable.children) {
      if (OPERATORS_OR_KEYWORDS.includes(child.type)) {
        continue;
      }

      let assignmentIdentifier;
      if (child.type === 'shorthand_property_identifier_pattern') {
        assignmentIdentifier = child.text;
      } else if (child.type === 'pair_pattern') {
        assignmentIdentifier = child.children[2].text;
      }

      if (sourceName) {
        requiredModuleDependencies[assignmentIdentifier] = { source: sourceName };
        if (child.type === 'pair_pattern') {
          requiredModuleDependencies[assignmentIdentifier].sourceProperty = child.children[0].text;
        }
      }
      if (scopeInstanceName && !sourceName) {
        localScopeVariables.push(assignmentIdentifier);
      }
    }
  }

  return !!sourceName;
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
      requiredModuleDependencies[source] = { source, sideEffect: true };
    }
  }
}

function _lexicalDeclarationHandler(scopeInstanceName, node, requiredModuleDependencies, instanceAndfunctionDependencies, level, localScopeVariables) {
  const declarator = _oneDescendantOfType(node, 'variable_declarator');
  if (declarator) {
    const objPattern = _oneChildrenOfType(declarator, 'object_pattern');
    if (objPattern) {
      // Destructuring assignment, such as:
      // const {Query, Parser} = binding;
      const isRequire = _requireCallExpressionHandler(objPattern, declarator.children[2], requiredModuleDependencies, scopeInstanceName, localScopeVariables);
      if (isRequire) {
        return;
      }

      const assignmentIdentifier = _walkAndBuildDependency(scopeInstanceName, declarator.children[2], requiredModuleDependencies, instanceAndfunctionDependencies, level, localScopeVariables);

      _walkAndBuildDependency(assignmentIdentifier, objPattern, requiredModuleDependencies, instanceAndfunctionDependencies, level, localScopeVariables);
    } else {
      let identifier = _oneChildrenOfType(declarator, 'identifier');
      if (identifier) {
        identifier = identifier.text;

        const isRequire = _requireCallExpressionHandler(identifier, declarator.children[2], requiredModuleDependencies, scopeInstanceName, localScopeVariables);
        if (isRequire) {
          return;
        }

        _walkAndBuildDependency(scopeInstanceName || identifier, declarator.children[2], requiredModuleDependencies, instanceAndfunctionDependencies, level, localScopeVariables);
      }

      return identifier;
    }
  }
}

function _functionNodeHander(scopeInstanceName, node, requiredModuleDependencies, instanceAndfunctionDependencies, level, localScopeVariables) {
  // Local arguments that are not required to put in dependencies
  // Function or Method
  let identifier = _oneChildrenOfType(node, 'identifier') ||
    _oneChildrenOfType(node, 'property_identifier') ||
    _oneChildrenOfType(node, 'private_property_identifier');
  if (identifier) {
    identifier = identifier.text;
  } else {
    identifier = '';
  }

  // Local arguments that are not required to put in dependencies
  const funArgs = _oneChildrenOfType(node, 'formal_parameters');
  const funArgIdentifiers = funArgs.descendantsOfType('identifier').map(arg => arg.text);

  if (identifier) {
    // Anonymous function is annoyed
    const dependency = _captureDependency(instanceAndfunctionDependencies, identifier);
    dependency.$sourceCode = node.text;
    dependency.$type = 'method';
  }

  _walkAndBuildDependency(scopeInstanceName || identifier, _oneChildrenOfType(node, 'statement_block'), requiredModuleDependencies, instanceAndfunctionDependencies, level, funArgIdentifiers.concat(localScopeVariables));

  return identifier;
}

function _memberExpressionHandler(scopeInstanceName, node, requiredModuleDependencies, instanceAndfunctionDependencies, level, localScopeVariables) {
  const dependentIdentifer = _walkAndBuildDependency(scopeInstanceName, node.children[0], requiredModuleDependencies, instanceAndfunctionDependencies, level + 1, localScopeVariables) +
    '.' +
    _walkAndBuildDependency(scopeInstanceName, node.children[2], requiredModuleDependencies, instanceAndfunctionDependencies, level + 1, localScopeVariables);

  return dependentIdentifer;
}

function _newExpressionHandler(scopeInstanceName, node, requiredModuleDependencies, instanceAndfunctionDependencies, level, localScopeVariables) {
  const dependentIdentifer = _walkAndBuildDependency(scopeInstanceName, node.children[1], requiredModuleDependencies, instanceAndfunctionDependencies, level + 1, localScopeVariables);

  // Handle arguments
  _walkAndBuildDependency(scopeInstanceName || dependentIdentifer, node.children[2], requiredModuleDependencies, instanceAndfunctionDependencies, level, localScopeVariables);

  return dependentIdentifer;
}

function _callExpressionHandler(scopeInstanceName, node, requiredModuleDependencies, instanceAndfunctionDependencies, level, localScopeVariables) {
  const dependentIdentifer = _walkAndBuildDependency(scopeInstanceName, node.children[0], requiredModuleDependencies, instanceAndfunctionDependencies, level + 1, localScopeVariables);

  // Handle arguments
  _walkAndBuildDependency(scopeInstanceName || dependentIdentifer, node.children[1], requiredModuleDependencies, instanceAndfunctionDependencies, level, localScopeVariables);

  return dependentIdentifer;
}

function _identifierHandler(scopeInstanceName, node, requiredModuleDependencies, instanceAndfunctionDependencies, level, localScopeVariables) {
  return node.text;
}

const OPERATORS_OR_KEYWORDS = ['{', '}', ',', ';', '@', 'export', 'return', 'await', '\'', '"', '+', '-', '?', ':', '(', ')', '>', '<', '>=', '<=', '==', '===', '!=', '!==', '&&', '||', '!',];

function _assignmentExpressionHandler(scopeInstanceName, node, requiredModuleDependencies, instanceAndfunctionDependencies, level, localScopeVariables) {
  const children = node.children;
  if (children[0].type === 'member_expression' && children[0].text.indexOf('module.exports') === 0) {
    // module.exports = Parser;
    // module.exports.Query = Query;
    const assignmentIdentifier = _walkAndBuildDependency('', children[2], requiredModuleDependencies, instanceAndfunctionDependencies, level, localScopeVariables);

    if (children[0].text === 'module.exports') {
      const dependency = _captureDependency(instanceAndfunctionDependencies, assignmentIdentifier);
      dependency.$public = true;
    } else {
      const exportedFieldIdentifier = children[0].text.replace('module.exports.', '');

      const dependency = _captureDependency(instanceAndfunctionDependencies, exportedFieldIdentifier);
      if (exportedFieldIdentifier !== assignmentIdentifier) {
        // module.exports.Query = DifferentName;
        dependency[assignmentIdentifier] = { $name: assignmentIdentifier, $usage: '$assignment' };
      }
      dependency.$public = true;
    }

    return;
  }

  _generalExpressionHandler(scopeInstanceName, node, requiredModuleDependencies, instanceAndfunctionDependencies, level, localScopeVariables);
}

function _generalExpressionHandler(scopeInstanceName, node, requiredModuleDependencies, instanceAndfunctionDependencies, level, localScopeVariables) {
  if (node.type === 'subscript_expression' && node.text.indexOf('(') === -1) {
    // If not a function call, then it's possible a member accessment like: xxx.yyy.zzz[0]
    return node.text;
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

  _walkAndBuildDependency(identifier, node.children[2], requiredModuleDependencies, instanceAndfunctionDependencies, level, localScopeVariables);
}

function _classDeclarationHandler(scopeInstanceName, node, requiredModuleDependencies, instanceAndfunctionDependencies, level, localScopeVariables) {
  const className = _oneChildrenOfType(node, 'identifier').text;
  const heritage = _oneChildrenOfType(node, 'class_heritage');

  // Class in JS file is a top level object
  const dependency = _captureDependency(instanceAndfunctionDependencies, className);
  dependency.$type = 'class';

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

function _exportClauseHandler(scopeInstanceName, node, requiredModuleDependencies, instanceAndfunctionDependencies, level, localScopeVariables) {
  const exportSpecifiers = _allChildrenOfType(node, 'export_specifier');
  for (const exportSpecifier of exportSpecifiers) {
    const identifier = exportSpecifier.children[0].text;
    if (instanceAndfunctionDependencies[identifier]) {
      instanceAndfunctionDependencies[identifier].$public = true;
    }
  }
}

function _objectPatternHandler(scopeInstanceName, node, requiredModuleDependencies, instanceAndfunctionDependencies, level, localScopeVariables) {
  if (requiredModuleDependencies[scopeInstanceName] || level === 0) {
    // Only top level object pattern is considered as dependency
    // const { fieldA, fieldB: aliasB } = topModule;
    for (const child of node.children) {
      if (OPERATORS_OR_KEYWORDS.includes(child.type)) {
        continue;
      }

      let identifier;
      if (child.type === 'shorthand_property_identifier_pattern') {
        identifier = child.text;
        if (localScopeVariables.includes(identifier)) {
          continue;
        }
        const dependency = _captureDependency(instanceAndfunctionDependencies, identifier);
        dependency[scopeInstanceName] = { $name: scopeInstanceName, $usage: '$property' };
      } else if (child.type === 'pair_pattern') {
        if (child.children[2].type === 'assignment_pattern') {
          identifier = child.children[2].children[0].text;
        } else {
          identifier = child.children[2].text;
        }
        if (localScopeVariables.includes(identifier)) {
          continue;
        }
        const dependency = _captureDependency(instanceAndfunctionDependencies, identifier);
        dependency[scopeInstanceName] = { $name: scopeInstanceName, $usage: '$property', $sourceProperty: child.children[0].text };
      }
    }
  }
}

const NODE_TYPE_HANDLERS = {
  program: _programHandler,
  import_statement: _importStatementHandler,
  lexical_declaration: _lexicalDeclarationHandler,
  variable_declaration: _lexicalDeclarationHandler,
  function_declaration: _functionNodeHander,
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
  array: _generalExpressionHandler,
  return_statement: _generalExpressionHandler,
  await_expression: _generalExpressionHandler,
  binary_expression: _generalExpressionHandler,
  expression_statement: _generalExpressionHandler,
  ternary_expression: _generalExpressionHandler,
  unary_expression: _generalExpressionHandler,
  for_statement: _generalExpressionHandler,
  update_statement: _generalExpressionHandler,
  if_statement: _generalExpressionHandler,
  while_statement: _generalExpressionHandler,
  try_statement: _generalExpressionHandler,
  throw_statement: _generalExpressionHandler,
  spread_element: _generalExpressionHandler,
  parenthesized_expression: _generalExpressionHandler,
  object: _generalExpressionHandler,
  pair: _objectPairHandler,
  export_statement: _generalExpressionHandler,
  decorator: _generalExpressionHandler,
  class_declaration: _classDeclarationHandler,
  method_definition: _functionNodeHander,
  field_definition: _generalExpressionHandler,
  class_static_block: _generalExpressionHandler,
  assignment_expression: _assignmentExpressionHandler,
  subscript_expression: _generalExpressionHandler,
  yield_expression: _generalExpressionHandler,
  this: _identifierHandler,
  super: _identifierHandler,
  export_clause: _exportClauseHandler,
  object_pattern: _objectPatternHandler,
  string: _identifierHandler,
  number: _identifierHandler
};

function _captureDependency(instanceAndfunctionDependencies, instanceName) {
  instanceAndfunctionDependencies[instanceName] = instanceAndfunctionDependencies[instanceName] || { $name: instanceName };
  return instanceAndfunctionDependencies[instanceName];
}

function _walkAndBuildDependency(scopeInstanceName, node, requiredModuleDependencies = {}, instanceAndfunctionDependencies = {}, level = 0, localScopeVariables = ['constructor', 'console']) {
  if (!node) {
    return;
  }

  // console.log(`scope in ${scopeInstanceName} - ${node.type} ` + node.text + ' children: ', node.children);

  let dependentIdentifer = '';
  const handler = NODE_TYPE_HANDLERS[node.type];
  if (handler) {
    dependentIdentifer = handler(scopeInstanceName, node, requiredModuleDependencies, instanceAndfunctionDependencies, level, localScopeVariables) || '';
  } else if (OPERATORS_OR_KEYWORDS.includes(node.type)) {
    console.warn('====== Unhandled node type: ', node.type, node.text);
  }

  const topLevelName = dependentIdentifer.indexOf('.') > 0 ? dependentIdentifer.split('.')[0] : dependentIdentifer;
  if (scopeInstanceName && level === 0 && dependentIdentifer && !localScopeVariables.includes(topLevelName)) {
    const dependency = _captureDependency(instanceAndfunctionDependencies, scopeInstanceName);
    dependency[dependentIdentifer] = { $name: dependentIdentifer, $usage: node.text };
    if (node.type === 'new_expression') {
      dependency[dependentIdentifer].$type = 'constructor';
    }
  }

  return dependentIdentifer;
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

function _setExternalDependency(dependency, externalModuleDependency) {
  if (externalModuleDependency.isDefault) {
    dependency.module = externalModuleDependency.source;
  } else if (dependency.externalSource.isNamespace) {
    dependency.instanceName = dependency.instanceName.replace(`${dependency.module}.`, '');
    dependency.module = dependency.externalSource.source;
  } else {
    dependency.module = externalModuleDependency.source;
    dependency.instanceName = externalModuleDependency.sourceProperty;
  }
}

function _collectInnerDependencies(node, requiredModuleDependencies, instanceAndfunctionDependencies, level = 0) {
  // Special properties like $name, $type, $public are not dependencies
  if (!node) {
    return [];
  }

  const dependencyNames = _getDependencyNames(node);

  if (dependencyNames.length === 0 && !_.isEmpty(node)) {
    // No dependencies, but still need to capture the instance itself
    const dependencyName = (node.$name || '');
    const topLevelName = dependencyName.indexOf('.') > 0 ? dependencyName.split('.')[0] : dependencyName;

    let module;
    let instanceName = dependencyName;
    let externalSource;
    const dependency = {
      module,
      instanceName,
      type: _nodeType(node),
      public: node.$public,
      usage: node.$usage,
      sourceCode: node.$sourceCode,
      externalSource
    };

    if (dependencyName !== topLevelName) {
      dependency.module = topLevelName;
      dependency.instanceName = dependencyName.replace(`${topLevelName}.`, '');

      if (instanceAndfunctionDependencies[topLevelName]) {
        dependency.module = 'this';
        dependency.instanceName = dependencyName;

        const fieldConstructor = _.find(instanceAndfunctionDependencies[topLevelName], (value, key) => value.$type === 'constructor');
        if (fieldConstructor) {
          // Needs to add dependency to original module
          const module = fieldConstructor.$name;
          const cloned = _.clone(dependency);
          cloned.module = module;
          cloned.instanceName = dependencyName.replace(`${topLevelName}.`, `${module}.`);
          if (requiredModuleDependencies[module]) {
            cloned.module = requiredModuleDependencies[module].source;
            cloned.externalSource = requiredModuleDependencies[module];
          }

          dependency.dependencies = [cloned];
        }
      }
      if (requiredModuleDependencies[dependency.module]) {
        dependency.externalSource = requiredModuleDependencies[dependency.module];
        if (dependency.externalSource.isDefault) {
          dependency.module = 'default';
        } else if (dependency.externalSource.isNamespace) {
          dependency.module = dependency.externalSource.source;
          dependency.instanceName = dependencyName.replace(`${topLevelName}.`, '');
        }
      }
    } else if (topLevelName === 'this') {
      dependency.module = 'this';
      dependency.instanceName = dependencyName.replace('this.', '');
    } else if (instanceAndfunctionDependencies[topLevelName] && instanceAndfunctionDependencies[topLevelName].$module) {
      dependency.module = instanceAndfunctionDependencies[topLevelName].$module;
      dependency.instanceName = dependencyName.replace(`${topLevelName}.`, '');
    } else if (node.$type === 'constructor') {
      dependency.module = dependencyName;
    } else {
      dependency.module = 'this';
    }

    return [dependency];
  }

  const dependencies = [];
  for (let dependencyName of dependencyNames) {
    const inspectedDependency = node[dependencyName];
    const topLevelName = dependencyName.indexOf('.') > 0 ? dependencyName.split('.')[0] : dependencyName;
    if (topLevelName === 'this') {
      dependencyName = dependencyName.replace('this.', '');
    }

    const usage = inspectedDependency.$usage;
    const externalModuleDependency = requiredModuleDependencies[topLevelName];
    let dependency;

    if (externalModuleDependency && dependencyName !== 'constructor') {
      // External Module Dependency
      const source = externalModuleDependency.source;

      if (usage === '$property') {
        dependency = {
          module: source,
          instanceName: inspectedDependency.$sourceProperty || node.$name,
          usage,
          externalSource: externalModuleDependency,
          public: node.$public
        }
      } else if (externalModuleDependency.isDefault) {
        // Top level reference is default export
        dependency = {
          module: source,
          instanceName: dependencyName.replace(`${topLevelName}.`, ''),
          usage,
          externalSource: externalModuleDependency,
          public: node.$public,
          type: _nodeType(inspectedDependency)
        }
      } else {
        let instanceName = dependencyName;
        if (externalModuleDependency.isNamespace) {
          instanceName = dependencyName.replace(`${topLevelName}.`, '');
        } else if (externalModuleDependency.sourceProperty) {
          instanceName = dependencyName.replace(`${topLevelName}.`, `${externalModuleDependency.sourceProperty}.`);
        }
        dependency = {
          module: source,
          instanceName,
          usage,
          externalSource: externalModuleDependency,
          public: node.$public,
          type: _nodeType(inspectedDependency)
        }
      }

      dependencies.push(dependency);
    } else if (usage === '$assignment') {
      // Assignment which requires to check instanceAndfunctionDependencies to get real dependency
      // module.exports.ExportedQuery = Query;
      const dependentInstance = instanceAndfunctionDependencies[dependencyName];
      dependencies.push(..._collectInnerDependencies(dependentInstance, requiredModuleDependencies, instanceAndfunctionDependencies, level + 1));
    } else {
      let innerDependencyNames = [];
      let innerDependencies;

      innerDependencyNames = _getDependencyNames(inspectedDependency);
      if (inspectedDependency.$type === 'class') {
        innerDependencies = _collectInnerDependencies(inspectedDependency, requiredModuleDependencies, _.merge({}, instanceAndfunctionDependencies, inspectedDependency), level + 1);
      } else {
        innerDependencies = _collectInnerDependencies(inspectedDependency, requiredModuleDependencies, instanceAndfunctionDependencies, level + 1);
      }

      if (innerDependencyNames.length > 0) {
        dependency = {
          instanceName: inspectedDependency.$name,
          type: _nodeType(inspectedDependency),
          public: inspectedDependency.$public,
          module: inspectedDependency.$module || 'this',
          usage,
          sourceCode: inspectedDependency.$sourceCode,
          dependencies: innerDependencies
        }
        dependencies.push(dependency);
      } else {
        dependencies.push(...innerDependencies);
      }
    }
  }

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

  async getFunctionDependencies(functionCode) {
    
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
  getDependencies(code) {
    try {
      const tree = this.parser.parse(code);
      const rootNode = tree.rootNode;
      const requiredModuleDependencies = {};
      const instanceAndfunctionDependencies = {};

      _walkAndBuildDependency('', rootNode, requiredModuleDependencies, instanceAndfunctionDependencies);

      // instanceAndfunctionDependencies is flatten dependencies for each method/field in file, no matter public or private
      // Massage data into hierarchical structure
      const massagedResult = { dependencies: [] };

      _.each(instanceAndfunctionDependencies, (value, key) => {
        value.$module = '$file';
      });

      massagedResult.dependencies.push(..._collectInnerDependencies(instanceAndfunctionDependencies, requiredModuleDependencies, instanceAndfunctionDependencies));

      return { requiredModuleDependencies, instanceAndfunctionDependencies: massagedResult };
    } catch (error) {
      console.error(`Error parsing code: \n${code}`, error);
      throw error;
    }
  }
}

export {
  AstParser
}
