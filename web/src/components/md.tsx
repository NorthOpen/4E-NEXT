import React from "react";
import { createComponent } from "@lit/react";

import { MdFilledButton } from "@material/web/button/filled-button.js";
import { MdOutlinedButton } from "@material/web/button/outlined-button.js";
import { MdTextButton } from "@material/web/button/text-button.js";
import { MdFilledTonalButton } from "@material/web/button/filled-tonal-button.js";
import { MdIconButton } from "@material/web/iconbutton/icon-button.js";
import { MdFilledTextField } from "@material/web/textfield/filled-text-field.js";
import { MdOutlinedTextField } from "@material/web/textfield/outlined-text-field.js";
import { MdFilledSelect } from "@material/web/select/filled-select.js";
import { MdOutlinedSelect } from "@material/web/select/outlined-select.js";
import { MdSelectOption } from "@material/web/select/select-option.js";
import { MdMenu } from "@material/web/menu/menu.js";
import { MdMenuItem } from "@material/web/menu/menu-item.js";
import { MdList } from "@material/web/list/list.js";
import { MdListItem } from "@material/web/list/list-item.js";
import { MdSwitch } from "@material/web/switch/switch.js";
import { MdCheckbox } from "@material/web/checkbox/checkbox.js";
import { MdDialog } from "@material/web/dialog/dialog.js";
import { MdDivider } from "@material/web/divider/divider.js";
import { MdSlider } from "@material/web/slider/slider.js";
import { MdLinearProgress } from "@material/web/progress/linear-progress.js";
import { MdTabs } from "@material/web/tabs/tabs.js";
import { MdPrimaryTab } from "@material/web/tabs/primary-tab.js";

export const FilledButton = createComponent({ tagName: "md-filled-button", elementClass: MdFilledButton, react: React, events: { onClick: "click" } });
export const OutlinedButton = createComponent({ tagName: "md-outlined-button", elementClass: MdOutlinedButton, react: React, events: { onClick: "click" } });
export const TextButton = createComponent({ tagName: "md-text-button", elementClass: MdTextButton, react: React, events: { onClick: "click" } });
export const FilledTonalButton = createComponent({ tagName: "md-filled-tonal-button", elementClass: MdFilledTonalButton, react: React, events: { onClick: "click" } });
export const IconButton = createComponent({ tagName: "md-icon-button", elementClass: MdIconButton, react: React, events: { onClick: "click" } });
export const FilledTextField = createComponent({ tagName: "md-filled-text-field", elementClass: MdFilledTextField, react: React, events: { onInput: "input", onChange: "change" } });
export const OutlinedTextField = createComponent({ tagName: "md-outlined-text-field", elementClass: MdOutlinedTextField, react: React, events: { onInput: "input", onChange: "change" } });
export const FilledSelect = createComponent({ tagName: "md-filled-select", elementClass: MdFilledSelect, react: React, events: { onChange: "change", onInput: "input" } });
export const OutlinedSelect = createComponent({ tagName: "md-outlined-select", elementClass: MdOutlinedSelect, react: React, events: { onChange: "change", onInput: "input" } });
export const SelectOption = createComponent({ tagName: "md-select-option", elementClass: MdSelectOption, react: React });
export const Menu = createComponent({ tagName: "md-menu", elementClass: MdMenu, react: React, events: { onClose: "close", onClosed: "closed", onOpen: "open", onOpened: "opened" } });
export const MenuItem = createComponent({ tagName: "md-menu-item", elementClass: MdMenuItem, react: React, events: { onClick: "click" } });
export const List = createComponent({ tagName: "md-list", elementClass: MdList, react: React });
export const ListItem = createComponent({ tagName: "md-list-item", elementClass: MdListItem, react: React, events: { onClick: "click" } });
export const Switch = createComponent({ tagName: "md-switch", elementClass: MdSwitch, react: React, events: { onChange: "change" } });
export const Checkbox = createComponent({ tagName: "md-checkbox", elementClass: MdCheckbox, react: React, events: { onChange: "change" } });
export const Dialog = createComponent({ tagName: "md-dialog", elementClass: MdDialog, react: React, events: { onOpen: "open", onClose: "close", onOpened: "opened", onClosed: "closed" } });
export const Divider = createComponent({ tagName: "md-divider", elementClass: MdDivider, react: React });
export const Slider = createComponent({ tagName: "md-slider", elementClass: MdSlider, react: React, events: { onInput: "input", onChange: "change" } });
// MD3 线性进度指示器：不确定进度（indeterminate）用于「AI 正在逐项生成」这类没有确定百分比的场景。
export const LinearProgress = createComponent({ tagName: "md-linear-progress", elementClass: MdLinearProgress, react: React });
// MD3 Primary Tabs（主标签页）：用于切换同级视图，选中项由 primary 色胶囊指示器标出。
// md-tabs 自己管理选中态、指示器动画与左右方向键导航，只在切换时冒泡 change 事件，
// 选中项通过 event.target.activeTabIndex 读取。
export const Tabs = createComponent({ tagName: "md-tabs", elementClass: MdTabs, react: React, events: { onChange: "change" } });
export const PrimaryTab = createComponent({ tagName: "md-primary-tab", elementClass: MdPrimaryTab, react: React });
