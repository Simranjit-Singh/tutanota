//@flow
import {elementIdPart, listIdPart} from "../../common/EntityFunctions"
import {OperationType} from "../../common/TutanotaConstants"
import {assertNotNull, containsEventOfType} from "../../common/utils/Utils"
import {ProgrammingError} from "../../common/error/ProgrammingError"
import {ConnectionError, ServiceUnavailableError} from "../../common/error/RestError"
import type {EntityUpdate} from "../../entities/sys/EntityUpdate"
import {createEntityUpdate} from "../../entities/sys/EntityUpdate"
import type {QueuedBatch} from "../search/EventQueue"
