//@flow
import m from "mithril"
import {Dialog, DialogType} from "../gui/base/Dialog"
import {DatePicker} from "../gui/base/DatePicker"
import {getStartOfTheWeekOffsetForUser} from "../calendar/CalendarUtils"
import {HtmlEditor} from "../gui/base/HtmlEditor"
import type {OutOfOfficeNotification} from "../api/entities/tutanota/OutOfOfficeNotification"
import {createOutOfOfficeNotification} from "../api/entities/tutanota/OutOfOfficeNotification"
import {logins} from "../api/main/LoginController"
import type {GroupMembership} from "../api/entities/sys/GroupMembership"
import {TextFieldN} from "../gui/base/TextFieldN"
import stream from "mithril/stream/stream.js"
import {lang} from "../misc/LanguageViewModel"
import {locator} from "../api/main/MainLocator"
import {Keys, OUT_OF_OFFICE_SUBJECT_PREFIX, OutOfOfficeNotificationMessageType} from "../api/common/TutanotaConstants"
import {DropDownSelector} from "../gui/base/DropDownSelector"
import {CheckboxN} from "../gui/base/CheckboxN"
import type {CheckboxAttrs} from "../gui/base/CheckboxN"
import type {OutOfOfficeNotificationMessage} from "../api/entities/tutanota/OutOfOfficeNotificationMessage"
import {createOutOfOfficeNotificationMessage} from "../api/entities/tutanota/OutOfOfficeNotificationMessage"
import {px} from "../gui/size"
import {ButtonType} from "../gui/base/ButtonN"

type NotificationData = {
	mailMembership: GroupMembership,
	enabled: Stream<boolean>,
	outOfOfficeStartTimePicker: DatePicker,
	outOfOfficeEndTimePicker: DatePicker,
	organizationSubject: Stream<string>,
	defaultSubject: Stream<string>,
	organizationOutOfOfficeEditor: HtmlEditor,
	defaultOutOfOfficeEditor: HtmlEditor
}

/**
 * Return an object that holds the currently configured values of the OutOfOfficeNotification.
 * Returns the default value if it is not available.
 * */
function initNotificationValues(outOfOfficeNotification: ?OutOfOfficeNotification, timeRangeEnabled: Stream<boolean>, organizationMessageEnabled: Stream<boolean>, defaultMessageEnabled: Stream<boolean>) {
	const notificationData: NotificationData = {
		mailMembership: getMailMembership(),
		enabled: stream(false),
		outOfOfficeStartTimePicker: new DatePicker(getStartOfTheWeekOffsetForUser(), "dateFrom_label"),
		outOfOfficeEndTimePicker: new DatePicker(getStartOfTheWeekOffsetForUser(), "dateTo_label"),
		organizationSubject: stream(lang.get("outOfOfficeDefaultSubject_msg")),
		defaultSubject: stream(lang.get("outOfOfficeDefaultSubject_msg")),
		organizationOutOfOfficeEditor: new HtmlEditor("message_label", {enabled: true})
			.setMinHeight(100)
			.showBorders()
			.setValue(lang.get("outOfOfficeDefault_msg")),
		defaultOutOfOfficeEditor: new HtmlEditor("message_label", {enabled: true})
			.setMinHeight(100)
			.showBorders()
			.setValue(lang.get("outOfOfficeDefault_msg"))
	}
	notificationData.outOfOfficeStartTimePicker.setDate(new Date())
	if (outOfOfficeNotification) {
		notificationData.enabled(outOfOfficeNotification.enabled)
		let defaultEnabled = false
		outOfOfficeNotification.notifications.forEach((notification) => {
			if (notification.type === OutOfOfficeNotificationMessageType.Default) {
				defaultEnabled = true
				notificationData.defaultSubject(notification.subject)
				notificationData.defaultOutOfOfficeEditor.setValue(notification.message)
			} else if (notification.type === OutOfOfficeNotificationMessageType.SameOrganization) {
				organizationMessageEnabled(true)
				notificationData.organizationSubject(notification.subject)
				notificationData.organizationOutOfOfficeEditor.setValue(notification.message)
			}
		})
		defaultMessageEnabled(defaultEnabled)
		if (outOfOfficeNotification.startTime) {
			timeRangeEnabled(true)
			notificationData.outOfOfficeStartTimePicker.setDate(outOfOfficeNotification.startTime)
			notificationData.outOfOfficeEndTimePicker.setDate(outOfOfficeNotification.endTime)
		}
	}
	return notificationData
}

export function showEditOutOfOfficeNotificationDialog(outOfOfficeNotification: ?OutOfOfficeNotification) {
	const timeRangeEnabled: Stream<boolean> = stream(false)
	const organizationMessageEnabled: Stream<boolean> = stream(false)
	const defaultMessageEnabled: Stream<boolean> = stream(true)
	const notificationData = initNotificationValues(outOfOfficeNotification, timeRangeEnabled, organizationMessageEnabled, defaultMessageEnabled)
	organizationMessageEnabled.map(enabled => {
		if (!enabled) {
			defaultMessageEnabled(true)
		}
	})
	const statusItems = [
		{
			name: lang.get("notificationsDisabled_label"),
			value: false
		},
		{
			name: lang.get("notificationsEnabled_label"),
			value: true
		}
	]
	const timeRangeCheckboxAttrs: CheckboxAttrs = {
		label: () => lang.get("outOfOfficeTimeRange_msg"),
		checked: timeRangeEnabled,
		helpLabel: () => lang.get("outOfOfficeTimeRangeHelp_msg"),
	}
	const organizationMessageCheckboxAttrs: CheckboxAttrs = {
		label: () => lang.get("outOfOfficeEnableInternal_msg"),
		checked: organizationMessageEnabled,
		helpLabel: () => lang.get("outOfOfficeEnableInternalHelp_msg"),
	}
	const defaultMessageCheckboxAttrs: CheckboxAttrs = {
		label: () => lang.get("outOfOfficeEnableExternal_msg"),
		checked: defaultMessageEnabled,
		helpLabel: () => lang.get("outOfOfficeEnableExternalHelp_msg"),
	}
	const statusSelector: DropDownSelector<boolean> = new DropDownSelector("state_label", null, statusItems, notificationData.enabled)

	const childForm = {
		view: () => {
			return [
				m(".h4.text-center.mt", lang.get("configuration_label")),
				m(".mt", lang.get("outOfOfficeExplanation_msg")),
				m(statusSelector),
				m(".mt.flex-start", m(CheckboxN, timeRangeCheckboxAttrs)),
				timeRangeEnabled()
					? m(".flex-start", [
						m(notificationData.outOfOfficeStartTimePicker), m(notificationData.outOfOfficeEndTimePicker)
					])
					: null,
				defaultMessageEnabled()
					? [
						m(".h4.text-center", lang.get("outOfOfficeExternal_msg")),
						m(TextFieldN, {
								label: "subject_label",
								value: notificationData.defaultSubject,
								injectionsLeft: () => m(".flex-no-grow-no-shrink-auto.pr-s", {
									style: {
										'line-height': px(24),
										opacity: '1'
									}
								}, OUT_OF_OFFICE_SUBJECT_PREFIX)
							}
						),
						m(notificationData.defaultOutOfOfficeEditor)
					]
					: null,
				m(".mt.flex-start", m(CheckboxN, organizationMessageCheckboxAttrs)),
				organizationMessageEnabled()
					? [
						m(".mt.flex-start", m(CheckboxN, defaultMessageCheckboxAttrs)),
						m(".h4.text-center.mt", lang.get("outOfOfficeInternal_msg")),
						m(TextFieldN, {
								label: "subject_label",
								value: notificationData.organizationSubject,
								injectionsLeft: () => m(".flex-no-grow-no-shrink-auto.pr-s", {
									style: {
										'line-height': px(24),
										opacity: '1'
									}
								}, OUT_OF_OFFICE_SUBJECT_PREFIX)
							}
						),
						m(notificationData.organizationOutOfOfficeEditor)
					]
					: null,
			]
		}
	}

	const saveOutOfOfficeNotification = (dialog) => {
		const sendableNotification = getNotificationFromNotificationData(notificationData, timeRangeEnabled, defaultMessageEnabled, organizationMessageEnabled, outOfOfficeNotification)
		// Error messages are already shown if sendableNotification is null. We do not close the dialog.
		if (sendableNotification) {
			const requestPromise = outOfOfficeNotification
				? locator.entityClient.update(sendableNotification)
				: locator.entityClient.setup(null, sendableNotification)
			// If the request fails the user should have to close manually. Otherwise the input data would be lost.
			requestPromise.then(() => cancel()).catch(e => Dialog.error(() => e.toString()))
		}
	}

	function cancel() {
		dialog.close()
	}

	const dialogHeaderAttrs = {
		left: [{label: "cancel_action", click: cancel, type: ButtonType.Secondary}],
		right: [{label: "ok_action", click: saveOutOfOfficeNotification, type: ButtonType.Primary}],
		middle: () => lang.get("outOfOfficeNotification_title"),
	}
	const dialog = Dialog.largeDialog(dialogHeaderAttrs, childForm).addShortcut({
		key: Keys.ESC,
		exec: cancel,
		help: "close_alt"
	}).addShortcut({
		key: Keys.S,
		ctrl: true,
		exec: saveOutOfOfficeNotification,
		help: "ok_action"
	})
	dialog.show()
}

/**
 * Return OutOfOfficeNotification created from input data or null if invalid. Shows error dialogs if invalid.
 * */
function getNotificationFromNotificationData(notificationData: NotificationData, timeRangeEnabled: Stream<boolean>, defaultMessageEnabled: Stream<boolean>, organizationMessageEnabled: Stream<boolean>, outOfOfficeNotification: ?OutOfOfficeNotification): ?OutOfOfficeNotification {
	let startTime: ?Date = timeRangeEnabled() ? notificationData.outOfOfficeStartTimePicker.date() : null
	let endTime: ?Date = timeRangeEnabled() ? notificationData.outOfOfficeEndTimePicker.date() : null
	if (timeRangeEnabled() && (!startTime || (endTime && (startTime.getTime() > endTime.getTime() || endTime.getTime() < Date.now())))) {
		Dialog.error("invalidTimePeriod_msg")
		return null
	}
	const notificationMessages: OutOfOfficeNotificationMessage[] = []
	if (defaultMessageEnabled()) {
		const defaultNotification: OutOfOfficeNotificationMessage = createOutOfOfficeNotificationMessage({
			subject: notificationData.defaultSubject(),
			message: notificationData.defaultOutOfOfficeEditor.getValue(),
			type: OutOfOfficeNotificationMessageType.Default
		})
		notificationMessages.push(defaultNotification)
	}
	if (organizationMessageEnabled()) {
		const organizationNotification: OutOfOfficeNotificationMessage = createOutOfOfficeNotificationMessage({
			subject: notificationData.organizationSubject(),
			message: notificationData.organizationOutOfOfficeEditor.getValue(),
			type: OutOfOfficeNotificationMessageType.SameOrganization
		})
		notificationMessages.push(organizationNotification)
	}
	if (!notificationMessagesAreValid(notificationMessages)) {
		Dialog.error("outOfOfficeMessageInvalid_msg")
		return null
	}
	if (!outOfOfficeNotification) {
		outOfOfficeNotification = createOutOfOfficeNotification()
	}
	outOfOfficeNotification._ownerGroup = notificationData.mailMembership.group
	outOfOfficeNotification.enabled = notificationData.enabled()
	outOfOfficeNotification.startTime = startTime
	outOfOfficeNotification.endTime = endTime
	outOfOfficeNotification.notifications = notificationMessages
	return outOfOfficeNotification
}

function notificationMessagesAreValid(messages: OutOfOfficeNotificationMessage[]): boolean {
	if (messages.length < 1 || messages.length > 2) {
		return false
	}
	let result = true
	messages.forEach((message) => {
		if (message.subject === "" || message.message === "") {
			result = false
		}
	})
	return result
}

export function getMailMembership(): GroupMembership {
	return logins.getUserController().getMailGroupMemberships()[0]
}

/**
 * Returns true if notifications will be sent now or at some point in the future.
 * */
export function isNotificationReallyEnabled(notification: OutOfOfficeNotification): boolean {
	return notification.enabled && (!notification.startTime || !notification.endTime || notification.endTime.getTime() > Date.now())
}