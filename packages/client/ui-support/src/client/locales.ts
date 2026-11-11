/** `support` namespace dictionaries. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'support'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'trigger.label': '需要帮助？',
  'dialog.title': '需要帮助？',
  'dialog.description': '告诉我们出了什么问题，我们会尽快回复。',
  'dialog.close': '关闭',
  'field.subject': '主题',
  'field.subjectPlaceholder': '简要说明',
  'field.message': '详细描述',
  'field.messagePlaceholder': '发生了什么？当时你在做什么？',
  'action.submit': '发送请求',
  'action.sending': '正在发送…',
  'action.cancel': '取消',
  'action.done': '完成',
  'error.signIn': '登录状态已失效，请重新登录。',
  'error.failed': '请求发送失败，请重试。',
  'success.message': '感谢反馈，你的请求已发送。我们会通过邮件回复你。',
  'account.label': '账户',
  'account.signOut': '退出登录',
} as const

/** English dictionary, key-identical to the Chinese source of truth. */
export const en: Record<SupportKey, string> = {
  'trigger.label': 'Need help?',
  'dialog.title': 'Need help?',
  'dialog.description': "Tell us what went wrong and we'll get back to you.",
  'dialog.close': 'Close',
  'field.subject': 'Subject',
  'field.subjectPlaceholder': 'A short summary',
  'field.message': 'Message',
  'field.messagePlaceholder': 'What happened, and what were you doing?',
  'action.submit': 'Send request',
  'action.sending': 'Sending…',
  'action.cancel': 'Cancel',
  'action.done': 'Done',
  'error.signIn': 'Please sign in again.',
  'error.failed': "Couldn't send your request. Try again.",
  'success.message': "Thanks — your request is sent. We'll get back to you by email.",
  'account.label': 'Account',
  'account.signOut': 'Sign out',
}

/** Key domain of the `support` namespace (zh is the source of truth). */
export type SupportKey = keyof typeof zh

/** Japanese dictionary, checked against the English keys. */
export const ja = {
  'trigger.label': 'ヘルプが必要ですか？',
  'dialog.title': 'ヘルプが必要ですか？',
  'dialog.description': '問題の内容をお知らせください。担当者からご連絡します。',
  'dialog.close': '閉じる',
  'field.subject': '件名',
  'field.subjectPlaceholder': '簡単な要約',
  'field.message': 'メッセージ',
  'field.messagePlaceholder': '何が起きたか、そのとき何をしていたかを教えてください。',
  'action.submit': 'リクエストを送信',
  'action.sending': '送信中…',
  'action.cancel': 'キャンセル',
  'action.done': '完了',
  'error.signIn': 'もう一度サインインしてください。',
  'error.failed': 'リクエストを送信できませんでした。もう一度お試しください。',
  'success.message': 'ありがとうございます。リクエストを送信しました。メールでご連絡します。',
  'account.label': 'アカウント',
  'account.signOut': 'ログアウト',
} satisfies Record<keyof typeof en, string>

/** Spanish dictionary, checked against the English keys. */
export const es = {
  'trigger.label': '¿Necesitas ayuda?',
  'dialog.title': '¿Necesitas ayuda?',
  'dialog.description': 'Cuéntanos qué salió mal y te responderemos.',
  'dialog.close': 'Cerrar',
  'field.subject': 'Asunto',
  'field.subjectPlaceholder': 'Un resumen breve',
  'field.message': 'Mensaje',
  'field.messagePlaceholder': '¿Qué ocurrió y qué estabas haciendo?',
  'action.submit': 'Enviar solicitud',
  'action.sending': 'Enviando…',
  'action.cancel': 'Cancelar',
  'action.done': 'Listo',
  'error.signIn': 'Vuelve a iniciar sesión.',
  'error.failed': 'No se pudo enviar tu solicitud. Inténtalo de nuevo.',
  'success.message': 'Gracias, tu solicitud se envió. Te responderemos por correo.',
  'account.label': 'Cuenta',
  'account.signOut': 'Cerrar sesión',
} satisfies Record<keyof typeof en, string>

/** French dictionary, checked against the English keys. */
export const fr = {
  'trigger.label': 'Besoin d’aide ?',
  'dialog.title': 'Besoin d’aide ?',
  'dialog.description': 'Dites-nous ce qui s’est mal passé et nous vous répondrons.',
  'dialog.close': 'Fermer',
  'field.subject': 'Objet',
  'field.subjectPlaceholder': 'Un résumé court',
  'field.message': 'Message',
  'field.messagePlaceholder': 'Que s’est-il passé, et que faisiez-vous ?',
  'action.submit': 'Envoyer la demande',
  'action.sending': 'Envoi…',
  'action.cancel': 'Annuler',
  'action.done': 'Terminé',
  'error.signIn': 'Veuillez vous reconnecter.',
  'error.failed': 'Impossible d’envoyer votre demande. Réessayez.',
  'success.message': 'Merci, votre demande est envoyée. Nous vous répondrons par e-mail.',
  'account.label': 'Compte',
  'account.signOut': 'Se déconnecter',
} satisfies Record<keyof typeof en, string>

/** German dictionary, checked against the English keys. */
export const de = {
  'trigger.label': 'Brauchen Sie Hilfe?',
  'dialog.title': 'Brauchen Sie Hilfe?',
  'dialog.description': 'Sagen Sie uns, was schiefgelaufen ist, und wir melden uns bei Ihnen.',
  'dialog.close': 'Schließen',
  'field.subject': 'Betreff',
  'field.subjectPlaceholder': 'Eine kurze Zusammenfassung',
  'field.message': 'Nachricht',
  'field.messagePlaceholder': 'Was ist passiert, und was haben Sie gerade getan?',
  'action.submit': 'Anfrage senden',
  'action.sending': 'Wird gesendet…',
  'action.cancel': 'Abbrechen',
  'action.done': 'Fertig',
  'error.signIn': 'Bitte melden Sie sich erneut an.',
  'error.failed': 'Ihre Anfrage konnte nicht gesendet werden. Versuchen Sie es erneut.',
  'success.message': 'Danke, Ihre Anfrage ist gesendet. Wir antworten per E-Mail.',
  'account.label': 'Konto',
  'account.signOut': 'Abmelden',
} satisfies Record<keyof typeof en, string>

/** Russian dictionary, checked against the English keys. */
export const ru = {
  'trigger.label': 'Нужна помощь?',
  'dialog.title': 'Нужна помощь?',
  'dialog.description': 'Расскажите, что пошло не так, и мы ответим вам.',
  'dialog.close': 'Закрыть',
  'field.subject': 'Тема',
  'field.subjectPlaceholder': 'Краткое описание',
  'field.message': 'Сообщение',
  'field.messagePlaceholder': 'Что произошло и что вы делали?',
  'action.submit': 'Отправить запрос',
  'action.sending': 'Отправка…',
  'action.cancel': 'Отмена',
  'action.done': 'Готово',
  'error.signIn': 'Пожалуйста, войдите снова.',
  'error.failed': 'Не удалось отправить запрос. Попробуйте ещё раз.',
  'success.message': 'Спасибо, ваш запрос отправлен. Мы ответим по электронной почте.',
  'account.label': 'Аккаунт',
  'account.signOut': 'Выйти',
} satisfies Record<keyof typeof en, string>

/** Portuguese dictionary, checked against the English keys. */
export const pt = {
  'trigger.label': 'Precisa de ajuda?',
  'dialog.title': 'Precisa de ajuda?',
  'dialog.description': 'Conte o que deu errado e entraremos em contato.',
  'dialog.close': 'Fechar',
  'field.subject': 'Assunto',
  'field.subjectPlaceholder': 'Um resumo curto',
  'field.message': 'Mensagem',
  'field.messagePlaceholder': 'O que aconteceu e o que você estava fazendo?',
  'action.submit': 'Enviar solicitação',
  'action.sending': 'Enviando…',
  'action.cancel': 'Cancelar',
  'action.done': 'Concluído',
  'error.signIn': 'Faça login novamente.',
  'error.failed': 'Não foi possível enviar sua solicitação. Tente novamente.',
  'success.message': 'Obrigado, sua solicitação foi enviada. Responderemos por e-mail.',
  'account.label': 'Conta',
  'account.signOut': 'Sair',
} satisfies Record<keyof typeof en, string>
