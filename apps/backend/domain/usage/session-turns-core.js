'use strict';
/**
 * @asseris-module       Session-Turns Core
 * @asseris-description  Pure two-pass JSONL → per-session turn aggregator — pass1 collects
 *                       sessions across day-window with day-boundary tolerance, pass2/finalize
 *                       builds the per-day session breakdown. Shared by Session Turns Service
 *                       + benchmark script.
 * @asseris-pillar       sensor
 * @asseris-domain       analytics-pipeline
 * @asseris-stage        core
 * @asseris-implements   —
 * @asseris-anchor       —
 * @asseris-calls        —
 * @asseris-called-by    Session Turns Service, benchmark-session-turns
 * @asseris-emits        per-session turn arrays + per-day finalized result
 * @asseris-consumes     JSONL line stream + dateKey window
 */

/**
 * Session-turns Pass1 + finalize (shared by dashboard-server + benchmark-session-turns.js).
 * forEachJsonlLineSync must be usage-scan-roots' implementation (streaming, UTF-8 safe).
 */
var crypto = require('node:crypto');

function pass1CollectSessionsForDayWindowFromFiles(dateKeys, files, forEachJsonlLineSync) {
  var allowedDays = Object.create(null);
  for (var dk of dateKeys) {
    var d = new Date(dk + 'T00:00:00Z');
    var prevDay = new Date(d.getTime() - 86400000).toISOString().slice(0, 10);
    var nextDay = new Date(d.getTime() + 86400000).toISOString().slice(0, 10);
    allowedDays[dk] = true;
    allowedDays[prevDay] = true;
    allowedDays[nextDay] = true;
  }
  var allSessions = Object.create(null);
  for (var file of files) {
    try {
      forEachJsonlLineSync(file.path, function (line) {
        if (!line) return;
        var rec;
        try {
          rec = JSON.parse(line);
        } catch (_e) {
          return;
        }
        if (rec.type !== 'assistant') return;
        if (rec.isSidechain) return;
        var ts = rec.timestamp;
        if (!ts || typeof ts !== 'string' || ts.length < 19) return;
        var turnDay = ts.slice(0, 10);
        if (!allowedDays[turnDay]) return;
        var msg = rec.message || {};
        var usage = msg.usage;
        if (!usage) return;
        var input = usage.input_tokens || 0;
        var output = usage.output_tokens || 0;
        var cacheRead = usage.cache_read_input_tokens || 0;
        var cacheCreation = usage.cache_creation_input_tokens || 0;
        if (input + output + cacheRead + cacheCreation === 0) return;
        var sid = rec.sessionId;
        if (!sid) return;
        if (!allSessions[sid]) allSessions[sid] = [];
        allSessions[sid].push({
          ts: ts,
          day: turnDay,
          input: input,
          output: output,
          cache_read: cacheRead,
          cache_creation: cacheCreation,
          model: (msg.model || 'unknown').replace(/-\d{8}$/, '')
        });
      });
    } catch (_e) {
      /* skip unreadable files */
    }
  }
  return allSessions;
}

function finalizeSessionTurnsForDate(dateKey, allSessions) {
  var sessions = Object.create(null);
  var totalParsed = 0;
  var sids = Object.keys(allSessions);
  for (var sid of sids) {
    var turns = allSessions[sid];
    var hasDateKey = false;
    for (var turn of turns) {
      if (turn.day === dateKey) {
        hasDateKey = true;
        break;
      }
    }
    if (!hasDateKey) continue;
    sessions[sid] = turns;
    totalParsed += turns.length;
  }

  var result = [];
  var resultSids = Object.keys(sessions);
  for (var sid2 of resultSids) {
    var turns2 = sessions[sid2];
    turns2.sort(function (a, b) {
      if (a.ts < b.ts) return -1;
      if (a.ts > b.ts) return 1;
      return 0;
    });

    var firstDay = turns2[0].day;
    var lastDay = turns2[turns2.length - 1].day;
    var edgeStart = firstDay < dateKey;
    var edgeEnd = lastDay > dateKey;

    var mapped = [];
    for (var ti2 = 0; ti2 < turns2.length; ti2++) {
      mapped.push({
        index: ti2,
        ts: turns2[ti2].ts,
        input: turns2[ti2].input,
        output: turns2[ti2].output,
        cache_read: turns2[ti2].cache_read,
        cache_creation: turns2[ti2].cache_creation,
        model: turns2[ti2].model
      });
    }
    var hash = crypto.createHash('sha256').update(String(sid2)).digest('hex').slice(0, 12);
    var entry = {
      session_id_hash: hash,
      turn_count: mapped.length,
      first_ts: turns2[0].ts,
      last_ts: turns2[turns2.length - 1].ts,
      total_output: turns2.reduce(function (s, t) {
        return s + t.output;
      }, 0),
      total_cache_read: turns2.reduce(function (s, t) {
        return s + t.cache_read;
      }, 0),
      total_all: turns2.reduce(function (s, t) {
        return s + t.input + t.output + t.cache_read + t.cache_creation;
      }, 0),
      turns: mapped
    };
    if (edgeStart) entry.edge_start = true;
    if (edgeEnd) entry.edge_end = true;
    result.push(entry);
  }
  result.sort(function (a, b) {
    return b.total_all - a.total_all;
  });
  return { date: dateKey, session_count: result.length, total_turns: totalParsed, sessions: result };
}

function buildSessionTurnsForDateWithCollected(dateKey, tagged, forEachJsonlLineSync) {
  var allSessions = pass1CollectSessionsForDayWindowFromFiles([dateKey], tagged, forEachJsonlLineSync);
  return finalizeSessionTurnsForDate(dateKey, allSessions);
}

/** One JSONL pass, finalize each date; does not touch _sessionTurnsCache. */
function populateSessionTurnsCacheForDatesBench(dateKeys, tagged, forEachJsonlLineSync) {
  var allSessions = pass1CollectSessionsForDayWindowFromFiles(dateKeys, tagged, forEachJsonlLineSync);
  var stByDate = {};
  for (var dk of dateKeys) {
    stByDate[dk] = finalizeSessionTurnsForDate(dk, allSessions);
  }
  return stByDate;
}

/**
 * Extract-Cache accelerated: collect sessions from pre-extracted mini-records
 * instead of re-parsing full JSONL files.
 *
 * @param {string[]} dateKeys - dates to collect
 * @param {object} extractCache - loaded extract cache (from extract-cache.js)
 * @returns {object} allSessions map (same format as pass1)
 */
function pass1FromExtractCache(dateKeys, extractCache) {
  var allowedDays = Object.create(null);
  for (var dk of dateKeys) {
    var d = new Date(dk + 'T00:00:00Z');
    var prevDay = new Date(d.getTime() - 86400000).toISOString().slice(0, 10);
    var nextDay = new Date(d.getTime() + 86400000).toISOString().slice(0, 10);
    allowedDays[dk] = true;
    allowedDays[prevDay] = true;
    allowedDays[nextDay] = true;
  }
  var allSessions = Object.create(null);
  var files = extractCache.files || {};
  for (var fp in files) {
    if (!Object.hasOwn(files, fp)) continue;
    var entry = files[fp];
    var records = entry.records || [];
    for (var r of records) {
      if (r.tp !== 'assistant') continue;
      var ts = r.ts;
      if (!ts || ts.length < 19) continue;
      var turnDay = ts.slice(0, 10);
      if (!allowedDays[turnDay]) continue;
      var inp = r.inp || 0;
      var out = r.out || 0;
      var cr = r.cr || 0;
      var cc = r.cc || 0;
      if (inp + out + cr + cc === 0) continue;
      var sid = r.sid;
      if (!sid) continue;
      if (!allSessions[sid]) allSessions[sid] = [];
      allSessions[sid].push({
        ts: ts,
        day: turnDay,
        input: inp,
        output: out,
        cache_read: cr,
        cache_creation: cc,
        model: r.mod || 'unknown'
      });
    }
  }
  return allSessions;
}

/**
 * Build session turns from extract cache (fast path).
 */
function buildSessionTurnsFromCache(dateKey, extractCache) {
  var allSessions = pass1FromExtractCache([dateKey], extractCache);
  return finalizeSessionTurnsForDate(dateKey, allSessions);
}

module.exports = {
  pass1CollectSessionsForDayWindowFromFiles: pass1CollectSessionsForDayWindowFromFiles,
  pass1FromExtractCache: pass1FromExtractCache,
  finalizeSessionTurnsForDate: finalizeSessionTurnsForDate,
  buildSessionTurnsForDateWithCollected: buildSessionTurnsForDateWithCollected,
  buildSessionTurnsFromCache: buildSessionTurnsFromCache,
  populateSessionTurnsCacheForDatesBench: populateSessionTurnsCacheForDatesBench
};
