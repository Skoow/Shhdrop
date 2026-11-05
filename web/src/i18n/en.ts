import type { fr } from "./fr";

export const en = {
  "hero.title": "One link, one password, then nothing.",
  "hero.lede":
    "Text, photos, videos, voice notes, documents. Encrypted on your device before sending: neither the server nor its owner can read them.",
  "hero.how": "How it works",

  "shell.skip": "Skip to content",
  "shell.home": "Shhdrop, home",
  "shell.lang.label": "Français",
  "shell.lang.switch": "Français, switch the interface to French",
  "shell.lang.locked": "Changing the language is disabled while sending.",
  "shell.nav": "Information",
  "shell.security": "Security",
  "shell.privacy": "Privacy",
  "shell.footer": "Encrypted on your device before sending.",
  "demo.banner": "Demo: nothing is sent, the link only works in this tab.",

  "notfound.title": "This page does not exist.",
  "notfound.home": "Back to the home page",

  "common.retry": "Try again",
  "common.copy": "Copy",
  "common.copied": "Copied",
  "common.cancel": "Cancel",
  "common.confirm": "Confirm",

  "compose.add.files": "Files",
  "compose.add.photo": "Photo",
  "compose.add.voice": "Voice",
  "compose.add.text": "Text",
  "compose.add.paste": "Paste",
  "compose.drop": "Drop to add",
  "compose.folder": "Folders can't be added. Add the files themselves, or a .zip archive.",
  "compose.cat.text": "Text",
  "compose.cat.photos": "Photos",
  "compose.cat.videos": "Videos",
  "compose.cat.audio": "Audio and voice",
  "compose.cat.documents": "Documents",
  "compose.cat.other": "Other",
  "compose.moved": "{name}: position {i} of {n} in {category}.",
  "compose.removed": "{name} removed",
  "compose.duplicate": "Duplicate?",
  "compose.gauge": "{size} / 1 GB · {n} / 10",
  "compose.gauge.empty": "Nothing to send yet · up to 1 GB and 10 items",
  "compose.tooBig": "Too big: {size} of 1 GB. Remove {excess}.",
  "compose.tooMany.one": "{n} item was not added: 10 at most.",
  "compose.tooMany.other": "{n} items were not added: 10 at most.",
  "compose.cleaned": "Cleaned · location, device and capture date removed",

  "options.ttl.hint": "Counted from the end of the upload.",
  "options.opens.hint": "One open = one successful unlock.",
  "options.submit": "Encrypt and send",

  "seal.keys": "Preparing keys",
  "seal.captcha": "Bot check · computed on your device",
  "seal.upload": "Encrypting and sending",
  "seal.padding": "The uploaded size is rounded up to hide the real size.",
  "seal.offline": "Connection lost. Retrying in {duration}…",
  "seal.paused": "Paused · resumes automatically in {duration}",
  "seal.cancel.confirm": "Cancel the upload? What was sent will be erased from the server.",

  "verif.title": "Extra check",
  "verif.body":
    "The automatic check did not succeed on this device. You can use Google's instead. Google will see your IP address and may set its cookies in its frame. Your content, your link and your password stay out of its reach: the check runs in a separate page with no access to this one.",
  "verif.continue": "Continue with Google",
  "verif.cancel": "Cancel the upload",
  "verif.more": "Learn more",

  "ready.title": "Link ready",
  "ready.created": "Share created.",
  "ready.pw.reminder": "Send it another way than the link. Both in the same chat is like having no password.",
  "ready.delete.confirm": "Delete this share for everyone? The link will lead nowhere.",
  "ready.never": "This information will never be shown again.",

  "open.intro": "Someone sent you an encrypted share. Shhdrop does not verify who the sender is.",
  "open.cost": "Unlocking uses one open. If the download then fails, that open is lost.",
  "open.badPw.one": "Wrong password · {n} attempt left",
  "open.badPw.other": "Wrong password · {n} attempts left",
  "open.lastTry": "One more failure and the share will be destroyed.",
  "open.destroyedByPw": "Wrong password. The share has been destroyed.",

  "content.banner":
    "Available for {duration} · disappears when you leave the page · reloading uses an open",
  "content.finish": "Finish and erase",
  "content.undecodable":
    "This file can't be played on this device. Save it to open it with another app.",
  "content.risky":
    "“{name}” can run code on your device. Only open it if you trust the sender.",

  "report.body":
    "The share will be destroyed immediately for everyone. Shhdrop cannot see the content and keeps no trace of your report. For illegal content, you can also report it to the authorities (in France: PHAROS, internet-signalement.gouv.fr).",

  "invalid": "This link does not exist or is no longer available.",
  "incomplete": "This link is incomplete. Reopen it from the original message.",
  "incomplete.hint":
    "The secret part may have been removed from the address bar after a first visit.",
  "unsupported":
    "This browser cannot encrypt safely. Use a recent version of Safari, Chrome, Firefox or Edge.",

  "manage.status": "Opened {u} / {max} · Expires in {duration}",
  "manage.gone": "Deleted",

  "err.limit": "Upload limit reached. Try again in {duration}.",
  "err.full": "The service is full right now. Try again later.",
  "err.interrupted": "The transfer was interrupted (the server may have restarted). Try again.",
  "err.network": "Can't connect. Check your network and try again.",
} as const satisfies Record<keyof typeof fr, string>;
