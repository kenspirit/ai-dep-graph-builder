import axios from 'axios';

export class DifyWorkflow {
  constructor({ user, token, workflow_url }) {
    this.user = user;
    this.token = token;
    this.workflow_url = workflow_url;
  }

  async chat(prompt) {
    const response = await axios.post(this.workflow_url, {
      "inputs": {
        prompt
      },
      "user": this.user
    }, {
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json'
      }
    });

    return response.data.data.outputs.text;
  }
}

export default DifyWorkflow;
