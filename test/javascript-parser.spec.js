import fs from 'fs';
import path from 'path';
import { AstParser } from '../parsers/javascript.js';

const parser = new AstParser();
const nodeTypes = fs.readdirSync(path.resolve(__dirname, './fixtures/javascript/in'));

function _recursivelyReplaceMethodSourceCode(node) {
  // Because it's difficult to compare the exact source code of functions, we replace it with a placeholder
  // And just need to make sure it does contain something NOT dummy
  if (node.dependencies) {
    node.dependencies.forEach((dependency) => {
      if (dependency.sourceCode && dependency.type === 'method' && dependency.sourceCode !== dependency.name) {
        dependency.sourceCode = '$SOURCE_CODE$';
      }

      _recursivelyReplaceMethodSourceCode(dependency);
    });
  }
}

nodeTypes.forEach((nodeType) => {
  const parseCases = fs.readdirSync(path.resolve(__dirname, `./fixtures/javascript/in/${nodeType}`));

  parseCases.forEach((parseCase) => {
    if (process.env.TEST_CASE && !process.env.TEST_CASE.split(',').includes(parseCase)) {
      return
    }

    const code = fs.readFileSync(path.resolve(__dirname, `./fixtures/javascript/in/${nodeType}/${parseCase}`), 'utf-8');
    test(`Parsing : ${nodeType} - ${parseCase}`, () => {
      const result = parser.getDependencies('', code)

      _recursivelyReplaceMethodSourceCode(result.instanceAndfunctionDependencies)

      const outputPath = path.resolve(__dirname, `./fixtures/javascript/out/${nodeType}/${parseCase.replace(/\.js/, '.json')}`);
      if (!fs.existsSync(outputPath)) {
        fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
      }

      const output = require(outputPath);
      try {
        expect(result).toEqual(output);
      } catch (e) {
        fs.writeFileSync(outputPath.replace('.json', `.failed.json`), JSON.stringify(result, null, 2));
        throw e;
      }
    })
  })
})
