import _ from 'lodash';
import path from 'path';
import { fileURLToPath } from 'url';
import { AiProvider, GraphBuilder } from './index.js';
import { loadModules } from './module.loader.js'
import { parserList } from './parsers/index.js';

const DEFAULT_LANG_PARSERS = {};

for (const parser of parserList) {
  const parserName = parser.replace('.js', '');
  DEFAULT_LANG_PARSERS[parserName] = `./parsers/${parserName}.js`;
}

export class RepoBuilder {
  constructor(rootDir, microService, config = { parsers: {}, graph: {} }) {
    this.rootDir = rootDir;
    this.microService = microService;
    this.config = config;
    this.config.parsers = { ...DEFAULT_LANG_PARSERS, ...config.parsers };
    this.parserInstances = {};

    this.builder = new GraphBuilder(config.graph.type, config.graph.connectionOptions);
    if (config.aiEnabled) {
      this.aiProvider = new AiProvider(config.defaultAiProvider, config.aiProviders[config.defaultAiProvider]);
    }
  }

  getLanguage(fileSuffix) {
    return fileSuffix === 'js' ? 'javascript' : fileSuffix;
  }

  async buildGraph(parsedDirOrFile) {
    await this.builder.initGraph();

    await this.persistVertex({
      name: this.microService,
      category: 'microService',
      description: this.microService,
      type: 'microService'
    });

    if (parsedDirOrFile) {
      parsedDirOrFile = path.resolve(this.rootDir, parsedDirOrFile);
    }

    await this.buildSystemModuleVertices(this.rootDir, this.config, parsedDirOrFile);

    return parsedDirOrFile;
  }

  async persistVertex(vertex) {
    try {
      await this.builder.createVertex(vertex);
    } catch (e) {
      console.error('Error while persisting vertex:', vertex);
      throw e;
    }
  }

  async getAstParser(suffix) {
    const language = this.getLanguage(suffix);
    if (this.parserInstances[language]) {
      return this.parserInstances[language];
    }

    const parserFile = this.config.parsers[language];
    if (!parserFile) {
      console.log(`No parser found for ${language || suffix}`);
      return null;
    }

    const { AstParser } = await import(parserFile);
    this.parserInstances[language] = new AstParser(this.rootDir.replace(/\\/g, '/'));
    await this.parserInstances[language].initializeLSP();
    
    return this.parserInstances[language];
  }

  async getFileDescription(codeFileContent, language) {
    if (!this.aiProvider) {
      return {};
    }

    try {
      return this.aiProvider.getFileDescription(codeFileContent, language);
    } catch (error) {
      console.error('Error retrieving file description:', error);
      return {};
    }
  }

  getFunctionDescription(fileDescription, functionName) {
    const funDesc = _.find(fileDescription.components, { name: functionName });
    if (!funDesc) {
      return null;
    }
    return funDesc.description;
  }

  async buildSystemModuleVertices(rootDir, config, parsedDirOrFile) {
    const codeFiles = await loadModules(parsedDirOrFile || rootDir, config.filesMatchingPatterns, false, config.vscExtension);

    for (const result of codeFiles) {
      const { filePath, rawContent } = result;
      const suffix = filePath.split('.').pop().toLowerCase();
      const language = this.getLanguage(suffix);
      const astParser = await this.getAstParser(suffix);
      if (!astParser) {
        continue;
      }

      console.log(`========== Dependencies built for ${filePath} ===========\n`);
      try {
        let relativePath = filePath.replace(rootDir + path.sep, '').replace(/\\/g, '/');
        if (!relativePath.startsWith('/')) {
          relativePath = `/${relativePath}`;
        }
        const fileDescriptions = await this.getFileDescription(rawContent, language);
        const { requiredModuleDependencies, instanceAndfunctionDependencies } = await astParser.getDependencies(relativePath, rawContent);
        let fileName = instanceAndfunctionDependencies.$name || relativePath;

        const moduleDependencies = this.convertGraphComponents(fileName, language, this.microService, requiredModuleDependencies, instanceAndfunctionDependencies.dependencies);

        for (const dependency of moduleDependencies) {
          // Only top level public functions are considered
          if (dependency.type === 'Function' && dependency.sourceCode) {
            dependency.description = await this.getFunctionDescription(fileDescriptions, dependency.name);
          }

          await this.persistVertex(dependency);
        }
      } catch (e) {
        console.error(`Error while building dependencies for ${filePath}`, e);
        continue;
      }
    }
  }

  convertGraphComponents(fileName, language, microService, moduleDependencyMap, dependencies = []) {
    const result = dependencies.map(dependency => {
      const isFunction = ['method', 'constructor'].includes(dependency.type);

      const converted = {
        language,
        public: dependency.visibility !== 'private',
        visibility: dependency.visibility,
        category: 'component',
        name: dependency.instanceName,
        fileName,
        systemModule: dependency.module,
        startRow: dependency.startRow,
        endRow: dependency.endRow,
        microService: microService,
        type: isFunction ? 'Function' : 'Field',
        sourceCode: isFunction ? dependency.sourceCode : '',
        dependencies: this.convertGraphComponents(fileName, language, microService, moduleDependencyMap, dependency.dependencies)
      };

      if (converted.systemModule === 'this') {
        // Follows its parent system module
        delete converted.systemModule;
      }

      return converted;
    });

    return result;
  }
}

export function isDirectlyExecuted() {
  if (!process.argv || process.argv.length === 0) {
    return false;
  }

  return process.argv[1] === fileURLToPath(import.meta.url);
}

if (isDirectlyExecuted()) {
  const parsedDirOrFile = process.argv[2];
  if (parsedDirOrFile) {
    // Single directory or file is passed
    if (!process.env.PROJECT_ROOT) {
      console.error('Please set PROJECT_ROOT environment variable to the root directory of the project');
      process.exit(1);
    }
  }

  const currentFileName = fileURLToPath(import.meta.url);
  const currentDirName = path.dirname(currentFileName);

  // Executed through node, read from config file & environment variables
  const rootDir = process.env.PROJECT_ROOT || path.join(currentDirName, 'sample-project/server');
  const microService = process.env.SERVICE_NAME || 'dep-graph-builder';
  const config = await import(path.join('file://', path.join(currentDirName, './sample.config.js')));
  config.default.aiEnabled = process.env.AI_ENABLED === 'true';

  const builder = new RepoBuilder(rootDir, microService, config.default);
  await builder.buildGraph(parsedDirOrFile);
  process.exit(0);
}
