// The five public share pages (share-post, share-collection, share-wishlist,
// share-watches, share-recap) and the comment box under two of them, in every
// app language. The reader is whoever opened the link, usually not a member, so
// the language comes from the request (pageLang in ./lang.ts), not a profile.
//
// English is the text these pages always had; each page's lib.test.ts pins it
// byte for byte. {n} is a person's name or a number, {w} a watch, {m} a month.
// Names, captions, labels and watch names are the member's own and are never
// translated. No string here may contain & < > or a double quote: they are
// written into markup and attributes as they are (share-strings.test.ts).
// The og:image SVGs stay English: only link-preview fetchers ever request them.
import type { Lang, Plural } from "./lang.ts";

export interface ShareStrings {
  someone: string;
  tagline: string;
  visit: string;
  incomplete: string;
  revoked: string;
  collPrivate: string;
  watches: Plural;
  wears: Plural;
  mostWornIs: string;
  sharedFrom: string;
  post: {
    none: string; notFound: string; notFoundDesc: string; notFoundSub: string;
    photoAlt: string; appStoreAlt: string;
    titleWatch: string; titlePost: string; wore: string; checkOut: string;
    useCases: Record<string, string>;
  };
  collection: {
    none: string; privateTitle: string; notFound: string; notFoundSub: string;
    empty: string; title: string; totalWears: Plural;
  };
  wishlist: { none: string; deadTitle: string; dead: string; heading: string; emptied: string; emptiedSub: string; cta: string };
  watchesPage: { none: string; deadTitle: string; dead: string; heading: string; emptied: string; emptiedSub: string; cta: string };
  recap: {
    bad: string; badSub: string; privateTitle: string; private: string;
    title: string; noWears: string; noWearsSub: string;
    eyebrow: string; statWears: string; statWatches: string; statDays: string;
    mostWorn: string; streak: string; cta: string; daysLogged: Plural;
  };
  comments: {
    title: string; empty: string; name: string; namePh: string; body: string; bodyPh: string;
    note: string; submit: string; failed: string;
    now: string; min: string; hour: string; day: string;
    needName: string; nameLong: string; needBody: string; bodyLong: string;
    bad: string; gone: string; tooMany: string; saveFail: string;
  };
}

export const SHARE_STRINGS: Record<Lang, ShareStrings> = {
  en: {
    someone: "Someone",
    tagline: "The watch collection tracker for enthusiasts.",
    visit: "Visit WRotate to explore watch collections.",
    incomplete: "This link is incomplete. Visit WRotate to explore watch collections.",
    revoked: "The owner may have revoked it, or it never existed.",
    collPrivate: "This collection is private or no longer available.",
    watches: ["{n} watch", "{n} watches"],
    wears: ["{n} wear", "{n} wears"],
    mostWornIs: "Most worn: {w}",
    sharedFrom: "Shared from WRotate",
    post: {
      none: "No post specified", notFound: "Post not found",
      notFoundDesc: "This post is private or no longer available.",
      notFoundSub: "This post may be private, deleted, or no longer available.",
      photoAlt: "Watch post", appStoreAlt: "Download on the App Store",
      titleWatch: "{n}'s {w} — WRotate", titlePost: "{n}'s post — WRotate",
      wore: "{n} wore their {w}", checkOut: "Check out this post on WRotate",
      useCases: {
        casual: "Casual", formal: "Formal", sport: "Sport", dive: "Dive", travel: "Travel", work: "Work",
        special: "Special Occasion", outdoor: "Outdoor", dinner: "Dinner", unspecified: "",
      },
    },
    collection: {
      none: "No user specified", privateTitle: "Private Collection — WRotate",
      notFound: "Collection not found", notFoundSub: "This collection may be private or no longer available.",
      empty: "No public watches yet", title: "{n}'s Watch Collection — WRotate",
      totalWears: ["{n} total wear", "{n} total wears"],
    },
    wishlist: {
      none: "No wishlist specified", deadTitle: "Wishlist link — WRotate",
      dead: "This wishlist link is no longer available", heading: "{n}'s wishlist",
      emptied: "Nothing left in this list",
      emptiedSub: "The watches on this link are no longer on the owner's wishlist.",
      cta: "Start your own wishlist",
    },
    watchesPage: {
      none: "No watches specified", deadTitle: "Collection link — WRotate",
      dead: "This link is no longer available", heading: "{n}'s watches",
      emptied: "Nothing left on this link",
      emptiedSub: "The watches on this link are no longer in the owner's collection.",
      cta: "Track your own collection",
    },
    recap: {
      bad: "Nothing to show here", badSub: "This link is missing a collector or a month.",
      privateTitle: "Private — WRotate", private: "Not available",
      title: "{n}'s {m} — WRotate", noWears: "No wears that month",
      noWearsSub: "{n} didn't log any wears in {m}.",
      eyebrow: "Month in review", statWears: "Wears", statWatches: "Watches", statDays: "Days",
      mostWorn: "Most worn", streak: "days logged in a row", cta: "Track your own rotation",
      daysLogged: ["{n} day logged", "{n} days logged"],
    },
    comments: {
      title: "Comments", empty: "No comments yet — be the first.",
      name: "Your name", namePh: "So they know who this is from",
      body: "Comment", bodyPh: "Say something about these watches…",
      note: "Visible to everyone who has this link.", submit: "Post comment",
      failed: "Could not post your comment. Please try again.",
      now: "just now", min: "{n} min ago", hour: "{n} h ago", day: "{n} d ago",
      needName: "Please add your name", nameLong: "Name is too long ({n} characters max)",
      needBody: "Please write a comment", bodyLong: "Comment is too long ({n} characters max)",
      bad: "Bad request", gone: "This link is no longer available",
      tooMany: "Too many comments right now — please try again later",
      saveFail: "Could not save your comment",
    },
  },
  es: {
    someone: "Alguien",
    tagline: "El registro de colecciones de relojes para aficionados.",
    visit: "Visita WRotate para descubrir colecciones de relojes.",
    incomplete: "Este enlace está incompleto. Visita WRotate para descubrir colecciones de relojes.",
    revoked: "Puede que su propietario lo haya revocado o que nunca haya existido.",
    collPrivate: "Esta colección es privada o ya no está disponible.",
    watches: ["{n} reloj", "{n} relojes"],
    wears: ["{n} uso", "{n} usos"],
    mostWornIs: "Más usado: {w}",
    sharedFrom: "Compartido desde WRotate",
    post: {
      none: "No se indicó ninguna publicación", notFound: "Publicación no encontrada",
      notFoundDesc: "Esta publicación es privada o ya no está disponible.",
      notFoundSub: "Puede que esta publicación sea privada, se haya eliminado o ya no esté disponible.",
      photoAlt: "Publicación de un reloj", appStoreAlt: "Descárgalo en el App Store",
      titleWatch: "{w} de {n} — WRotate", titlePost: "Publicación de {n} — WRotate",
      wore: "{n} usó su {w}", checkOut: "Mira esta publicación en WRotate",
      useCases: {
        casual: "Informal", formal: "Formal", sport: "Deporte", dive: "Buceo", travel: "Viaje", work: "Trabajo",
        special: "Ocasión especial", outdoor: "Aire libre", dinner: "Cena", unspecified: "",
      },
    },
    collection: {
      none: "No se indicó ningún usuario", privateTitle: "Colección privada — WRotate",
      notFound: "Colección no encontrada", notFoundSub: "Puede que esta colección sea privada o ya no esté disponible.",
      empty: "Aún no hay relojes públicos", title: "Colección de relojes de {n} — WRotate",
      totalWears: ["{n} uso en total", "{n} usos en total"],
    },
    wishlist: {
      none: "No se indicó ninguna lista de deseos", deadTitle: "Enlace de lista de deseos — WRotate",
      dead: "Este enlace de lista de deseos ya no está disponible", heading: "Lista de deseos de {n}",
      emptied: "No queda nada en esta lista",
      emptiedSub: "Los relojes de este enlace ya no están en la lista de deseos de su propietario.",
      cta: "Crea tu propia lista de deseos",
    },
    watchesPage: {
      none: "No se indicó ningún reloj", deadTitle: "Enlace de colección — WRotate",
      dead: "Este enlace ya no está disponible", heading: "Relojes de {n}",
      emptied: "No queda nada en este enlace",
      emptiedSub: "Los relojes de este enlace ya no están en la colección de su propietario.",
      cta: "Registra tu propia colección",
    },
    recap: {
      bad: "No hay nada que mostrar", badSub: "A este enlace le falta un coleccionista o un mes.",
      privateTitle: "Privado — WRotate", private: "No disponible",
      title: "{n} · {m} — WRotate", noWears: "Sin usos ese mes",
      noWearsSub: "{n} no registró ningún uso en {m}.",
      eyebrow: "Resumen del mes", statWears: "Usos", statWatches: "Relojes", statDays: "Días",
      mostWorn: "Más usados", streak: "días seguidos registrados", cta: "Registra tu propia rotación",
      daysLogged: ["{n} día registrado", "{n} días registrados"],
    },
    comments: {
      title: "Comentarios", empty: "Aún no hay comentarios — sé el primero.",
      name: "Tu nombre", namePh: "Para que sepan de quién es",
      body: "Comentario", bodyPh: "Di algo sobre estos relojes…",
      note: "Visible para cualquiera que tenga este enlace.", submit: "Publicar comentario",
      failed: "No se pudo publicar tu comentario. Inténtalo de nuevo.",
      now: "ahora mismo", min: "hace {n} min", hour: "hace {n} h", day: "hace {n} d",
      needName: "Añade tu nombre", nameLong: "El nombre es demasiado largo (máximo {n} caracteres)",
      needBody: "Escribe un comentario", bodyLong: "El comentario es demasiado largo (máximo {n} caracteres)",
      bad: "Solicitud no válida", gone: "Este enlace ya no está disponible",
      tooMany: "Demasiados comentarios en este momento — inténtalo más tarde",
      saveFail: "No se pudo guardar tu comentario",
    },
  },
  it: {
    someone: "Qualcuno",
    tagline: "Il registro delle collezioni di orologi per appassionati.",
    visit: "Visita WRotate per scoprire collezioni di orologi.",
    incomplete: "Questo link è incompleto. Visita WRotate per scoprire collezioni di orologi.",
    revoked: "Il proprietario potrebbe averlo revocato, oppure non è mai esistito.",
    collPrivate: "Questa collezione è privata o non è più disponibile.",
    watches: ["{n} orologio", "{n} orologi"],
    wears: ["{n} utilizzo", "{n} utilizzi"],
    mostWornIs: "Più indossato: {w}",
    sharedFrom: "Condiviso da WRotate",
    post: {
      none: "Nessun post indicato", notFound: "Post non trovato",
      notFoundDesc: "Questo post è privato o non è più disponibile.",
      notFoundSub: "Questo post potrebbe essere privato, eliminato o non più disponibile.",
      photoAlt: "Post di un orologio", appStoreAlt: "Scarica su App Store",
      titleWatch: "{w} di {n} — WRotate", titlePost: "Post di {n} — WRotate",
      wore: "{n} ha indossato il suo {w}", checkOut: "Guarda questo post su WRotate",
      useCases: {
        casual: "Informale", formal: "Formale", sport: "Sportivo", dive: "Subacqueo", travel: "Viaggio", work: "Lavoro",
        special: "Occasione speciale", outdoor: "All'aperto", dinner: "Cena", unspecified: "",
      },
    },
    collection: {
      none: "Nessun utente indicato", privateTitle: "Collezione privata — WRotate",
      notFound: "Collezione non trovata", notFoundSub: "Questa collezione potrebbe essere privata o non più disponibile.",
      empty: "Ancora nessun orologio pubblico", title: "La collezione di orologi di {n} — WRotate",
      totalWears: ["{n} utilizzo in totale", "{n} utilizzi in totale"],
    },
    wishlist: {
      none: "Nessuna lista dei desideri indicata", deadTitle: "Link della lista dei desideri — WRotate",
      dead: "Questo link della lista dei desideri non è più disponibile", heading: "Lista dei desideri di {n}",
      emptied: "Non è rimasto nulla in questa lista",
      emptiedSub: "Gli orologi di questo link non sono più nella lista dei desideri del proprietario.",
      cta: "Crea la tua lista dei desideri",
    },
    watchesPage: {
      none: "Nessun orologio indicato", deadTitle: "Link della collezione — WRotate",
      dead: "Questo link non è più disponibile", heading: "Orologi di {n}",
      emptied: "Non è rimasto nulla in questo link",
      emptiedSub: "Gli orologi di questo link non sono più nella collezione del proprietario.",
      cta: "Registra la tua collezione",
    },
    recap: {
      bad: "Niente da mostrare qui", badSub: "A questo link manca un collezionista o un mese.",
      privateTitle: "Privato — WRotate", private: "Non disponibile",
      title: "{n} · {m} — WRotate", noWears: "Nessun utilizzo quel mese",
      noWearsSub: "{n} non ha registrato utilizzi a {m}.",
      eyebrow: "Riepilogo del mese", statWears: "Utilizzi", statWatches: "Orologi", statDays: "Giorni",
      mostWorn: "Più indossati", streak: "giorni di fila registrati", cta: "Registra la tua rotazione",
      daysLogged: ["{n} giorno registrato", "{n} giorni registrati"],
    },
    comments: {
      title: "Commenti", empty: "Ancora nessun commento — scrivi il primo.",
      name: "Il tuo nome", namePh: "Così sanno chi scrive",
      body: "Commento", bodyPh: "Scrivi qualcosa su questi orologi…",
      note: "Visibile a chiunque abbia questo link.", submit: "Pubblica commento",
      failed: "Impossibile pubblicare il commento. Riprova.",
      now: "adesso", min: "{n} min fa", hour: "{n} h fa", day: "{n} g fa",
      needName: "Aggiungi il tuo nome", nameLong: "Il nome è troppo lungo (massimo {n} caratteri)",
      needBody: "Scrivi un commento", bodyLong: "Il commento è troppo lungo (massimo {n} caratteri)",
      bad: "Richiesta non valida", gone: "Questo link non è più disponibile",
      tooMany: "Troppi commenti in questo momento — riprova più tardi",
      saveFail: "Impossibile salvare il commento",
    },
  },
  fr: {
    someone: "Quelqu'un",
    tagline: "Le suivi de collection de montres pour les passionnés.",
    visit: "Rendez-vous sur WRotate pour découvrir des collections de montres.",
    incomplete: "Ce lien est incomplet. Rendez-vous sur WRotate pour découvrir des collections de montres.",
    revoked: "Son propriétaire l'a peut-être révoqué, ou il n'a jamais existé.",
    collPrivate: "Cette collection est privée ou n'est plus disponible.",
    watches: ["{n} montre", "{n} montres"],
    wears: ["{n} port", "{n} ports"],
    mostWornIs: "La plus portée : {w}",
    sharedFrom: "Partagé depuis WRotate",
    post: {
      none: "Aucune publication indiquée", notFound: "Publication introuvable",
      notFoundDesc: "Cette publication est privée ou n'est plus disponible.",
      notFoundSub: "Cette publication est peut-être privée, supprimée ou n'est plus disponible.",
      photoAlt: "Publication d'une montre", appStoreAlt: "Télécharger dans l'App Store",
      titleWatch: "{w} de {n} — WRotate", titlePost: "Publication de {n} — WRotate",
      wore: "{n} a porté sa {w}", checkOut: "Découvrez cette publication sur WRotate",
      useCases: {
        casual: "Décontracté", formal: "Habillé", sport: "Sport", dive: "Plongée", travel: "Voyage", work: "Travail",
        special: "Occasion spéciale", outdoor: "Plein air", dinner: "Dîner", unspecified: "",
      },
    },
    collection: {
      none: "Aucun utilisateur indiqué", privateTitle: "Collection privée — WRotate",
      notFound: "Collection introuvable", notFoundSub: "Cette collection est peut-être privée ou n'est plus disponible.",
      empty: "Aucune montre publique pour l'instant", title: "Collection de montres de {n} — WRotate",
      totalWears: ["{n} port au total", "{n} ports au total"],
    },
    wishlist: {
      none: "Aucune liste de souhaits indiquée", deadTitle: "Lien de liste de souhaits — WRotate",
      dead: "Ce lien de liste de souhaits n'est plus disponible", heading: "Liste de souhaits de {n}",
      emptied: "Il ne reste rien dans cette liste",
      emptiedSub: "Les montres de ce lien ne figurent plus dans la liste de souhaits de son propriétaire.",
      cta: "Créez votre propre liste de souhaits",
    },
    watchesPage: {
      none: "Aucune montre indiquée", deadTitle: "Lien de collection — WRotate",
      dead: "Ce lien n'est plus disponible", heading: "Montres de {n}",
      emptied: "Il ne reste rien sur ce lien",
      emptiedSub: "Les montres de ce lien ne font plus partie de la collection de son propriétaire.",
      cta: "Suivez votre propre collection",
    },
    recap: {
      bad: "Rien à afficher ici", badSub: "Il manque un collectionneur ou un mois à ce lien.",
      privateTitle: "Privé — WRotate", private: "Non disponible",
      title: "{n} · {m} — WRotate", noWears: "Aucun port ce mois-là",
      noWearsSub: "{n} n'a enregistré aucun port en {m}.",
      eyebrow: "Bilan du mois", statWears: "Ports", statWatches: "Montres", statDays: "Jours",
      mostWorn: "Les plus portées", streak: "jours d'affilée enregistrés", cta: "Suivez votre propre rotation",
      daysLogged: ["{n} jour enregistré", "{n} jours enregistrés"],
    },
    comments: {
      title: "Commentaires", empty: "Aucun commentaire pour l'instant — soyez le premier.",
      name: "Votre nom", namePh: "Pour qu'on sache de qui il vient",
      body: "Commentaire", bodyPh: "Dites quelque chose sur ces montres…",
      note: "Visible par toute personne disposant de ce lien.", submit: "Publier le commentaire",
      failed: "Impossible de publier votre commentaire. Veuillez réessayer.",
      now: "à l'instant", min: "il y a {n} min", hour: "il y a {n} h", day: "il y a {n} j",
      needName: "Ajoutez votre nom", nameLong: "Le nom est trop long ({n} caractères maximum)",
      needBody: "Écrivez un commentaire", bodyLong: "Le commentaire est trop long ({n} caractères maximum)",
      bad: "Requête invalide", gone: "Ce lien n'est plus disponible",
      tooMany: "Trop de commentaires pour le moment — veuillez réessayer plus tard",
      saveFail: "Impossible d'enregistrer votre commentaire",
    },
  },
  tr: {
    someone: "Biri",
    tagline: "Meraklılar için saat koleksiyonu takipçisi.",
    visit: "Saat koleksiyonlarını keşfetmek için WRotate'i ziyaret et.",
    incomplete: "Bu bağlantı eksik. Saat koleksiyonlarını keşfetmek için WRotate'i ziyaret et.",
    revoked: "Sahibi bağlantıyı iptal etmiş olabilir ya da hiç var olmadı.",
    collPrivate: "Bu koleksiyon gizli ya da artık mevcut değil.",
    watches: ["{n} saat", "{n} saat"],
    wears: ["{n} kullanım", "{n} kullanım"],
    mostWornIs: "En çok takılan: {w}",
    sharedFrom: "WRotate'ten paylaşıldı",
    post: {
      none: "Gönderi belirtilmedi", notFound: "Gönderi bulunamadı",
      notFoundDesc: "Bu gönderi gizli ya da artık mevcut değil.",
      notFoundSub: "Bu gönderi gizli olabilir, silinmiş olabilir ya da artık mevcut değil.",
      photoAlt: "Saat gönderisi", appStoreAlt: "App Store'dan indir",
      titleWatch: "{n} · {w} — WRotate", titlePost: "{n} · Gönderi — WRotate",
      wore: "{n}, {w} saatini taktı", checkOut: "WRotate'teki bu gönderiye göz at",
      useCases: {
        casual: "Günlük", formal: "Resmî", sport: "Spor", dive: "Dalış", travel: "Seyahat", work: "İş",
        special: "Özel gün", outdoor: "Açık hava", dinner: "Akşam yemeği", unspecified: "",
      },
    },
    collection: {
      none: "Kullanıcı belirtilmedi", privateTitle: "Gizli koleksiyon — WRotate",
      notFound: "Koleksiyon bulunamadı", notFoundSub: "Bu koleksiyon gizli olabilir ya da artık mevcut değil.",
      empty: "Henüz herkese açık saat yok", title: "{n} · Saat koleksiyonu — WRotate",
      totalWears: ["toplam {n} kullanım", "toplam {n} kullanım"],
    },
    wishlist: {
      none: "İstek listesi belirtilmedi", deadTitle: "İstek listesi bağlantısı — WRotate",
      dead: "Bu istek listesi bağlantısı artık mevcut değil", heading: "{n} istek listesi",
      emptied: "Bu listede bir şey kalmadı",
      emptiedSub: "Bu bağlantıdaki saatler artık sahibinin istek listesinde değil.",
      cta: "Kendi istek listeni oluştur",
    },
    watchesPage: {
      none: "Saat belirtilmedi", deadTitle: "Koleksiyon bağlantısı — WRotate",
      dead: "Bu bağlantı artık mevcut değil", heading: "{n} · Saatler",
      emptied: "Bu bağlantıda bir şey kalmadı",
      emptiedSub: "Bu bağlantıdaki saatler artık sahibinin koleksiyonunda değil.",
      cta: "Kendi koleksiyonunu takip et",
    },
    recap: {
      bad: "Burada gösterilecek bir şey yok", badSub: "Bu bağlantıda koleksiyoncu ya da ay eksik.",
      privateTitle: "Gizli — WRotate", private: "Mevcut değil",
      title: "{n} · {m} — WRotate", noWears: "O ay kullanım yok",
      noWearsSub: "{n}, {m} için kullanım kaydetmedi.",
      eyebrow: "Ayın özeti", statWears: "Kullanım", statWatches: "Saatler", statDays: "Gün",
      mostWorn: "En çok takılanlar", streak: "gün üst üste kayıt", cta: "Kendi rotasyonunu takip et",
      daysLogged: ["{n} gün kaydedildi", "{n} gün kaydedildi"],
    },
    comments: {
      title: "Yorumlar", empty: "Henüz yorum yok — ilk yorumu sen yaz.",
      name: "Adın", namePh: "Kimden geldiğini bilsinler",
      body: "Yorum", bodyPh: "Bu saatler hakkında bir şeyler yaz…",
      note: "Bu bağlantıya sahip herkes görebilir.", submit: "Yorumu gönder",
      failed: "Yorumun gönderilemedi. Lütfen tekrar dene.",
      now: "az önce", min: "{n} dk önce", hour: "{n} sa önce", day: "{n} g önce",
      needName: "Lütfen adını ekle", nameLong: "Ad çok uzun (en fazla {n} karakter)",
      needBody: "Lütfen bir yorum yaz", bodyLong: "Yorum çok uzun (en fazla {n} karakter)",
      bad: "Geçersiz istek", gone: "Bu bağlantı artık mevcut değil",
      tooMany: "Şu anda çok fazla yorum var — lütfen daha sonra tekrar dene",
      saveFail: "Yorumun kaydedilemedi",
    },
  },
  de: {
    someone: "Jemand",
    tagline: "Der Uhrensammlungs-Tracker für Enthusiasten.",
    visit: "Besuche WRotate und entdecke Uhrensammlungen.",
    incomplete: "Dieser Link ist unvollständig. Besuche WRotate und entdecke Uhrensammlungen.",
    revoked: "Vielleicht wurde er widerrufen, oder es gab ihn nie.",
    collPrivate: "Diese Sammlung ist privat oder nicht mehr verfügbar.",
    watches: ["{n} Uhr", "{n} Uhren"],
    wears: ["{n}× getragen", "{n}× getragen"],
    mostWornIs: "Meistgetragen: {w}",
    sharedFrom: "Geteilt über WRotate",
    post: {
      none: "Kein Beitrag angegeben", notFound: "Beitrag nicht gefunden",
      notFoundDesc: "Dieser Beitrag ist privat oder nicht mehr verfügbar.",
      notFoundSub: "Dieser Beitrag ist vielleicht privat, gelöscht oder nicht mehr verfügbar.",
      photoAlt: "Uhrenbeitrag", appStoreAlt: "Laden im App Store",
      titleWatch: "{w} von {n} — WRotate", titlePost: "Beitrag von {n} — WRotate",
      wore: "{n} hat die {w} getragen", checkOut: "Schau dir diesen Beitrag auf WRotate an",
      useCases: {
        casual: "Leger", formal: "Formell", sport: "Sport", dive: "Tauchen", travel: "Reise", work: "Arbeit",
        special: "Besonderer Anlass", outdoor: "Outdoor", dinner: "Abendessen", unspecified: "",
      },
    },
    collection: {
      none: "Kein Nutzer angegeben", privateTitle: "Private Sammlung — WRotate",
      notFound: "Sammlung nicht gefunden", notFoundSub: "Diese Sammlung ist vielleicht privat oder nicht mehr verfügbar.",
      empty: "Noch keine öffentlichen Uhren", title: "Uhrensammlung von {n} — WRotate",
      totalWears: ["insgesamt {n}× getragen", "insgesamt {n}× getragen"],
    },
    wishlist: {
      none: "Keine Wunschliste angegeben", deadTitle: "Wunschlisten-Link — WRotate",
      dead: "Dieser Wunschlisten-Link ist nicht mehr verfügbar", heading: "Wunschliste von {n}",
      emptied: "Auf dieser Liste ist nichts mehr",
      emptiedSub: "Die Uhren aus diesem Link stehen nicht mehr auf der Wunschliste.",
      cta: "Starte deine eigene Wunschliste",
    },
    watchesPage: {
      none: "Keine Uhren angegeben", deadTitle: "Sammlungs-Link — WRotate",
      dead: "Dieser Link ist nicht mehr verfügbar", heading: "Uhren von {n}",
      emptied: "Unter diesem Link ist nichts mehr",
      emptiedSub: "Die Uhren aus diesem Link sind nicht mehr in der Sammlung.",
      cta: "Erfasse deine eigene Sammlung",
    },
    recap: {
      bad: "Hier gibt es nichts zu sehen", badSub: "Diesem Link fehlt ein Sammler oder ein Monat.",
      privateTitle: "Privat — WRotate", private: "Nicht verfügbar",
      title: "{n} · {m} — WRotate", noWears: "Keine Trageeinträge in diesem Monat",
      noWearsSub: "{n} hat im {m} nichts eingetragen.",
      eyebrow: "Monatsrückblick", statWears: "Trageeinträge", statWatches: "Uhren", statDays: "Tage",
      mostWorn: "Meistgetragen", streak: "Tage in Folge erfasst", cta: "Erfasse deine eigene Rotation",
      daysLogged: ["{n} Tag erfasst", "{n} Tage erfasst"],
    },
    comments: {
      title: "Kommentare", empty: "Noch keine Kommentare — schreib den ersten.",
      name: "Dein Name", namePh: "Damit klar ist, von wem das kommt",
      body: "Kommentar", bodyPh: "Schreib etwas zu diesen Uhren…",
      note: "Sichtbar für alle, die diesen Link haben.", submit: "Kommentar posten",
      failed: "Dein Kommentar konnte nicht gepostet werden. Bitte versuch es noch einmal.",
      now: "gerade eben", min: "vor {n} Min.", hour: "vor {n} Std.", day: "vor {n} T.",
      needName: "Bitte gib deinen Namen an", nameLong: "Der Name ist zu lang (maximal {n} Zeichen)",
      needBody: "Bitte schreib einen Kommentar", bodyLong: "Der Kommentar ist zu lang (maximal {n} Zeichen)",
      bad: "Ungültige Anfrage", gone: "Dieser Link ist nicht mehr verfügbar",
      tooMany: "Gerade zu viele Kommentare — bitte versuch es später noch einmal",
      saveFail: "Dein Kommentar konnte nicht gespeichert werden",
    },
  },
  pt: {
    someone: "Alguém",
    tagline: "O registo de coleções de relógios para entusiastas.",
    visit: "Visita o WRotate para descobrir coleções de relógios.",
    incomplete: "Esta ligação está incompleta. Visita o WRotate para descobrir coleções de relógios.",
    revoked: "O proprietário pode tê-la revogado, ou nunca existiu.",
    collPrivate: "Esta coleção é privada ou já não está disponível.",
    watches: ["{n} relógio", "{n} relógios"],
    wears: ["{n} uso", "{n} usos"],
    mostWornIs: "Mais usado: {w}",
    sharedFrom: "Partilhado a partir do WRotate",
    post: {
      none: "Nenhuma publicação indicada", notFound: "Publicação não encontrada",
      notFoundDesc: "Esta publicação é privada ou já não está disponível.",
      notFoundSub: "Esta publicação pode ser privada, ter sido eliminada ou já não estar disponível.",
      photoAlt: "Publicação de um relógio", appStoreAlt: "Descarregar na App Store",
      titleWatch: "{w} de {n} — WRotate", titlePost: "Publicação de {n} — WRotate",
      wore: "{n} usou o seu {w}", checkOut: "Vê esta publicação no WRotate",
      useCases: {
        casual: "Casual", formal: "Formal", sport: "Desporto", dive: "Mergulho", travel: "Viagem", work: "Trabalho",
        special: "Ocasião especial", outdoor: "Ar livre", dinner: "Jantar", unspecified: "",
      },
    },
    collection: {
      none: "Nenhum utilizador indicado", privateTitle: "Coleção privada — WRotate",
      notFound: "Coleção não encontrada", notFoundSub: "Esta coleção pode ser privada ou já não estar disponível.",
      empty: "Ainda não há relógios públicos", title: "Coleção de relógios de {n} — WRotate",
      totalWears: ["{n} uso no total", "{n} usos no total"],
    },
    wishlist: {
      none: "Nenhuma lista de desejos indicada", deadTitle: "Ligação de lista de desejos — WRotate",
      dead: "Esta ligação de lista de desejos já não está disponível", heading: "Lista de desejos de {n}",
      emptied: "Não resta nada nesta lista",
      emptiedSub: "Os relógios desta ligação já não estão na lista de desejos do proprietário.",
      cta: "Cria a tua própria lista de desejos",
    },
    watchesPage: {
      none: "Nenhum relógio indicado", deadTitle: "Ligação de coleção — WRotate",
      dead: "Esta ligação já não está disponível", heading: "Relógios de {n}",
      emptied: "Não resta nada nesta ligação",
      emptiedSub: "Os relógios desta ligação já não estão na coleção do proprietário.",
      cta: "Regista a tua própria coleção",
    },
    recap: {
      bad: "Nada para mostrar aqui", badSub: "Falta um colecionador ou um mês nesta ligação.",
      privateTitle: "Privado — WRotate", private: "Não disponível",
      title: "{n} · {m} — WRotate", noWears: "Sem usos nesse mês",
      noWearsSub: "{n} não registou nenhum uso em {m}.",
      eyebrow: "Resumo do mês", statWears: "Usos", statWatches: "Relógios", statDays: "Dias",
      mostWorn: "Mais usados", streak: "dias seguidos registados", cta: "Regista a tua própria rotação",
      daysLogged: ["{n} dia registado", "{n} dias registados"],
    },
    comments: {
      title: "Comentários", empty: "Ainda não há comentários — sê o primeiro.",
      name: "O teu nome", namePh: "Para saberem de quem é",
      body: "Comentário", bodyPh: "Diz algo sobre estes relógios…",
      note: "Visível para qualquer pessoa que tenha esta ligação.", submit: "Publicar comentário",
      failed: "Não foi possível publicar o teu comentário. Tenta novamente.",
      now: "agora mesmo", min: "há {n} min", hour: "há {n} h", day: "há {n} d",
      needName: "Adiciona o teu nome", nameLong: "O nome é demasiado longo (máximo de {n} caracteres)",
      needBody: "Escreve um comentário", bodyLong: "O comentário é demasiado longo (máximo de {n} caracteres)",
      bad: "Pedido inválido", gone: "Esta ligação já não está disponível",
      tooMany: "Demasiados comentários neste momento — tenta mais tarde",
      saveFail: "Não foi possível guardar o teu comentário",
    },
  },
};
