import joi from 'joi';
import AiQueryTemplate from './fixtures/ai_query_template.js';
import Moonshot from './ai-providers/moonshot.js';

const AI_PROVIDERS = {
  MOONSHOT: Moonshot
}

const SCHEMA = {
  FILE_DESCRIPTION: joi.object({
    description: joi.string(),
    components: joi.array().items(joi.object({
      name: joi.string().required(),
      description: joi.string().required()
    })).required()
  }),
  FUNCTION_DESCRIPTION: joi.object({
    description: joi.string()
  }),
  FUNCTION_DEPENDENCY: joi.object({
    dependencies: joi.array().items(joi.object({
      instanceName: joi.string().required(),
      method: joi.string(),
      field: joi.string(),
      usage: joi.string()
    }).or('method', 'field')).required()
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
  const { error, value } = schema.validate(typeof data === 'string' ? JSON.parse(data.replace(/```json\s*\n/g, '').replace(/\n\s*```/g, '')) : data);
  if (error) {
    throw new Error(error.message);
  }
  return value;
}

class AiProvider {
  constructor(providerType = 'MOONSHOT', providerOptions = {}) {
    this.client = new AI_PROVIDERS[providerType](providerOptions);
  }

  async chat(messages, stream) {
    return this.client.chat(messages, stream);
  }

  async getFileDescription(fileCode) {
    const prompt = AiQueryTemplate.getFileDescription(fileCode);
    const result = await this.client.chat(prompt);
    return validate(SCHEMA.FILE_DESCRIPTION, result);
  }

  async getFunctionDescription(functionCode) {
    const prompt = AiQueryTemplate.getFunctionDescription(functionCode);
    const result = await this.client.chat(prompt);
    return validate(SCHEMA.FUNCTION_DESCRIPTION, result);
  }

  async getFunctionDependencies(functionCode) {
    const prompt = AiQueryTemplate.getFunctionDependencies(functionCode);
    const result = await this.client.chat(prompt);
    return validate(SCHEMA.FUNCTION_DEPENDENCY, result);
  }

  async getRequiredModuleDependencies(functionCode) {
    const prompt = AiQueryTemplate.getRequiredModuleDependencies(functionCode);
    const result = await this.client.chat(prompt);
    return validate(SCHEMA.MODULE_DEPENDENCY, result);
  }
}

function registerAiProvider(providerType, provider) {
  AI_PROVIDERS[providerType] = provider;
}

export {
  AiProvider,
  registerAiProvider
}
