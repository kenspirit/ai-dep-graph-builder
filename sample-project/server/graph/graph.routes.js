import joi from 'joi';
import * as graphController from './graph.controller.js';
import { VERTEX_QUERY_SCHEMA } from '../../../graph-constants.js';

export default {
  basePath: '/graph',
  description: 'API Routes for Graph',
  routes: [
    {
      method: 'get',
      path: '/descendants',
      action: [graphController.getDescendants],
      description: 'Load all descendants of a given vertex',
      validators: {
        query: VERTEX_QUERY_SCHEMA
      }
    },
    {
      method: 'get',
      path: '/ancestors',
      action: [graphController.getAncestors],
      description: 'Load all ancestors of a given vertex',
      validators: {
        query: VERTEX_QUERY_SCHEMA
      }
    },
    {
      method: 'get',
      path: '/all',
      action: [graphController.getAll],
      description: 'Load all affected of a given vertex',
      validators: {
        query: VERTEX_QUERY_SCHEMA
      }
    },
    {
      method: 'get',
      path: '/module-rownumber/:direction',
      action: [graphController.getByModuleRowNumber],
      description: 'Load all affected of a given vertex',
      validators: {
        params: joi.object().keys({
          direction: joi.string().valid('descendants', 'ancestors', 'all').required()
        }),
        query: joi.object().keys({
          rowNumber: joi.number().integer().min(1).required(),
          systemModule: joi.string().required(),
          dependencyType: joi.string().valid('Function', 'Class', 'Field', 'API').default('Function'),
          hasSourceCode: joi.boolean().default(true),
          minFnRowCount: joi.number().integer().min(0).default(0),
          depth: joi.number().integer().min(0).default(0)
        })
      }
    }
  ]
};
