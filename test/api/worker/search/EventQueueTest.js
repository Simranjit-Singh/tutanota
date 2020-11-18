// @flow
import o from "ospec/ospec.js"
import type {QueuedBatch} from "../../../../src/api/worker/search/EventQueue"
import {EventQueue} from "../../../../src/api/worker/search/EventQueue"
import {replaceAllMaps} from "../../TestUtils"
import type {EntityUpdate} from "../../../../src/api/entities/sys/EntityUpdate"
import {createEntityUpdate} from "../../../../src/api/entities/sys/EntityUpdate"
import type {OperationTypeEnum} from "../../../../src/api/common/TutanotaConstants"
import {OperationType} from "../../../../src/api/common/TutanotaConstants"
import {defer} from "../../../../src/api/common/utils/Utils"
import {ConnectionError} from "../../../../src/api/common/error/RestError"
import {MailTypeRef} from "../../../../src/api/entities/tutanota/Mail"

o.spec("EventQueueTest", function () {
	let queue: EventQueue
	let processElement: OspecSpy<(nextElement: QueuedBatch) => Promise<void>>
	let lastProcess: {resolve: () => void, reject: (Error) => void, promise: Promise<void>}

	const newUpdate = (type: OperationTypeEnum, instanceId: string) => {
		const update = createEntityUpdate()
		update.operation = type
		update.instanceId = instanceId
		return update
	}

	o.beforeEach(function () {
		lastProcess = defer()
		processElement = o.spy(() => {
			if (queue._eventQueue.length === 1) {
				// the last element is removed right after processing it
				lastProcess.resolve()
			}
			return Promise.resolve()
		})
		queue = new EventQueue(processElement)
	})

	o("pause and resume", async function () {
		queue.pause()
		const groupId = "groupId"
		const batchWithOnlyDelete: QueuedBatch = {
			events: [newUpdate(OperationType.DELETE, "1")],
			groupId,
			batchId: "1"
		}
		queue.addBatches([batchWithOnlyDelete])

		await Promise.delay(5, Promise.resolve())
		o(queue._eventQueue.length).equals(1)

		queue.resume()
		await lastProcess.promise
		o(queue._eventQueue.length).equals(0)
	})

	o("start after pause", async function () {
		queue.pause()
		const groupId = "groupId"
		const batchWithOnlyDelete: QueuedBatch = {
			events: [newUpdate(OperationType.DELETE, "1")],
			groupId,
			batchId: "1"
		}
		queue.addBatches([batchWithOnlyDelete])

		await Promise.delay(5, Promise.resolve())
		queue.start()
		o(queue._eventQueue.length).equals(1)
	})

	o("handle ConnectionError", async function () {
		const groupId = "groupId"
		const batchWithThrow: QueuedBatch = {
			events: [newUpdate(OperationType.CREATE, "2"), newUpdate(OperationType.DELETE, "2")],
			groupId,
			batchId: "2"
		}
		const batchWithOnlyCreate: QueuedBatch = {
			events: [newUpdate(OperationType.CREATE, "3")],
			groupId,
			batchId: "3"
		}

		lastProcess = defer()
		processElement = o.spy(() => {
			if (queue._eventQueue.length === 1) {
				// the last element is removed right after processing it
				lastProcess.resolve()
			}
			return Promise.resolve()
		})
		let queue = new EventQueue((nextElement: QueuedBatch) => {
			if (nextElement.batchId === "2") {
				return Promise.reject(new ConnectionError("no connection"))
			} else {
				o("should not be called").equals(true)
				return Promise.resolve()
			}
		})
		queue.addBatches([batchWithThrow, batchWithOnlyCreate])

		queue.start()
		await Promise.delay(5, Promise.resolve())
		o(queue._eventQueue.length).equals(2)
		o(queue._processingActive).equals(null)
	})

	o.spec("collapsing events", function () {
		o("create + delete == delete", async function () {
			const createEvent = createUpdate(OperationType.CREATE, "new-mail-list", "1", "u1")
			const deleteEvent = createUpdate(OperationType.DELETE, createEvent.instanceListId, createEvent.instanceId, "u2")

			queue.add("batch-id-1", "group-id", [createEvent])
			queue.add("batch-id-2", "group-id", [deleteEvent])
			queue.start()
			await lastProcess.promise

			const expectedDelete = createUpdate(OperationType.DELETE, createEvent.instanceListId, createEvent.instanceId, "u2")

			o(processElement.calls.map(c => c.args)).deepEquals([
				[{events: [], batchId: "batch-id-1", groupId: "group-id"}],
				[{events: [expectedDelete], batchId: "batch-id-2", groupId: "group-id"}],
			])
		})

		o("create + update + delete == delete", async function () {
			const createEvent = createUpdate(OperationType.CREATE, "new-mail-list", "1", "u1")
			const updateEvent = createUpdate(OperationType.UPDATE, "new-mail-list", "1", "u2")
			const deleteEvent = createUpdate(OperationType.DELETE, createEvent.instanceListId, createEvent.instanceId, "u")

			queue.add("batch-id-1", "group-id", [createEvent])
			queue.add("batch-id-2", "group-id", [updateEvent])
			queue.add("batch-id-3", "group-id", [deleteEvent])
			queue.start()
			await lastProcess.promise

			const expectedDelete = createUpdate(OperationType.DELETE, createEvent.instanceListId, createEvent.instanceId, "u")

			o(processElement.calls.map(c => c.args)).deepEquals([
				[{events: [], batchId: "batch-id-1", groupId: "group-id"}],
				[{events: [expectedDelete], batchId: "batch-id-3", groupId: "group-id"}],
			])
		})

		o("create & move == create*", async function () {
			const createEvent = createUpdate(OperationType.CREATE, "new-mail-list", "1", "u1")
			const deleteEvent = createUpdate(OperationType.DELETE, createEvent.instanceListId, createEvent.instanceId, "u2")
			const createAgainEvent = createUpdate(OperationType.CREATE, "new-mail-list-2", createEvent.instanceId, "u3")

			queue.add("batch-id-1", "group-id", [createEvent])
			queue.add("batch-id-2", "group-id", [deleteEvent, createAgainEvent])

			queue.start()
			await lastProcess.promise

			const expectedCreate = createUpdate(OperationType.CREATE, "new-mail-list-2", "1", "u3")

			o(processElement.calls.map(c => c.args)).deepEquals([
				[{events: [expectedCreate], groupId: "group-id", batchId: "batch-id-1"}],
			])
		})

		o("move + move == move", async function () {
			const instanceId = "new-mail"
			// Two parts of the "move" event in the firts batch
			const deleteEvent = createUpdate(OperationType.DELETE, "new-mail-list-1", instanceId, "u1")
			const createEvent = createUpdate(OperationType.CREATE, "new-mail-list-2", instanceId, "u2")
			// Two parts of the "move" event in the second batch
			const deleteAgainEvent = createUpdate(OperationType.DELETE, "new-mail-list-2", instanceId, "u3")
			const createAgainEvent = createUpdate(OperationType.CREATE, "new-mail-list-3", instanceId, "u4")

			queue.add("batch-id-1", "group-id", [deleteEvent, createEvent])
			queue.add("batch-id-2", "group-id", [deleteAgainEvent, createAgainEvent])

			queue.start()
			await lastProcess.promise

			const expectedEvents = [
				createUpdate(OperationType.DELETE, "new-mail-list-1", instanceId, "u1"),
				createUpdate(OperationType.CREATE, "new-mail-list-3", instanceId, "u4")
			]
			o(processElement.calls.map(c => c.args)).deepEquals([
				[{events: expectedEvents, groupId: "group-id", batchId: "batch-id-1"}]
			])
		})

		o("update + move == delete + create", async function () {
			const instanceId = "mailId"
			const updateEvent = createUpdate(OperationType.UPDATE, "new-mail-list", instanceId, "u1")
			// Two parts of the "move" event in the second batch
			const deleteEvent = createUpdate(OperationType.DELETE, "new-mail-list", instanceId, "u2")
			const createEvent = createUpdate(OperationType.CREATE, "new-mail-list-2", instanceId, "u3")

			queue.add("batch-id-1", "group-id", [updateEvent])
			queue.add("batch-id-2", "group-id", [deleteEvent, createEvent])

			queue.start()
			await lastProcess.promise

			const expectedEvents = [
				createUpdate(OperationType.DELETE, "new-mail-list", instanceId, "u1"),
				createUpdate(OperationType.CREATE, "new-mail-list-2", instanceId, "u3")
			]

			o(processElement.calls.map(c => c.args)).deepEquals([
				[{events: expectedEvents, groupId: "group-id", batchId: "batch-id-1"}]
			])
		})

		function createUpdate(type: OperationTypeEnum, listId: Id, instanceId: Id, eventId?: Id): EntityUpdate {
			let update = createEntityUpdate()
			update.operation = type
			update.instanceListId = listId
			update.instanceId = instanceId
			update.type = MailTypeRef.type
			update.application = MailTypeRef.app
			if (eventId) {
				update._id = eventId
			}
			return update
		}
	})
})