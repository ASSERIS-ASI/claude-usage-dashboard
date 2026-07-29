# Claude Usage Dashboard

Lokales, nur lesendes Analyse-Dashboard für Claude-Code-Sessions,
Tokenverbrauch, Cache-Verhalten, Quota-Signale und geschätzte Kosten.

Das Dashboard liest vorhandene lokale Logs. Es ist **kein Proxy**, verändert
keine Requests, installiert keine Zertifikate und lädt keine Session-Logs hoch.

## Start

```bash
git clone https://github.com/ASSERIS-ASI/claude-usage-dashboard.git
cd claude-usage-dashboard
npm ci
npm start
```

Danach <http://127.0.0.1:3333> öffnen. Das initiale Setup fragt Sprache,
Anthropic-Abo, Datenmodus und Logverzeichnisse ab.

Unterstützt werden lokale Claude-JSONL-Dateien, kompatible Request-NDJSON sowie
optionale Read-only-Adapter für
[`claude-code-cache-fix`](https://github.com/cnighswonger/claude-code-cache-fix)
und [`claude-code-meter`](https://github.com/cnighswonger/claude-code-meter).

Die vollständige Dokumentation steht in [README.md](README.md).

## Versionen

Die eigenständige öffentliche ASSERIS-Linie beginnt mit **v1.9.0**. Die
veröffentlichten Versionen `v1.0.0–v1.8.3` bleiben als Vorgängerhistorie
dokumentiert; ihre alten Git-Tags werden nicht auf das bereinigte Repository
umgebogen. Siehe [CHANGELOG.md](CHANGELOG.md).

## Lizenz

Copyright © 2026 Asseris und Mitwirkende. Apache-2.0; siehe [LICENSE](LICENSE)
und [NOTICE](NOTICE).
