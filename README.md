# Menti – anonyme Fragerunde

Ein Link, über den alle per Handy **anonym Fragen stellen** können. Die Fragen stehen in der Mitte,
jede kann **geliked** werden. Ein optionaler **Erstellerzugang** (oben links) markiert Fragen als beantwortet oder löscht sie.
Alle sehen die offenen und die beantworteten Fragen (Umschalter oben). Gestaltet nach den Apple Human
Interface Guidelines (Systemschrift, Systemfarben, Hell/Dunkel, großer Titel, Action Sheets).

## Starten

Voraussetzung: Java 21 oder neuer (keine weiteren Bibliotheken).

```
start.cmd            (Windows, Doppelklick)
./start.sh           (macOS/Linux/Git Bash)
java src/Menti.java 9000   (anderer Port)
```

Die Konsole zeigt die Links und das Admin-Passwort:

- `http://localhost:8080` – auf diesem PC
- `http://192.168.x.x:8080` – für Handys im **selben WLAN** (beim ersten Start fragt die Windows-Firewall –
  „Private Netzwerke“ erlauben)
- `http://localhost:8080/admin` – öffnet direkt die Anmeldung (sonst oben links „Erstellerzugang“)

## Link fürs Internet (Handys ohne gleiches WLAN)

Am einfachsten ohne Konto über einen Cloudflare-Tunnel:

```
winget install Cloudflare.cloudflared
cloudflared tunnel --url http://localhost:8080
```

Die Ausgabe enthält einen Link wie `https://xyz.trycloudflare.com` – den verschicken (gilt, solange PC und
Tunnel laufen). Für einen dauerhaften Link kann Menti auf jedem Server mit Java laufen (Port über `PORT`).

## Erstellerzugang

- Passwort: Umgebungsvariable `MENTI_ADMIN_PASSWORD`, sonst `data/admin-passwort.txt`
  (wird beim ersten Start zufällig erzeugt).
- Im Ersteller-Modus: Kreis links tippen = beantwortet / wieder offen; Frage tippen = Menü mit „Löschen“.
- Anmeldung gilt 24 Stunden bzw. bis zum Neustart des Servers.

## Daten & Anonymität

- Fragen liegen in `data/fragen.json` (zum Zurücksetzen Server stoppen und Datei löschen).
- Gespeichert werden keine Namen und keine IP-Adressen. Jedes Gerät hat eine zufällige Kennung im Browser;
  der Server speichert nur deren Hashwert – damit jedes Gerät pro Frage nur einmal liken kann und die eigenen
  Fragen als „Deine Frage“ sieht.
- Schutz: höchstens 300 Zeichen, 5 s Pause zwischen zwei Fragen eines Geräts, doppelte offene Fragen werden
  abgelehnt („like sie einfach“).

## Technik

- `src/Menti.java` – HTTP-Server (JDK `HttpServer`, virtuelle Threads) + JSON-API, eine Datei.
- `public/` – `index.html`, `style.css`, `app.js` (ohne Framework). Aktualisierung alle 3 s; der Server
  antwortet mit 204, wenn sich nichts geändert hat.
