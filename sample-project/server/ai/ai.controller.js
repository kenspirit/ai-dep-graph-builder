import * as aiService from './ai.service.js';

async function chat(req, res) {
  const response = await aiService.chat(req.body.messages);
  res.json(response);
}

async function affectedFromComponent(req, res) {
  const { direction, component, changeDescription } = req.body;
  const response = await aiService.affectedFromComponent(direction, component, changeDescription);
  res.json({ response });
}

async function affectedFromBusiness(req, res) {
  const response = await aiService.affectedFromBusiness(req.body.changeDescription);
  res.json(response);
}

export {
  chat,
  affectedFromComponent,
  affectedFromBusiness
};
