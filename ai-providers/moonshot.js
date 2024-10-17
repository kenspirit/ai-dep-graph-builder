import OpenAI from 'openai';

// https://platform.moonshot.cn/docs/api/chat
export class MoonShot {
  constructor({ apiKey, model = 'moonshot-v1-8k' }) {
    const client = new OpenAI({
      apiKey,
      baseURL: "https://api.moonshot.cn/v1",
    });

    this.client = client;
    this.model = model;
  }

  async chat(prompt, model = this.model) {
    const messages = Array.isArray(prompt) ? prompt : [{ role: 'user', content: prompt }];
    const completion = await this.client.chat.completions.create({
      model,
      messages,
    });
    // history = history.concat(completion.choices[0].message)
    return completion.choices[0].message.content;
  }
}

export default MoonShot;
