async function _request(opts) {
}

async function getToken(userId, opts) {
  return _request({
    method: 'get',
    url: 'token_url',
    params: { userId, type: opts.type },
    headers: opts.headers
  });
}

module.exports = {
  getToken
};
