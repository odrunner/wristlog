// The "someone commented on a link you shared" email in every app language.
// {n} commenter name, {l} the link's label. Collection and wishlist get whole
// sentences each, so nothing has to agree with a swapped-in noun. English is
// the text this email has always had: share-comments-lib.test.ts pins it.
import type { Lang } from "./lang.ts";

export interface ShareCommentStrings {
  subject: { collection: string; wishlist: string };
  left: string;
  onLabel: string;
  onLink: { collection: string; wishlist: string };
  outro: string;
}

export const SHARE_COMMENT_STRINGS: Record<Lang, ShareCommentStrings> = {
  en: {
    subject: { collection: "New comment on your shared watches", wishlist: "New comment on your shared wishlist" },
    left: "<strong>{n}</strong> left a comment.",
    onLabel: "On your link <strong>“{l}”</strong>:",
    onLink: { collection: "On a watches link you shared:", wishlist: "On a wishlist link you shared:" },
    outro: "Open WRotate and go to Shared links to read the thread or remove the comment. We email you about a link at most once every 30 minutes — the app always has everything.",
  },
  es: {
    subject: { collection: "Nuevo comentario en tus relojes compartidos", wishlist: "Nuevo comentario en tu lista de deseos compartida" },
    left: "<strong>{n}</strong> dejó un comentario.",
    onLabel: "En tu enlace <strong>“{l}”</strong>:",
    onLink: { collection: "En un enlace de relojes que compartiste:", wishlist: "En un enlace de lista de deseos que compartiste:" },
    outro: "Abre WRotate y ve a Enlaces compartidos para leer la conversación o eliminar el comentario. Te escribimos sobre un enlace como máximo una vez cada 30 minutos; en la app siempre está todo.",
  },
  it: {
    subject: { collection: "Nuovo commento sui tuoi orologi condivisi", wishlist: "Nuovo commento sulla tua lista dei desideri condivisa" },
    left: "<strong>{n}</strong> ha lasciato un commento.",
    onLabel: "Sul tuo link <strong>“{l}”</strong>:",
    onLink: { collection: "Su un link di orologi che hai condiviso:", wishlist: "Su un link della lista dei desideri che hai condiviso:" },
    outro: "Apri WRotate e vai su Link condivisi per leggere la conversazione o rimuovere il commento. Ti scriviamo per un link al massimo una volta ogni 30 minuti; nell'app trovi sempre tutto.",
  },
  fr: {
    subject: { collection: "Nouveau commentaire sur vos montres partagées", wishlist: "Nouveau commentaire sur votre liste de souhaits partagée" },
    left: "<strong>{n}</strong> a laissé un commentaire.",
    onLabel: "Sur votre lien <strong>«&nbsp;{l}&nbsp;»</strong>&nbsp;:",
    onLink: { collection: "Sur un lien de montres que vous avez partagé&nbsp;:", wishlist: "Sur un lien de liste de souhaits que vous avez partagé&nbsp;:" },
    outro: "Ouvrez WRotate et allez dans Liens partagés pour lire la conversation ou supprimer le commentaire. Nous vous écrivons au sujet d'un lien au plus une fois toutes les 30 minutes ; l'app contient toujours tout.",
  },
  tr: {
    subject: { collection: "Paylaştığın saatlere yeni yorum", wishlist: "Paylaştığın istek listesine yeni yorum" },
    left: "<strong>{n}</strong> bir yorum bıraktı.",
    onLabel: "<strong>“{l}”</strong> bağlantında:",
    onLink: { collection: "Paylaştığın bir saat bağlantısında:", wishlist: "Paylaştığın bir istek listesi bağlantısında:" },
    outro: "Konuşmayı okumak veya yorumu kaldırmak için WRotate'i aç ve Paylaşılan bağlantılar bölümüne git. Bir bağlantı için sana en fazla 30 dakikada bir e-posta gönderiyoruz; her şey her zaman uygulamada.",
  },
  de: {
    subject: { collection: "Neuer Kommentar zu deinen geteilten Uhren", wishlist: "Neuer Kommentar zu deiner geteilten Wunschliste" },
    left: "<strong>{n}</strong> hat einen Kommentar hinterlassen.",
    onLabel: "Zu deinem Link <strong>„{l}“</strong>:",
    onLink: { collection: "Zu einem Uhren-Link, den du geteilt hast:", wishlist: "Zu einem Wunschlisten-Link, den du geteilt hast:" },
    outro: "Öffne WRotate und gehe zu Geteilte Links, um die Unterhaltung zu lesen oder den Kommentar zu entfernen. Wir schreiben dir zu einem Link höchstens einmal alle 30 Minuten; in der App findest du immer alles.",
  },
  pt: {
    subject: { collection: "Novo comentário nos teus relógios partilhados", wishlist: "Novo comentário na tua lista de desejos partilhada" },
    left: "<strong>{n}</strong> deixou um comentário.",
    onLabel: "Na tua ligação <strong>“{l}”</strong>:",
    onLink: { collection: "Numa ligação de relógios que partilhaste:", wishlist: "Numa ligação de lista de desejos que partilhaste:" },
    outro: "Abre o WRotate e vai a Links partilhados para ler a conversa ou remover o comentário. Escrevemos-te sobre uma ligação no máximo uma vez a cada 30 minutos; na app está sempre tudo.",
  },
};
