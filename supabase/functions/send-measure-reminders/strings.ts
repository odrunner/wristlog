// send-measure-reminders — the re-measure / drift push and the day-7 nudge in
// every app language. {w} watch, {r} rate ("+4.2 s/d"), {date} a short date,
// {mon} a month name, {d} a rate difference, {cmp} one of same/faster/slower.
// `watch` is the label when the watch has no brand or name. Phrased with a
// possessive so no article has to agree with an unknown watch name. English is
// the text these have always had: lib.test.ts pins it.
import type { Lang } from "../_shared/lang.ts";

export interface MeasureStrings {
  watch: string;
  first: string; drift: string; same: string; faster: string; slower: string;
  d7push: string; d7subject: string; d7body: string; d7button: string;
}

export const MEASURE_STRINGS: Record<Lang, MeasureStrings> = {
  en: {
    watch: "watch",
    first: "You measured your {w} at {r} on {date}. Re-measure to see if it's holding.",
    drift: "Your {w} is running {r} — {cmp}. Tap to re-measure.",
    same: "same as in {mon}", faster: "{d} s/d faster than in {mon}", slower: "{d} s/d slower than in {mon}",
    d7push: "Your {w} ran {r} last week. Measure again to see if it holds.",
    d7subject: "Did your {w} hold its rate?",
    d7body: "A week ago your <strong>{w}</strong> measured <strong>{r}</strong>. Measure it again in WRotate to see whether it's holding — two readings make a trend, one is just a number.",
    d7button: "Measure it again",
  },
  es: {
    watch: "reloj",
    first: "Mediste tu {w} a {r} el {date}. Vuelve a medirlo para ver si se mantiene.",
    drift: "Tu {w} marcha a {r}: {cmp}. Toca para volver a medirlo.",
    same: "igual que en {mon}", faster: "{d} s/d más rápido que en {mon}", slower: "{d} s/d más lento que en {mon}",
    d7push: "Tu {w} marchó a {r} la semana pasada. Mídelo de nuevo para ver si se mantiene.",
    d7subject: "¿Tu {w} mantuvo su marcha?",
    d7body: "Hace una semana tu <strong>{w}</strong> midió <strong>{r}</strong>. Mídelo de nuevo en WRotate para ver si se mantiene: dos lecturas marcan una tendencia, una sola es solo un número.",
    d7button: "Medir de nuevo",
  },
  it: {
    watch: "orologio",
    first: "Hai misurato il tuo {w} a {r} il {date}. Misuralo di nuovo per vedere se tiene.",
    drift: "Il tuo {w} marcia a {r}: {cmp}. Tocca per misurarlo di nuovo.",
    same: "come a {mon}", faster: "{d} s/d più veloce rispetto a {mon}", slower: "{d} s/d più lento rispetto a {mon}",
    d7push: "La settimana scorsa il tuo {w} marciava a {r}. Misuralo di nuovo per vedere se tiene.",
    d7subject: "Il tuo {w} ha mantenuto la marcia?",
    d7body: "Una settimana fa il tuo <strong>{w}</strong> misurava <strong>{r}</strong>. Misuralo di nuovo in WRotate per vedere se tiene: due letture fanno una tendenza, una sola è solo un numero.",
    d7button: "Misuralo di nuovo",
  },
  fr: {
    watch: "montre",
    first: "Vous avez mesuré votre {w} à {r} le {date}. Mesurez-la à nouveau pour voir si elle tient.",
    drift: "Votre {w} tourne à {r} : {cmp}. Touchez pour la mesurer à nouveau.",
    same: "comme en {mon}", faster: "{d} s/d plus rapide qu'en {mon}", slower: "{d} s/d plus lente qu'en {mon}",
    d7push: "Votre {w} tournait à {r} la semaine dernière. Mesurez-la à nouveau pour voir si elle tient.",
    d7subject: "Votre {w} a-t-elle tenu sa marche ?",
    d7body: "Il y a une semaine, votre <strong>{w}</strong> affichait <strong>{r}</strong>. Mesurez-la à nouveau dans WRotate pour voir si elle tient : deux mesures font une tendance, une seule n'est qu'un chiffre.",
    d7button: "Mesurer à nouveau",
  },
  tr: {
    watch: "saatin",
    first: "{date} tarihinde {w} için {r} ölçtün. Değişip değişmediğini görmek için yeniden ölç.",
    drift: "{w} şu an {r} gidiyor: {cmp}. Yeniden ölçmek için dokun.",
    same: "{mon} ayındakiyle aynı", faster: "{mon} ayına göre {d} s/d daha hızlı", slower: "{mon} ayına göre {d} s/d daha yavaş",
    d7push: "{w} geçen hafta {r} gidiyordu. Aynı mı diye görmek için yeniden ölç.",
    d7subject: "{w} aynı kaldı mı?",
    d7body: "Bir hafta önce <strong>{w}</strong> için <strong>{r}</strong> ölçtün. Aynı kalıp kalmadığını görmek için WRotate'te yeniden ölç: iki ölçüm bir eğilim gösterir, tek ölçüm yalnızca bir sayıdır.",
    d7button: "Yeniden ölç",
  },
  de: {
    watch: "Uhr",
    first: "Du hast deine {w} am {date} mit {r} gemessen. Miss sie noch einmal, um zu sehen, ob sie den Wert hält.",
    drift: "Deine {w} läuft mit {r}: {cmp}. Tippe, um neu zu messen.",
    same: "wie im {mon}", faster: "{d} s/d schneller als im {mon}", slower: "{d} s/d langsamer als im {mon}",
    d7push: "Deine {w} lief letzte Woche mit {r}. Miss noch einmal, um zu sehen, ob sie den Wert hält.",
    d7subject: "Hält deine {w} ihren Gang?",
    d7body: "Vor einer Woche hast du bei deiner <strong>{w}</strong> <strong>{r}</strong> gemessen. Miss sie in WRotate noch einmal, um zu sehen, ob sie den Wert hält: Zwei Messungen ergeben einen Trend, eine ist nur eine Zahl.",
    d7button: "Noch einmal messen",
  },
  pt: {
    watch: "relógio",
    first: "Mediste o teu {w} a {r} em {date}. Volta a medi-lo para ver se se mantém.",
    drift: "O teu {w} está a marcar {r}: {cmp}. Toca para voltar a medir.",
    same: "igual a {mon}", faster: "{d} s/d mais rápido do que em {mon}", slower: "{d} s/d mais lento do que em {mon}",
    d7push: "Na semana passada o teu {w} marcava {r}. Mede outra vez para ver se se mantém.",
    d7subject: "O teu {w} manteve a marcha?",
    d7body: "Há uma semana o teu <strong>{w}</strong> marcava <strong>{r}</strong>. Mede-o outra vez no WRotate para ver se se mantém: duas leituras fazem uma tendência, uma é só um número.",
    d7button: "Medir outra vez",
  },
};
