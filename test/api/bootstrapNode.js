import bluebird from "bluebird"
import xhr2 from "xhr2"
import express from "express"
import server_destroy from "server-destroy"
import body_parser from "body-parser"

globalThis.env = __TUTANOTA_ENV

globalThis.Promise = bluebird.Promise
Promise.config({
	longStackTraces: true
})

globalThis.isBrowser = typeof window !== "undefined"

;(async function () {
	if (isBrowser) {
		/**
		 * runs this test exclusively on browsers (not nodec)
		 */
		window.browser = function (func) {
			return func
		}

		/**
		 * runs this test exclusively on node (not browsers)
		 */
		window.node = function () {
			return function () {
			}
		}
	} else {
		const noOp = () => {}

		/**
		 * runs this test exclusively on browsers (not node)
		 */
		globalThis.browser = () => noOp

		/**
		 * runs this test exclusively on node (not browsers)
		 */
		globalThis.node = func => func
		globalThis.btoa = str => Buffer.from(str, 'binary').toString('base64')
		globalThis.atob = b64Encoded => Buffer.from(b64Encoded, 'base64').toString('binary')
		globalThis.WebSocket = noOp

		const nowOffset = Date.now();
		globalThis.performance = {
			now: function () {
				return Date.now() - nowOffset;
			}
		}
		globalThis.performance = {
			now: Date.now,
			mark: noOp,
			measure: noOp,
		}
		const crypto = await import("crypto")
		globalThis.crypto = {
			getRandomValues: function (bytes) {
				let randomBytes = crypto.randomBytes(bytes.length)
				bytes.set(randomBytes)
			}
		}
	}

	globalThis.XMLHttpRequest = xhr2
	globalThis.express = express
	globalThis.enableDestroy = server_destroy
	globalThis.bodyParser = body_parser

	import("../../src/api/Env.js").then((module) => {
		module.bootFinished()
		import('./Suite.js')
	})
})()

