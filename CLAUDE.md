# Menti – anonyme Fragerunde

Web-App: Handy-Link zum anonymen Fragenstellen, Likes, Erstellerzugang oben links (beantwortet markieren, löschen).
Nutzer spricht Deutsch; UI-Texte und Kommentare deutsch. Design nach Apple HIG (iOS) – siehe `public/style.css`.

- Live: https://jahhhhhn.github.io/menti/ – GitHub Pages veröffentlicht `public/` bei Push auf `main` (Actions).
- Kein eigener Server: Firebase Realtime Database + Auth (Projekt `menti-dfdb1`, europe-west1), Konfiguration in
  `public/firebase-config.js`. Firebase-SDK 13.1.0 liegt in `public/vendor/` (Importe auf `./firebase-app.js` umgeschrieben).
- `database.rules.json` ist die Quelle der Sicherheitsregeln; der Nutzer fügt sie von Hand in der Konsole ein
  (kein Firebase-CLI). Bei Änderungen daran erinnern.
- Besucher: anonyme Firebase-Anmeldung. Ersteller: Google-Anmeldung, freigeschaltet über `ersteller/{uid}` (nur Konsole).
- CSP als `<meta>` in `index.html` (`script-src 'self'` + Google/Firebase, `style-src 'self'`) → keine Inline-Skripte/
  `style`-Attribute, nur `el.style.x = …` aus JS.
- Anonymität: keine Namen/IPs speichern; öffentliche Daten (`fragen`) ohne Bezug zum Absender.
- Alte Java-Server-Version: Git-Tag `java-version`.
