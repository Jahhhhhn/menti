# Menti – anonyme Fragerunde

Ein Link, über den alle per Handy **anonym Fragen stellen** können. Die Fragen stehen in der Mitte,
jede kann **geliked** werden. Über den **Erstellerzugang** (oben links) markieren freigeschaltete Ersteller
Fragen als beantwortet oder löschen sie. Alle sehen die offenen und die beantworteten Fragen (Umschalter oben).
Gestaltet nach den Apple Human Interface Guidelines (Systemschrift, Systemfarben, Hell/Dunkel, Action Sheets).

**Adresse:** https://jahhhhhn.github.io/menti/

## Aufbau

- `public/` – die Website (ohne Framework). GitHub Pages veröffentlicht diesen Ordner bei jedem Push auf
  `main` automatisch (`.github/workflows/pages.yml`).
- Daten liegen in der **Firebase Realtime Database** (Projekt `menti-dfdb1`, Region Belgien). Änderungen
  erscheinen live bei allen.
- `database.rules.json` – die Sicherheitsregeln. **Nach jeder Änderung** in der Firebase-Konsole unter
  Realtime Database → Regeln einfügen und veröffentlichen.
- `public/vendor/` – Firebase-Bibliothek 13.1.0 (lokal mitgeliefert wegen der strengen CSP).
- Die frühere Version mit eigenem Java-Server liegt im Git-Tag `java-version`.

## Erstellerzugang

- Oben links „Erstellerzugang“ → Anmeldung mit Google.
- Noch nicht freigeschaltete Konten schicken damit automatisch eine **Anfrage** (Name + E-Mail) und werden
  gleich wieder abgemeldet.
- Ersteller sehen oben rechts das **Postfach** (rote Zahl = offene Anfragen):
  - Reiter **Anfragen**: **Annehmen**, **Ablehnen** oder **Sperren** – ohne Rückfrage.
    Akzeptierte Konten stehen unter `ersteller/{kennung}`.
  - Reiter **Gesperrt**: gesperrte Konten (`gesperrt/{kennung}`) mit **Entsperren**. Gesperrte Konten können
    keine Anfragen stellen.
- Entziehen: Firebase-Konsole → Realtime Database → Daten → `ersteller` → Eintrag löschen.
- Im Ersteller-Modus: Kreis links tippen = beantwortet / wieder offen; „Löschen“ bei jeder Frage (sofort, ohne Rückfrage).
- Besucher können ihre **eigenen Fragen** löschen („Löschen“ neben „Deine Frage“).
- Von Erstellern gelöschte Fragen landen im Reiter **Gelöscht** (`papierkorb/`, nur für Ersteller sichtbar) und
  lassen sich dort **wiederherstellen** oder **endgültig löschen**. Selbst gelöschte Fragen sind sofort weg.

## Daten & Anonymität

- `fragen/{id}`: Text, Zeit, Status, Anzahl Likes – öffentlich lesbar, **ohne** Hinweis auf den Absender.
- Besucher werden unsichtbar **anonym** bei Firebase angemeldet (zufällige Kennung, keine Namen).
  `likes/{kennung}` (wer was geliked hat) und `zuletzt/{kennung}` (Zeit der letzten Frage) kann nur das
  jeweilige Gerät selbst lesen.
- „Deine Frage“ merkt sich nur der eigene Browser. Damit nur der Fragende selbst löschen kann, steht unter
  `autoren/{frage}` die anonyme Kennung – das ist für niemanden lesbar (nur in der Firebase-Konsole sichtbar).
- Die Regeln sorgen dafür: höchstens eine Frage alle 5 s pro Gerät, ein Like pro Gerät und Frage, Fragen
  lassen sich nachträglich nicht ändern; beantworten und löschen dürfen nur Ersteller.
- `anfragen/` und `gesperrt/` (E-Mail-Adressen) können nur Ersteller lesen.
- Doppelte offene Fragen und die 300-Zeichen-Grenze prüft die Website.

## Lokal testen

```
cd public
python -m http.server 8080
```

Dann http://localhost:8080 öffnen (`localhost` ist in Firebase als Domain erlaubt). Es wird die echte
Datenbank benutzt.

## Grenzen (Firebase-Gratistarif „Spark“)

- höchstens 100 gleichzeitige Verbindungen, 1 GB gespeichert, 10 GB Download pro Monat – für eine
  Fragerunde mehr als genug. Der Gratistarif kann keine Kosten verursachen.
