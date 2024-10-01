import OpenAI from 'openai';

// https://open.bigmodel.cn/
export class BigModel {
  constructor({ apiKey, model = 'glm-4-flash' }) {
    const client = new OpenAI({
      apiKey,
      baseURL: "https://open.bigmodel.cn/api/paas/v4/",
    });

    this.client = client;
    this.model = model;
  }

  async chat(prompt, model = this.model) {
    const completion = await this.client.chat.completions.create({
      model,
      messages: [{ role: 'user', content: prompt }],
    });
    // history = history.concat(completion.choices[0].message)
    return completion.choices[0].message.content;
  }
}

export default BigModel;
