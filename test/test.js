import Promise from "bluebird"
import path from "path"
import child_process from "child_process"
import * as env from "../buildSrc/env.js"
import {renderHtml} from "../buildSrc/LaunchHtml.js"
import nollup from 'nollup'
import flow from "flow-bin"
import {rollupDebugPlugins} from "../buildSrc/RollupConfig.js"
import fs from "fs-extra"

let project
if (process.argv.indexOf("api") !== -1) {
	project = "api"
} else if (process.argv.indexOf("client") !== -1) {
	project = "client"
} else {
	console.error("must provide 'api' or 'client' to run the tests")
	process.exit(1)
}

let testRunner = null

const localEnv = env.create("localhost:9000", "unit-test", "Test")

/** Returns cache or null. */
function readCache(cacheLocation) {
	try {
		// *must not* return boolean. Returning "false" will disable caching which is bad.
		return fs.existsSync(cacheLocation) ? JSON.parse(fs.readFileSync(cacheLocation, {encoding: "utf8"})) : null
	} catch (e) {
		return null
	}
}

// We use this homebrew plugin so that libs are copies to _virtual folder and *not* build/node_modules
// (which would be the case with preserve_modules).
// Files in build/node_modules are treated as separate libraries and ES mode resets back to commonjs.
function resolveTestLibsPlugin() {
	const testLibs = {
		ospec: "../node_modules/ospec/ospec.js",
		bluebird: "../node_modules/bluebird/js/browser/bluebird.js"
	}

	return {
		name: "resolve-test-libs",
		resolveId(source) {
			switch (source) {
				case "util":
				case "crypto":
				case "xhr2":
				case "express":
				case "server-destroy":
				case "body-parser":
					return false
			}
			return testLibs[source]
		}
	}
}

/**
 * Simple plugin for virtual module "@tutanota/env" which resolves to the {@param env}.
 * see https://rollupjs.org/guide/en/#a-simple-example
 */
function envPlugin(env) {
	return {
		name: "tutanota-env",
		resolveId(source) {
			if (source === "@tutanota/env") return source
		},
		load(id) {
			if (id === "@tutanota/env") return `export default ${JSON.stringify(env)}`
		},
	}
}

async function build() {
	const start = Date.now()

	// TODO: we could add some watch mode with invalidation for super quick builds
	console.log("Bundling...")
	const bundle = await nollup({
		input: `${project}/bootstrapTests.js`,
		plugins: [
			envPlugin(localEnv),
			resolveTestLibsPlugin(),
			...rollupDebugPlugins(".."),
		],
		treeshake: false,
		preserveModules: true,
	})
	console.log("Generating...")
	const result = await bundle.generate({sourcemap: false, dir: "../build/", format: "esm"})
	result.stats && console.log("Generated in", result.stats.time)

	await Promise.map(result.output, (o) => _writeFile(path.join("..", "build", o.fileName), o.code))
	console.log("Built in", Date.now() - start)
}

(async function () {
	try {
		console.log("Building...")
		await build()
		await createUnitTestHtml()
		console.log("Running tests...")
		const statusCode = await runTest()
		process.exit(statusCode)
	} catch (e) {
		console.error(e)
		process.exit(1)
	}
})()


async function checkFlow() {
	return child_process.spawn(flow, [], {stdio: [process.stdin, process.stdout, process.stderr]})
}

function runTest() {
	if (testRunner != null) {
		console.log("> skipping test run as test are already executed")
	} else {
		return new Promise((resolve) => {
			let testRunner = child_process.fork(`../build/bootstrapTests.js`)
			testRunner.on('exit', (code) => {
				resolve(code)
				testRunner = null
			})
		})
	}
}

async function createUnitTestHtml(watch) {
	let imports = [`test-${project}.js`]

	const template = "import('./bootstrapTests.js')"
	await _writeFile(`../build/test-${project}.js`, [
		`window.whitelabelCustomizations = null`,
		`window.env = ${JSON.stringify(localEnv, null, 2)}`,
		watch ? "new WebSocket('ws://localhost:8080').addEventListener('message', (e) => window.hotReload())" : "",
	].join("\n") + "\n" + template)

	const html = await renderHtml(imports, localEnv)
	await _writeFile(`../build/test-${project}.html`, html)
}

function _writeFile(targetFile, content) {
	return fs.mkdirs(path.dirname(targetFile)).then(() => fs.writeFile(targetFile, content, 'utf-8'))
}
