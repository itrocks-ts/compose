import { inherits }  from '@itrocks/class-type'
import { Type }      from '@itrocks/class-type'
import { Uses }      from '@itrocks/uses'
import { normalize } from 'path'

type CachedModule = { __esModule: true } & Record<string, boolean | Type> // TODO Only __esModule should be bool

export type ComposeConfig = Record<string, string | string[]>

const EXCLUDE     = 2
const ORIGINAL    = 1
const REPLACEMENT = 0

const cache: Record<string, [CachedModule, CachedModule, string[]]> = {}

const replacements: Record<string, Record<string, { script: string, export: string }[]>> = {}

function configPath(baseDir: string, config: string)
{
	return normalize(require.resolve((config[0] === '/') ? (baseDir + '/' + config) : config))
}

export function compose(baseDir: string, config: ComposeConfig)
{

	// initReplacements
	for (let [module, configReplacements] of Object.entries(config)) {
		let moduleExport: string
		[module, moduleExport] = module.split(':')
		module = configPath(baseDir, module)
		moduleExport ??= 'default'
		replacements[module] ??= {}
		replacements[module][moduleExport] = []
		for (let replacement of Array.isArray(configReplacements) ? configReplacements : [configReplacements]) {
			let replacementExport: string
			[replacement, replacementExport] = replacement.split(':')
			replacement = configPath(baseDir, replacement)
			replacementExport ??= 'default'
			replacements[module][moduleExport].push({script: replacement, export: replacementExport})
		}
	}

	const Module = require('module')
	const superRequire: (...args: any) => typeof Module = Module.prototype.require

	Module.prototype.require = function (file: string)
	{
		// resolve and normalize
		if (file.startsWith('.')) {
			file = this.path + (this.path.endsWith('/') ? file : ('/' + file))
		}
		file = normalize(require.resolve(file))
		// from cache
		if (cache[file]) {
			const which = cache[file][EXCLUDE].includes(this.filename)
				? ORIGINAL
				: REPLACEMENT
			return cache[file][which]
		}
		// no replacement
		let exportEntries = replacements[file]
		if (!exportEntries) {
			const original = superRequire.call(this, ...arguments)
			cache[file] = [original, original, []]
			return original
		}
		// require original
		const module: CachedModule = { __esModule: true }
		const original = superRequire.call(this, ...arguments)
		const replacementFiles = new Array<string>()
		cache[file] = [module, original, replacementFiles]
		Object.assign(module, original)
		// compose
		for (let [moduleExport, replacementEntries] of Object.entries(exportEntries)) {
			if (!original[moduleExport]) {
				if ((moduleExport === 'default') && !original.default) {
					moduleExport = Object.keys(original)[0]
				}
				else {
					throw 'Not found original ' + file + ':' + moduleExport
				}
			}
			const replacementTypes: Type[] = replacementEntries.map(entry => {
				if (!replacementFiles.includes(entry.script)) {
					replacementFiles.push(entry.script)
				}
				const replacementModule = this.require(entry.script)
				if (!replacementModule[entry.export]) {
					if ((entry.export === 'default') && !replacementModule.default) {
						entry.export = Object.keys(replacementModule)[0]
					}
					else {
						throw 'Not found replacement ' + entry.script + ':' + entry.export
					}
				}
				return replacementModule[entry.export]
			})
			const originalType = original[moduleExport]
			let replacementType: Type | undefined
			for (let replacementTypeIndex = 0; replacementTypeIndex < replacementTypes.length; replacementTypeIndex++) {
				if (inherits(replacementTypes[replacementTypeIndex], originalType)) {
					replacementType = replacementTypes.splice(replacementTypeIndex, 1)[0]
					break
				}
			}
			const replacementExport = replacementType
				? (replacementTypes.length ? Uses(...replacementTypes)(replacementType) : replacementType)
				: Uses(...replacementTypes)(originalType)
			for (const [name, type] of Object.entries(original)) {
				if (type === originalType) {
					module[name] = replacementExport
				}
			}
		}
		return module
	}

}
