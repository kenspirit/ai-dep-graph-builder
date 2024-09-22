import OpenAI from 'openai';

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
    const completion = await this.client.chat.completions.create({
      model,
      messages: [{ role: 'user', content: prompt }],
    });
    // history = history.concat(completion.choices[0].message)
    return completion.choices[0].message.content;
  }
}

export default MoonShot;
