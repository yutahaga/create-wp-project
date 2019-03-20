const path = require('path')
const fs = require('fs-extra')

async function replace(file, ...queries) {
  let content = await fs.readFile(file, 'utf-8')
  queries.forEach(({ regex, replacement }) => {
    content = content.replace(regex, replacement)
  })
  await fs.outputFile(file, content, 'utf-8')
  return content
}

module.exports = replace
