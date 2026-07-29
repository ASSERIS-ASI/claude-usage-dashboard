# Claude Usage Dashboard

[English](README.md) · [Deutsch](README.de.md) · [한국어](README.ko.md)

Lokales, nur lesendes Analyse-Dashboard für Claude-Code-Sessions,
Tokenverbrauch, Cache-Verhalten, Quota-Signale und geschätzte Kosten.

Das Dashboard liest vorhandene lokale Logs, verändert die Quelldaten nicht und
hält seine abgeleiteten Daten lokal.

## Start

```bash
git clone https://github.com/ASSERIS-ASI/claude-usage-dashboard.git
cd claude-usage-dashboard
npm ci
npm start
```

Danach <http://127.0.0.1:3333> öffnen. Das initiale Setup fragt Sprache,
Anthropic-Abo, additive Datenquellen und Logverzeichnisse ab. Claude JSONL ist
die Basis; Cache Fix und Code Meter lassen sich unabhängig oder gemeinsam als
zusätzliche Dienste aktivieren.

Voraussetzung ist Node.js 24 LTS. Alle Browser-Bibliotheken und
Schriften werden lokal aus gepinnten Paketabhängigkeiten bereitgestellt.

Unterstützt werden lokale Claude-JSONL-Dateien, kompatible Request-NDJSON sowie
optionale Read-only-Adapter für
[`claude-code-cache-fix`](https://github.com/cnighswonger/claude-code-cache-fix)
und [`claude-code-meter`](https://github.com/cnighswonger/claude-code-meter).

## Kombination mit `claude-code-cache-fix`

Im initialen Setup **Claude Cache Fix** als zusätzlichen Dienst aktivieren und
die lokale `usage.jsonl` sowie, falls vorhanden, das Cache-Fix-Debug-Log
angeben. Die Claude-Session-JSONL bleibt parallel aktiviert. **Claude Code
Meter** kann gleichzeitig aktiviert werden; übereinstimmende Requests werden
vor der Aggregation zusammengeführt und nicht doppelt gezählt.

- `usage.jsonl` ergänzt Tokenklassen pro Request, Modellverteilung,
  Cache-Read-Ratio, Zähler für ephemere Cache-Erstellung und vorhandene
  5h-/7d-Quota-Signale.
- Ein kompatibles Diagnose-Eventlog kann explizit protokollierte
  angewandte/übersprungene Fixes und Cache-TTL-Ereignisse ergänzen. Aus
  gewöhnlichen Cache-Fix-Servertraces werden solche Ereignisse nicht abgeleitet.
- Sessiongrenzen, Agents, Compactions und weitere Session-Analysen stammen
  weiterhin aus den Claude-Session-Logs.

Die Integration liest die Quellen nur. Request-Dauer und HTTP-Fehler gehören
nicht zu `usage.jsonl`; ohne eine separat unterstützte Quelle bleiben sie
unverfügbar und werden nicht geschätzt.

Die vollständige Dokumentation mit Docker-Aufruf, Datenquellen,
Umgebungsvariablen, Netzwerkzugriffen und Reset-Hinweisen steht in
[README.md](README.md).

## Versionen

Die eigenständige öffentliche ASSERIS-Linie beginnt mit **v1.9.0**. Die
veröffentlichten Versionen `v1.0.0–v1.8.3` bleiben als Vorgängerhistorie
dokumentiert; ihre alten Git-Tags werden nicht auf das bereinigte Repository
umgebogen. Siehe [CHANGELOG.md](CHANGELOG.md).

## Lizenz

Copyright © 2026 Asseris und Mitwirkende. Apache-2.0; siehe [LICENSE](LICENSE)
und [NOTICE](NOTICE).
