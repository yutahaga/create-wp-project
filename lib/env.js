const path = require('path')
const fs = require('fs-extra')
const compareVersions = require('compare-versions')
const inquirer = require('inquirer')

const required = {
  PHP: true,
  NGINX: true,
  traefik: true,
  portainer: true,
  'docker-sync': true,
  files: true,
}

const optional = {
  NODE: true,
  VARNISH: true,
  SOLR: true,
  ELASTICSEARCH: true,
  KIBANA: true,
  POSTGRES: true,
}

const labels = {
  MARIADB: 'MariaDB',
  PHP: 'PHP',
  NGINX: 'Nginx',
  REDIS: 'Redis',
  NODE: 'Node.js',
  VARNISH: 'Varnish',
  SOLR: 'Apache Solr',
  ELASTICSEARCH: 'Elasticsearch',
  KIBANA: 'Kibana',
  POSTGRES: 'PostgreSQL',
}

const forceDefault = {
  pma: true,
}

const forceDefaultLargest = {
  MARIADB: 'MariaDB',
  PHP: 'PHP',
  NGINX: 'Nginx',
  REDIS: true,
}

const when = {
  POSTGRES: ansewers => !ansewers['MARIADB'],
}

let envCache, variablesCache, hasMultipleCache
async function parseEnv(file) {
  if (hasMultipleCache) {
    return hasMultipleCache
  }
  envCache = await fs.readFile(file, 'utf-8')
  const pattern = /(#?)([^\s=]+?)_TAG=(\S+)/g

  const variables = {}
  let match
  while ((match = pattern.exec(envCache)) !== null) {
    const [_all, notDefault, name, value] = match
    variables[name] = variables[name] || []
    variables[name].push({ value, default: Boolean(notDefault) })
  }

  const hasMultiple = {}
  Object.keys(variables).map(name => {
    if (variables[name].length > 1) {
      hasMultiple[name] = variables[name]
    }
  })

  variablesCache = variables
  hasMultipleCache = hasMultiple

  return hasMultiple
}

let dockerComposeCache, parsedDockerComposeCache
async function parseDockerCompose(file) {
  if (parsedDockerComposeCache) {
    return parsedDockerComposeCache
  }
  dockerComposeCache = await fs.readFile(file, 'utf-8')

  const lines = dockerComposeCache.split('\n')

  const startPattern = /^(#?)\s\s([^\s:]+):/
  const services = {}
  let opened = null
  lines.forEach((line, index) => {
    const matches = line.match(startPattern)
    if (!matches) {
      if (!opened) return
      if (line === '') {
        services[opened].end = index - 1
        opened = null
      }
      return
    }
    const [_all, disabled, name] = matches
    opened = name
    services[name] = {
      disabled: Boolean(disabled),
      start: index,
    }
  })

  parsedDockerComposeCache = services

  return services
}

function generateEnvQuestions(variables) {
  return Object.keys(variables).map(name => {
    const list = variables[name]
    const defaultValue = list.find(item => item.default)
    const largestValue = list.reduce((current, item) => {
      if (
        compareVersions(
          item.value.split('-').shift(),
          current.split('-').shift()
        ) > 0
      ) {
        return item.value
      }
      return current
    }, '0.0.0')
    const choices = list.reduce(
      (current, item) => {
        current.push({
          name: item.value,
          value: item.value,
          short: item.value,
        })
        return current
      },
      required[name]
        ? []
        : [{ name: 'Disabled', value: false, short: 'disabled' }]
    )
    return {
      type: 'list',
      name,
      message: labels[name],
      default: () =>
        optional[name]
          ? false
          : name in forceDefaultLargest
          ? largestValue
          : defaultValue
          ? defaultValue.value
          : false,
      choices,
      when: when[name] ? when[name] : true,
    }
  })
}

function generateServicesQuestions(services) {
  return {
    type: 'checkbox',
    name: 'services',
    message: 'Check the required services',
    choices: Object.keys(services).map(name => {
      const service = services[name]

      return {
        name,
        value: name,
        checked: name in forceDefault ? forceDefault[name] : !service.disabled,
      }
    }),
  }
}

function yesQuestions(questions) {
  let answers
  if (Array.isArray(questions)) {
    answers = {}
    questions.forEach(question => {
      if (
        (typeof question.when === 'function' && question.when(answers)) ||
        question.when === true
      ) {
        answers[question.name] = question.default()
      }
    })
  } else {
    answers = questions.choices.filter(c => c.checked).map(c => c.value)
  }

  return answers
}

async function selectEnv(file, yes) {
  const variables = await parseEnv(file)
  let answers
  if (yes) {
    answers = yesQuestions(generateEnvQuestions(variables))
  } else {
    answers = await inquirer.prompt(generateEnvQuestions(variables))
  }

  Object.keys(when).forEach(name => {
    if (!(name in answers)) {
      answers[name] = false
    }
  })

  return answers
}

async function selectServices(file, yes) {
  const [data, variables] = await Promise.all([
    await parseDockerCompose(file),
    await parseEnv(file),
  ])
  const variableLowerNames = Object.keys(variables).map(name =>
    name.toLowerCase()
  )

  const services = {}
  Object.keys(data).forEach(name => {
    if (variableLowerNames.indexOf(name) === -1 && !required[name]) {
      services[name] = data[name]
    }
  })

  let rawAnswers
  if (yes) {
    rawAnswers = yesQuestions(generateServicesQuestions(services))
  } else {
    rawAnswers = await inquirer
      .prompt(generateServicesQuestions(services))
      .then(s => s.services)
  }

  const answers = {}
  Object.keys(services).forEach(name => {
    answers[name] = rawAnswers.indexOf(name) !== -1
  })

  return answers
}

function replaceEnv(answers, file) {
  let output = envCache
  Object.keys(answers).forEach(name => {
    const varname = `${name}_TAG`
    const value = answers[name]
    if (value) {
      output = output.replace(`#${varname}=${value}`, `${varname}=${value}`)
      output = output.replace(
        new RegExp(`#?(${varname}=(?!${value}).+\n)`, 'g'),
        '#$1'
      )
    } else {
      output = output.replace(new RegExp(`#?(${varname}=.+\n)`, 'g'), '#$1')
    }
  })
  return fs.outputFile(file, output, 'utf-8')
}

async function replaceDockerCompose(answers, file) {
  const data = await parseDockerCompose(file)

  let output = dockerComposeCache
  const lines = output.split('\n')

  Object.keys(answers).forEach(name => {
    const lowerName = name.toLowerCase()
    const enabled = Boolean(answers[name])
    if (
      !(lowerName in data) ||
      (answers[name] && !data[lowerName].disabled) ||
      (!answers[name] && data[lowerName].disabled)
    ) {
      return
    }

    for (
      let i = data[lowerName].start, iz = data[lowerName].end;
      i <= iz;
      i++
    ) {
      lines[i] = enabled ? lines[i].slice(1) : `#${lines[i]}`
    }
  })

  output = lines.join('\n')

  await fs.outputFile(file, output, 'utf-8')
}

async function replaceFiles(file, yes = false) {
  const dockerComposeFile = path.resolve(file, '../docker-compose.yml')
  const envAnswers = await selectEnv(file, yes)
  console.log()
  const serviceAnswers = await selectServices(dockerComposeFile, yes)
  await Promise.all([
    replaceEnv(envAnswers, file),
    replaceDockerCompose(
      { ...envAnswers, ...serviceAnswers },
      dockerComposeFile
    ),
  ])
}

module.exports = replaceFiles
