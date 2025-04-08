import _ from 'lodash';
import path from 'path';
import Parser from 'tree-sitter';
import Java from 'tree-sitter-java';
import fs from 'fs';
import { initializeServer, hover } from '../lsp-client.js';

let filePath;

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

async function _programHandler(scopeInstanceName, node, requiredModuleDependencies, instanceAndfunctionDependencies, level, localScopeVariables) {
  const sectionNodes = node.children;
  for (let i = 0; i < sectionNodes.length; i++) {
    await _walkAndBuildDependency('', sectionNodes[i], requiredModuleDependencies, instanceAndfunctionDependencies, level, localScopeVariables);
  }
}

async function _generalExpressionHandler(scopeInstanceName, node, requiredModuleDependencies, instanceAndfunctionDependencies, level, localScopeVariables) {
  const children = node.children;
  for (let child of children) {
    if (OPERATORS_OR_KEYWORDS.indexOf(child.type) !== -1) {
      // Skipping those `return`, `await`, ;, operators (e.g. >), etc
      continue;
    }

    await _walkAndBuildDependency(scopeInstanceName, child, requiredModuleDependencies, instanceAndfunctionDependencies, level, localScopeVariables);
  }
}

async function _lambdaHandler(scopeInstanceName, node, requiredModuleDependencies, instanceAndfunctionDependencies, level, localScopeVariables) {
  const children = node.children;
  for (let child of children) {
    if (OPERATORS_OR_KEYWORDS.indexOf(child.type) !== -1) {
      // Skipping those `return`, ;, operators (e.g. >), etc
      continue;
    }

    if (child.type === 'identifier') {
      try {
        const spec = await hover(`file:///${filePath}`, child.startPosition.row, child.startPosition.column);
        if (spec) {
          localScopeVariables[child.text] = _removeGenericFromType(spec.substring(0, spec.indexOf(' ')));
        }
      } catch (e) {
        console.error(`Failed to resolve type of parameter ${child.text} from LSP`, e);
      }
    } else {
      await _walkAndBuildDependency(scopeInstanceName, child, requiredModuleDependencies, instanceAndfunctionDependencies, level, localScopeVariables);
    }
  }
}

async function _functionNodeHander(scopeInstanceName, node, requiredModuleDependencies, instanceAndfunctionDependencies, level, localScopeVariables) {
  // Local arguments that are not required to put in dependencies
  // Function or Method
  let identifier = _oneChildrenOfType(node, 'identifier') ||
    _oneChildrenOfType(node, 'property_identifier') ||
    _oneChildrenOfType(node, 'private_property_identifier');
  if (identifier) {
    identifier = identifier.text;

    if (node.type === 'constructor_declaration') {
      identifier = scopeInstanceName;
    }
  } else {
    identifier = '';
  }

  // Local arguments that are not required to put in dependencies
  const argumentsNode = _oneChildrenOfType(node, 'formal_parameters');
  const argumentTypes = [];
  for (const child of argumentsNode.children) {
    if (child.type === 'formal_parameter') {
      // TODO: Handle modifiers
      const argType = _typeNodeHandler(child, requiredModuleDependencies);
      localScopeVariables[_oneChildrenOfType(child, 'identifier').text] = argType;
      argumentTypes.push(_getShortName(argType));
    }
  }

  let dependency;
  if (identifier) {
    // Anonymous function is ignored
    identifier = `${identifier}(${argumentTypes.join(',')})`;

    dependency = _captureDependency(instanceAndfunctionDependencies, identifier);
    dependency.$sourceCode = node.text;
    dependency.$type = node.type === 'constructor_declaration' ? 'constructor' : 'method';
    _setVisibility(dependency, node, scopeInstanceName);
  }

  const body = _oneChildrenOfType(node, 'block') || _oneChildrenOfType(node, 'constructor_body');
  await _walkAndBuildDependency(scopeInstanceName || identifier, body, requiredModuleDependencies, dependency || instanceAndfunctionDependencies, level, localScopeVariables);

  return identifier;
}

async function _getInvokeMethodSpecThroughLSP(node, lastMethodInvocation = false) {
  let hoverPosition = node.startPosition.column + node.text.indexOf('(') - 1;
  if (lastMethodInvocation) {
    // 1st index after the last dot
    hoverPosition = node.startPosition.column + node.children[0].text.length + 1;
  }

  try {
    const spec = await hover(`file:///${filePath}`, node.startPosition.row, hoverPosition);
    return spec;
  } catch (e) {
    console.error(e);
  }
}

const PRIMITIVE_TYPE_OBJECTS = ['Boolean', 'Byte', 'Character', 'Double', 'Float', 'Integer', 'Long', 'Short', 'String'];

async function _getInvokeMethodReturnType(node, lastMethodInvocation = false) {
  let spec = await _getInvokeMethodSpecThroughLSP(node, lastMethodInvocation);
  if (!spec) {
    if (PRIMITIVE_TYPE_OBJECTS.includes(node.children[0].text) && node.children[2].text === 'valueOf') {
      return node.children[0].text;
    } else if (node.children.length > 2 && node.children[2].text === 'toString') {
      // x.toString() is always String
      return 'String';
    } else if (node.children.length > 2 && node.children[2].text === 'equals') {
      // x.equals() is always Boolean
      return 'Boolean';
    }
    console.warn(`Failed to get return type for: ${node.text}`);
    return;
  }

  if (spec.startsWith('<')) {
    // signature can be something like this, and need to remove header `<Map<String, Object>> ` first
    // <Map<String, Object>> List<Map<String, Object>> a.b.c(String jsonString)
    spec = _removeLeadingGenericType(spec);
  }
  // `spec` is possibly in this format:
  // String varName - a.b.find(String)
  // String a.b.find(String)
  if (spec.indexOf(' ') > -1) {
    spec = spec.substring(0, spec.indexOf(' '));
  }

  return _removeGenericFromType(spec);
}

function _indexOfFirstCharAfterBracket(text) {
  let angleBracketCount = 0;
  let i = 0;

  // Iterate through the string to find the end of the leading generic type
  while (i < text.length) {
    if (text[i] === '<') {
      angleBracketCount++;
    } else if (text[i] === '>') {
      angleBracketCount--;
      if (angleBracketCount === 0) {
        i++; // Move past the closing '>'
        break;
      }
    }
    i++;
  }

  // Skip any whitespace characters after the leading generic type
  while (i < text.length && /\s/.test(text[i])) {
    i++;
  }

  return i;
}

function _removeLeadingGenericType(signature) {
  const i = _indexOfFirstCharAfterBracket(signature);

  // Return the substring starting from the first non-whitespace character after the leading generic type
  return signature.substring(i);
}

function _getLeadingGenericType(signature) {
  const i = _indexOfFirstCharAfterBracket(signature);

  // Return the substring starting from the first non-whitespace character after the leading generic type
  return signature.substring(0, i - 1);
}

function _extractParameterTypes(signature) {
  let parameterString = signature.substring(signature.indexOf('(') + 1, signature.lastIndexOf(')')).trim();
  if (parameterString === '') {
    return [];
  }

  const params = [];
  while (parameterString) {
    if (parameterString.indexOf(',') === -1) {
      // Last parameter
      const parts = parameterString.split(' ');
      params.push(_removeGenericFromType(parts.length === 1 ? parts[0] : parts[parts.length - 2]));
      break;
    }

    // Remained multiple parameters or with generic type
    let paramType;
    if (parameterString.indexOf('<') === -1 || parameterString.indexOf('<') > parameterString.indexOf(',')) {
      paramType = parameterString.substring(0, parameterString.indexOf(' '));
    } else {
      paramType = _getLeadingGenericType(parameterString); // Remove generic types
    }

    params.push(_removeGenericFromType(paramType));
    parameterString = parameterString.substring(paramType.length).trim();
    if (parameterString.indexOf(',') === -1) {
      break;
    }
    parameterString = parameterString.substring(parameterString.indexOf(',') + 1).trim();
  }

  return params;
}

function _compactMethodSignature(signature, isConstructorInvocation = false) {
  if (signature.indexOf(' ') === -1) {
    // Most compressed format of inner call got from _getInvokeMethodManually already
    return signature;
  }
  if (signature.startsWith('<')) {
    // signature can be something like this, and need to remove header `<Map<String, Object>> ` first
    // <Map<String, Object>> List<Map<String, Object>> a.b.parseList(String jsonString)
    signature = _removeLeadingGenericType(signature);
  }

  const index = signature.indexOf('(');
  const genericIndex = signature.indexOf('<');
  if (!isConstructorInvocation) {
    // Remove return value
    // If it's not constructor invocation, then it must have return value, even if it's void
    const returnValueIndex = signature.lastIndexOf(' ', index);
    signature = signature.substring(returnValueIndex);
  } else if (genericIndex > -1 && genericIndex < index) {
    // Class definition might be generic, need to remove the generic part
    const tmpIndex = signature.lastIndexOf('.', genericIndex); // TODO: class name is duplicated in the signature
    signature = signature.substring(0, tmpIndex) + signature.substring(index);
  }

  signature = signature.replace(/@\w+(\([^)]*\))?\s+|final\s+/g, ''); // Remove annotations

  return signature.substring(0, signature.indexOf('(') + 1).trim()
    + _extractParameterTypes(signature).join(',') // Remove parameter types
    + ')'
    ;
}

async function _getInvokeMethodSignatureThroughLSP(node, lastMethodInvocation = false) {
  const spec = await _getInvokeMethodSpecThroughLSP(node, lastMethodInvocation);
  const isConstructorInvocation = node.type === 'explicit_constructor_invocation';
  if (spec) {
    console.info(`success to get signature through LSP server: ${node.text}`);
    return _compactMethodSignature(spec, isConstructorInvocation);
  }

  console.warn(`Failed to get signature through LSP server: ${node.text}`);
  return;
}

function _getLocalScopeVariableType(localScopeVariables, node) {
  if (localScopeVariables[node.text] && typeof localScopeVariables[node.text] !== 'function') {
    return localScopeVariables[node.text];
  }

  return node.text;
}

const LOGICAL_OPERATORS = ['&&', '||', '!', '==', '!=', '>', '>=', '<', '<='];

async function _getReturnTypeWithObjectCreation(scopeInstanceName, node, requiredModuleDependencies, instanceAndfunctionDependencies, level, localScopeVariables) {
  const args = _oneChildrenOfType(node, 'argument_list');
  const objCreationNode = _oneChildrenOfType(node, 'object_creation_expression');
  const objType = _objectCreationHandler(scopeInstanceName, objCreationNode, requiredModuleDependencies, instanceAndfunctionDependencies, level, localScopeVariables);
  if (!args) {
    // If it's purely object creation, then return the type
    return objType;
  }

  // It should be a chain of method invocation after creation
  // Capture the dependency for the first invocation
  _captureDependency(instanceAndfunctionDependencies, `${objType}.${node.children[2].text}()`);

  // Try to get the return type from the last method invocation
  return await _getInvokeMethodReturnType(node, true) || '$Object';
}

async function _getInvokeMethodManually(scopeInstanceName, node, requiredModuleDependencies, instanceAndfunctionDependencies, level, localScopeVariables) {
  // Just use the short type name in parameters as current Hover API doesn't support fully qualified name
  if (node.children[0].type === 'method_invocation') {
    // Use the first method invocation node to get the signature and capture the dependency
    return await _getInvokeMethodManually(scopeInstanceName, node.children[0], requiredModuleDependencies, instanceAndfunctionDependencies, level, localScopeVariables);
  }

  let dependentIdentifer = [];

  for (let i = 0; i < node.children.length; i++) {
    const child = node.children[i];
    if (child.type === 'modifiers') {
      for (const modifier of child.children) {
        if (!modifier.text.startsWith('@')) {
          dependentIdentifer.push(modifier.text + ' ');
        }
      }
    } else if (child.type === 'identifier') {
      const dependencyName = _getRequiredModuleDependency(_getLocalScopeVariableType(localScopeVariables, child), requiredModuleDependencies);
      dependentIdentifer.push(dependencyName);
    } else if (child.type === 'array_access') {
      const arrayType = _getLocalScopeVariableType(localScopeVariables, child.children[0]);
      dependentIdentifer.push(arrayType.replace('[]', ''));
    } else if (child.type === 'argument_list') {
      // Try to deduce argument types
      // If it's local variable, then get the type from localScopeVariables
      // If it's returned value from method invocation, try to get it from instanceAndfunctionDependencies (through LSP?)
      // If it's primitive type, then it's already known
      for (const arg of child.children) {
        if (arg.type === 'identifier') {
          dependentIdentifer.push(_getShortName(localScopeVariables[arg.text] || instanceAndfunctionDependencies[arg.text] || arg.text));
        } else if (arg.type === 'class_literal') {
          dependentIdentifer.push('Class');
        } else if (arg.type === 'object_creation_expression') {
          const argType = await _getReturnTypeWithObjectCreation(scopeInstanceName, child, requiredModuleDependencies, instanceAndfunctionDependencies, level, localScopeVariables);
          dependentIdentifer.push(_getShortName(argType));
        } else if (arg.type === 'string_literal') {
          dependentIdentifer.push('String');
        } else if (arg.type === 'character_literal') {
          dependentIdentifer.push('Char');
        } else if (arg.type === 'decimal_integer_literal') {
          if (arg.text.toUpperCase().indexOf('L') > 0) {
            dependentIdentifer.push('Long')
          } else {
            dependentIdentifer.push('Integer');
          }
        } else if (arg.type === 'decimal_floating_point_literal') {
          if (arg.text.toUpperCase().indexOf('F') > 0) {
            dependentIdentifer.push('Float')
          } else {
            dependentIdentifer.push('Double');
          }
        } else if (arg.type === 'true' || arg.type === 'false') {
          dependentIdentifer.push('Boolean');
        } else if (arg.type === 'binary_expression') {
          if (LOGICAL_OPERATORS.includes(arg.children[1].text)) {
            dependentIdentifer.push('Boolean');
          } else {
            dependentIdentifer.push('Integer');
          }
        } else if (arg.type === 'method_invocation') {
          const returnType = await _getInvokeMethodReturnType(arg, true);
          if (returnType) {
            dependentIdentifer.push(returnType);
          } else {
            // To collect dependencies, return type cannot be determined
            let innerMethod = await _methodInvocationHandler(scopeInstanceName, arg, requiredModuleDependencies, instanceAndfunctionDependencies, level, localScopeVariables);
            // Method signature is possibly resolved by LSP in long version, such as:  a.b.c(String)
            // Or manually in short version, such as: 
            // Can use the short name to check return type if it's already in localScopeVariables
            let returnType = localScopeVariables[innerMethod] || instanceAndfunctionDependencies[innerMethod]?.$returnType;
            if (!returnType) {
              const shortName = innerMethod.substring(innerMethod.lastIndexOf('.', innerMethod.indexOf('(')) + 1);
              returnType = localScopeVariables[shortName] || instanceAndfunctionDependencies[shortName]?.$returnType;
            }
            dependentIdentifer.push(returnType || '$Object');
            // if (innerMethod && localScopeVariables[innerMethod]) {
            //   dependentIdentifer.push(_getShortName(localScopeVariables[innerMethod]));
            // } else {
            //   dependentIdentifer.push('$Object');
            // }
          }
        } else if (arg.type === 'cast_expression') {
          dependentIdentifer.push(_getShortName(_typeNodeHandler(arg.children[1], requiredModuleDependencies)));

          await _walkAndBuildDependency(scopeInstanceName, arg.children[3], requiredModuleDependencies, instanceAndfunctionDependencies, level, localScopeVariables);
        } else if (arg.type === 'field_access') {
          // TODO, lookup by LSP?
          // const fullName = _fieldAccessHandler(scopeInstanceName, arg, requiredModuleDependencies, instanceAndfunctionDependencies, level, localScopeVariables);
          dependentIdentifer.push(arg.text);
        } else if (arg.text !== ';') {
          // (, ) or , are directly added
          dependentIdentifer.push(arg.text);
        }
      }
    } else if (child.type === 'formal_parameters') {
      // If formal_parameters is found, then it's a method declaration
      // break after processing formal_parameters
      dependentIdentifer.push(child.text);
      break;
    } else if (child.type === 'object_creation_expression') {
      const argType = await _getReturnTypeWithObjectCreation(scopeInstanceName, node, requiredModuleDependencies, instanceAndfunctionDependencies, level, localScopeVariables);
      dependentIdentifer.push(_getShortName(argType));
    } else if (child.type === 'string_literal') {
      // TODO: Need to capture the constant as dependency?
      dependentIdentifer.push('String');
    } else {
      // (, ) or . are directly added
      dependentIdentifer.push(child.text);
      if (['modifiers', 'void_type', 'type_identifier', 'generic_type'].includes(child.type)) {
        dependentIdentifer.push(' ');
      }
    }
  }

  if (dependentIdentifer.length > 0) {
    return _compactMethodSignature(dependentIdentifer.join(''));
  }
}

async function _methodInvocationHandler(scopeInstanceName, node, requiredModuleDependencies, instanceAndfunctionDependencies, level, localScopeVariables) {
  // If there is a chain of method invocations, use the first method invocation node to get the signature
  // node.text sample is `abc.getA().getB().getC()`
  // text of 1st children is `abc.getA().getB()`
  let returnType;
  let invokedMethod = await _getInvokeMethodSignatureThroughLSP(node);
  if (!invokedMethod) {
    invokedMethod = await _getInvokeMethodManually(scopeInstanceName, node, requiredModuleDependencies, instanceAndfunctionDependencies, level, localScopeVariables);
  } else {
    // Return type is not from last invocation as invokedMethod is from the first invocation
    if (node.type === 'explicit_constructor_invocation') {
      if (node.children[0].text === 'this') {
        returnType = scopeInstanceName;
      } else {
        returnType = '$parent';
      }
    } else {
      returnType = await _getInvokeMethodReturnType(node);
    }
  }

  if (invokedMethod) {
    const dependency = _captureDependency(instanceAndfunctionDependencies, invokedMethod);
    dependency.$type = node.type === 'explicit_constructor_invocation' ? 'constructor' : 'method';
    if (returnType) {
      dependency.$returnType = returnType;
    }
  } else {
    console.warn(`Failed to get method signature manually: ${node.text}`);
  }

  const args = _oneChildrenOfType(node, 'argument_list');
  if (args) {
    for (const arg of args.children) {
      await _walkAndBuildDependency(scopeInstanceName, arg, requiredModuleDependencies, instanceAndfunctionDependencies, level, localScopeVariables);
    }
  }

  return invokedMethod;
}

function _getRequiredModuleDependency(identifier, requiredModuleDependencies) {
  const dep = _.find(requiredModuleDependencies, (value, key) => {
    if (key === identifier || value.shortName === identifier) {
      return true;
    }
  });

  if (dep) {
    return dep.source;
  }

  return identifier;
}

function _fieldAccessHandler(scopeInstanceName, node, requiredModuleDependencies, instanceAndfunctionDependencies, level, localScopeVariables) {
  const identifiers = [];
  for (const identifier of _allChildrenOfType(node, 'identifier')) {
    identifiers.push(identifier.text);
  }

  const dependentName = _getRequiredModuleDependency(identifiers[0], requiredModuleDependencies);
  let fullName = identifiers.join('.');
  if (dependentName !== identifiers[0]) {
    identifiers[0] = dependentName;
    fullName = identifiers.join('.');
    instanceAndfunctionDependencies[fullName] = { $name: fullName };
  }
  return fullName;
}

function _classLiteralHandler(scopeInstanceName, node, requiredModuleDependencies, instanceAndfunctionDependencies, level, localScopeVariables) {
  // Need to capture this when it's a method parameter
  const typeIdentifier = _typeNodeHandler(node, requiredModuleDependencies);
  return typeIdentifier;
}

function _getShortName(name) {
  if (name.indexOf('.') > -1) {
    return name.substring(name.lastIndexOf('.') + 1);
  }
  return name;
}

function _getTypeName(node, requiredModuleDependencies) {
  if (node.type === 'type_identifier' || node.type === 'catch_type') {
    return _getRequiredModuleDependency(node.text, requiredModuleDependencies);
  }

  if (node.type === 'generic_type') {
    return _getRequiredModuleDependency(_genericHandler(node).name, requiredModuleDependencies);
  }

  if (node.type === 'void_type') {
    return 'void';
  }

  switch (node.text) {
    case 'boolean':
      return 'Boolean';
    case 'byte':
      return 'Byte';
    case 'char':
      return 'Character';
    case 'double':
      return 'Double';
    case 'float':
      return 'Float';
    case 'int':
      return 'Integer';
    case 'long':
      return 'Long';
    case 'short':
      return 'Short';
    default:
      return node.text;
  }
}

function _objectCreationHandler(scopeInstanceName, node, requiredModuleDependencies, instanceAndfunctionDependencies, level, localScopeVariables) {
  const typeIdentifier = _typeNodeHandler(node, requiredModuleDependencies);
  const externalSource = _getRequiredModuleDependency(typeIdentifier, requiredModuleDependencies);
  const dependency = _captureDependency(instanceAndfunctionDependencies, externalSource);
  dependency.$usage = 'constructor';
  return typeIdentifier;
}

function _identifierHandler(scopeInstanceName, node, requiredModuleDependencies, instanceAndfunctionDependencies, level, localScopeVariables) {
  return node.text;
}

const OPERATORS_OR_KEYWORDS = LOGICAL_OPERATORS.concat(
  ['{', '}', ',', ';', '@', 'extends', 'implements', 'return', 'await', 'comment', 'class', 'if', 'else', 'try', 'catch', 'throw', 'break', 'continue', 'true', 'false', '\'', '"', '+', '-', '?', ':', '(', ')', '=', '*', '/', '->', '+=', '-=', '*=', '/=', 'instanceof', 'new', 'this', 'super', 'null', 'void', 'static', 'final', 'abstract', 'synchronized']
);

async function _forStatementHandler(scopeInstanceName, node, requiredModuleDependencies, instanceAndfunctionDependencies, level, localScopeVariables) {
  const variableDeclaration = _oneChildrenOfType(node, 'local_variable_declaration');
  if (variableDeclaration) {
    const typeIdentifier = _typeNodeHandler(variableDeclaration.children[0], requiredModuleDependencies);
    const variableDeclarators = _allChildrenOfType(variableDeclaration, 'variable_declarator');

    for (const declarator of variableDeclarators) {
      const identifier = _oneChildrenOfType(declarator, 'identifier').text;

      localScopeVariables[identifier] = typeIdentifier;
    }
  }

  await _walkAndBuildDependency(scopeInstanceName, node.children[node.children.length - 1], requiredModuleDependencies, instanceAndfunctionDependencies, level, localScopeVariables);
}

async function _enhancedForStatementHandler(scopeInstanceName, node, requiredModuleDependencies, instanceAndfunctionDependencies, level, localScopeVariables) {
  const identifier = _oneChildrenOfType(node, 'identifier').text;
  const typeIdentifier = _typeNodeHandler(node.children[2], requiredModuleDependencies);

  localScopeVariables[identifier] = typeIdentifier;

  await _walkAndBuildDependency(scopeInstanceName, node.children[node.children.length - 1], requiredModuleDependencies, instanceAndfunctionDependencies, level, localScopeVariables);
}

function _setVisibility(dependency, node, scopeInstanceName) {
  const modifiers = _oneChildrenOfType(node, 'modifiers');
  if (!modifiers) {
    // Default package declaration if there is no scopeInstanceName
    // Local variable declaration if scopeInstanceName exists
    if (!scopeInstanceName) {
      dependency.$visibility = 'package';
    }
  } else {
    for (const modifier of modifiers.children) {
      if (modifier.text === 'public' || modifier.text === 'private' || modifier.text === 'protected') {
        dependency.$visibility = modifier.text;
        break;
      }
    }
    if (!dependency.$visibility) {
      dependency.$visibility = 'package';
    }
  }
}

function _typeNodeHandler(node, requiredModuleDependencies) {
  // node possible contains modifiers (optional), type, declaration part
  let typeNode;
  let typeIdentifier;

  if (node.children.length === 0) {
    // Directly pass the type node instead of field declaration node
    typeNode = node;
  } else if (node.type === 'object_creation_expression') {
    typeNode = node.children[1];
  } else {
    const modifiers = _oneChildrenOfType(node, 'modifiers');
    if (modifiers) {
      typeNode = node.children[1];
    } else {
      typeNode = node.children[0];
    }
  }

  if (typeNode.type === 'array_type') {
    typeIdentifier = _getTypeName(typeNode.children[0], requiredModuleDependencies);
    typeIdentifier = `${typeIdentifier}[]`;
  } else {
    typeIdentifier = _getTypeName(typeNode, requiredModuleDependencies);
  }

  return typeIdentifier;
}

async function _localVariableDeclarationHandler(scopeInstanceName, node, requiredModuleDependencies, instanceAndfunctionDependencies, level, localScopeVariables) {
  // Basically the same as field declaration, but no need to capture the field name
  const fieldName = _oneDescendantOfType(node, 'identifier').text;
  const declarator = _oneChildrenOfType(node, 'variable_declarator');
  const typeIdentifier = _typeNodeHandler(node, requiredModuleDependencies);

  localScopeVariables[fieldName] = typeIdentifier;

  if (declarator) {
    await _walkAndBuildDependency(scopeInstanceName, declarator.children[2], requiredModuleDependencies, instanceAndfunctionDependencies, level, localScopeVariables);
  }

  return;
}

async function _fieldDeclarationHandler(scopeInstanceName, node, requiredModuleDependencies, instanceAndfunctionDependencies, level, localScopeVariables) {
  const declarator = _oneChildrenOfType(node, 'variable_declarator');
  const typeIdentifier = _typeNodeHandler(node, requiredModuleDependencies);
  const fieldName = _oneChildrenOfType(declarator, 'identifier').text;

  const dependency = _captureDependency(instanceAndfunctionDependencies, scopeInstanceName ? `${scopeInstanceName}.${fieldName}` : fieldName);
  _setVisibility(dependency, node, scopeInstanceName);

  if (instanceAndfunctionDependencies.$visibility === 'private') {
    dependency.$visibility = 'private';
  }

  dependency.$module = scopeInstanceName || typeIdentifier
  localScopeVariables[fieldName] = typeIdentifier;

  if (declarator) {
    await _walkAndBuildDependency(scopeInstanceName, declarator.children[2], requiredModuleDependencies, dependency, level, localScopeVariables);
  }

  return fieldName;
}

function _removeGenericFromType(text) {
  if (text.indexOf('<') === -1) {
    return text;
  }
  return text.substring(0, text.indexOf('<'));
}

function _genericHandler(node) {
  return {
    name: _removeGenericFromType(node.text)
  };
}

async function _classDeclarationHandler(scopeInstanceName, node, requiredModuleDependencies, instanceAndfunctionDependencies, level, localScopeVariables) {
  const classModifiers = _oneChildrenOfType(node, 'modifiers');
  const className = _oneChildrenOfType(node, 'identifier').text;
  const superClass = _oneChildrenOfType(node, 'superclass');
  const superInterfaces = _oneChildrenOfType(node, 'super_interfaces') || _oneChildrenOfType(node, 'extends_interfaces');
  const fullName = `${scopeInstanceName || requiredModuleDependencies.$package}.${className}`;

  // Class in JS file is a top level object
  requiredModuleDependencies[fullName] = {
    shortName: className,
    source: fullName
  };

  let requestRoot;
  const dependency = _captureDependency(instanceAndfunctionDependencies, fullName);
  _setVisibility(dependency, node);

  if (!classModifiers) {
    // Default package declaration
    dependency.$type = node.children[0].text;
  } else {
    dependency.$type = node.children[1].text;
    const requestMapping = _.find(classModifiers.children, modifier => {
      return modifier.text.startsWith('@RequestMapping(')
    });
    if (requestMapping) {
      requestRoot = _getModifierAttribute(requestMapping);
      dependency.$requestPath = requestRoot;
    }
  }
  dependency['$interfaces'] = [];

  if (superClass) {
    dependency['$super'] = _genericHandler(superClass.children[1]);
  }
  if (superInterfaces) {
    for (const child of superInterfaces.children) {
      if (OPERATORS_OR_KEYWORDS.indexOf(child.type) !== -1) {
        continue;
      }

      dependency['$interfaces'].push(_genericHandler(child));
    }
  }

  if (node.type === 'enum_declaration') {
    const constantFields = _allChildrenOfType(_oneChildrenOfType(node, 'enum_body'), 'enum_constant');
    for (const child of constantFields) {
      const fieldName = _oneChildrenOfType(child, 'identifier').text;
      _captureDependency(dependency, `${fullName}.${fieldName}`);
    }
  }

  // Filter out all field_decalaration first to collect class level variables
  const body = _oneChildrenOfType(node, 'class_body') || _oneChildrenOfType(node, 'interface_body') ||
    _oneDescendantOfType(node, 'enum_body_declarations');
  if (!body) {
    return className;
  }

  const classLevelVariables = {};

  const innerClasses = _allChildrenOfType(body, 'class_declaration');
  for (const child of innerClasses) {
    await _walkAndBuildDependency(fullName, child, requiredModuleDependencies, dependency, 0, classLevelVariables);
  }

  const classFields = _allChildrenOfType(body, 'field_declaration');
  for (const child of classFields) {
    await _walkAndBuildDependency(fullName, child, requiredModuleDependencies, dependency, 0, classLevelVariables);
  }

  // Collect all method signatures first for later use
  const methodDependencies = [];
  const classMethods = _allChildrenOfType(body, 'method_declaration');
  for (const child of classMethods) {
    let methodSignature = await _getInvokeMethodSignatureThroughLSP(child);
    if (!methodSignature) {
      methodSignature = await _getInvokeMethodManually(className, child, requiredModuleDependencies, instanceAndfunctionDependencies, level, classLevelVariables);
      methodSignature = `${fullName}.${methodSignature}`;
    }

    const modifiers = _oneChildrenOfType(child, 'modifiers');
    let returnTypeNode;
    if (modifiers) {
      returnTypeNode = child.children[1];
    } else {
      returnTypeNode = child.children[0];
    }
    const returnType = _typeNodeHandler(returnTypeNode, requiredModuleDependencies);
    const methodDependency = _captureDependency(dependency, methodSignature);
    methodDependency.$sourceCode = child.text;
    methodDependency.$type = 'method';
    methodDependency.$shortName = methodSignature.substring(methodSignature.lastIndexOf('.') + 1);
    methodDependency.$returnType = returnType;
    _setVisibility(methodDependency, child, className);

    methodDependencies.push(methodDependency);

    classLevelVariables[methodDependency.$shortName] = returnType;
  }

  for (const child of classMethods) {
    const methodBody = _oneChildrenOfType(child, 'block');
    if (!methodBody) {
      continue;
    }

    const methodDependency = methodDependencies.shift();

    // Handle Modifiers
    const modifiers = _oneChildrenOfType(child, 'modifiers');
    if (modifiers) {
      for (const modifier of modifiers.children) {
        if (modifier.type !== 'annotation') {
          continue;
        }
        if (modifier.children[1].text === 'JmsListener') {
          const args = modifier.children[2];
          for (const arg of args.children) {
            if (arg.type === 'element_value_pair') {
              if (arg.children[0].text === 'destination') {
                // Capture dependency on property file and the destination
                const propertyDependency = _captureDependency(methodDependency, arg.children[2].text.replace('"', ''));
                propertyDependency.$type = 'property';
              }
            }
          }
        }
        if (['PostMapping', 'GetMapping', 'PutMapping', 'PatchMapping', 'DeleteMapping'].includes(modifier.children[1].text)) {
          const attributeValues = _getModifierAttribute(modifier, ['value', 'path'], true);
          let requestPath;
          if (typeof attributeValues === 'string') {
            requestPath = attributeValues;
          } else {
            requestPath = attributeValues.path || attributeValues.value;
          }
          const pathDependency = _captureDependency(methodDependency, `${requestRoot}${requestPath}`);
          pathDependency.$type = 'requestPath';
        }
      }
    }

    // Local arguments that are not required to put in dependencies
    const cloned = _.cloneDeep(classLevelVariables);
    const argumentsNode = _oneChildrenOfType(child, 'formal_parameters');
    if (argumentsNode) {
      for (const arg of argumentsNode.children) {
        if (arg.type === 'formal_parameter') {
          // TODO: Handle modifiers
          const argType = _typeNodeHandler(arg, requiredModuleDependencies);
          cloned[_oneChildrenOfType(arg, 'identifier').text] = argType;
        }
      }
    }

    await _walkAndBuildDependency(methodDependency.$name, methodBody, requiredModuleDependencies, methodDependency, 0, cloned);
  }

  for (const child of body.children) {
    if (OPERATORS_OR_KEYWORDS.indexOf(child.type) !== -1 || ['class_declaration', 'field_declaration', 'method_declaration'].includes(child.type)) {
      // Skipping those `return`, `await`, ;, operators (e.g. >), etc
      continue;
    }
    const cloned = _.cloneDeep(classLevelVariables);

    // Static block / constructor
    await _walkAndBuildDependency(fullName, child, requiredModuleDependencies, dependency, 0, cloned);
  }

  // Pass class level variables to external passed in localScopeVariables in case this is inner class
  _.merge(localScopeVariables, classLevelVariables);

  return className;
}

function _getModifierAttribute(modifier, attributes = [], assumeDefault = true) {
  const args = _oneChildrenOfType(modifier, 'annotation_argument_list');
  if (!args || args.childCount === 2) {
    return;
  }

  const valuePairs = _allChildrenOfType(args, 'element_value_pair');
  if (assumeDefault && valuePairs.length === 0) {
    return args.children[1].text.replace(/"/g, '');
  }

  const result = _.reduce(valuePairs, (acc, arg) => {
    if (attributes.includes(arg.children[0].text)) {
      acc[arg.children[0].text] = arg.children[2].text.replace(/"/g, '');
    }
    return acc;
  }, {});

  return result;
}

function _packageHandler(scopeInstanceName, node, requiredModuleDependencies, instanceAndfunctionDependencies, level, localScopeVariables) {
  const identifierNode = node.children[1];
  instanceAndfunctionDependencies.$package = identifierNode.text;
  requiredModuleDependencies.$package = identifierNode.text;
  return instanceAndfunctionDependencies.$package;
}

function _importHandler(scopeInstanceName, node, requiredModuleDependencies, instanceAndfunctionDependencies, level, localScopeVariables) {
  const identifierNode = node.children.length === 3 ? node.children[1] : node.children[2]; // Normal or static import
  requiredModuleDependencies[identifierNode.text] = { source: identifierNode.text, shortName: identifierNode.text.split('.').pop() };
  return identifierNode.text;
}

function _catchClauseHandler(scopeInstanceName, node, requiredModuleDependencies, instanceAndfunctionDependencies, level, localScopeVariables) {
  const parameter = _oneChildrenOfType(node, 'catch_formal_parameter');
  const identifier = parameter.children[1].text;
  localScopeVariables[identifier] = _typeNodeHandler(parameter, requiredModuleDependencies);
  _walkAndBuildDependency(scopeInstanceName, node.children[node.children.length - 1], requiredModuleDependencies, instanceAndfunctionDependencies, level, localScopeVariables);
  return identifier;
}

function _literalHandler(scopeInstanceName, node, requiredModuleDependencies, instanceAndfunctionDependencies, level, localScopeVariables) {
  return node.text;
}

function _ignoreHandler() {
  // Ignore comment
}

const NODE_TYPE_HANDLERS = {
  program: _programHandler,
  package_declaration: _packageHandler,
  constructor_body: _generalExpressionHandler,
  block: _generalExpressionHandler,
  identifier: _identifierHandler,
  type_identifier: _identifierHandler,
  assignment_expression: _generalExpressionHandler,
  expression_statement: _generalExpressionHandler,
  parenthesized_expression: _generalExpressionHandler,
  return_statement: _generalExpressionHandler,
  ternary_expression: _generalExpressionHandler,
  binary_expression: _generalExpressionHandler,
  unary_expression: _generalExpressionHandler,
  for_statement: _forStatementHandler,
  enhanced_for_statement: _enhancedForStatementHandler,
  if_statement: _generalExpressionHandler,
  while_statement: _generalExpressionHandler,
  try_statement: _generalExpressionHandler,
  catch_clause: _catchClauseHandler,
  cast_expression: _generalExpressionHandler,
  throw_statement: _generalExpressionHandler,
  switch_expression: _generalExpressionHandler,
  comment: _ignoreHandler,
  block_comment: _ignoreHandler,
  line_comment: _ignoreHandler,
  string_literal: _literalHandler,
  decimal_integer_literal: _literalHandler,
  null_literal: _literalHandler,
  array_access: _literalHandler,
  class_declaration: _classDeclarationHandler,
  interface_declaration: _classDeclarationHandler,
  enum_declaration: _classDeclarationHandler,
  import_declaration: _importHandler,
  field_declaration: _fieldDeclarationHandler,
  local_variable_declaration: _localVariableDeclarationHandler,
  method_declaration: _functionNodeHander,
  constructor_declaration: _functionNodeHander,
  method_invocation: _methodInvocationHandler,
  explicit_constructor_invocation: _methodInvocationHandler,
  argument_list: _generalExpressionHandler,
  class_literal: _classLiteralHandler,
  object_creation_expression: _objectCreationHandler,
  field_access: _fieldAccessHandler,
  lambda_expression: _lambdaHandler,
};

function _captureDependency(instanceAndfunctionDependencies, instanceName) {
  instanceAndfunctionDependencies[instanceName] = instanceAndfunctionDependencies[instanceName] || { $name: instanceName };
  return instanceAndfunctionDependencies[instanceName];
}

async function _walkAndBuildDependency(scopeInstanceName, node, requiredModuleDependencies = {}, instanceAndfunctionDependencies = {}, level = 0, localScopeVariables = {}) {
  if (!node) {
    return;
  }

  let dependentIdentifer = '';
  const handler = NODE_TYPE_HANDLERS[node.type];
  if (handler) {
    dependentIdentifer = await handler(scopeInstanceName, node, requiredModuleDependencies, instanceAndfunctionDependencies, level, localScopeVariables) || '';
  } else if (!OPERATORS_OR_KEYWORDS.includes(node.type)) {
    console.warn('====== Unhandled node type: ', node.type, node.text);
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
  if (node.$usage === 'constructor') {
    return 'constructor';
  }
  return (node.$usage || node.$name).indexOf('(') > 0 ? 'method' : 'field';
}

const COMMON_JAVA_TYPES = ['String', 'Integer', 'Long', 'Double', 'Float', 'Boolean', 'Char', 'Date', 'Object', 'Class', 'void',
  'ArrayList', 'HashMap', 'HashSet', 'List', 'Map', 'Set', 'Calendar',
  'java.lang.String',
  'java.util.Calendar',
  'java.util.Date',
  'java.util.HashMap',
  'java.util.Map',
  'java.util.List',
  'java.util.ArrayList',
  'java.util.Set',
  'java.util.HashSet',
  'org.slf4j.Logger'
];

function _isCommonDependency(dependencyName) {
  return _.some(COMMON_JAVA_TYPES, type => {
    return type === dependencyName || dependencyName.startsWith(type + '.');
  })
}

function _getClassFullName(name, requiredModuleDependencies, $package) {
  const fullName = _getRequiredModuleDependency(name, requiredModuleDependencies);
  if (fullName === name) {
    return `${$package}.${name}`;
  }
  return fullName;
}

function _convertDependencyStructure(inspectedDependency, requiredModuleDependencies, parentDependencyName, className, parentClassName) {
  let dependencyName = inspectedDependency.$name;
  if (_isCommonDependency(dependencyName)) {
    return;
  }

  let module;
  if (dependencyName.indexOf('.') === -1) {
    dependencyName = `${parentDependencyName}.${dependencyName}`;
  }

  if (dependencyName.startsWith('super.')) {
    dependencyName = dependencyName.replace('super.', `${parentClassName}.`);
    module = parentClassName;
  }

  if (dependencyName.startsWith('this.')) {
    dependencyName = dependencyName.replace('this.', `${className}.`);
  }
  if (inspectedDependency.$type === 'constructor' && dependencyName.indexOf('(') > 0) {
    module = dependencyName.substring(0, dependencyName.indexOf('('));
  }

  if (!module) {
    // Ensure it's not something like `a().b()`
    const endIndex = dependencyName.indexOf('(') === -1 ? undefined : dependencyName.indexOf('(');
    module = dependencyName.substring(0, dependencyName.lastIndexOf('.', endIndex));
  }

  const dependency = {
    instanceName: dependencyName,
    usage: inspectedDependency.$usage,
    sourceCode: inspectedDependency.$sourceCode,
    visibility: inspectedDependency.$visibility,
    type: _nodeType(inspectedDependency),
    module,
    dependencies: []
  };

  if (inspectedDependency.$type === 'requestPath') {
    dependency.visibility = 'public';
    dependency.type = 'API';
  }

  if (inspectedDependency.$super) {
    dependency.dependencies.push({
      instanceName: _getClassFullName(inspectedDependency.$super.name, requiredModuleDependencies, inspectedDependency.$package),
      type: 'class'
    });
  }

  if (inspectedDependency.$interfaces) {
    for (const interfaceClass of inspectedDependency.$interfaces) {
      dependency.dependencies.push({
        instanceName: _getClassFullName(interfaceClass.name, requiredModuleDependencies, inspectedDependency.$package),
        type: 'interface'
      });
    }
  }

  return dependency;
}

function _collectInnerDependencies(node, requiredModuleDependencies, instanceAndfunctionDependencies, className = '', parentClassName, parentDependencyName = '') {
  // Special properties like $name, $type, $public are not dependencies
  if (!node) {
    return [];
  }

  const dependency = _convertDependencyStructure(node, requiredModuleDependencies, parentDependencyName, className, parentClassName);
  if (!dependency) {
    return [];
  }

  const dependencyNames = _getDependencyNames(node);

  for (let dependencyName of dependencyNames) {
    if (_isCommonDependency(dependencyName)) {
      continue;
    }

    const childDependencies = _collectInnerDependencies(node[dependencyName], requiredModuleDependencies, instanceAndfunctionDependencies, className, parentClassName, dependency.instanceName);
    dependency.dependencies.push(...childDependencies);
  }

  return [dependency];
}

class AstParser {
  constructor(rootDir) {
    this.rootDir = rootDir;
    this.parser = new Parser();
    this.parser.setLanguage(Java);
    this.initialized = false;
  }

  parse(code) {
    return this.parser.parse(code);
  }

  extractFunctionSignature(code = '') {
    const functionSpec = code.split('{')[0].trim();
    return _compactMethodSignature(functionSpec);
  }

  async initializeLSP() {
    if (this.initialized) {
      return;
    }
    await initializeServer(`file:///${this.rootDir}`);
    this.initialized = true;
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
  async getDependencies(sourceFile, rawContent) {
    try {
      filePath = path.join(this.rootDir, sourceFile).replace(/\\/g, '/');
      const tree = this.parser.parse(rawContent);
      const rootNode = tree.rootNode;
      const requiredModuleDependencies = {};
      let instanceAndfunctionDependencies = {};

      await _walkAndBuildDependency('', rootNode, requiredModuleDependencies, instanceAndfunctionDependencies);
      fs.writeFileSync('./ast.java.json', JSON.stringify(instanceAndfunctionDependencies, null, 2));
      // instanceAndfunctionDependencies = JSON.parse(fs.readFileSync('./ast.json'));

      // Massage data into hierarchical structure
      const $package = instanceAndfunctionDependencies.$package;
      delete instanceAndfunctionDependencies.$package;

      const massagedResult = { dependencies: [], $package, $type: '$file', $name: sourceFile };
      _.each(instanceAndfunctionDependencies, (value, key) => {
        // If there are multiple classes in a file, then the key is the class name
        value.$package = $package;
        const className = `${$package}.${key}`;
        const parentClassName = value.$super ? `${value.$package}.${value.$super.name}` : '';
        massagedResult.dependencies.push(..._collectInnerDependencies(value, requiredModuleDependencies, instanceAndfunctionDependencies, className, parentClassName, $package));
      });

      fs.writeFileSync('./dependencies.java.json', JSON.stringify(massagedResult, null, 2));
      return { requiredModuleDependencies, instanceAndfunctionDependencies: massagedResult };
    } catch (error) {
      console.error(`Error parsing source: \n${sourceFile}`, error);
      throw error;
    }
  }
}

export {
  AstParser
}
