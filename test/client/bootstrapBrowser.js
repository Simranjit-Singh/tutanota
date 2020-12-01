window.isBrowser = true



window.tutao = {}

Promise.config({
	longStackTraces: false,
	warnings: false
})

System
	.import("./browser/src/api/Env.js")
	.then((module) => {
		module.bootFinished()
		System.import('./browser/test/client/Suite.js')
	})

