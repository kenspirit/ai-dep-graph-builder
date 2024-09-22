const moduleCode = `
const zlib = require('zlib');
const { Transform } = require('stream');
const { pipeline } = require('node:stream/promises');
const momentTimezone = require('moment-timezone');
const stringify = require('csv-stringify/lib/sync');
const organizationModel = require('../../common/mongoose_models/organization');
const organizationHistoryModel = require('../../common/mongoose_models/organizationhistory');
const _ = require('lodash');
const { v4: uuidv4 } = require('uuid');
const organizationNetworkConfig = require('../networkconfig/organizationNetworkConfig.service');
const jsrsa = require('jsrsasign');
const organizationConstant = require('../constant/organization.constant');
const HISTORY_MODEL_NAME = organizationHistoryModel.name;
const OABCS_API_CONFIG_MODEL_NAME = 'oabcsapiConfig';

const logger = require('../../server/config/logger').getLogger('organization.service');
const stableStringify = require('fast-json-stable-stringify');
const constant = require('../constant/codeNode.constant');
const emailService = require('../services/email/email.service');
const joiUtil = require('../util/joi.utils');
const {
  throwError,
  INVALID_ORG_ROLES,
  INVALID_BRANCH_IN_CONTACT
} = require('../../common/utils/serviceErrorCode');
const configLoader = require('../config/config-loader');
const unlocodeUtil = require('../util/unlocode.util');

const updateAll = async ({ model, where, data, operator }) => {
  if (operator) {
    data.updatedBy = headerUtil.parseOperatorByModelName(operator, model);
  }
  const Model = MongooseManager.getModelConstructor(model);

  const updateResult = await Model.updateMany(_convertWhere(where, Model), data);
  return {
    count: updateResult.modifiedCount
  };
};

module.exports = {
  updateAll
};
`;

import config from './sample.config.js';
import { AiProvider } from './index.js';
const ai = new AiProvider(config.aiProvider.type, config.aiProvider.providerOptions);

ai.getRequiredModuleDependencies(moduleCode).then((result) => {
  console.log(result);
});
