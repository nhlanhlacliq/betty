/**
 * Things in what he says that the phone acts on, wherever they come in the sentence (commands only count at the
 * start). Pure, so the phrasings from real rides are tested.
 */

/**
 * He asked for a search, in so many words, or Whisper's version of them (ride of 2026-10-17: "Do a whipserge on that
 * speed", "Did you look it up?"). Then the answer must search: that ride she said "I shall search now" seven times
 * without searching.
 */
const ASKED_SEARCH = /\b(search|web ?surge|whip ?s[eu]rge|wep ?search|look (it|that|this|them|those)? ?up|look up|google|internet|online|on the (web|net)|check (online|the web)|did you (check|look))/i;
/**
 * What is only right when it is current: prices, stock, reviews, events, news, scores, opening hours. Answering those
 * from memory is guessing (she would not confirm the CFMoto's price until told three times to search).
 */
const CURRENT = /\b(price[sd]?|pricing|cost(s|ing)?|how much (is|are|does|do|for)|availab(le|ility)|in stock|for sale|reviews?|rated|rating|events?|festivals?|what'?s on|happening (in|around|near|this|today|tonight)|concerts?|shows? (on|near|tonight|this)|news|score|results?|open (now|today|tonight|until)|opening hours|tickets?|recommend|which (bike|one|model)\b[^.?!]*\bshould|best (bike|place|spot|restaurant|coffee))\b/i;

export function wantsSearch(said: string): boolean {
  return ASKED_SEARCH.test(said) || CURRENT.test(said);
}

/** A reply that says she will look something up, or that she does not know, instead of answering. */
const PUT_OFF = /\b(i('ll| will| shall| can| could)|let me) (now )?(search|look|check|verify|find out)|\b(search|look (it|that|them) up) (now|for you)\b|\bif you (ask|like|want)\b.*\bsearch|\bi (do not|don't|cannot|can't|could not|couldn't) (know|say|confirm|tell|place|find|give|work out|calculate|answer|be sure)|\bnot (a name|something) i (can place|know)|\brather not guess\b|\bnot sure (what|which|who|where|when)\b|\bdon'?t know (the|that|this|it|enough)\b/i;

export function putsOff(reply: string): boolean { return PUT_OFF.test(reply); }

/** "I am on a detour", "we're taking the long way", "not going straight to ...": stop the off-route mentions. */
const DETOUR = /\b(detour|long way( round| around)?|scenic route|the other way|not going (straight|directly|direct)|not heading (straight|directly)|going somewhere else|off (the |my )?route on purpose|making a stop|quick stop first|change of plan)\b/i;
export const saysDetour = (said: string) => DETOUR.test(said);

/** "I was just filling up", "filled up", "got petrol", "topped up", "full tank": counts as FILLED UP. */
const FILLED = /\b((just )?(fill(ed|ing)?|topp(ed|ing)) (her |it |the (bike|tank) )?up|fill(ed|ing)? (the |my |her )?tank|full tank|tank('s| is) full|(got|getting|bought|put in|grabbed|filling up (on|with)?) (some )?(fuel|petrol|gas)|refuel(l?ed|l?ing)?|at the (petrol|fuel|gas) (station|pump))\b/i;
/** Not when he is asking or planning ("where can I fill up", "I need petrol", "should I fill up"). */
const NOT_YET = /\b(where|should|need|needs|must|have to|going to|gonna|want to|will|when|can i|nearest|next)\b[^.?!]*\b(fill|fuel|petrol|gas|tank|refuel)|\b(fill|fuel|petrol|tank)\b[^.?!]*\?/i;
export const saysFilledUp = (said: string) => FILLED.test(said) && !NOT_YET.test(said);

