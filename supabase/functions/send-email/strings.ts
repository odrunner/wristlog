// send-email — the notification emails in every app language.
//
// {a} is the actor's display name (already HTML-escaped). A pair is
// [subject, body]; for comment / comment_also the second item is the lead
// sentence, which lib.ts ends with a full stop or with `colon` + the quoted
// text. Wording follows i18n/<lang>.json (tu/vous/du, "close friends", "post").
// English is the text these emails have always had: lib.test.ts pins it.
import type { Lang } from "../_shared/lang.ts";

export interface EmailStrings {
  comment: [string, string];
  comment_also: [string, string];
  follow: [string, string];
  follow_request: [string, string];
  follow_accepted: [string, string];
  message_request: [string, string];
  friend_request: [string, string];
  friend_accepted: [string, string];
  club_invite: [string, string];
  club_join_request: [string, string];
  club_join_accepted: [string, string];
  club_promoted: [string, string];
  // subject, then the lead with no surface / in a post / in a comment
  mention: [string, string, string, string];
  colon: string;
  open: string;        // the button
  why: string;         // "You're receiving this because…"
  unsub: string;
  manage: string;
  whyNoLink: string;   // footer when there is no unsubscribe link
}

export const EMAIL_STRINGS: Record<Lang, EmailStrings> = {
  en: {
    comment: ["{a} commented on your post", "{a} commented on your post"],
    comment_also: ["{a} also commented", "{a} also commented on a post you interacted with"],
    follow: ["{a} started following you", "{a} is now following you on WRotate."],
    follow_request: ["{a} wants to follow you", "{a} sent you a follow request on WRotate. Open the app to approve or decline."],
    follow_accepted: ["{a} accepted your follow request", "{a} accepted your follow request. You can now see their posts."],
    message_request: ["{a} wants to send you a message", "{a} wants to send you a message on WRotate. Open the app to accept or decline."],
    friend_request: ["{a} sent a close friend request", "{a} wants to be your close friend on WRotate. Open the app to respond."],
    friend_accepted: ["{a} accepted your friend request", "You and {a} are now close friends on WRotate!"],
    club_invite: ["{a} invited you to a club", "{a} invited you to join a club on WRotate. Open the app to accept."],
    club_join_request: ["{a} wants to join your club", "{a} requested to join your club. Open the app to approve or decline."],
    club_join_accepted: ["{a} approved your club request", "{a} approved your request to join the club. Welcome in!"],
    club_promoted: ["You were promoted in a club", "{a} made you an owner of the club on WRotate."],
    mention: ["{a} mentioned you", "{a} mentioned you", "{a} mentioned you in a post", "{a} mentioned you in a comment"],
    colon: ":",
    open: "Open WRotate",
    why: "You're receiving this because you have email notifications enabled in WRotate.",
    unsub: "Unsubscribe",
    manage: "Manage preferences",
    whyNoLink: "To change your preferences, open WRotate &rarr; Profile &rarr; Notifications.",
  },
  es: {
    comment: ["{a} comentó tu publicación", "{a} comentó tu publicación"],
    comment_also: ["{a} también comentó", "{a} también comentó una publicación en la que participaste"],
    follow: ["{a} empezó a seguirte", "{a} ahora te sigue en WRotate."],
    follow_request: ["{a} quiere seguirte", "{a} te envió una solicitud de seguimiento en WRotate. Abre la app para aprobarla o rechazarla."],
    follow_accepted: ["{a} aceptó tu solicitud de seguimiento", "{a} aceptó tu solicitud de seguimiento. Ya puedes ver sus publicaciones."],
    message_request: ["{a} quiere enviarte un mensaje", "{a} quiere enviarte un mensaje en WRotate. Abre la app para aceptar o rechazar."],
    friend_request: ["{a} te envió una solicitud de mejores amigos", "{a} quiere ser uno de tus mejores amigos en WRotate. Abre la app para responder."],
    friend_accepted: ["{a} aceptó tu solicitud de amistad", "{a} ya es uno de tus mejores amigos en WRotate."],
    club_invite: ["{a} te invitó a un club", "{a} te invitó a unirte a un club en WRotate. Abre la app para aceptar."],
    club_join_request: ["{a} quiere unirse a tu club", "{a} solicitó unirse a tu club. Abre la app para aprobar o rechazar."],
    club_join_accepted: ["{a} aprobó tu solicitud para el club", "{a} aprobó tu solicitud para unirte al club. Ya formas parte."],
    club_promoted: ["Tienes un nuevo rol en un club", "{a} te dio el rol de propietario del club en WRotate."],
    mention: ["{a} te mencionó", "{a} te mencionó", "{a} te mencionó en una publicación", "{a} te mencionó en un comentario"],
    colon: ":",
    open: "Abrir WRotate",
    why: "Recibes este correo porque tienes activadas las notificaciones por correo en WRotate.",
    unsub: "Cancelar suscripción",
    manage: "Gestionar preferencias",
    whyNoLink: "Para cambiar tus preferencias, abre WRotate &rarr; Perfil &rarr; Notificaciones.",
  },
  it: {
    comment: ["{a} ha commentato il tuo post", "{a} ha commentato il tuo post"],
    comment_also: ["{a} ha commentato anche", "{a} ha commentato anche un post con cui hai interagito"],
    follow: ["{a} ha iniziato a seguirti", "{a} ora ti segue su WRotate."],
    follow_request: ["{a} vuole seguirti", "{a} ti ha inviato una richiesta di follow su WRotate. Apri l'app per approvarla o rifiutarla."],
    follow_accepted: ["{a} ha accettato la tua richiesta di follow", "{a} ha accettato la tua richiesta di follow. Ora puoi vedere i suoi post."],
    message_request: ["{a} vuole inviarti un messaggio", "{a} vuole inviarti un messaggio su WRotate. Apri l'app per accettare o rifiutare."],
    friend_request: ["{a} ti ha inviato una richiesta di amicizia stretta", "{a} vuole essere tra i tuoi amici stretti su WRotate. Apri l'app per rispondere."],
    friend_accepted: ["{a} ha accettato la tua richiesta di amicizia", "Tu e {a} ora siete amici stretti su WRotate."],
    club_invite: ["{a} ti ha invitato in un club", "{a} ti ha invitato a unirti a un club su WRotate. Apri l'app per accettare."],
    club_join_request: ["{a} vuole unirsi al tuo club", "{a} ha chiesto di unirsi al tuo club. Apri l'app per approvare o rifiutare."],
    club_join_accepted: ["{a} ha approvato la tua richiesta per il club", "{a} ha approvato la tua richiesta di unirti al club. Ora ne fai parte."],
    club_promoted: ["Hai un nuovo ruolo in un club", "{a} ti ha dato il ruolo di proprietario del club su WRotate."],
    mention: ["{a} ti ha menzionato", "{a} ti ha menzionato", "{a} ti ha menzionato in un post", "{a} ti ha menzionato in un commento"],
    colon: ":",
    open: "Apri WRotate",
    why: "Ricevi questa email perché hai attivato le notifiche via email in WRotate.",
    unsub: "Annulla iscrizione",
    manage: "Gestisci preferenze",
    whyNoLink: "Per cambiare le preferenze, apri WRotate &rarr; Profilo &rarr; Notifiche.",
  },
  fr: {
    comment: ["{a} a commenté votre publication", "{a} a commenté votre publication"],
    comment_also: ["{a} a aussi commenté", "{a} a aussi commenté une publication avec laquelle vous avez interagi"],
    follow: ["{a} a commencé à vous suivre", "{a} vous suit désormais sur WRotate."],
    follow_request: ["{a} souhaite vous suivre", "{a} vous a envoyé une demande d'abonnement sur WRotate. Ouvrez l'app pour l'approuver ou la refuser."],
    follow_accepted: ["{a} a accepté votre demande d'abonnement", "{a} a accepté votre demande d'abonnement. Vous pouvez maintenant voir ses publications."],
    message_request: ["{a} souhaite vous envoyer un message", "{a} souhaite vous envoyer un message sur WRotate. Ouvrez l'app pour accepter ou refuser."],
    friend_request: ["{a} vous a envoyé une demande d'ami proche", "{a} souhaite faire partie de vos amis proches sur WRotate. Ouvrez l'app pour répondre."],
    friend_accepted: ["{a} a accepté votre demande d'ami", "Vous et {a} êtes maintenant amis proches sur WRotate."],
    club_invite: ["{a} vous invite dans un club", "{a} vous invite à rejoindre un club sur WRotate. Ouvrez l'app pour accepter."],
    club_join_request: ["{a} souhaite rejoindre votre club", "{a} a demandé à rejoindre votre club. Ouvrez l'app pour approuver ou refuser."],
    club_join_accepted: ["{a} a approuvé votre demande pour le club", "{a} a approuvé votre demande pour rejoindre le club. Vous en faites désormais partie."],
    club_promoted: ["Vous avez un nouveau rôle dans un club", "{a} vous a donné le rôle de propriétaire du club sur WRotate."],
    mention: ["{a} vous a mentionné", "{a} vous a mentionné", "{a} vous a mentionné dans une publication", "{a} vous a mentionné dans un commentaire"],
    colon: "&nbsp;:",
    open: "Ouvrir WRotate",
    why: "Vous recevez cet e-mail parce que les notifications par e-mail sont activées dans WRotate.",
    unsub: "Se désabonner",
    manage: "Gérer les préférences",
    whyNoLink: "Pour modifier vos préférences, ouvrez WRotate &rarr; Profil &rarr; Notifications.",
  },
  tr: {
    comment: ["{a} gönderine yorum yaptı", "{a} gönderine yorum yaptı"],
    comment_also: ["{a} da yorum yaptı", "{a}, etkileşimde bulunduğun bir gönderiye de yorum yaptı"],
    follow: ["{a} seni takip etmeye başladı", "{a} artık seni WRotate'te takip ediyor."],
    follow_request: ["{a} seni takip etmek istiyor", "{a} sana WRotate'te takip isteği gönderdi. Onaylamak veya reddetmek için uygulamayı aç."],
    follow_accepted: ["{a} takip isteğini kabul etti", "{a} takip isteğini kabul etti. Artık gönderilerini görebilirsin."],
    message_request: ["{a} sana mesaj göndermek istiyor", "{a} sana WRotate'te mesaj göndermek istiyor. Kabul etmek veya reddetmek için uygulamayı aç."],
    friend_request: ["{a} yakın arkadaşlık isteği gönderdi", "{a} WRotate'te yakın arkadaşın olmak istiyor. Yanıtlamak için uygulamayı aç."],
    friend_accepted: ["{a} arkadaşlık isteğini kabul etti", "{a} ile artık WRotate'te yakın arkadaşsınız."],
    club_invite: ["{a} seni bir kulübe davet etti", "{a} seni WRotate'te bir kulübe katılmaya davet etti. Kabul etmek için uygulamayı aç."],
    club_join_request: ["{a} kulübüne katılmak istiyor", "{a} kulübüne katılmak için istek gönderdi. Onaylamak veya reddetmek için uygulamayı aç."],
    club_join_accepted: ["{a} kulüp isteğini onayladı", "{a} kulübe katılma isteğini onayladı. Hoş geldin!"],
    club_promoted: ["Bir kulüpte yeni bir rolün var", "{a} seni WRotate'teki kulübün sahibi yaptı."],
    mention: ["{a} senden bahsetti", "{a} senden bahsetti", "{a} bir gönderide senden bahsetti", "{a} bir yorumda senden bahsetti"],
    colon: ":",
    open: "WRotate'i aç",
    why: "Bu e-postayı, WRotate'te e-posta bildirimlerin açık olduğu için alıyorsun.",
    unsub: "Abonelikten çık",
    manage: "Tercihleri yönet",
    whyNoLink: "Tercihlerini değiştirmek için WRotate &rarr; Profil &rarr; Bildirimler bölümünü aç.",
  },
  de: {
    comment: ["{a} hat deinen Beitrag kommentiert", "{a} hat deinen Beitrag kommentiert"],
    comment_also: ["{a} hat auch kommentiert", "{a} hat auch einen Beitrag kommentiert, mit dem du interagiert hast"],
    follow: ["{a} folgt dir jetzt", "{a} folgt dir jetzt auf WRotate."],
    follow_request: ["{a} möchte dir folgen", "{a} hat dir auf WRotate eine Follower-Anfrage geschickt. Öffne die App, um sie anzunehmen oder abzulehnen."],
    follow_accepted: ["{a} hat deine Follower-Anfrage angenommen", "{a} hat deine Follower-Anfrage angenommen. Du kannst jetzt die Beiträge sehen."],
    message_request: ["{a} möchte dir eine Nachricht senden", "{a} möchte dir auf WRotate eine Nachricht senden. Öffne die App, um anzunehmen oder abzulehnen."],
    friend_request: ["{a} hat dir eine Anfrage für enge Freunde geschickt", "{a} möchte auf WRotate zu deinen engen Freunden gehören. Öffne die App, um zu antworten."],
    friend_accepted: ["{a} hat deine Freundschaftsanfrage angenommen", "Du und {a} seid jetzt enge Freunde auf WRotate."],
    club_invite: ["{a} hat dich in einen Club eingeladen", "{a} hat dich eingeladen, einem Club auf WRotate beizutreten. Öffne die App, um anzunehmen."],
    club_join_request: ["{a} möchte deinem Club beitreten", "{a} möchte deinem Club beitreten. Öffne die App, um zuzustimmen oder abzulehnen."],
    club_join_accepted: ["{a} hat deine Club-Anfrage bestätigt", "{a} hat deine Anfrage bestätigt, dem Club beizutreten. Willkommen!"],
    club_promoted: ["Du hast eine neue Rolle in einem Club", "{a} hat dir auf WRotate die Inhaberrolle im Club übertragen."],
    mention: ["{a} hat dich erwähnt", "{a} hat dich erwähnt", "{a} hat dich in einem Beitrag erwähnt", "{a} hat dich in einem Kommentar erwähnt"],
    colon: ":",
    open: "WRotate öffnen",
    why: "Du erhältst diese E-Mail, weil du E-Mail-Benachrichtigungen in WRotate aktiviert hast.",
    unsub: "Abmelden",
    manage: "Einstellungen verwalten",
    whyNoLink: "Um deine Einstellungen zu ändern, öffne WRotate &rarr; Profil &rarr; Benachrichtigungen.",
  },
  pt: {
    comment: ["{a} comentou a tua publicação", "{a} comentou a tua publicação"],
    comment_also: ["{a} também comentou", "{a} também comentou uma publicação com a qual interagiste"],
    follow: ["{a} começou a seguir-te", "{a} segue-te agora no WRotate."],
    follow_request: ["{a} quer seguir-te", "{a} enviou-te um pedido para te seguir no WRotate. Abre a app para aprovar ou recusar."],
    follow_accepted: ["{a} aceitou o teu pedido para seguir", "{a} aceitou o teu pedido. Já podes ver as publicações."],
    message_request: ["{a} quer enviar-te uma mensagem", "{a} quer enviar-te uma mensagem no WRotate. Abre a app para aceitar ou recusar."],
    friend_request: ["{a} enviou-te um pedido de amigo próximo", "{a} quer ser um dos teus amigos próximos no WRotate. Abre a app para responder."],
    friend_accepted: ["{a} aceitou o teu pedido de amizade", "Tu e {a} são agora amigos próximos no WRotate."],
    club_invite: ["{a} convidou-te para um clube", "{a} convidou-te para um clube no WRotate. Abre a app para aceitar."],
    club_join_request: ["{a} quer entrar no teu clube", "{a} pediu para entrar no teu clube. Abre a app para aprovar ou recusar."],
    club_join_accepted: ["{a} aprovou o teu pedido para o clube", "{a} aprovou o teu pedido para entrar no clube. Já fazes parte."],
    club_promoted: ["Tens uma nova função num clube", "{a} deu-te a função de proprietário do clube no WRotate."],
    mention: ["{a} mencionou-te", "{a} mencionou-te", "{a} mencionou-te numa publicação", "{a} mencionou-te num comentário"],
    colon: ":",
    open: "Abrir o WRotate",
    why: "Recebes este e-mail porque tens as notificações por e-mail ativadas no WRotate.",
    unsub: "Cancelar subscrição",
    manage: "Gerir preferências",
    whyNoLink: "Para alterar as tuas preferências, abre o WRotate &rarr; Perfil &rarr; Notificações.",
  },
};
