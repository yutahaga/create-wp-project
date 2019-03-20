const { wpSalts } = require('wp-salts')

function generateSalts() {
  const salts = wpSalts()
  return Object.keys(salts)
    .map(key => `${key}='${salts[key].replace(/'/g, "\\'")}'`)
    .join('\n')
}

module.exports = generateSalts
