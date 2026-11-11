---
description: "The sidebar-footer Need help action and its support-request dialog: subject, message, and page URL filed at POST /support/requests for the signed-in customer."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-support

English | [中文](README.zh.md)

## Summary

`dsh-client-ui-support` adds one always-visible footer action to the sidebar: a compact "Need help?" row in the wide column and a 36×36 icon button in the rail. Clicking it opens a dialog with a required subject (at most 200 characters), a required message (at most 5000 characters), and the current page URL, then files the request for the signed-in customer. Success acknowledges the request in place; a 401 asks the customer to sign in again; every other failure keeps the drafts and reports that the request was not sent.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Load the plugin through the web-app manifest. It registers into the existing `sidebar.footer.action` list that `dsh-client-ui-sidebar` declares, so it appears just above the Settings row in both sidebar widths. The trigger is never conditional: it does not depend on a current Session, a selected panel, or an open conversation.

### Filing a request

Submitting posts JSON to `/support/requests` with the browser session cookie (`credentials: 'include'`). The body carries only `subject`, `message`, and `pageUrl`; the endpoint derives the tenant and account from the signed-in session. The dialog closes on Escape, a backdrop click, or Cancel, but not while a request is in flight. Success replaces the form with an acknowledgement and a Done button; the next open starts from empty fields. A 401 renders the "Please sign in again" line, every other non-201 response or network failure renders the generic failure line, and both keep the drafts so the customer can retry.

Both required fields must contain non-whitespace text before Send request enables. The rendered text comes from the plugin's own `support` locale namespace, so the trigger label, field labels, errors, and acknowledgement follow the active language.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

One `sidebar.footer.action` registration (`id: 'support'`, `order: 30`) renders `SupportButton`, which reads only the owner `wide` flag and the framework-injected namespace translator — it receives no business face. The trigger owns the open flag; the dialog is the shared `Modal` primitive, so Escape ownership, Tab containment, and focus return to the trigger come from the frame's modal layer rather than local wiring. The subject input carries `data-modal-autofocus`, and the acknowledgement focuses its Done control after the form unmounts. The request uses the browser `fetch` directly; the plugin adds no transport service or store of its own.

| File | Role |
|---|---|
| [`src/client/SupportButton.tsx`](src/client/SupportButton.tsx) | The footer trigger, support dialog, and submission |
| [`src/client/index.ts`](src/client/index.ts) | Slot registration and the dictionaries |
| [`src/client/locales.ts`](src/client/locales.ts) | The `support` namespace copy (zh source of truth) |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [`dsh-api-tenant-auth`](../../api/tenant-auth/README.md) — the host plugin that accepts `POST /support/requests` and joins the record with the customer's tenant and account.
- [`dsh-client-ui-sidebar`](../ui-sidebar/README.md) — the shell that declares `sidebar.footer.action` and supplies the `wide` column state.
- [`dsh-client-ui-primitives`](../ui-primitives/README.md) — the `Modal` and `Button` surfaces the dialog composes.

-----

<a id="model-experience"></a>
## Model Experience

None, as this package only renders a human-facing form and files an HTTP request. It touches no prompt, message, schema, stream, or tool result.

#### KV Cache effect

None; the package never assembles or sends provider requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define current package constraints, not a task backlog.

- **Requires the hosted tenant endpoint** — a profile without the tenant-auth routes mounted has no `/support/requests`, so the action reports the generic failure. An offline queue or a local diagnostics fallback is not implemented.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
