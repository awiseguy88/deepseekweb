---
description: "侧边栏底部的「需要帮助」动作及其支持请求对话框：以当前登录客户身份将主题、描述与页面 URL 提交到 POST /support/requests。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-support

[English](README.md) | 中文

## 概述

`dsh-client-ui-support` 在侧边栏底部增加一个始终可见的动作：宽布局下是一行紧凑的「需要帮助？」，收起为导轨时是 36×36 的图标按钮。点击后打开对话框，包含必填主题（最多 200 字符）、必填描述（最多 5000 字符）以及当前页面 URL，并以当前登录客户的身份提交请求。提交成功后就地确认；401 提示重新登录；其他失败保留草稿并提示请求未发送。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

通过 web-app 清单加载本插件。它注册进 `dsh-client-ui-sidebar` 已声明的 `sidebar.footer.action` 列表，因此在两种侧边栏宽度下都紧邻 Settings 行上方显示。触发器是无条件的：它不依赖当前会话、选中面板或已打开的对话。

### 提交请求

提交时以浏览器会话 Cookie（`credentials: 'include'`）向 `/support/requests` POST JSON。请求体只包含 `subject`、`message` 与 `pageUrl`；租户与账号由端点从登录会话中取得。对话框可通过 Escape、点击遮罩或取消关闭，但请求进行中不会关闭。成功后表单替换为确认文案和「完成」按钮；下次打开从空字段开始。401 渲染「请重新登录」，其他非 201 响应或网络失败渲染通用失败文案，二者都保留草稿以便重试。

两个必填字段都必须包含非空白文本，「发送请求」才会启用。所有文案来自插件自己的 `support` 语命名空间，因此触发器标签、字段标签、错误与确认文案都跟随当前语言。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内幕——点击展开</summary>

一个 `sidebar.footer.action` 注册（`id: 'support'`，`order: 30`）渲染 `SupportButton`，它只读取 owner 的 `wide` 标志和框架注入的命名空间翻译器——不接收任何业务注入面。触发器持有打开标志；对话框使用共享的 `Modal` 原语，因此 Escape 归属、Tab 约束与焦点返回触发器都由框架的模态层负责，而不是本地接线。主题输入带有 `data-modal-autofocus`，确认态在表单卸载后把焦点移到「完成」控件。请求直接使用浏览器 `fetch`；插件不新增传输服务或自有 store。

| 文件 | 角色 |
|---|---|
| [`src/client/SupportButton.tsx`](src/client/SupportButton.tsx) | 底部触发器、支持对话框与提交 |
| [`src/client/index.ts`](src/client/index.ts) | slot 注册与词典 |
| [`src/client/locales.ts`](src/client/locales.ts) | `support` 命名空间文案（zh 为事实源） |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [`dsh-api-tenant-auth`](../../api/tenant-auth/README.md) —— 接收 `POST /support/requests` 并把记录与客户的租户、账号关联的宿主插件。
- [`dsh-client-ui-sidebar`](../ui-sidebar/README.zh.md) —— 声明 `sidebar.footer.action` 并提供 `wide` 列状态的 shell。
- [`dsh-client-ui-primitives`](../ui-primitives/README.zh.md) —— 对话框组合的 `Modal` 与 `Button` 表面。

-----

<a id="model-experience"></a>
## 模型体验

无。本包只渲染人类使用的表单并发起一次 HTTP 请求，不触碰任何提示词、消息、schema、流或工具结果。

#### KV 缓存影响

无；本包从不组装或发送 provider 请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制界定当前包约束，不是任务清单。

- **依赖托管的租户端点** —— 未挂载 tenant-auth 路由的 profile 没有 `/support/requests`，动作会报告通用失败。尚未实现离线队列或本地诊断回退。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作语境——点击展开</summary>

无。

</details>
