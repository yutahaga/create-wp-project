#!/usr/bin/env node

const path = require('path')
const c = require('chalk')
const fs = require('fs-extra')
const download = require('download')
const ora = require('ora')
const yargs = require('yargs')
const replace = require('../lib/replace')
const getLatestVersion = require('../lib/latest-version')
const generateSalts = require('../lib/salts')
const replaceFilesWithEnv = require('../lib/env')

;(async function() {
  const argv = yargs
    .usage('Usage: $0 <dist-path> [options]')
    .alias('y', 'yes')
    .demandCommand(1).argv
  const relativeDistPath = argv._[0]
  const dist = path.resolve(process.cwd(), relativeDistPath)
  const exists = await fs.pathExists(dist)
  if (exists) {
    console.error(c.red(`[Error] The given path exists`))
    process.exit(-1)
  }

  const spinner = ora('Downloading core files').start()
  const [bedrockVersion, d4wVersion] = await Promise.all([
    getLatestVersion('roots/bedrock'),
    getLatestVersion('wodby/docker4wordpress'),
  ])

  await Promise.all([
    download(
      `https://github.com/wodby/docker4wordpress/releases/download/${d4wVersion}/docker4wordpress.tar.gz`,
      dist,
      { extract: true }
    ),
    download(
      `https://github.com/roots/bedrock/archive/${bedrockVersion}.tar.gz`,
      dist,
      { extract: true }
    ),
  ])
  spinner.succeed('Core files are downloaded')
  spinner.start('Moving files')
  await Promise.all(
    [
      'config',
      'web',
      '.gitignore',
      'composer.json',
      'composer.lock',
      'LICENSE.md',
      'README.md',
      'wp-cli.yml',
    ].map(name =>
      fs.move(
        path.join(dist, `bedrock-${bedrockVersion}`, name),
        path.join(dist, name)
      )
    )
  )
  spinner.succeed('The files are moved')
  spinner.start('Removing unnecessary files')
  await Promise.all(
    [`bedrock-${bedrockVersion}`, 'docker-compose.override.yml'].map(name =>
      fs.remove(path.join(dist, name))
    )
  )

  spinner.start('Replacing the content of files')

  await Promise.all([
    replace(path.join(dist, '.env'), {
      regex: 'DB_HOST=mariadb',
      replacement: `DB_HOST=mariadb
DB_PREFIX=wp_

WP_ENV=development
WP_HOME=http://\${PROJECT_BASE_URL}:8000
WP_SITEURL=\${WP_HOME}/wp

${generateSalts()}`,
    }),

    replace(path.join(dist, 'docker-compose.yml'), {
      regex: '#NGINX_SERVER_ROOT: /var/www/html/subdir',
      replacement: 'NGINX_SERVER_ROOT: /var/www/html/web',
    }),

    replace(
      path.join(dist, 'composer.json'),
      {
        regex: /\s+"(authors|keywords|post-root-package-install)":\s*\[[\S\s]+?\],/gm,
        replacement: '',
      },
      {
        regex: /\s+"support":\s*\{[\S\s]+?\},/gm,
        replacement: '',
      },
      {
        regex: /\s+"homepage":\s*"[\S\s]+?\",/gm,
        replacement: '',
      },
      {
        regex: '"preferred-install": "dist"',
        replacement: `"preferred-install": "dist",
    "sort-packages": true,
    "optimize-autoloader": true`,
      },
      {
        regex: '"repositories": [',
        replacement: `"repositories": [
		{
			"type": "composer",
			"url": "https://wp-languages.github.io"
		},`,
      },
      {
        regex: '"wordpress-install-dir": "web/wp"',
        replacement: `"wordpress-install-dir": "web/wp",
    "dropin-paths": {
      "web/app/languages/": [
        "vendor:koodimonni-language"
      ],
      "web/app/languages/plugins/": [
        "vendor:koodimonni-plugin-language"
      ],
      "web/app/languages/themes/": [
        "vendor:koodimonni-theme-language"
      ]
    }`,
      },
      {
        regex: '"roots/wordpress"',
        replacement: `"koodimonni-language/core-ja": "*",
    "roots/wordpress"`,
      }
    ),
  ])

  spinner.succeed('The content of files are replaced')
  if (!argv['yes']) console.log()

  await Promise.all([
    await replaceFilesWithEnv(path.join(dist, '.env'), argv['y']),
  ])

  if (!argv['yes']) console.log()
  console.log(c.green('Done.'))
  console.log()
  console.log(c.cyan('[Next Steps]'))
  console.log(`${c.yellow('1.')} cd "${relativeDistPath}"`)
  console.log(`${c.yellow('2.')} composer install`)
  console.log(`${c.yellow('3.')} docker-compose up -d`)
})()
