// email-unsubscribe — the confirmation page and the four error pages in every
// app language. {c} is the category label. The success page and the "could not
// update" page follow the member's own language; the other three errors happen
// before (or without) a profile, so they follow the request (requestLang in
// _shared/lang.ts: ?lang=, else the browser's Accept-Language, else English).
import type { Lang } from "../_shared/lang.ts";

export interface UnsubStrings {
  title: string; h1: string; wont: string; reenable: string; all: string; open: string;
  cats: Record<string, string>;
  err: {
    invalidTitle: string; invalidH1: string; incomplete: string; expired: string;
    errorTitle: string; errorH1: string; noAccount: string; noUpdate: string;
  };
}

export const UNSUB_STRINGS: Record<Lang, UnsubStrings> = {
  en: {
    title: "Unsubscribed", h1: "You've been unsubscribed",
    wont: "You won't receive <strong>{c}</strong> emails from WRotate anymore.",
    reenable: "You can re-enable them anytime in WRotate → Profile → Notifications.",
    all: "Unsubscribe from all emails", open: "Open WRotate",
    cats: { comments: "Comments & replies", mentions: "Mentions", friends: "Follows & friend requests", clubs: "Clubs", updates: "Updates & new features", reminders: "Daily reminders", share_comments: "Comments on your shared links", all: "All emails" },
    err: {
      invalidTitle: "Invalid link", invalidH1: "Invalid unsubscribe link",
      incomplete: "This link appears to be incomplete. Open WRotate to manage your notification preferences.",
      expired: "This link has expired or is invalid. Open WRotate to manage your notification preferences.",
      errorTitle: "Error", errorH1: "Something went wrong",
      noAccount: "We couldn't find your account. Open WRotate to manage your preferences.",
      noUpdate: "We couldn't update your preferences. Try again or open WRotate to manage them manually.",
    },
  },
  es: {
    title: "Suscripción cancelada", h1: "Has cancelado la suscripción",
    wont: "Ya no recibirás correos de <strong>{c}</strong> de WRotate.",
    reenable: "Puedes volver a activarlos cuando quieras en WRotate → Perfil → Notificaciones.",
    all: "Cancelar la suscripción a todos los correos", open: "Abrir WRotate",
    cats: { comments: "Comentarios y respuestas", mentions: "Menciones", friends: "Seguidores y solicitudes de amistad", clubs: "Clubes", updates: "Novedades y nuevas funciones", reminders: "Recordatorios diarios", share_comments: "Comentarios en tus enlaces compartidos", all: "Todos los correos" },
    err: {
      invalidTitle: "Enlace no válido", invalidH1: "Enlace de cancelación no válido",
      incomplete: "Parece que este enlace está incompleto. Abre WRotate para gestionar tus preferencias de notificación.",
      expired: "Este enlace ha caducado o no es válido. Abre WRotate para gestionar tus preferencias de notificación.",
      errorTitle: "Error", errorH1: "Algo salió mal",
      noAccount: "No pudimos encontrar tu cuenta. Abre WRotate para gestionar tus preferencias.",
      noUpdate: "No pudimos actualizar tus preferencias. Inténtalo de nuevo o abre WRotate para gestionarlas manualmente.",
    },
  },
  it: {
    title: "Iscrizione annullata", h1: "Hai annullato l'iscrizione",
    wont: "Non riceverai più le email di <strong>{c}</strong> da WRotate.",
    reenable: "Puoi riattivarle quando vuoi in WRotate → Profilo → Notifiche.",
    all: "Annulla l'iscrizione a tutte le email", open: "Apri WRotate",
    cats: { comments: "Commenti e risposte", mentions: "Menzioni", friends: "Follower e richieste di amicizia", clubs: "Club", updates: "Aggiornamenti e nuove funzioni", reminders: "Promemoria giornalieri", share_comments: "Commenti sui tuoi link condivisi", all: "Tutte le email" },
    err: {
      invalidTitle: "Link non valido", invalidH1: "Link di annullamento non valido",
      incomplete: "Questo link sembra incompleto. Apri WRotate per gestire le preferenze di notifica.",
      expired: "Questo link è scaduto o non è valido. Apri WRotate per gestire le preferenze di notifica.",
      errorTitle: "Errore", errorH1: "Qualcosa è andato storto",
      noAccount: "Non siamo riusciti a trovare il tuo account. Apri WRotate per gestire le tue preferenze.",
      noUpdate: "Non siamo riusciti ad aggiornare le tue preferenze. Riprova oppure apri WRotate per gestirle manualmente.",
    },
  },
  fr: {
    title: "Désabonnement confirmé", h1: "Vous êtes désabonné",
    wont: "Vous ne recevrez plus les e-mails <strong>{c}</strong> de WRotate.",
    reenable: "Vous pouvez les réactiver à tout moment dans WRotate → Profil → Notifications.",
    all: "Se désabonner de tous les e-mails", open: "Ouvrir WRotate",
    cats: { comments: "Commentaires et réponses", mentions: "Mentions", friends: "Abonnements et demandes d'ami", clubs: "Clubs", updates: "Actualités et nouvelles fonctions", reminders: "Rappels quotidiens", share_comments: "Commentaires sur vos liens partagés", all: "Tous les e-mails" },
    err: {
      invalidTitle: "Lien invalide", invalidH1: "Lien de désabonnement invalide",
      incomplete: "Ce lien semble incomplet. Ouvrez WRotate pour gérer vos préférences de notification.",
      expired: "Ce lien a expiré ou est invalide. Ouvrez WRotate pour gérer vos préférences de notification.",
      errorTitle: "Erreur", errorH1: "Une erreur s'est produite",
      noAccount: "Nous n'avons pas trouvé votre compte. Ouvrez WRotate pour gérer vos préférences.",
      noUpdate: "Nous n'avons pas pu mettre à jour vos préférences. Réessayez ou ouvrez WRotate pour les gérer manuellement.",
    },
  },
  tr: {
    title: "Abonelikten çıkıldı", h1: "Abonelikten çıktın",
    wont: "Artık WRotate'ten <strong>{c}</strong> e-postaları almayacaksın.",
    reenable: "İstediğin zaman WRotate → Profil → Bildirimler bölümünden yeniden açabilirsin.",
    all: "Tüm e-postalardan çık", open: "WRotate'i aç",
    cats: { comments: "Yorumlar ve yanıtlar", mentions: "Bahsetmeler", friends: "Takipler ve arkadaşlık istekleri", clubs: "Kulüpler", updates: "Güncellemeler ve yeni özellikler", reminders: "Günlük hatırlatmalar", share_comments: "Paylaştığın bağlantılardaki yorumlar", all: "Tüm e-postalar" },
    err: {
      invalidTitle: "Geçersiz bağlantı", invalidH1: "Geçersiz abonelikten çıkma bağlantısı",
      incomplete: "Bu bağlantı eksik görünüyor. Bildirim tercihlerini yönetmek için WRotate'i aç.",
      expired: "Bu bağlantının süresi dolmuş ya da bağlantı geçersiz. Bildirim tercihlerini yönetmek için WRotate'i aç.",
      errorTitle: "Hata", errorH1: "Bir şeyler ters gitti",
      noAccount: "Hesabını bulamadık. Tercihlerini yönetmek için WRotate'i aç.",
      noUpdate: "Tercihlerini güncelleyemedik. Tekrar dene ya da tercihlerini elle yönetmek için WRotate'i aç.",
    },
  },
  de: {
    title: "Abgemeldet", h1: "Du hast dich abgemeldet",
    wont: "Du erhältst von WRotate keine E-Mails mehr zu <strong>{c}</strong>.",
    reenable: "Du kannst sie jederzeit in WRotate → Profil → Benachrichtigungen wieder aktivieren.",
    all: "Von allen E-Mails abmelden", open: "WRotate öffnen",
    cats: { comments: "Kommentare und Antworten", mentions: "Erwähnungen", friends: "Follower und Freundschaftsanfragen", clubs: "Clubs", updates: "Neuigkeiten und neue Funktionen", reminders: "Tägliche Erinnerungen", share_comments: "Kommentare zu deinen geteilten Links", all: "Alle E-Mails" },
    err: {
      invalidTitle: "Ungültiger Link", invalidH1: "Ungültiger Abmeldelink",
      incomplete: "Dieser Link scheint unvollständig zu sein. Öffne WRotate, um deine Benachrichtigungseinstellungen zu verwalten.",
      expired: "Dieser Link ist abgelaufen oder ungültig. Öffne WRotate, um deine Benachrichtigungseinstellungen zu verwalten.",
      errorTitle: "Fehler", errorH1: "Etwas ist schiefgelaufen",
      noAccount: "Wir konnten dein Konto nicht finden. Öffne WRotate, um deine Einstellungen zu verwalten.",
      noUpdate: "Wir konnten deine Einstellungen nicht aktualisieren. Versuch es noch einmal oder öffne WRotate, um sie selbst zu verwalten.",
    },
  },
  pt: {
    title: "Subscrição cancelada", h1: "Cancelaste a subscrição",
    wont: "Já não vais receber e-mails de <strong>{c}</strong> do WRotate.",
    reenable: "Podes voltar a ativá-los quando quiseres em WRotate → Perfil → Notificações.",
    all: "Cancelar a subscrição de todos os e-mails", open: "Abrir o WRotate",
    cats: { comments: "Comentários e respostas", mentions: "Menções", friends: "Seguidores e pedidos de amizade", clubs: "Clubes", updates: "Novidades e novas funções", reminders: "Lembretes diários", share_comments: "Comentários nas tuas ligações partilhadas", all: "Todos os e-mails" },
    err: {
      invalidTitle: "Ligação inválida", invalidH1: "Ligação de cancelamento inválida",
      incomplete: "Esta ligação parece estar incompleta. Abre o WRotate para gerir as tuas preferências de notificação.",
      expired: "Esta ligação expirou ou é inválida. Abre o WRotate para gerir as tuas preferências de notificação.",
      errorTitle: "Erro", errorH1: "Algo correu mal",
      noAccount: "Não conseguimos encontrar a tua conta. Abre o WRotate para gerir as tuas preferências.",
      noUpdate: "Não conseguimos atualizar as tuas preferências. Tenta novamente ou abre o WRotate para as gerires manualmente.",
    },
  },
};
