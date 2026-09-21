'use strict';

/**
 * @asseris-module       Rate Cards
 * @asseris-description  Resolves published token rates by date from an
 *                       append-only card history, so a cost figure can name
 *                       the card it was computed with.
 * @asseris-pillar       decision
 * @asseris-domain       analytics-pipeline
 * @asseris-stage        core
 */

/**
 * Token prices change, and they change on announced dates — the published
 * pricing page carries an introductory Sonnet 5 rate that expires. Costing a
 * July record with September rates would quietly rewrite history, so rates are
 * kept as a list of dated cards and looked up by the record's own timestamp.
 *
 * The committed file is the baseline. Cards appended at runtime live in the
 * product state directory and are only ever added, never edited, so an earlier
 * computation stays reproducible.
 */

var fs = require('node:fs');
var path = require('node:path');
var storagePaths = require('./storage-paths');

var BASELINE = require('./rate-cards.json');
var APPENDED_FILE = 'rate-cards.ndjson';

/** Path of the appended-card file. Named once so reader and seeder cannot drift. */
function appendedFile() {
  return path.join(storagePaths.stateDir(), APPENDED_FILE);
}

/**
 * Identity of the appended file as far as the memo is concerned: modification
 * time and size. The history is append-only, so a file that has neither grown
 * nor been rewritten cannot hold a card that was not already read.
 */
function appendedStamp() {
  try {
    var stat = fs.statSync(appendedFile());
    return stat.mtimeMs + ':' + stat.size;
  } catch (error) {
    if (error.code === 'ENOENT') return 'absent';
    throw error;
  }
}

/**
 * Resolution memo. A cost path asks once per record, and without the memo
 * every ask re-read the file from disk — tens of thousands of reads per parse
 * of a file that changes a few times a year. Keyed on the file stamp, so an
 * appended card still takes effect without a restart.
 */
var _memo = { stamp: null, cards: null, statAt: 0, cardAt: new Map(), rates: new Map() };

/**
 * How long a stamp is trusted before the file is asked again. A card appended
 * at runtime takes effect a second later.
 */
var STAT_TTL_MS = 1000;

/**
 * Read the appended file. An absent file means no cards were ever appended; a
 * file that cannot be read is a fault and is not disguised as an empty history,
 * because silently pricing with fewer cards than exist is worse than failing.
 */
function appendedText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return '';
    throw error;
  }
}

/** A malformed line is skipped; anything that is not a parse failure is raised. */
function parseCard(line) {
  try {
    return JSON.parse(line);
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

function appendedCards() {
  var file = appendedFile();
  var cards = [];
  for (var line of appendedText(file).split('\n')) {
    var trimmed = line.trim();
    if (!trimmed) continue;
    var card = parseCard(trimmed);
    if (card?.valid_from && card.models) cards.push(card);
  }
  return cards;
}

/** All cards, oldest first. Later cards with the same id replace earlier ones. */
function allCards() {
  var now = Date.now();
  if (_memo.cards && now - _memo.statAt < STAT_TTL_MS) return _memo.cards;
  var stamp = appendedStamp();
  if (_memo.stamp === stamp && _memo.cards) {
    _memo.statAt = now;
    return _memo.cards;
  }
  var byId = new Map();
  for (var card of BASELINE.cards.concat(appendedCards())) {
    byId.set(card.id || card.valid_from, card);
  }
  var sorted = Array.from(byId.values()).sort(function (left, right) {
    return String(left.valid_from).localeCompare(String(right.valid_from));
  });
  // A fresh stamp drops the derived maps too, or a stale price would outlive
  // the card that replaced it.
  _memo = { stamp: stamp, cards: sorted, statAt: now, cardAt: new Map(), rates: new Map() };
  return sorted;
}

function dayOf(value) {
  if (!value) return '';
  return String(value).slice(0, 10);
}

/** Rates of a card with its inherited base resolved. */
function resolvedModels(card, cards) {
  if (!card.inherits) return card.models || {};
  var base = cards.find(function (candidate) { return candidate.id === card.inherits; });
  var merged = base ? { ...resolvedModels(base, cards) } : {};
  for (var model of Object.keys(card.models || {})) {
    merged[model] = { ...merged[model], ...card.models[model] };
  }
  return merged;
}

/** The card in force on the given day, or null when the day predates every card. */
function cardAt(date) {
  var day = dayOf(date);
  var cards = allCards();
  if (_memo.cardAt.has(day)) return _memo.cardAt.get(day);
  var found = null;
  for (var card of cards) {
    if (!day || dayOf(card.valid_from) <= day) found = card;
  }
  var resolved = found ? { ...found, models: resolvedModels(found, cards) } : null;
  _memo.cardAt.set(day, resolved);
  return resolved;
}

/**
 * Normalise a served model name to a card key: dated ids lose their suffix
 * (claude-haiku-4-5-20251001), dotted names lose their dots (claude-opus-4.7).
 *
 * The date is stripped FIRST. A model without a minor version carries its date
 * where a minor version would sit, so the pattern below read
 * claude-opus-4-20250514 as major 4, minor 20250514 — a key no card matches,
 * which left Opus 4 and Sonnet 4 unpriceable under their served ids. The chart
 * strips the date the same way (modelsInUse in sections/cost-intelligence.js).
 */
function modelKey(model) {
  var name = String(model || '').toLowerCase().replaceAll('.', '-').replace(/-\d{8}$/, '');
  var match = /^(claude-[a-z]+-\d+(?:-\d+)?)/.exec(name);
  return match ? match[1] : name;
}

/** Rates for a model on a day, falling back from the requested tier to standard. */
function priceFor(model, tier, date) {
  var card = cardAt(date);
  if (!card) return null;
  var entry = card.models[modelKey(model)];
  if (!entry) return null;
  var rates = entry[tier || 'standard'] || entry.standard || null;
  if (!rates) return null;
  return {
    card_id: card.id,
    valid_from: card.valid_from,
    source_url: card.source_url,
    confidence: card.confidence || 'unknown',
    tier: entry[tier] ? tier : 'standard',
    rates: rates
  };
}

/**
 * The rate row a cost calculation uses for one record: the model as the card
 * names it, on the record's own day.
 *
 * Every rate is carried under both spellings — cache_write_5m / cache_write_1h
 * as the cards publish them, cache_creation / cache_creation_1h as the cost
 * path names them — from one resolved row, so the two can never disagree.
 * Frozen because it is memoised: a caller mutating a rate would corrupt every
 * later computation.
 *
 * @returns {{rates:object, card_id:string, valid_from:string, confidence:string}|null}
 *          null when no card covers the model on that day; the caller decides
 *          what an unpriceable record means.
 */
function ratesFor(model, date) {
  var day = dayOf(date);
  // cardAt() answers an empty date with the NEWEST card — right for the chart,
  // wrong for a cost figure: an undated record would be billed at today's
  // prices. An undated record is unpriceable.
  if (day.length !== 10) return null;
  var key = day + '|' + modelKey(model);
  allCards();
  if (_memo.rates.has(key)) return _memo.rates.get(key);

  var priced = priceFor(model, 'standard', day);
  var resolved = null;
  if (priced) {
    var r = priced.rates;
    resolved = Object.freeze({
      rates: Object.freeze({
        input: r.input,
        output: r.output,
        cache_read: r.cache_read,
        cache_write_5m: r.cache_write_5m,
        cache_write_1h: r.cache_write_1h,
        cache_creation: r.cache_write_5m,
        cache_creation_1h: r.cache_write_1h
      }),
      card_id: priced.card_id,
      valid_from: priced.valid_from,
      confidence: priced.confidence
    });
  }
  _memo.rates.set(key, resolved);
  return resolved;
}

/**
 * Per-model price series for charting: one point per card, so a step chart
 * shows exactly when a rate changed and which card changed it.
 */
function history() {
  var cards = allCards();
  var series = {};
  for (var card of cards) {
    var models = resolvedModels(card, cards);
    for (var model of Object.keys(models)) {
      var standard = models[model].standard;
      if (!standard) continue;
      if (!series[model]) series[model] = [];
      series[model].push({
        valid_from: dayOf(card.valid_from),
        card_id: card.id,
        source_url: card.source_url,
        confidence: card.confidence || 'unknown',
        input: standard.input,
        output: standard.output,
        cache_read: standard.cache_read,
        cache_write_5m: standard.cache_write_5m,
        fast: models[model].fast || null
      });
    }
  }
  return series;
}

/** Card boundaries for the chart's change bands. */
function changePoints() {
  return allCards().map(function (card) {
    return {
      valid_from: dayOf(card.valid_from),
      card_id: card.id,
      source: card.source,
      source_url: card.source_url,
      confidence: card.confidence || 'unknown',
      note: card.note || ''
    };
  });
}

/**
 * Write the committed cards into the product state once, as the starting
 * stock. They are dated, sourced and reproducible, so a fresh setup should
 * inherit them rather than start blank and lose the ability to price anything
 * that happened before today. Existing lines are never rewritten — the file
 * only grows, and a card already present keeps the form it was recorded in.
 */
/** Drop the memo. For tests, and for the seeder that just changed the file. */
function invalidate() {
  _memo = { stamp: null, cards: null, statAt: 0, cardAt: new Map(), rates: new Map() };
}

function seedStateHistory() {
  var file = appendedFile();
  var known = new Set();
  for (var line of appendedText(file).split('\n')) {
    var trimmed = line.trim();
    if (!trimmed) continue;
    var card = parseCard(trimmed);
    if (card?.id) known.add(card.id);
  }

  var pending = BASELINE.cards.filter(function (card) { return !known.has(card.id); });
  if (!pending.length) return 0;

  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(
    file,
    pending.map(function (card) { return JSON.stringify(card); }).join('\n') + '\n',
    'utf8'
  );
  invalidate();
  return pending.length;
}

module.exports = {
  seedStateHistory: seedStateHistory,
  allCards: allCards,
  cardAt: cardAt,
  modelKey: modelKey,
  priceFor: priceFor,
  ratesFor: ratesFor,
  invalidate: invalidate,
  history: history,
  changePoints: changePoints
};
