import * as aiService from './ai.service.js';

async function chat(req, res) {
  const response = await aiService.chat(req.body.messages);
  res.json({ data: response });
}

async function affectedFromComponent(req, res) {
  const { direction, component, changeDescription } = req.body;
  const response = await aiService.affectedFromComponent(direction, component, changeDescription);
  res.json({ data: response });
}

async function affectedFromBusiness(req, res) {
  const affectedComponents = await aiService.affectedFromBusiness(req.body.changeDescription);
  res.json({ data: affectedComponents });
}

export {
  chat,
  affectedFromComponent,
  affectedFromBusiness
};
