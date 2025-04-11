import joi from 'joi';

const VERTEX_SCHEMA = joi.object({
  category: joi.string().required().valid('businessModule', 'microService', 'systemModule', 'component'),
  name: joi.string().required(),
  type: joi.string().required(), // -- Class / File / UI / Function / Field / Interface (API URL/Queue/Table/Store Procedure)
  fileName: joi.string(), // File name
  visibility: joi.string(),
  public: joi.boolean().default(false),
  description: joi.string().allow('', null).default(''),
  startRow: joi.number().integer(),
  endRow: joi.number().integer(),
  dependencies: joi.array().items(joi.link('#vertex')),
  sourceCode: joi.string().when('category', {
    is: 'component',
    then: joi.string().allow('', null).default(''),
    otherwise: joi.forbidden()
  }),
  businessModules: joi.array().when('category', {
    is: 'systemModule',
    then: joi.array().items(joi.string()),
    otherwise: joi.forbidden()
  }),
  microService: joi.string().when('category', {
    is: joi.string().valid('component', 'systemModule'),
    then: joi.required(),
    otherwise: joi.forbidden()
  }),
  systemModule: joi.string().when('category', {
    is: 'component',
    then: joi.required(),
    otherwise: joi.forbidden()
  }),
  language: joi.string()
}).id('vertex');

const VERTEX_QUERY_SCHEMA = joi.object({
  category: joi.string().required().valid('businessModule', 'microService', 'systemModule', 'component'),
  name: joi.string().required(),
  microService: joi.string().when('category', {
    is: joi.string().valid('component', 'systemModule'),
    then: joi.required(),
    otherwise: joi.forbidden()
  }),
  systemModule: joi.string().when('category', {
    is: 'component',
    then: joi.required(),
    otherwise: joi.forbidden()
  }),
  language: joi.string()
}).unknown(true);

const UPDATABLE_FIELDS = [
  'name',
  'description',
  'type',
  'fileName',
  'visibility',
  'public',
  'startRow',
  'endRow',
  'sourceCode',
  'businessModules'
];

export {
  VERTEX_SCHEMA,
  VERTEX_QUERY_SCHEMA,
  UPDATABLE_FIELDS
};
