import joi from 'joi';
import AiQueryTemplate from './fixtures/ai_query_template.js';
// import Openai from './ai-providers/openai.js';
import Moonshot from './ai-providers/moonshot.js';

const AI_PROVIDERS = {
  // OPENAI: Openai,
  MOONSHOT: Moonshot
}

const SCHEMA = {
  FUNCTION_DEPENDENCY: joi.object({
    dependencies: joi.array().items(joi.object({
      instanceName: joi.string().required(),
      method: joi.string().required(),
      usage: joi.string().required()
    })).required()
  }),
  MODULE_DEPENDENCY: joi.object({
    dependencies: joi.array().items(joi.object({
      moduleName: joi.string().required(),
      modulePath: joi.string().required(),
      moduleInstance: joi.string(),
      instanceAlias: joi.string()
    })).required()
  })
}

function validate(schema, data) {
  const { error } = schema.validate(typeof data === 'string' ? JSON.parse(data) : data);
  if (error) {
    throw new Error(error.message);
  }
}

class AiProvider {
  constructor(providerType = 'MOONSHOT', providerOptions = {}) {
    this.client = new AI_PROVIDERS[providerType](providerOptions);
  }

  async getFunctionDescription(functionCode) {
    const prompt = AiQueryTemplate.getFunctionDescription(functionCode);
    const result = await this.client.chat(prompt);
    return result;
  }

  async getFunctionDependencies(functionCode) {
    const prompt = AiQueryTemplate.getFunctionDependencies(functionCode);
    const result = await this.client.chat(prompt);
    validate(SCHEMA.FUNCTION_DEPENDENCY, result);
    return result;
  }

  async getRequiredModuleDependencies(functionCode) {
    const prompt = AiQueryTemplate.getRequiredModuleDependencies(functionCode);
    const result = await this.client.chat(prompt);
    validate(SCHEMA.MODULE_DEPENDENCY, result);
    return result;
  }
}

function registerAiProvider(providerType, provider) {
  AI_PROVIDERS[providerType] = provider;
}

export {
  AiProvider,
  registerAiProvider
}
