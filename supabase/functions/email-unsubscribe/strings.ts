// email-unsubscribe — the confirmation page in every app language. {c} is the
// category label. Only the success page is translated: the error pages are
// shown before (or without) a profile, so there is no language to pick.
import type { Lang } from "../_shared/lang.ts";

export interface UnsubStrings {
  title: string; h1: string; wont: string; reenable: string; all: string; open: string;
  cats: Record<string, string>;
}

export const UNSUB_STRINGS: Record<Lang, UnsubStrings> = {
  en: {
    title: "Unsubscribed", h1: "You've been unsubscribed",
    wont: "You won't receive <strong>{c}</strong> emails from WRotate anymore.",
    reenable: "You can re-enable them anytime in WRotate → Profile → Notifications.",
    all: "Unsubscribe from all emails", open: "Open WRotate",
    cats: { comments: "Comments & replies", mentions: "Mentions", friends: "Follows & friend requests", clubs: "Clubs", updates: "Updates & new features", reminders: "Daily reminders", share_comments: "Comments on your shared links", all: "All emails" },
  },
  es: {
    title: "Suscripción cancelada", h1: "Has cancelado la suscripción",
    wont: "Ya no recibirás correos de <strong>{c}</strong> de WRotate.",
    reenable: "Puedes volver a activarlos cuando quieras en WRotate → Perfil → Notificaciones.",
    all: "Cancelar la suscripción a todos los correos", open: "Abrir WRotate",
    cats: { comments: "Comentarios y respuestas", mentions: "Menciones", friends: "Seguidores y solicitudes de amistad", clubs: "Clubes", updates: "Novedades y nuevas funciones", reminders: "Recordatorios diarios", share_comments: "Comentarios en tus enlaces compartidos", all: "Todos los correos" },
  },
  it: {
    title: "Iscrizione annullata", h1: "Hai annullato l'iscrizione",
    wont: "Non riceverai più le email di <strong>{c}</strong> da WRotate.",
    reenable: "Puoi riattivarle quando vuoi in WRotate → Profilo → Notifiche.",
    all: "Annulla l'iscrizione a tutte le email", open: "Apri WRotate",
    cats: { comments: "Commenti e risposte", mentions: "Menzioni", friends: "Follower e richieste di amicizia", clubs: "Club", updates: "Aggiornamenti e nuove funzioni", reminders: "Promemoria giornalieri", share_comments: "Commenti sui tuoi link condivisi", all: "Tutte le email" },
  },
  fr: {
    title: "Désabonnement confirmé", h1: "Vous êtes désabonné",
    wont: "Vous ne recevrez plus les e-mails <strong>{c}</strong> de WRotate.",
    reenable: "Vous pouvez les réactiver à tout moment dans WRotate → Profil → Notifications.",
    all: "Se désabonner de tous les e-mails", open: "Ouvrir WRotate",
    cats: { comments: "Commentaires et réponses", mentions: "Mentions", friends: "Abonnements et demandes d'ami", clubs: "Clubs", updates: "Actualités et nouvelles fonctions", reminders: "Rappels quotidiens", share_comments: "Commentaires sur vos liens partagés", all: "Tous les e-mails" },
  },
  tr: {
    title: "Abonelikten çıkıldı", h1: "Abonelikten çıktın",
    wont: "Artık WRotate'ten <strong>{c}</strong> e-postaları almayacaksın.",
    reenable: "İstediğin zaman WRotate → Profil → Bildirimler bölümünden yeniden açabilirsin.",
    all: "Tüm e-postalardan çık", open: "WRotate'i aç",
    cats: { comments: "Yorumlar ve yanıtlar", mentions: "Bahsetmeler", friends: "Takipler ve arkadaşlık istekleri", clubs: "Kulüpler", updates: "Güncellemeler ve yeni özellikler", reminders: "Günlük hatırlatmalar", share_comments: "Paylaştığın bağlantılardaki yorumlar", all: "Tüm e-postalar" },
  },
  de: {
    title: "Abgemeldet", h1: "Du hast dich abgemeldet",
    wont: "Du erhältst von WRotate keine E-Mails mehr zu <strong>{c}</strong>.",
    reenable: "Du kannst sie jederzeit in WRotate → Profil → Benachrichtigungen wieder aktivieren.",
    all: "Von allen E-Mails abmelden", open: "WRotate öffnen",
    cats: { comments: "Kommentare und Antworten", mentions: "Erwähnungen", friends: "Follower und Freundschaftsanfragen", clubs: "Clubs", updates: "Neuigkeiten und neue Funktionen", reminders: "Tägliche Erinnerungen", share_comments: "Kommentare zu deinen geteilten Links", all: "Alle E-Mails" },
  },
  pt: {
    title: "Subscrição cancelada", h1: "Cancelaste a subscrição",
    wont: "Já não vais receber e-mails de <strong>{c}</strong> do WRotate.",
    reenable: "Podes voltar a ativá-los quando quiseres em WRotate → Perfil → Notificações.",
    all: "Cancelar a subscrição de todos os e-mails", open: "Abrir o WRotate",
    cats: { comments: "Comentários e respostas", mentions: "Menções", friends: "Seguidores e pedidos de amizade", clubs: "Clubes", updates: "Novidades e novas funções", reminders: "Lembretes diários", share_comments: "Comentários nas tuas ligações partilhadas", all: "Todos os e-mails" },
  },
};
