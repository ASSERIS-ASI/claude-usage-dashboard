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

Voraussetzung ist Node.js 24 LTS. Alle Browser-Bibliotheken werden lokal aus
gepinnten Paketabhängigkeiten bereitgestellt; die Schriften Gelasio, Carlito
und Cascadia Code liegen unter der SIL Open Font License 1.1 im Quellbaum. Kein
Asset wird von einem CDN geladen.

Der Erststart legt zusätzlich das Layout an: Jede Rubrik startet mit ihrem
eigenen Default-Template als bearbeitbare Kopie. Ein vorhandenes Layout wird
nicht überschrieben.

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
unverfügbar und werden nicht geschätzt. Im Proxy-Modus kann die
request-log-Erweiterung ein Timing-Log schreiben; dessen Pfad wird über
`CACHE_FIX_REQUEST_LOG` angegeben und liefert die Latenz-Charts.

## Charts und Datenquellen

Jede Datenquelle deklariert, was sie trägt, und jedes Chart, was es braucht.
Charts, deren Voraussetzung keine aktivierte Quelle liefert, werden
ausgeblendet statt leer gezeichnet — eine leere Achse liest sich als „nichts
passiert“ und wäre damit eine andere und falsche Aussage. Das Ausblenden wird
nicht automatisch rückgängig gemacht: Wird die Quelle später ergänzt, bleibt
das Chart ausgeblendet, bis es im Layout-Builder wieder aktiviert wird.

## Preishistorie

Tokenpreise ändern sich zu angekündigten Terminen und werden deshalb als Liste
datierter Karten geführt, nicht als eine aktuelle Tabelle. Ein Datensatz wird
mit der Karte berechnet, die zu seinem eigenen Zeitpunkt galt — eine Juli-Zahl
bleibt eine Juli-Zahl und wird nicht still zu heutigen Preisen neu gerechnet.
Die mitgelieferten Karten werden beim Erststart nach `rate-cards.ndjson` ins
Statusverzeichnis übernommen; die Datei wächst nur, Karten werden nie
nachträglich geändert. **Cost Forensic** zeigt die Historie je Modell.

Die vollständige Dokumentation mit Docker-Aufruf, Datenquellen,
Umgebungsvariablen, Netzwerkzugriffen und Reset-Hinweisen steht in
[README.md](README.md).

## Versionen

Die eigenständige öffentliche ASSERIS-Linie beginnt mit **v1.9.0**. Die
veröffentlichten Versionen `v1.0.0–v1.8.3` bleiben als Vorgängerhistorie
dokumentiert; ihre alten Git-Tags werden nicht auf das bereinigte Repository
umgebogen. Siehe [CHANGELOG.md](CHANGELOG.md).

## Lizenz

Copyright © 2026 ASSERIS AISBL und Mitwirkende. Apache-2.0; siehe
[LICENSE](LICENSE) und [NOTICE](NOTICE).

`ASSERIS`, die ASSERIS-Wortmarke und die Logos sind eingetragene Marken der
ASSERIS AISBL. Apache-2.0 erteilt keine Markenlizenz; siehe
[TRADEMARKS.md](TRADEMARKS.md).
