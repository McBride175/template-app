import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const DEFAULT_PROJECT_ROOT = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)))

function isFilePathLike(value) {
  return value.startsWith('.') || value.startsWith('/') || value.startsWith('file:')
}

function normalizePathSpecifier(specifier) {
  if (specifier instanceof URL) {
    return fileURLToPath(specifier)
  }

  if (typeof specifier === 'string' && specifier.startsWith('file:')) {
    return fileURLToPath(specifier)
  }

  return specifier
}

function resolveTypeScriptPath(basePath) {
  const candidates = [
    basePath,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    `${basePath}.js`,
    path.join(basePath, 'index.ts'),
    path.join(basePath, 'index.tsx'),
    path.join(basePath, 'index.js'),
  ]

  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate
    }
  }

  return null
}

export function loadTypeScriptModule(entrySpecifier, options = {}) {
  const projectRoot = options.projectRoot ?? DEFAULT_PROJECT_ROOT
  const mocks = options.mocks ?? {}
  const moduleCache = new Map()
  const nodeRequire = createRequire(import.meta.url)

  function loadModuleSync(modulePath) {
    const normalizedPath = path.resolve(modulePath)
    if (moduleCache.has(normalizedPath)) {
      return moduleCache.get(normalizedPath).exports
    }

    const source = fs.readFileSync(normalizedPath, 'utf8')
    const transpiled = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
        jsx: ts.JsxEmit.ReactJSX,
      },
      fileName: normalizedPath,
    })

    const moduleShim = { exports: {} }
    moduleCache.set(normalizedPath, moduleShim)

    const dirname = path.dirname(normalizedPath)

    const localRequire = (request) => {
      if (Object.prototype.hasOwnProperty.call(mocks, request)) {
        return mocks[request]
      }

      if (request.startsWith('@/')) {
        const aliasResolved = resolveTypeScriptPath(path.join(projectRoot, request.slice(2)))
        if (!aliasResolved) {
          throw new Error(`Could not resolve alias import: ${request}`)
        }
        return loadModuleSync(aliasResolved)
      }

      if (isFilePathLike(request)) {
        const normalizedRequest = normalizePathSpecifier(request)
        const resolvedPath = resolveTypeScriptPath(path.resolve(dirname, normalizedRequest))
        if (!resolvedPath) {
          throw new Error(`Could not resolve relative import: ${request} from ${normalizedPath}`)
        }
        return loadModuleSync(resolvedPath)
      }

      return nodeRequire(request)
    }

    const wrapped = `(function (exports, require, module, __filename, __dirname) {\n${transpiled.outputText}\n})`
    const compiledFn = vm.runInThisContext(wrapped, { filename: normalizedPath })
    compiledFn(moduleShim.exports, localRequire, moduleShim, normalizedPath, dirname)
    return moduleShim.exports
  }

  const normalizedEntry = normalizePathSpecifier(entrySpecifier)
  const resolvedEntry = resolveTypeScriptPath(
    path.isAbsolute(normalizedEntry) ? normalizedEntry : path.join(projectRoot, normalizedEntry)
  )

  if (!resolvedEntry) {
    throw new Error(`Could not resolve entry module: ${String(entrySpecifier)}`)
  }

  return loadModuleSync(resolvedEntry)
}
