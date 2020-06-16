//@flow
import m from "mithril"
import type {BannerAttrs} from "../gui/base/Banner"
import {Banner, BannerType} from "../gui/base/Banner"
import {BootIcons} from "../gui/base/icons/BootIcons"
import {noOp} from "../api/common/utils/Utils"


export class CalendarMailBanner implements MComponent<BannerAttrs> {
	view(vnode: Vnode<BannerAttrs>): Children {
		const bannerAttrs: BannerAttrs = {
			icon: BootIcons.Calendar,
			title: "Test title",
			message: "Test message",
			helpLink: "TODO",
			buttons: [{text: "Button", click: noOp}],
			type: BannerType.Info,
		}
		return m(Banner, bannerAttrs)
	}
}