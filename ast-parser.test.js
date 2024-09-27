import { AstParser } from './ast-parser.js';
import fs from 'fs';

const code = fs.readFileSync('./sample-project/server/vertex/vertex.routes.js', 'utf8');
const astParser = new AstParser();
console.log(astParser.getRequiredModuleDependencies(code));
