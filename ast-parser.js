import Parser from 'tree-sitter';
import JavaScript from 'tree-sitter-javascript';

function _walk(node, result) {
  if (node.type === 'import_statement') {
    const importSpecifier = node.descendantsOfType('identifier');
    if (importSpecifier) {
      const source = node.childrenForFieldName('source');
      result.push({ identifier: importSpecifier[0].text, source: source[0].text.replace(/['"]/g, '') });
    }
  }

  if (node.children.length > 0) {
    node.children.forEach(child => _walk(child, result));
  }
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

  getRequiredModuleDependencies(code) {
    const tree = this.parser.parse(code);
    const rootNode = tree.rootNode;
    const requiredModuleDependencies = [];

    _walk(rootNode, requiredModuleDependencies);
    return requiredModuleDependencies;
  }
}

export {
  AstParser
}
