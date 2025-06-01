#!/usr/bin/env node

import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { exec as execCallback } from 'node:child_process'
import util from 'node:util'

import minimist from 'minimist'
import prompts from 'prompts'
import { red, green, bold } from 'kolorist'

import ejs from 'ejs'

import * as banners from './utils/banners.js'

import renderTemplate from './utils/renderTemplate.js'
import { postOrderDirectoryTraverse, preOrderDirectoryTraverse } from './utils/directoryTraverse.js'
import getCommand from './utils/getCommand.js'
import sortDependencies from './utils/sortDependencies.js'
import deepMerge from './utils/deepMerge.js'
import pkg from './package.json' assert { type: 'json' }

const exec = util.promisify(execCallback)
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

console.log('version:', pkg.version)

function isValidPackageName(projectName) {
  return /^(?:@[a-z0-9-*~][a-z0-9-*._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/.test(projectName)
}

function random(length = 12) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let str = ''
  for (let i = 0; i < length; i++) {
    str += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return str
}

function toValidPackageName(projectName) {
  return projectName
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/^[._]/, '')
    .replace(/[^a-z0-9-~]+/g, '-')
}

function canSkipEmptying(dir) {
  if (!fs.existsSync(dir)) {
    return true
  }

  const files = fs.readdirSync(dir)
  if (files.length === 0) {
    return true
  }
  if (files.length === 1 && files[0] === '.git') {
    return true
  }

  return false
}

function emptyDir(dir) {
  if (!fs.existsSync(dir)) {
    return
  }

  postOrderDirectoryTraverse(
    dir,
    (dir) => fs.rmdirSync(dir),
    (file) => fs.unlinkSync(file)
  )
}

function copyCurrentProjectFiles(sourceDir, targetDir, excludeTargetDir = null) {
  // 排除的文件和文件夹
  const excludeList = ['node_modules', 'package.json', '.git']

  // 如果目标文件夹在当前目录下，需要排除它以避免无限循环拷贝
  if (excludeTargetDir) {
    excludeList.push(excludeTargetDir)
  }

  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true })
  }

  function copyRecursive(src, dest) {
    const stat = fs.statSync(src)

    if (stat.isDirectory()) {
      if (!fs.existsSync(dest)) {
        fs.mkdirSync(dest, { recursive: true })
      }

      const files = fs.readdirSync(src)
      for (const file of files) {
        const srcPath = path.join(src, file)
        const destPath = path.join(dest, file)
        copyRecursive(srcPath, destPath)
      }
    } else {
      fs.copyFileSync(src, dest)
    }
  }

  try {
    const files = fs.readdirSync(sourceDir)
    for (const file of files) {
      // 跳过排除列表中的文件和文件夹
      if (excludeList.includes(file)) {
        continue
      }

      const srcPath = path.join(sourceDir, file)
      const destPath = path.join(targetDir, file)

      copyRecursive(srcPath, destPath)
    }

    console.log(`已拷贝当前工程文件到 ${targetDir}`)
  } catch (error) {
    console.error('拷贝当前工程文件时出错:', error.message)
  }
}

const LINE =
  /(?:^|^)\s*(?:export\s+)?([\w.-]+)(?:\s*=\s*?|:\s+?)(\s*'(?:\\'|[^'])*'|\s*"(?:\\"|[^"])*"|\s*`(?:\\`|[^`])*`|[^#\r\n]+)?\s*(?:#.*)?(?:$|$)/gm

// Parser src into an Object
function parseEnv(src) {
  const obj = {}

  // Convert buffer to string
  let lines = src.toString()

  // Convert line breaks to same format
  lines = lines.replace(/\r\n?/gm, '\n')

  let match
  while ((match = LINE.exec(lines)) != null) {
    const key = match[1]

    // Default undefined or null to empty string
    let value = match[2] || ''

    // Remove whitespace
    value = value.trim()

    // Check if double quoted
    const maybeQuote = value[0]

    // Remove surrounding quotes
    value = value.replace(/^(['"`])([\s\S]*)\1$/gm, '$2')

    // Expand newlines if double quoted
    if (maybeQuote === '"') {
      value = value.replace(/\\n/g, '\n')
      value = value.replace(/\\r/g, '\r')
    }

    // Add to object
    obj[key] = value
  }

  return obj
}
const envContext = parseEnv(
  fs.readFileSync(path.resolve(__dirname, './.env'), { encoding: 'utf8' })
)

const normalizeArgv = (argv) => {
  const kwargs = {}
  for (const key in argv) {
    kwargs[key.replace(/-/g, '_').toUpperCase()] = argv[key]
  }
  if (kwargs.PROD) {
    kwargs.NODE_ENV = 'production'
  } else {
    kwargs.NODE_ENV = 'development'
  }
  return kwargs
}

async function init() {
  console.log()
  console.log(
    process.stdout.isTTY && process.stdout.getColorDepth() > 8
      ? banners.gradientBanner
      : banners.defaultBanner
  )
  console.log()
  const cwd = process.cwd()
  // possible options:
  // --default
  // --typescript / --ts
  // --jsx
  // --router / --vue-router
  // --pinia
  // --eslint
  // --eslint-with-prettier (only support prettier through eslint for simplicity)
  // --force (for force overwriting)
  const argv = minimist(process.argv.slice(2), {
    alias: {
      typescript: ['ts'],
      'with-tests': ['tests'],
      router: ['vue-router']
    },
    string: ['_'],
    // all arguments are treated as booleans
    boolean: true
  })
  const normalizedArgv = normalizeArgv(argv)

  // if any of the feature flags is set, we would skip the feature prompts

  let targetDir = argv._[0] // ? `create-${argv._[0]}` : ''
  const defaultProjectName = !targetDir ? 'create-xx' : targetDir

  const forceOverwrite = argv.force

  let result = {}

  try {
    // Prompts:
    // - Project name:
    //   - whether to overwrite the existing directory or not?
    //   - enter a valid package name for package.json
    // - Project language: JavaScript / TypeScript
    result = await prompts(
      [
        {
          name: 'projectName',
          type: targetDir ? null : 'text',
          message: 'Project name:',
          initial: defaultProjectName,
          onState: (state) => (targetDir = String(state.value).trim() || defaultProjectName)
        },
        {
          name: 'shouldOverwrite',
          type: () => (canSkipEmptying(targetDir) || forceOverwrite ? null : 'toggle'),
          message: () => {
            const dirForPrompt =
              targetDir === '.' ? 'Current directory' : `Target directory "${targetDir}"`

            return `${dirForPrompt} is not empty. Remove existing files and continue?`
          },
          initial: true,
          active: 'Yes',
          inactive: 'No'
        },
        {
          name: 'overwriteChecker',
          type: (prev, values) => {
            if (values.shouldOverwrite === false) {
              throw new Error(red('✖') + ` Operation cancelled`)
            }
            return null
          }
        },
        {
          name: 'packageName',
          type: () => (isValidPackageName(targetDir) ? null : 'text'),
          message: 'Project name:',
          initial: () => toValidPackageName(targetDir),
          validate: (dir) => isValidPackageName(dir) || 'Invalid package.json name'
        },
        {
          name: 'githubUser',
          type: 'text',
          message: 'GitHub user:',
          initial: 'xnscu'
        },
        {
          name:"githubScope",
          type: 'select',
          message: 'GitHub scope:',
          initial: 0,
          choices: [
            { title: 'private', value: 'private' },
            { title: 'public', value: 'public' }
          ]
        }
      ],
      {
        onCancel: () => {
          throw new Error(red('✖') + ` Operation cancelled`)
        }
      }
    )
  } catch (cancelled) {
    console.log(cancelled.message)
    process.exit(1)
  }

  // `initial` won't take effect if the prompt type is null
  // so we still have to assign the default values here
  const {
    // projectName = targetDir,
    // packageName = projectName ?? defaultProjectName,
    shouldOverwrite = argv.force,
  } = result

  const root = path.join(cwd, targetDir)
  const projectName = path.basename(root)
  const packageName = projectName ?? defaultProjectName

  if (fs.existsSync(root) && shouldOverwrite) {
    emptyDir(root)
  } else if (!fs.existsSync(root)) {
    fs.mkdirSync(root)
  }

  console.log(`\nScaffolding project in ${root}...`)

  const packageJson = { name: packageName, version: '0.0.0' }

  fs.writeFileSync(path.resolve(root, 'package.json'), JSON.stringify(packageJson, null, 2))


  const templateRoot = path.resolve(__dirname, 'template')
  const callbacks = []
  const render = function render(templateName) {
    const templateDir = path.resolve(templateRoot, templateName)
    renderTemplate(templateDir, root, callbacks)
  }
  // Render base template
  render('.')

  // 判断是否在原始 create-xx 项目中，如果是则拷贝当前工程文件
  // 如果是在生成的 create-* 包中，则只渲染 template 文件夹
  if (pkg.name === 'create-xx') {
    // 拷贝当前工程文件到目标目录
    // 如果目标文件夹在当前目录下，需要排除它以避免无限循环拷贝
    const excludeTargetDir = path.relative(cwd, root).split(path.sep)[0] || null
    copyCurrentProjectFiles(__dirname, root, excludeTargetDir)
  } else {
    console.log('当前运行在生成的 create-* 包中，仅渲染模板文件并拷贝bin文件夹')

    // 拷贝 bin 文件夹到目标目录
    const binDir = path.resolve(__dirname, 'bin')
    if (fs.existsSync(binDir)) {
      const targetBinDir = path.resolve(root, 'bin')
      copyCurrentProjectFiles(binDir, targetBinDir)
    }
  }

  // add dynamic scritps block
  const packageJsonPath = path.resolve(root, 'package.json')
  const existingPkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))
  const updatedPkg = sortDependencies(
    deepMerge(existingPkg, {
      name: projectName,
      private: result.githubScope === 'private' ? true : false,
      scripts: {
        'git': `./bin/init-github.sh ${result.githubScope} ${result.githubUser}`,
        'set-g': `git remote set-url origin git@github.com:${result.githubUser}/${projectName}.git`,
        'add-g': `git remote add origin git@github.com:${result.githubUser}/${projectName}.git`,
      }
    })
  )
  console.log({ argv, normalizedArgv, targetDir, projectName })
  fs.writeFileSync(packageJsonPath, JSON.stringify(updatedPkg, null, 2) + '\n', 'utf-8')

  // An external data store for callbacks to share data
  const dataStore = {}
  // Process callbacks
  for (const cb of callbacks) {
    await cb(dataStore)
  }

  // EJS template rendering
  preOrderDirectoryTraverse(
    root,
    () => {},
    (filepath) => {
      if (filepath.endsWith('.env.ejs') || filepath.endsWith('.ejs')) {
        const template = fs.readFileSync(filepath, 'utf-8')
        const dest = filepath.replace(/\.ejs$/, '')
        const commandContext = normalizedArgv

        // 提取 CREATE_NAME：如果项目名以 "create-" 开头，则提取后面的部分
        let createName = ''
        if (projectName.startsWith('create-')) {
          createName = projectName.replace(/^create-/, '')
        } else if (defaultProjectName.startsWith('create-')) {
          createName = defaultProjectName.replace(/^create-/, '')
        }

        const context = {
          ...envContext,
          ...dataStore[dest],
          ...commandContext,
          TARGET_DIR: targetDir,
          CREATE_NAME: createName,
        }
        const content = ejs.render(template, context)

        fs.writeFileSync(dest, content)
        fs.unlinkSync(filepath)
      }
    }
  )

  // Cleanup.

  // We try to share as many files between TypeScript and JavaScript as possible.
  // If that's not possible, we put `.ts` version alongside the `.js` one in the templates.
  // So after all the templates are rendered, we need to clean up the redundant files.
  // (Currently it's only `cypress/plugin/index.ts`, but we might add more in the future.)
  // (Or, we might completely get rid of the plugins folder as Cypress 10 supports `cypress.config.ts`)

  preOrderDirectoryTraverse(
    root,
    () => {},
    (filepath) => {
      if (filepath.endsWith('.ts')) {
        fs.unlinkSync(filepath)
      }
    }
  )

  // Instructions:
  // Supported package managers: pnpm > yarn > npm
  const userAgent = process.env.npm_config_user_agent ?? ''
  const packageManager = /pnpm/.test(userAgent) ? 'pnpm' : /yarn/.test(userAgent) ? 'yarn' : 'npm'

  console.log(`\nDone. Now run:\n`)
  if (root !== cwd) {
    const cdProjectName = path.relative(cwd, root)
    console.log(
      `  ${bold(green(`cd ${cdProjectName.includes(' ') ? `"${cdProjectName}"` : cdProjectName}`))}`
    )
  }
  console.log(`  ${bold(green(getCommand(packageManager, 'git')))}`)
  console.log(`  ${bold(green(getCommand(packageManager, 'install')))}`)
  console.log(`  ${bold(green(getCommand(packageManager, 'dev')))}`)
  console.log()
}

init().catch((e) => {
  console.error(e, '1')
})