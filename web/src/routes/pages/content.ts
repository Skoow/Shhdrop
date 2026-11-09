// Pages d'information (plan Task 25, retours UI5) : Sécurité, Confidentialité, Conditions
// d'utilisation, Mentions légales, Signaler un abus. Textes relus sur la spécification
// (docs/superpowers/specs/2026-11-03-shhdrop-design.md : §2, §5.3, §7, §9, §18, §35, §36, §41.4,
// §41.8, D41-28, D41-29). Règles : jamais « 100 % », aucune allégation d'audit ni de pays
// d'hébergement (plan B3), aucune identité d'éditeur ni d'hébergeur inventée (champs « à
// compléter par le propriétaire »), aucune adresse e-mail. Chiffres lus dans les constantes.
import { CONTENT_MAX, MAX_ITEMS, MAX_OPENS, PW_TRIES, TTL_MAX_HOURS } from "../../limits";
import { formatBytes, type Lang } from "../../i18n/format";

export type InfoName = "securite" | "confidentialite" | "conditions" | "mentions" | "signaler";
export type Block = { id?: string; h: string; p?: string[]; list?: string[] };
export type InfoPage = { title: string; lede: string; draft?: boolean; blocks: Block[] };

/** Dépôt public du code (lien sortant simple : rien n'est chargé depuis GitHub). */
export const SOURCE_URL = "https://github.com/Skoow/Shhdrop";
export const LICENSE_URL = "https://github.com/Skoow/Shhdrop/blob/main/LICENSE";

export function infoPage(name: InfoName, lang: Lang): InfoPage {
  const size = formatBytes(CONTENT_MAX, lang);
  const v = { size, n: MAX_ITEMS, h: TTL_MAX_HOURS, tries: PW_TRIES, opens: MAX_OPENS };
  return (lang === "fr" ? FR : EN)[name](v);
}

type V = { size: string; n: number; h: number; tries: number; opens: number };

const FR: Record<InfoName, (v: V) => InfoPage> = {
  securite: (v) => ({
    title: "Sécurité",
    lede: "Ce que Shhdrop protège, comment, et ce qu'il ne peut pas faire. Rien n'est sûr à tout coup : voici ce qui est vrai.",
    blocks: [
      {
        id: "chiffrement",
        h: "Chiffré sur votre appareil",
        p: [
          "Tout est chiffré dans votre navigateur avant l'envoi, avec AES-256-GCM (WebCrypto). Le mot de passe est transformé en clé par Argon2id (64 Mio de mémoire, 3 passes, libsodium) : chaque essai coûte cher à qui voudrait le deviner.",
          "Les noms de fichiers, les types et les textes sont chiffrés aussi : nous ne pouvons pas les lire.",
        ],
      },
      {
        id: "lien",
        h: "Comment fonctionne le lien",
        p: [
          "La clé est dans la fin du lien, après le signe #. Les navigateurs n'envoient jamais cette partie au serveur. Il faut le lien ET le mot de passe pour ouvrir un partage : le serveur n'a ni l'un ni l'autre.",
          `Après ${v.tries} mots de passe faux, le partage est détruit. Il s'efface aussi à l'échéance (${v.h} h au plus en gratuit) ou après le nombre d'ouvertures choisi (${v.opens} au plus).`,
        ],
      },
      {
        id: "serveur",
        h: "Ce que voit le serveur",
        list: [
          "Des données chiffrées, de taille arrondie, et jamais la clé ni le mot de passe.",
          "L'adresse IP de connexion, le temps de la connexion, comme tout site web. Elle n'est écrite nulle part.",
          "La taille approximative d'un partage, l'heure des envois et des lectures, et quels morceaux chiffrés sont lus.",
          "Aucune date de création n'est gardée ; les échéances sont arrondies au quart d'heure.",
        ],
      },
      {
        id: "sortie",
        h: "Dernière ouverture",
        p: [
          "Quand la dernière personne autorisée quitte la page, le partage est supprimé du serveur environ 3 minutes plus tard (un rechargement ne compte pas). Si l'onglet est tué sans prévenir, il est effacé au plus tard 6 heures après cette ouverture, ou à son échéance.",
        ],
      },
      {
        id: "limites",
        h: "Ce que Shhdrop ne peut pas faire",
        list: [
          "Empêcher une capture d'écran, une photo de l'écran ou une copie : ce que le destinataire voit ou télécharge lui appartient.",
          "Effacer l'historique de votre navigateur. Nous retirons la clé de la barre d'adresse, mais le navigateur a déjà noté l'adresse complète dans son historique (parfois synchronisé). Ouvrez le lien en navigation privée pour laisser moins de traces.",
          "Effacer la mémoire de façon garantie : elle est vidée au mieux. Pour qu'un rechargement ne coûte pas une ouverture, le lien et un jeton d'ouverture restent dans le stockage de cet onglet (jamais le mot de passe ni le contenu), le temps de l'ouverture.",
          "Nettoyer l'intérieur des PDF et des archives : ils partent intacts, avec leurs informations internes éventuelles (auteur, logiciel, dates, fichiers contenus). Les photos et vidéos perdent leurs métadonnées (position, appareil) ; ce qui se voit dans l'image reste.",
          "Vérifier l'expéditeur : un lien peut venir de n'importe qui.",
          "Vous protéger d'un site piégé : si notre serveur ou notre code était compromis, le site servi pourrait voler les clés. C'est pour cela que le code est public et que chaque version peut être vérifiée.",
          "Cacher votre adresse IP au serveur et à l'hébergeur pendant la connexion.",
        ],
      },
      {
        id: "qr",
        h: "QR code et partage en un geste",
        p: [
          "« Partager » peut envoyer le lien et le mot de passe ensemble, et le QR code les contient tous les deux. Avec une seule ouverture (le réglage par défaut), personne d'autre ne pourra voir le contenu ensuite, et le destinataire verrait qu'il a déjà été ouvert.",
          "Mais quelqu'un qui lit le message avant le destinataire peut l'ouvrir à sa place, et l'adresse du QR (lien et mot de passe) reste dans l'historique du navigateur qui l'ouvre. Pour plus de sûreté, envoyez le lien et le mot de passe par deux moyens différents.",
        ],
      },
      {
        id: "appareil",
        h: "Caméra et micro",
        p: [
          "Le site ne peut utiliser la caméra et le micro que pour ses propres enregistrements, après votre accord, et jamais dans un cadre d'un autre site (Permissions-Policy). Toutes les autres fonctions sensibles du navigateur lui sont fermées.",
        ],
      },
    ],
  }),
  confidentialite: (v) => ({
    title: "Confidentialité",
    lede: "Sans compte, ni pour envoyer, ni pour recevoir. Aucun traceur, aucune mesure d'audience, aucune publicité.",
    blocks: [
      {
        h: "Ce que nous gardons",
        list: [
          "Le contenu chiffré et le strict nécessaire pour le servir : sa taille arrondie, son échéance arrondie au quart d'heure, le nombre d'ouvertures restantes et d'essais ratés, des vérificateurs qui ne permettent pas de déchiffrer.",
          "Rien de cela ne contient votre nom, votre adresse e-mail, votre adresse IP, le nom de vos fichiers ou leur contenu en clair.",
          `Tout est effacé à l'échéance (${v.h} h au plus en gratuit), après la dernière ouverture, ou à la destruction.`,
        ],
      },
      {
        h: "Ce que nous ne gardons pas",
        list: [
          "Votre adresse IP n'est pas enregistrée. Le serveur la voit le temps de la connexion, comme tout site web, mais ne l'écrit nulle part.",
          "Aucun cookie. Pas de cookie de mesure, donc pas de bandeau.",
          "Aucun journal des partages, aucune statistique d'usage.",
        ],
      },
      {
        h: "Sur votre appareil",
        list: [
          "Le contenu déchiffré reste en mémoire et n'est jamais écrit dans le stockage du navigateur.",
          "Le lien et un jeton d'ouverture restent dans le stockage de l'onglet le temps de l'ouverture, pour qu'un rechargement ne coûte pas une ouverture.",
          "Vos préférences (langue) restent sur votre appareil.",
        ],
      },
      {
        id: "verification",
        h: "Vérification anti-robot",
        p: [
          "Une petite preuve de calcul est faite par votre navigateur, sans service extérieur. Si elle échoue, un repli Google reCAPTCHA peut être proposé, seulement après un clic et dans un cadre isolé sur un autre site, jamais sur une page qui détient des clés. Google voit alors votre adresse IP ; notre serveur, jamais.",
        ],
      },
      {
        h: "Vos droits",
        p: [
          "Nous ne savons pas qui vous êtes : il n'y a donc pas de données personnelles à vous rendre ou à corriger. Un partage peut être détruit à tout moment par son expéditeur (lien de gestion) ou, à la dernière ouverture, par son destinataire.",
        ],
      },
    ],
  }),
  conditions: () => ({
    title: "Conditions d'utilisation",
    lede: "Les règles d'usage de Shhdrop.",
    draft: true,
    blocks: [
      { h: "Usage autorisé", p: ["Shhdrop sert à transmettre des contenus de façon privée. Il est interdit de l'utiliser pour diffuser des contenus illégaux ou pour nuire à autrui."] },
      { h: "Signalement", p: ["Tout destinataire peut signaler un partage : il est alors détruit tout de suite. Voir « Signaler un abus »."] },
      { h: "Responsabilité", p: ["À compléter par le propriétaire."] },
      { h: "Droit applicable", p: ["À compléter par le propriétaire."] },
    ],
  }),
  mentions: () => ({
    title: "Mentions légales",
    lede: "Informations sur l'éditeur et l'hébergeur du site.",
    draft: true,
    blocks: [
      { h: "Éditeur", list: ["Nom ou raison sociale : à compléter par le propriétaire.", "Adresse : à compléter par le propriétaire.", "Contact : à compléter par le propriétaire.", "Directeur de la publication : à compléter par le propriétaire."] },
      { h: "Hébergeur", list: ["Nom : à compléter par le propriétaire.", "Adresse : à compléter par le propriétaire."] },
      { h: "Code source", p: ["Le code de Shhdrop est public, sous licence AGPL-3.0."] },
    ],
  }),
  signaler: (v) => ({
    title: "Signaler un abus",
    lede: "Un partage illégal ou malveillant ? Vous pouvez le détruire vous-même, tout de suite.",
    blocks: [
      {
        h: "Depuis le partage",
        list: [
          "Ouvrez le partage avec son lien et son mot de passe.",
          "Touchez « Signaler », en haut à droite du contenu, puis confirmez.",
          "Le partage est détruit aussitôt pour tout le monde : les téléchargements en cours sont coupés, aucune ouverture ne reste possible.",
        ],
      },
      {
        h: "Ce que nous recevons",
        p: [
          "Le signalement ne contient ni le contenu, ni le motif, ni qui vous êtes : nous ne pouvons pas lire le partage. Nous comptons seulement le nombre de signalements dans l'heure, pour repérer un abus massif.",
          `Sans le mot de passe, rien ne peut être fait sur le partage : il s'effacera seul à son échéance (${v.h} h au plus en gratuit).`,
        ],
      },
    ],
  }),
};

const EN: Record<InfoName, (v: V) => InfoPage> = {
  securite: (v) => ({
    title: "Security",
    lede: "What Shhdrop protects, how, and what it cannot do. Nothing is safe every time: here is what is true.",
    blocks: [
      {
        id: "chiffrement",
        h: "Encrypted on your device",
        p: [
          "Everything is encrypted in your browser before sending, with AES-256-GCM (WebCrypto). The password is turned into a key with Argon2id (64 MiB of memory, 3 passes, libsodium): every guess is expensive.",
          "File names, types and texts are encrypted too: we can't read them.",
        ],
      },
      {
        id: "lien",
        h: "How the link works",
        p: [
          "The key is at the end of the link, after the # sign. Browsers never send that part to the server. Opening a share takes the link AND the password: the server has neither.",
          `After ${v.tries} wrong passwords, the share is destroyed. It is also erased when it expires (${v.h} h at most on the free plan) or after the chosen number of opens (${v.opens} at most).`,
        ],
      },
      {
        id: "serveur",
        h: "What the server sees",
        list: [
          "Encrypted data, with a rounded size, and never the key or the password.",
          "Your IP address while connected, like any website. It is never written down.",
          "The approximate size of a share, when it is sent and read, and which encrypted pieces are read.",
          "No creation date is kept; expiry times are rounded to the quarter hour.",
        ],
      },
      {
        id: "sortie",
        h: "Last open",
        p: [
          "When the last person allowed to open a share leaves the page, the share is deleted from the server about 3 minutes later (a reload doesn't count). If the tab is killed without notice, it is erased at most 6 hours after that open, or when it expires.",
        ],
      },
      {
        id: "limites",
        h: "What Shhdrop cannot do",
        list: [
          "Prevent a screenshot, a photo of the screen or a copy: what the recipient sees or downloads is theirs.",
          "Erase your browser history. We remove the key from the address bar, but the browser has already recorded the full address in its history (sometimes synced). Open the link in a private window to leave fewer traces.",
          "Guarantee memory is wiped: it is cleared on a best-effort basis. So that a reload doesn't cost an open, the link and an open token stay in this tab's storage (never the password or the content) while the share is open.",
          "Clean the inside of PDFs and archives: they are sent untouched, with any internal information (author, software, dates, files inside). Photos and videos lose their metadata (location, device); what is visible in the picture stays.",
          "Verify the sender: a link can come from anyone.",
          "Protect you from a tampered site: if our server or code were compromised, the site could steal keys. That is why the code is public and every version can be verified.",
          "Hide your IP address from the server and the host while you are connected.",
        ],
      },
      {
        id: "qr",
        h: "QR code and one-tap sharing",
        p: [
          "“Share” can send the link and the password together, and the QR code holds both. With a single open (the default), nobody else can see the content afterwards, and the recipient would see it had already been opened.",
          "But someone who reads the message before the recipient can open it in their place, and the QR address (link and password) stays in the history of the browser that opens it. To be safer, send the link and the password through two different channels.",
        ],
      },
      {
        id: "appareil",
        h: "Camera and microphone",
        p: [
          "The site can only use the camera and microphone for its own recordings, after you agree, and never inside another site's frame (Permissions-Policy). Every other sensitive browser feature is closed to it.",
        ],
      },
    ],
  }),
  confidentialite: (v) => ({
    title: "Privacy",
    lede: "No account, to send or to receive. No trackers, no audience measurement, no ads.",
    blocks: [
      {
        h: "What we keep",
        list: [
          "The encrypted content and only what is needed to serve it: its rounded size, its expiry rounded to the quarter hour, the opens and failed attempts left, and verifiers that cannot decrypt anything.",
          "None of it holds your name, email address, IP address, file names or readable content.",
          `Everything is erased when it expires (${v.h} h at most on the free plan), after the last open, or when destroyed.`,
        ],
      },
      {
        h: "What we don't keep",
        list: [
          "Your IP address is not recorded. The server sees it while you are connected, like any website, but never writes it down.",
          "No cookies. No measurement cookies, so no banner.",
          "No log of shares, no usage statistics.",
        ],
      },
      {
        h: "On your device",
        list: [
          "Decrypted content stays in memory and is never written to browser storage.",
          "The link and an open token stay in the tab's storage while the share is open, so a reload doesn't cost an open.",
          "Your preferences (language) stay on your device.",
        ],
      },
      {
        id: "verification",
        h: "Bot check",
        p: [
          "Your browser solves a small proof of work, with no outside service. If it fails, a Google reCAPTCHA fallback may be offered, only after a click and inside an isolated frame on another site, never on a page that holds keys. Google then sees your IP address; our server never does.",
        ],
      },
      {
        h: "Your rights",
        p: [
          "We don't know who you are, so there is no personal data to hand back or correct. A share can be destroyed at any time by its sender (management link) or, at the last open, by its recipient.",
        ],
      },
    ],
  }),
  conditions: () => ({
    title: "Terms of use",
    lede: "The rules for using Shhdrop.",
    draft: true,
    blocks: [
      { h: "Allowed use", p: ["Shhdrop is for sending content privately. Using it to spread illegal content or to harm others is forbidden."] },
      { h: "Reporting", p: ["Any recipient can report a share: it is destroyed at once. See “Report abuse”."] },
      { h: "Liability", p: ["To be completed by the owner."] },
      { h: "Governing law", p: ["To be completed by the owner."] },
    ],
  }),
  mentions: () => ({
    title: "Legal notice",
    lede: "Information about the publisher and the host of this site.",
    draft: true,
    blocks: [
      { h: "Publisher", list: ["Name or company: to be completed by the owner.", "Address: to be completed by the owner.", "Contact: to be completed by the owner.", "Publication director: to be completed by the owner."] },
      { h: "Host", list: ["Name: to be completed by the owner.", "Address: to be completed by the owner."] },
      { h: "Source code", p: ["Shhdrop's code is public, under the AGPL-3.0 license."] },
    ],
  }),
  signaler: (v) => ({
    title: "Report abuse",
    lede: "An illegal or malicious share? You can destroy it yourself, right away.",
    blocks: [
      {
        h: "From the share",
        list: [
          "Open the share with its link and password.",
          "Tap “Report”, at the top right of the content, then confirm.",
          "The share is destroyed at once for everyone: downloads in progress are cut, no open remains possible.",
        ],
      },
      {
        h: "What we receive",
        p: [
          "A report holds neither the content, nor the reason, nor who you are: we cannot read the share. We only count reports per hour, to spot mass abuse.",
          `Without the password, nothing can be done to the share: it erases itself when it expires (${v.h} h at most on the free plan).`,
        ],
      },
    ],
  }),
};
