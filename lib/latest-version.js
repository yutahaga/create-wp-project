const fetch = require('node-fetch')

const extractInnerQuotesPattern = /.*"([^"]+)".*/

function getJSON(repo) {
  return fetch(`https://api.github.com/repos/${repo}/releases/latest`).then(
    res => res.json()
  )
}

async function parseJSON(repo) {
  const data = await getJSON(repo)
  if (!('tag_name' in data) || !data.tag_name) {
    return null
  }
  return data.tag_name
}

module.exports = parseJSON
