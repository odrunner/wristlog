// send-wear-reminders — the daily wear reminder in every app language.
// {w} is the last-worn watch ("Seiko SKX007"). Phrased with a possessive
// ("tu {w}", "votre {w}") so no article has to agree with an unknown name.
// English is the text the reminder has always had: lib.test.ts pins it.
import type { Lang } from "../_shared/lang.ts";

export interface WearStrings { pushWatch: string; push: string; subject: string; bodyWatch: string; body: string }

export const WEAR_STRINGS: Record<Lang, WearStrings> = {
  en: {
    pushWatch: "Wearing the {w} again today? Tap to log it — or pick another watch.",
    push: "What did you wear today? Log it before the day's out.",
    subject: "What's on your wrist today?",
    bodyWatch: "Wearing the {w} again today? Log it in WRotate before the day's out — or whatever's on your wrist. It keeps your wear history complete and your streak alive.",
    body: "Wearing something today? Log it in WRotate before the day's out — it keeps your collection's wear history complete and your streak alive.",
  },
  es: {
    pushWatch: "¿Llevas otra vez tu {w} hoy? Toca para registrarlo, o elige otro reloj.",
    push: "¿Qué reloj llevaste hoy? Regístralo antes de que acabe el día.",
    subject: "¿Qué llevas hoy en la muñeca?",
    bodyWatch: "¿Llevas otra vez tu {w} hoy? Regístralo en WRotate antes de que acabe el día, o lo que lleves en la muñeca. Así tu historial de usos queda completo y tu racha sigue viva.",
    body: "¿Llevas algún reloj hoy? Regístralo en WRotate antes de que acabe el día: así el historial de usos de tu colección queda completo y tu racha sigue viva.",
  },
  it: {
    pushWatch: "Indossi di nuovo il tuo {w} oggi? Tocca per registrarlo, o scegli un altro orologio.",
    push: "Che orologio hai indossato oggi? Registralo prima che finisca la giornata.",
    subject: "Cos'hai al polso oggi?",
    bodyWatch: "Indossi di nuovo il tuo {w} oggi? Registralo in WRotate prima che finisca la giornata, o registra quello che hai al polso. Così la cronologia degli utilizzi resta completa e la tua serie continua.",
    body: "Indossi un orologio oggi? Registralo in WRotate prima che finisca la giornata: così la cronologia degli utilizzi della tua collezione resta completa e la tua serie continua.",
  },
  fr: {
    pushWatch: "Vous portez à nouveau votre {w} aujourd'hui ? Touchez pour l'enregistrer, ou choisissez une autre montre.",
    push: "Quelle montre avez-vous portée aujourd'hui ? Enregistrez-la avant la fin de la journée.",
    subject: "Qu'avez-vous au poignet aujourd'hui ?",
    bodyWatch: "Vous portez à nouveau votre {w} aujourd'hui ? Enregistrez-la dans WRotate avant la fin de la journée, ou ce que vous avez au poignet. Votre historique reste complet et votre série continue.",
    body: "Vous portez une montre aujourd'hui ? Enregistrez-la dans WRotate avant la fin de la journée : l'historique de votre collection reste complet et votre série continue.",
  },
  tr: {
    pushWatch: "Bugün de {w} kolunda mı? Kaydetmek için dokun ya da başka bir saat seç.",
    push: "Bugün hangi saati taktın? Gün bitmeden kaydet.",
    subject: "Bugün kolunda ne var?",
    bodyWatch: "Bugün de {w} kolunda mı? Gün bitmeden WRotate'e kaydet, ya da kolunda ne varsa onu. Böylece kullanım geçmişin eksiksiz kalır ve serin devam eder.",
    body: "Bugün bir saat takıyor musun? Gün bitmeden WRotate'e kaydet: koleksiyonunun kullanım geçmişi eksiksiz kalır ve serin devam eder.",
  },
  de: {
    pushWatch: "Trägst du heute wieder deine {w}? Tippe, um sie zu erfassen, oder wähle eine andere Uhr.",
    push: "Welche Uhr hast du heute getragen? Erfasse sie, bevor der Tag vorbei ist.",
    subject: "Was trägst du heute am Handgelenk?",
    bodyWatch: "Trägst du heute wieder deine {w}? Erfasse sie in WRotate, bevor der Tag vorbei ist, oder was auch immer du am Handgelenk hast. So bleibt dein Trageverlauf vollständig und deine Serie läuft weiter.",
    body: "Trägst du heute eine Uhr? Erfasse sie in WRotate, bevor der Tag vorbei ist: So bleibt der Trageverlauf deiner Sammlung vollständig und deine Serie läuft weiter.",
  },
  pt: {
    pushWatch: "Hoje voltas a usar o teu {w}? Toca para registar, ou escolhe outro relógio.",
    push: "Que relógio usaste hoje? Regista-o antes de o dia acabar.",
    subject: "O que tens no pulso hoje?",
    bodyWatch: "Hoje voltas a usar o teu {w}? Regista-o no WRotate antes de o dia acabar, ou o que tiveres no pulso. Assim o teu histórico de usos fica completo e a tua sequência continua.",
    body: "Vais usar um relógio hoje? Regista-o no WRotate antes de o dia acabar: assim o histórico de usos da tua coleção fica completo e a tua sequência continua.",
  },
};
