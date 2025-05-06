import _ from 'lodash';
import fs from 'fs';
import Parser from 'tree-sitter';
import TypeScript from 'tree-sitter-typescript';
import { AstParser as JavaScriptParser } from './javascript.js';

function _interfaceDeclarationHandler(scopeInstanceName, node, requiredModuleDependencies, instanceAndfunctionDependencies, level, localScopeVariables) {
  const sectionNodes = node.children;
  for (let i = 0; i < sectionNodes.length; i++) {
    // _walkAndBuildDependency('', sectionNodes[i], requiredModuleDependencies, instanceAndfunctionDependencies, level, localScopeVariables);
  }
}

class AstParser extends JavaScriptParser {
  constructor() {
    super();
    this.parser = new Parser();
    this.parser.setLanguage(TypeScript.typescript);
    this.handlers['interface_declaration'] = _interfaceDeclarationHandler;
    this.handlers['type_alias_declaration'] = _interfaceDeclarationHandler;
    this.handlers['type_arguments'] = _interfaceDeclarationHandler;
    this.handlers['type_annotation'] = _interfaceDeclarationHandler;
  }
}

export {
  AstParser
}
