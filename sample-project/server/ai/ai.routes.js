import * as aiController from './ai.controller.js';
import joi from 'joi';
import { VERTEX_SCHEMA } from '../../../graph-constants.js';

export default {
  basePath: '/ai',
  description: 'API Routes for AI',
  routes: [
    {
      method: 'post',
      path: '/chat',
      action: [aiController.chat],
      description: 'Chat conversation with AI',
      validators: {
        body: joi.object().keys({
          messages: joi.array().required()
        })
      }
    },
    {
      method: 'post',
      path: '/affected-from-component',
      action: [aiController.affectedFromComponent],
      description: 'By providing business/technical change description on one component, finds all affected components with updated change',
      validators: {
        body: joi.object().keys({
          direction: joi.string().valid('descendants', 'ancestors'),
          component: VERTEX_SCHEMA,
          changeDescription: joi.string().required()
        })
      }
    },
    {
      method: 'post',
      path: '/affected-from-business',
      action: [aiController.affectedFromBusiness],
      description: 'By providing business change description, find all possible affected components',
      validators: {
        body: joi.object().keys({
          changeDescription: joi.string().required()
        })
      }
    }
  ]
};
