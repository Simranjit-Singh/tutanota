//@flow

import {OperationType} from "../../common/TutanotaConstants"
import {assertNotNull, containsEventOfType} from "../../common/utils/Utils"
import {ConnectionError, ServiceUnavailableError} from "../../common/error/RestError"
import type {WorkerImpl} from "../WorkerImpl"
import type {EntityUpdate} from "../../entities/sys/EntityUpdate"
import {isSameId} from "../../common/EntityFunctions"
import {firstThrow, last} from "../../common/utils/ArrayUtils"
import {ProgrammingError} from "../../common/error/ProgrammingError"
import {createEntityUpdate} from "../../entities/sys/EntityUpdate"

export type QueuedBatch = {
	events: EntityUpdate[], groupId: Id, batchId: Id
}


export const EntityModificationType = Object.freeze({
	CREATE: 'CREATE',
	UPDATE: 'UPDATE',
	MOVE: 'MOVE',
	DELETE: 'DELETE',
})
export type EntityModificationTypeEnum = $Values<typeof EntityModificationType>

type QueueAction = (nextElement: QueuedBatch) => Promise<void>

export function batchMod(events: $ReadOnlyArray<EntityUpdate>, id: Id): EntityModificationTypeEnum {
	for (const event of events) {
		if (event.instanceId === id) {
			switch (event.operation) {
				case OperationType.CREATE:
					return containsEventOfType(events, OperationType.DELETE, id) ? EntityModificationType.MOVE : EntityModificationType.CREATE
				case OperationType.UPDATE:
					return EntityModificationType.UPDATE
				case OperationType.DELETE:
					return containsEventOfType(events, OperationType.CREATE, id) ? EntityModificationType.MOVE : EntityModificationType.DELETE
				default:
					throw new ProgrammingError(`Unknown operation: ${event.operation}`)
			}
		}
	}
	throw new ProgrammingError(`Empty batch?`)
}

export class EventQueue {
	/** Batches to processs. Oldest first. */
	+_eventQueue: Array<QueuedBatch>;
	+_lastOperationForEntity: Map<Id, QueuedBatch>;
	+_queueAction: QueueAction;

	_processingActive: ?QueuedBatch;
	_paused: boolean;

	/**
	 * @param queueAction which is executed for each batch. Must *never* throw.
	 */
	constructor(queueAction: QueueAction) {
		this._eventQueue = []
		this._lastOperationForEntity = new Map()
		this._processingActive = null
		this._paused = false
		this._queueAction = queueAction
	}

	addBatches(batches: $ReadOnlyArray<QueuedBatch>) {
		for (const batch of batches) {
			this.add(batch.batchId, batch.groupId, batch.events)
		}
	}

	add(batchId: Id, groupId: Id, events: $ReadOnlyArray<EntityUpdate>) {
		const newBatch: QueuedBatch = {events: [], groupId, batchId}

		for (const next of events) {
			const elementId = next.instanceId
			const currentBatch = this._lastOperationForEntity.get(elementId)
			if (currentBatch == null || this._processingActive != null && this._processingActive === currentBatch) {
				// If there's no current operation, there's nothing to merge, just add
			// If current operation is already being processed, don't modify it, we cannot merge anymore and should just append.
				newBatch.events.push(next)
			} else {
				const nextMod = batchMod(events, next.instanceId)
				const currentMod = batchMod(currentBatch.events, next.instanceId)
				if (nextMod === EntityModificationType.DELETE) {
					newBatch.events.push(next)
					// TODO: cancel everything else for this entity in the queue
				} else if (currentMod === EntityModificationType.CREATE && nextMod === EntityModificationType.UPDATE) {
					// Skip the update because the create was not processed yet and we will download the updated version already
				} else if (currentMod === EntityModificationType.CREATE && nextMod === EntityModificationType.MOVE) {
					this._replace(currentBatch, Object.assign({}, next, {
						operation: OperationType.CREATE,
						instanceListId: next.instanceListId,
					}))
				} else if (currentMod === EntityModificationType.UPDATE && nextMod === EntityModificationType.UPDATE) {
					// Skip next update operation
				} else if (currentMod === EntityModificationType.UPDATE && nextMod === EntityModificationType.MOVE) {
					// The instance is not at the original location anymore so we cannot leave update in because we won't be able to download
					// it but we also cannot say that it just moved so we need to actually delete and create it again

					// Add delete at the old location
					const oldUpdate = currentBatch.events.find(e => e.instanceId === next.instanceId)
					this._replace(currentBatch, Object.assign({}, oldUpdate, {
						operation: OperationType.DELETE,
					}))
					// And create at the new one
					currentBatch.events.push(createEntityUpdate({
						instanceId: next.instanceId,
						instanceListId: next.instanceListId,
						operation: OperationType.CREATE,
						type: next.type,
						application: next.application,
					}))
				} else if (currentMod === EntityModificationType.MOVE && nextMod === EntityModificationType.UPDATE) {
					// Leave both, as we expect MOVE to not mutate the entity
					// We will execute this twice for DELETE and CREATE but it's fine, we need both
					currentBatch.events.push(next)
				} else if (currentMod === EntityModificationType.MOVE && nextMod === EntityModificationType.MOVE) {
					if (next.operation === OperationType.DELETE) {
						// Skip delete part
					} else {
						// Replace move with a move from original location to the final destination
						const oldDelete = assertNotNull(
							currentBatch.events.find(e => e.instanceId === next.instanceId && e.operation === OperationType.DELETE)
						)

						this._replace(currentBatch, next)
						// Keep the old delete
						currentBatch.events.unshift(oldDelete)
					}
				} else {
					throw new ProgrammingError(`Impossible modification combination ${currentMod} ${nextMod}`)
				}
			}
		}
		if (newBatch.events.length !== 0) {
			this._eventQueue.push(newBatch)
			for (const update of newBatch.events) {
				this._lastOperationForEntity.set(update.instanceId, newBatch)
			}
		}
	}

	start() {
		if (this._processingActive) {
			return
		}
		this._processNext()
	}

	_processNext() {
		if (this._paused) {
			return
		}
		const next = this._eventQueue[0]
		if (next) {
			this._processingActive = next
			// TODO: we take the first one here but we don't always add to the queue

			this._queueAction(firstThrow(this._eventQueue))
			    .then(() => {
				    this._eventQueue.shift()
				    this._processingActive = null
				    this._processNext()
			    })
			    .catch((e) => {
				    // TODO: is this ok? we probably want to resume sooner for EventBus and maybe we want to skip the event if it's not
				    //  handled
				    // processing continues if the event bus receives a new event
				    this._processingActive = null
			    	if (!(e instanceof ServiceUnavailableError || e instanceof ConnectionError)) {
					    console.error("Uncaught EventQueue error!", e)
				    }
			    })

		}
	}

	clear() {
		this._eventQueue.splice(0)
	}

	pause() {
		this._paused = true
	}

	resume() {
		this._paused = false
		this.start()
	}

	_replace(batch: QueuedBatch, newMod: EntityUpdate) {
		batch.events = batch.events.filter((e) => e.instanceId !== newMod.instanceId)
		batch.events.push(newMod)
	}
}

// export class EventQueue {
// 	_processingActive: boolean
// 	_eventQueue: QueuedBatch[]
// 	_processNextQueueElement: (nextElement: QueuedBatch, futureActions: FutureBatchActions) => Promise<void>
// 	_futureActions: FutureBatchActions
// 	_paused: boolean
// 	_worker: WorkerImpl
//
// 	constructor(worker: WorkerImpl, processNextQueueElement: (nextElement: QueuedBatch, futureActions: FutureBatchActions) => Promise<void>) {
// 		this._worker = worker
// 		this._processingActive = false
// 		this._eventQueue = []
// 		this._processNextQueueElement = processNextQueueElement
// 		this._futureActions = new FutureBatchActions()
// 		this._paused = false
// 	}
//
// 	start() {
// 		if (this._processingActive) {
// 			return
// 		}
// 		this._processNext()
// 	}
//
// 	_processNext() {
// 		if (this._paused) {
// 			return
// 		}
// 		if (this._eventQueue.length > 0) {
// 			this._processingActive = true
// 			this._processNextQueueElement(this._eventQueue[0], this._futureActions)
// 			    .then(() => {
// 				    this._eventQueue.shift()
// 				    this._processingActive = false
// 				    this._processNext()
// 			    })
// 			    .catch(ServiceUnavailableError, e => {
// 				    // processing continues if the event bus receives a new event
// 				    this._processingActive = false
// 			    })
// 			    .catch(ConnectionError, e => {
// 				    // processing continues if the event bus receives a new event
// 				    this._processingActive = false
// 			    })
// 			    .catch(e => {
// 				    // processing continues if the event bus receives a new event
// 				    this._processingActive = false
// 				    this._worker.sendError(e)
// 			    })
// 		}
// 	}
//
// 	addBatches(batches: QueuedBatch[]) {
// 		this._futureActions.populate(batches.map(b => b.events))
// 		for (let el of batches) {
// 			this._eventQueue.push(el)
// 		}
// 	}
//
// 	clear() {
// 		this._eventQueue.splice(0)
// 	}
//
// 	pause() {
// 		this._paused = true
// 	}
//
// 	resume() {
// 		this._paused = false
// 		this.start()
// 	}
// }
