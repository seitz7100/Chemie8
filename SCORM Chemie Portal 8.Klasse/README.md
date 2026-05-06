# SCORM-Paket: Chemie-Portal Klasse 8c

Komplettes Portal mit Klassenwahl, ABs und Übungen als SCORM 1.2 für mebis.

---

## In mebis hochladen

1. **Im Kurs**: Bearbeiten einschalten
2. **Aktivität hinzufügen** → **Lernpaket** auswählen
3. **Name** vergeben: z.B. „Chemie-Portal 8c"
4. **Bereich Paket**: ZIP-Datei reinziehen
5. **Aktivitätsabschluss**: „Aktivität abgeschlossen, wenn Status 'completed'"
6. **Speichern und anzeigen**

---

## Wie es für Schüler funktioniert

1. Schüler klickt in mebis auf das Lernpaket → **Portal-Startseite** öffnet sich
2. Wählt seine Klasse (8c) → kommt auf **Auswahlseite**: AB oder Übungen
3. Wählt eine Aktivität → arbeitet darin
4. **In jedem AB**: Klick auf „✓ AB abschließen" → markiert dieses AB als erledigt (lokal gespeichert) und schickt Schüler zurück zur Übersicht
5. **Auf der Portal-Startseite**: Sobald mind. 1 Aufgabe abgeschlossen ist, erscheint **„✓ Stunde abschließen"** → meldet `completed` an mebis → grüner Haken bei dir

---

## Wie du als Lehrer es siehst

Im Reiter **Berichte** der Aktivität:
- Liste aller Schüler mit Status (abgeschlossen / in Bearbeitung / nicht versucht)
- Zeitstempel der letzten Aktivität

Du siehst **nicht**, welche ABs konkret bearbeitet wurden – das wäre erst mit SCORM 2004 oder Backend-Tracking möglich. Der grüne Haken sagt nur „Schüler war drin und hat aktiv bestätigt".

---

## Inhalte erweitern

### Neues AB hinzufügen

1. Neue HTML-Datei in `8c/ab/` ablegen (z.B. `kern-huelle.html`)
2. In `8c/data.js` einen Eintrag im `arbeitsblaetter`-Array ergänzen:

```js
{
  "titel": "Kern-Hülle-Modell",
  "datei": "ab/kern-huelle.html",
  "lernbereich": "LB 4",
  "thema": "Atombau",
  "datum": "07.05.2026",
  "beschreibung": "...",
  "id": "ab_kern_huelle"
}
```

3. Im `imsmanifest.xml` die neue Datei in der `<resources>`-Liste ergänzen:
   `<file href="8c/ab/kern-huelle.html"/>`
4. ZIP neu packen, in mebis austauschen

### Neue Übung hinzufügen

Analog: Datei in `8c/uebungen/` ablegen, in `data.js` und `imsmanifest.xml` ergänzen.

### Neue Klasse hinzufügen (z.B. 9a)

1. `8c/`-Ordner als `9a/` kopieren, Inhalte anpassen
2. In Root-`index.html` die auskommentierte 9a-Karte einkommentieren
3. Im Manifest die 9a-Dateien ergänzen

---

## Struktur

```
SCORM-Paket.zip
├── imsmanifest.xml           ← SCORM-Manifest
├── index.html                 ← Portal-Startseite (Klassenwahl + Stunde-Abschluss-Button)
├── shared/
│   ├── scorm-adapter.js
│   └── jspdf.umd.min.js
└── 8c/
    ├── index.html             ← Auswahl AB / Übungen
    ├── data.js                ← Inhalts-Manifest (HIER NEUE INHALTE EINTRAGEN)
    ├── arbeitsblaetter.html   ← AB-Liste
    ├── uebungen.html          ← Übungen-Liste
    ├── ab/
    │   └── reibungselektrizitaet.html
    └── uebungen/
        └── stoechiometrietrainer.html  (Platzhalter)
```

---

## Wichtige Hinweise

**localStorage-Verhalten in mebis-Player:**
Skizzen und der „abgeschlossen"-Status der einzelnen ABs werden im Browser-localStorage gespeichert. Das funktioniert in mebis meistens, kann aber player-abhängig sein.

**Empfehlung für mebis-Einstellungen:**
- *Aussehen → Anzeigen*: „Aktuelles Fenster" (für iPad am besten)
- *Aktivitätsabschluss*: „Status 'completed' oder 'passed'"

**Pencil-Tests:**
Bevor du das in einer echten Stunde nutzt – mit deinem eigenen mebis-Account ausprobieren, ob der Apple Pencil im Player funktioniert. Falls nicht: auf „Neues Fenster" umstellen.

---

## DSGVO

- Alle Daten verbleiben auf dem Schüler-iPad (localStorage)
- mebis sieht nur den Bearbeitungsstatus, keine Inhalte
- Datenverarbeitung erfolgt durch mebis (Träger: Bayern) – kein zusätzlicher AVV nötig
