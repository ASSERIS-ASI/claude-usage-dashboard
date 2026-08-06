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
  var file = path.join(storagePaths.stateDir(), APPENDED_FILE);
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
  var byId = new Map();
  for (var card of BASELINE.cards.concat(appendedCards())) {
    byId.set(card.id || card.valid_from, card);
  }
  return Array.from(byId.values()).sort(function (left, right) {
    return String(left.valid_from).localeCompare(String(right.valid_from));
  });
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
  var found = null;
  for (var card of cards) {
    if (!day || dayOf(card.valid_from) <= day) found = card;
  }
  if (!found) return null;
  return { ...found, models: resolvedModels(found, cards) };
}

/**
 * Normalise a served model name to a card key: dated ids lose their suffix
 * (claude-haiku-4-5-20251001), dotted names lose their dots (claude-opus-4.7).
 */
function modelKey(model) {
  var name = String(model || '').toLowerCase().replaceAll('.', '-');
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
function seedStateHistory() {
  var file = path.join(storagePaths.stateDir(), APPENDED_FILE);
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
  return pending.length;
}

module.exports = {
  seedStateHistory: seedStateHistory,
  allCards: allCards,
  cardAt: cardAt,
  modelKey: modelKey,
  priceFor: priceFor,
  history: history,
  changePoints: changePoints
};
