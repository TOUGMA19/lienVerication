import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

export const Route = createFileRoute("/")({
  component: Index,
});

const STORAGE_KEY = "sheet_csv_data";
const STORAGE_NAME_KEY = "sheet_csv_name";

type Row = Record<string, string>;

function parseCSV(text: string): Row[] {
  const lines: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let inQuotes = false;
  // auto-detect separator: comma or semicolon
  const firstLine = text.split(/\r?\n/)[0] ?? "";
  const sep =
    (firstLine.match(/;/g)?.length ?? 0) >
    (firstLine.match(/,/g)?.length ?? 0)
      ? ";"
      : ",";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else {
      if (c === '"') inQuotes = true;
      else if (c === sep) {
        cur.push(field);
        field = "";
      } else if (c === "\n" || c === "\r") {
        if (field !== "" || cur.length) {
          cur.push(field);
          lines.push(cur);
          cur = [];
          field = "";
        }
        if (c === "\r" && text[i + 1] === "\n") i++;
      } else {
        field += c;
      }
    }
  }
  if (field !== "" || cur.length) {
    cur.push(field);
    lines.push(cur);
  }
  if (!lines.length) return [];
  // strip UTF-8 BOM from first header if present
  const headers = lines[0].map((h, i) =>
    (i === 0 ? h.replace(/^\uFEFF/, "") : h).trim(),
  );
  return lines.slice(1).map((row) => {
    const obj: Row = {};
    headers.forEach((h, i) => {
      obj[h] = (row[i] ?? "").trim();
    });
    return obj;
  });
}

function getId(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("id");
}

// --- Encodage compact (base64url) d'une ligne pour la mettre dans l'URL ---
function toBase64Url(s: string): string {
  const b64 =
    typeof window === "undefined"
      ? Buffer.from(s, "utf-8").toString("base64")
      : btoa(unescape(encodeURIComponent(s)));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromBase64Url(s: string): string {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
  if (typeof window === "undefined") return Buffer.from(b64, "base64").toString("utf-8");
  return decodeURIComponent(escape(atob(b64)));
}
function encodeRowToParam(row: Row): string {
  return toBase64Url(JSON.stringify(row));
}
function decodeRowFromParam(p: string): Row | null {
  try {
    const obj = JSON.parse(fromBase64Url(p));
    if (obj && typeof obj === "object") return obj as Row;
    return null;
  } catch {
    return null;
  }
}
function getDataParam(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("data");
}

function Index() {
  const [csvText, setCsvText] = useState<string>("");
  const [fileName, setFileName] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [id, setId] = useState<string | null>(null);
  const [urlId, setUrlId] = useState<string | null>(null);
  const [idInput, setIdInput] = useState<string>("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sharedRow, setSharedRow] = useState<Row | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const [correctionsCopied, setCorrectionsCopied] = useState(false);

  useEffect(() => {
    const initial = getId();
    setUrlId(initial);
    setId(initial);
    setIdInput(initial ?? "");
    // Mode "lien de vérification" : la ligne est encodée dans l'URL
    const dataParam = getDataParam();
    if (dataParam) {
      const decoded = decodeRowFromParam(dataParam);
      if (decoded) setSharedRow(decoded);
    }
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      const storedName = localStorage.getItem(STORAGE_NAME_KEY);
      if (stored) {
        setCsvText(stored);
        setFileName(storedName || "fichier.csv");
      }
    } catch {
      // localStorage indisponible (mode privé, quota…)
    }
  }, []);

  const rows = useMemo(() => {
    if (!csvText) return [];
    try {
      return parseCSV(csvText);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Erreur de parsing");
      return [];
    }
  }, [csvText]);

  const headers = useMemo(
    () => (rows.length ? Object.keys(rows[0]) : []),
    [rows],
  );

  const row = useMemo(() => {
    if (!id || !rows.length) return null;
    return (
      rows.find(
        (r) => (r.ID ?? r.id ?? "").toString().trim() === id.trim(),
      ) ?? null
    );
  }, [rows, id]);

  const notFound = Boolean(csvText && id && !row);

  const handleFile = async (file: File) => {
    setError(null);
    setLoadError(null);
    if (file.size > 4 * 1024 * 1024) {
      setError("Fichier trop volumineux (max 4 Mo).");
      return;
    }
    try {
      const text = await file.text();
      setCsvText(text);
      setFileName(file.name);
      try {
        localStorage.setItem(STORAGE_KEY, text);
        localStorage.setItem(STORAGE_NAME_KEY, file.name);
      } catch {
        setError(
          "Le fichier est chargé mais n'a pas pu être sauvegardé localement (trop volumineux).",
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lecture impossible");
    }
  };

  const clearFile = () => {
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(STORAGE_NAME_KEY);
    } catch {
      // ignore
    }
    setCsvText("");
    setFileName("");
    setError(null);
    setLoadError(null);
  };

  const [editValues, setEditValues] = useState<Row>({});
  const [saved, setSaved] = useState(false);

  // when the matched row changes, reset the edit form
  useEffect(() => {
    if (row) {
      setEditValues({ ...row });
      setSaved(false);
    } else {
      setEditValues({});
    }
  }, [row]);

  const isDirty = useMemo(() => {
    if (!row) return false;
    return headers.some((h) => (editValues[h] ?? "") !== (row[h] ?? ""));
  }, [editValues, row, headers]);

  // CSV serialization
  const serializeCSV = (rs: Row[], hs: string[]): string => {
    const escape = (v: string) => {
      const s = v ?? "";
      if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    const head = hs.join(",");
    const body = rs.map((r) => hs.map((h) => escape(r[h] ?? "")).join(",")).join("\n");
    return head + "\n" + body;
  };

  const handleSave = () => {
    if (!row) return;
    const idKey = "ID" in row ? "ID" : "id" in row ? "id" : null;
    if (!idKey) return;
    const updated = rows.map((r) =>
      (r.ID ?? r.id ?? "").toString().trim() === id?.trim()
        ? { ...r, ...editValues }
        : r,
    );
    const newCsv = serializeCSV(updated, headers);
    setCsvText(newCsv);
    try {
      localStorage.setItem(STORAGE_KEY, newCsv);
    } catch {
      // ignore
    }
    setSaved(true);
  };

  // ---------- Suggestions de correction ----------
  type Suggestion = {
    label: string; // description courte de la correction
    value: string; // valeur proposée
    severity: "info" | "warn" | "error";
  };

  // Normalisation pour comparaison floue (insensible casse/accents/espaces)
  const simplify = (s: string) =>
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ")
      .trim();

  const detectKind = (
    header: string,
  ): "email" | "date" | "phone" | "number" | "category" | "text" => {
    const h = header.toLowerCase();
    if (/mail/.test(h)) return "email";
    if (/(naissance|birth|^date|_date|created|updated)/.test(h)) return "date";
    if (/(tel|phone|mobile|portable)/.test(h)) return "phone";
    if (/(durée|duree|duration|nombre|count|age|prix|price|montant)/.test(h))
      return "number";
    if (/(statut|status|type|thématique|thematique|categor|état|etat)/.test(h))
      return "category";
    return "text";
  };

  // Valeur canonique la plus fréquente pour une colonne catégorielle
  const canonicalForColumn = (header: string, value: string): string | null => {
    const target = simplify(value);
    if (!target) return null;
    const counts = new Map<string, number>();
    for (const r of rows) {
      const v = (r[header] ?? "").trim();
      if (!v) continue;
      if (simplify(v) === target) {
        counts.set(v, (counts.get(v) ?? 0) + 1);
      }
    }
    let best: string | null = null;
    let bestN = 0;
    counts.forEach((n, v) => {
      if (n > bestN) {
        bestN = n;
        best = v;
      }
    });
    return best;
  };

  // Normalise une date variée vers YYYY-MM-DD si possible
  const normalizeDate = (v: string): string | null => {
    const s = v.trim();
    if (!s) return null;
    // déjà ISO
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    // DD/MM/YYYY ou DD-MM-YYYY ou DD.MM.YYYY
    const m1 = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
    if (m1) {
      const d = m1[1].padStart(2, "0");
      const mo = m1[2].padStart(2, "0");
      let y = m1[3];
      if (y.length === 2) y = (parseInt(y, 10) > 30 ? "19" : "20") + y;
      const dn = parseInt(d, 10);
      const mn = parseInt(mo, 10);
      if (mn >= 1 && mn <= 12 && dn >= 1 && dn <= 31) return `${y}-${mo}-${d}`;
    }
    // YYYY/MM/DD
    const m2 = s.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/);
    if (m2) {
      return `${m2[1]}-${m2[2].padStart(2, "0")}-${m2[3].padStart(2, "0")}`;
    }
    return null;
  };

  const isValidEmail = (v: string) =>
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());

  const levenshtein = (a: string, b: string): number => {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    const v0 = new Array(b.length + 1).fill(0);
    const v1 = new Array(b.length + 1).fill(0);
    for (let i = 0; i <= b.length; i++) v0[i] = i;
    for (let i = 0; i < a.length; i++) {
      v1[0] = i + 1;
      for (let j = 0; j < b.length; j++) {
        const cost = a[i] === b[j] ? 0 : 1;
        v1[j + 1] = Math.min(v1[j] + 1, v0[j + 1] + 1, v0[j] + cost);
      }
      for (let j = 0; j <= b.length; j++) v0[j] = v1[j];
    }
    return v1[b.length];
  };

  const suggestionsFor = (header: string, value: string): Suggestion[] => {
    const out: Suggestion[] = [];
    const v = value ?? "";
    const trimmed = v.trim().replace(/\s+/g, " ");

    // 1) espaces parasites
    if (v && v !== trimmed) {
      out.push({
        label: "Supprimer les espaces superflus",
        value: trimmed,
        severity: "info",
      });
    }

    const kind = detectKind(header);

    // 2) email
    if (kind === "email" && trimmed) {
      if (!isValidEmail(trimmed)) {
        let fixed = trimmed.toLowerCase();
        // fautes courantes de domaine
        fixed = fixed
          .replace(/@gmial\.|@gmal\.|@gmai\./, "@gmail.")
          .replace(/@hotmial\.|@hotmal\./, "@hotmail.")
          .replace(/@yaho\./, "@yahoo.")
          .replace(/\.con$/, ".com")
          .replace(/\.cm$/, ".com")
          .replace(/\.fr\.$/, ".fr");
        if (isValidEmail(fixed) && fixed !== trimmed) {
          out.push({
            label: "Corriger l'email (faute probable)",
            value: fixed,
            severity: "error",
          });
        } else {
          out.push({
            label: "Format d'email invalide",
            value: trimmed.toLowerCase(),
            severity: "error",
          });
        }
      } else if (trimmed !== trimmed.toLowerCase()) {
        out.push({
          label: "Mettre l'email en minuscules",
          value: trimmed.toLowerCase(),
          severity: "info",
        });
      }
    }

    // 3) date
    if (kind === "date" && trimmed) {
      const iso = normalizeDate(trimmed);
      if (iso && iso !== trimmed) {
        out.push({
          label: "Normaliser au format AAAA-MM-JJ",
          value: iso,
          severity: "warn",
        });
      } else if (!iso) {
        out.push({
          label: "Format de date non reconnu",
          value: trimmed,
          severity: "error",
        });
      }
    }

    // 4) téléphone — normalisation simple FR
    if (kind === "phone" && trimmed) {
      const digits = trimmed.replace(/[^\d+]/g, "");
      if (digits !== trimmed && digits.length >= 8) {
        out.push({
          label: "Garder uniquement les chiffres",
          value: digits,
          severity: "info",
        });
      }
    }

    // 4-bis) nombre — extrait la partie numérique si une unité est collée
    if (kind === "number" && trimmed) {
      const m = trimmed.match(/^-?\d+([.,]\d+)?/);
      if (!m) {
        out.push({
          label: "Valeur numérique attendue",
          value: trimmed,
          severity: "error",
        });
      } else if (m[0] !== trimmed) {
        out.push({
          label: "Garder uniquement la valeur numérique",
          value: m[0].replace(",", "."),
          severity: "warn",
        });
      } else if (trimmed.includes(",")) {
        out.push({
          label: "Utiliser le point comme séparateur décimal",
          value: trimmed.replace(",", "."),
          severity: "info",
        });
      }
    }

    // 4-ter) catégorie — proposer la valeur canonique la plus fréquente
    if (kind === "category" && trimmed) {
      const canonical = canonicalForColumn(header, trimmed);
      if (canonical && canonical !== trimmed) {
        out.push({
          label: `Aligner sur la valeur la plus fréquente : "${canonical}"`,
          value: canonical,
          severity: "warn",
        });
      }
    }

    // 5) doublon probable dans la même colonne (autre ligne avec valeur très proche)
    if (trimmed && kind !== "date" && kind !== "category" && kind !== "number") {
      const me = simplify(trimmed);
      const currentId = (row?.ID ?? row?.id ?? "").toString().trim();
      const matches = rows.filter((r) => {
        const rid = (r.ID ?? r.id ?? "").toString().trim();
        if (rid === currentId) return false;
        const other = simplify(r[header] ?? "");
        if (!other) return false;
        if (other === me) return true;
        if (Math.abs(other.length - me.length) <= 2) {
          return levenshtein(other, me) <= 2 && me.length >= 4;
        }
        return false;
      });
      if (matches.length > 0) {
        const sample = matches.slice(0, 2).map((r) => {
          const rid = (r.ID ?? r.id ?? "").toString().trim();
          return `${rid || "?"} → "${r[header]}"`;
        });
        out.push({
          label: `Doublon probable (${matches.length}) : ${sample.join(", ")}`,
          value: trimmed,
          severity: "warn",
        });
      }
    }

    return out;
  };

  const fieldSuggestions = useMemo(() => {
    const map: Record<string, Suggestion[]> = {};
    if (!row) return map;
    headers.forEach((h) => {
      map[h] = suggestionsFor(h, editValues[h] ?? "");
    });
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editValues, row, headers, rows]);

  const totalIssues = useMemo(
    () => Object.values(fieldSuggestions).reduce((n, l) => n + l.length, 0),
    [fieldSuggestions],
  );

  const applyAllSuggestions = () => {
    setEditValues((prev) => {
      const next = { ...prev };
      headers.forEach((h) => {
        const sug = fieldSuggestions[h];
        if (sug && sug.length) {
          // applique la première suggestion non "doublon" (qui ne change pas la valeur)
          const actionable = sug.find((s) => s.value !== (next[h] ?? ""));
          if (actionable) next[h] = actionable.value;
        }
      });
      return next;
    });
  };

  const handleDownload = () => {
    const blob = new Blob([csvText], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName || "donnees.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const buildShareLink = (r: Row): string => {
    const param = encodeRowToParam(r);
    const base =
      typeof window !== "undefined"
        ? `${window.location.origin}${window.location.pathname}`
        : "";
    return `${base}?data=${param}`;
  };

  const handleCopyShareLink = async () => {
    if (!row) return;
    const link = buildShareLink(row);
    try {
      await navigator.clipboard.writeText(link);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      window.prompt("Copiez ce lien :", link);
    }
  };

  // --- Mode destinataire : la personne ouvre un lien et corrige sa ligne ---
  const [sharedEdit, setSharedEdit] = useState<Row>({});
  useEffect(() => {
    if (sharedRow) setSharedEdit({ ...sharedRow });
  }, [sharedRow]);

  const sharedHeaders = useMemo(() => {
    if (!sharedRow) return [];
    const allowed = ["id", "titre", "auteurs", "resume", "type"];
    const norm = (s: string) =>
      s
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/^\uFEFF/, "")
        .trim();
    return Object.keys(sharedRow).filter((h) => allowed.includes(norm(h)));
  }, [sharedRow]);
  const sharedDirty = useMemo(() => {
    if (!sharedRow) return false;
    return sharedHeaders.some(
      (h) => (sharedEdit[h] ?? "") !== (sharedRow[h] ?? ""),
    );
  }, [sharedEdit, sharedRow, sharedHeaders]);

  const handleCopyCorrections = async () => {
    if (!sharedRow) return;
    const diffs = sharedHeaders
      .filter((h) => (sharedEdit[h] ?? "") !== (sharedRow[h] ?? ""))
      .map((h) => `${h}: ${sharedRow[h] ?? ""}  →  ${sharedEdit[h] ?? ""}`)
      .join("\n");
    const idVal = (sharedRow.ID ?? sharedRow.id ?? "").toString();
    const text = `Corrections pour ID ${idVal}\n\n${diffs || "(aucune modification)"}`;
    try {
      await navigator.clipboard.writeText(text);
      setCorrectionsCopied(true);
      setTimeout(() => setCorrectionsCopied(false), 2500);
    } catch {
      window.prompt("Copiez vos corrections :", text);
    }
  };

  // ----- Vue dédiée pour le destinataire d'un lien de vérification -----
  if (sharedRow) {
    const idVal = (sharedRow.ID ?? sharedRow.id ?? "").toString();
    return (
      <main className="min-h-screen bg-background flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
          <header className="text-center mb-8">
            <h1 className="text-3xl font-bold text-foreground tracking-tight">
              Vérification de vos informations
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Relisez les champs ci-dessous et corrigez si nécessaire.
            </p>
          </header>

          <div className="rounded-xl border border-border bg-card p-6 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-card-foreground">
                Vos informations
              </h2>
              {idVal && (
                <span className="text-xs text-muted-foreground">ID : {idVal}</span>
              )}
            </div>

            <div className="space-y-3">
              {sharedHeaders.map((h) => {
                const isIdCol = h === "ID" || h === "id";
                const changed =
                  (sharedEdit[h] ?? "") !== (sharedRow[h] ?? "");
                return (
                  <div key={h}>
                    <label className="text-xs uppercase tracking-wide text-muted-foreground">
                      {h}
                      {changed && (
                        <span className="ml-2 text-amber-700 dark:text-amber-400 normal-case">
                          (modifié)
                        </span>
                      )}
                    </label>
                    <input
                      type="text"
                      value={sharedEdit[h] ?? ""}
                      readOnly={isIdCol}
                      onChange={(e) =>
                        setSharedEdit((prev) => ({
                          ...prev,
                          [h]: e.target.value,
                        }))
                      }
                      className={`mt-1 w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring ${
                        isIdCol
                          ? "bg-muted text-muted-foreground border-input"
                          : changed
                            ? "bg-background border-amber-500/50"
                            : "bg-background border-input"
                      }`}
                    />
                  </div>
                );
              })}
            </div>

            <div className="pt-2 border-t border-border space-y-2">
              <button
                type="button"
                onClick={handleCopyCorrections}
                className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                Copier mes corrections à renvoyer
              </button>
              {correctionsCopied && (
                <p className="text-xs text-green-600 dark:text-green-400 text-center">
                  ✓ Copié — collez-le dans un email ou un message à l'organisateur.
                </p>
              )}
              <p className="text-xs text-muted-foreground text-center">
                Vos modifications restent sur votre appareil. Renvoyez-les à
                l'organisateur pour qu'elles soient prises en compte.
              </p>
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <header className="text-center mb-8">
          <h1 className="text-3xl font-bold text-foreground tracking-tight">
            Vérification
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Vos informations personnelles
          </p>
        </header>

        {!csvText && (
          <div className="rounded-xl border border-border bg-card p-6 shadow-sm space-y-4">
            <div>
              <h2 className="font-semibold text-card-foreground">
                Charger un fichier CSV
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Dans Google Sheets : <strong>Fichier → Télécharger → Valeurs séparées par des virgules (.csv)</strong>, puis sélectionnez le fichier ici.
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                Colonnes attendues : <code className="px-1 py-0.5 rounded bg-muted">ID</code>, <code className="px-1 py-0.5 rounded bg-muted">Nom</code>, <code className="px-1 py-0.5 rounded bg-muted">Erreur</code>.
              </p>
            </div>

            <label className="flex flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed border-input bg-background px-4 py-8 cursor-pointer hover:bg-accent/30 transition-colors">
              <span className="text-sm font-medium text-foreground">
                Cliquer pour choisir un fichier .csv
              </span>
              <span className="text-xs text-muted-foreground">
                ou glisser-déposer
              </span>
              <input
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                  e.target.value = "";
                }}
              />
            </label>

            {error && (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
                {error}
              </div>
            )}
          </div>
        )}

        {csvText && (
          <div className="mb-4 rounded-xl border border-border bg-card p-4 shadow-sm space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Fichier chargé
                </p>
                <p className="mt-1 text-sm font-medium text-card-foreground truncate">
                  {fileName}
                </p>
                <p className="text-xs text-muted-foreground">
                  {rows.length} ligne{rows.length > 1 ? "s" : ""}
                  {headers.length > 0 && ` — colonnes : ${headers.join(", ")}`}
                </p>
              </div>
              <button
                onClick={clearFile}
                className="shrink-0 text-xs text-muted-foreground hover:text-foreground underline"
              >
                Changer
              </button>
            </div>

            <div>
              <label className="text-xs uppercase tracking-wide text-muted-foreground">
                Tester un identifiant
              </label>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  setId(idInput.trim() || null);
                }}
                className="mt-2 flex gap-2"
              >
                <input
                  type="text"
                  value={idInput}
                  onChange={(e) => setIdInput(e.target.value)}
                  placeholder="ex: 1001"
                  className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <button
                  type="submit"
                  className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                >
                  Rechercher
                </button>
              </form>
              {urlId !== null && id !== urlId && (
                <button
                  type="button"
                  onClick={() => {
                    setIdInput(urlId);
                    setId(urlId);
                  }}
                  className="mt-2 text-xs text-muted-foreground hover:text-foreground"
                >
                  ↺ Réinitialiser à l'ID de l'URL ({urlId})
                </button>
              )}
            </div>

            {error && (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-400">
                {error}
              </div>
            )}
          </div>
        )}

        {csvText && loadError && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-center">
            <p className="text-sm text-destructive font-medium">
              Erreur de lecture
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{loadError}</p>
          </div>
        )}

        {csvText && !id && (
          <div className="rounded-xl border border-border bg-card p-6 shadow-sm text-center">
            <p className="text-sm text-card-foreground">
              Saisissez un identifiant ci-dessus
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              ou ajoutez{" "}
              <code className="px-1 py-0.5 rounded bg-muted">?id=VOTRE_ID</code>{" "}
              à l'URL.
            </p>
          </div>
        )}

        {csvText && id && notFound && (
          <div className="rounded-xl border border-border bg-card p-6 shadow-sm text-center">
            <p className="text-sm font-medium text-card-foreground">
              Aucune information trouvée
            </p>
            <p className="mt-1 text-xs text-muted-foreground">ID : {id}</p>
          </div>
        )}

        {csvText && id && row && (
          <div className="rounded-xl border border-border bg-card p-6 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-card-foreground">
                Informations de la ligne
              </h2>
              <span className="text-xs text-muted-foreground">ID : {id}</span>
            </div>

            {totalIssues > 0 && (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 flex items-center justify-between gap-3">
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  {totalIssues} suggestion{totalIssues > 1 ? "s" : ""} de correction détectée{totalIssues > 1 ? "s" : ""}
                </p>
                <button
                  type="button"
                  onClick={applyAllSuggestions}
                  className="text-xs rounded-md border border-amber-500/40 bg-background px-2 py-1 font-medium text-amber-700 hover:bg-amber-500/10 dark:text-amber-300"
                >
                  Tout appliquer
                </button>
              </div>
            )}

            <div className="space-y-3">
              {headers.map((h) => {
                const isIdCol = h === "ID" || h === "id";
                const sugs = fieldSuggestions[h] ?? [];
                return (
                  <div key={h}>
                    <label className="text-xs uppercase tracking-wide text-muted-foreground">
                      {h}
                    </label>
                    <input
                      type="text"
                      value={editValues[h] ?? ""}
                      readOnly={isIdCol}
                      onChange={(e) =>
                        setEditValues((prev) => ({ ...prev, [h]: e.target.value }))
                      }
                      className={`mt-1 w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring ${
                        isIdCol
                          ? "bg-muted text-muted-foreground border-input"
                          : sugs.some((s) => s.severity === "error")
                            ? "bg-background border-destructive/50"
                            : sugs.length
                              ? "bg-background border-amber-500/50"
                              : "bg-background border-input"
                      }`}
                    />
                    {!isIdCol && sugs.length > 0 && (
                      <ul className="mt-1.5 space-y-1">
                        {sugs.map((s, i) => {
                          const canApply = s.value !== (editValues[h] ?? "");
                          const color =
                            s.severity === "error"
                              ? "text-destructive"
                              : s.severity === "warn"
                                ? "text-amber-700 dark:text-amber-400"
                                : "text-muted-foreground";
                          return (
                            <li
                              key={i}
                              className="flex items-start justify-between gap-2 text-xs"
                            >
                              <span className={`flex-1 ${color}`}>
                                <span className="mr-1">
                                  {s.severity === "error" ? "✕" : s.severity === "warn" ? "⚠" : "ℹ"}
                                </span>
                                {s.label}
                                {canApply && (
                                  <span className="ml-1 text-muted-foreground">
                                    → <code className="px-1 rounded bg-muted">{s.value}</code>
                                  </span>
                                )}
                              </span>
                              {canApply && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setEditValues((prev) => ({ ...prev, [h]: s.value }))
                                  }
                                  className="shrink-0 rounded border border-input bg-background px-2 py-0.5 text-xs font-medium hover:bg-accent"
                                >
                                  Appliquer
                                </button>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
              <button
                type="button"
                onClick={handleSave}
                disabled={!isDirty}
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Enregistrer les modifications
              </button>
              <button
                type="button"
                onClick={handleDownload}
                className="rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground hover:bg-accent"
              >
                Télécharger le CSV
              </button>
              <button
                type="button"
                onClick={handleCopyShareLink}
                className="rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground hover:bg-accent"
                title="Copie un lien que vous pouvez envoyer à la personne concernée pour qu'elle vérifie et corrige ses informations."
              >
                {linkCopied ? "✓ Lien copié" : "🔗 Copier le lien de vérification"}
              </button>
              {isDirty && (
                <button
                  type="button"
                  onClick={() => setEditValues({ ...row })}
                  className="rounded-md px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
                >
                  Annuler
                </button>
              )}
            </div>

            {saved && !isDirty && (
              <p className="text-xs text-green-600 dark:text-green-400">
                ✓ Modifications enregistrées localement. Téléchargez le CSV pour conserver le fichier mis à jour.
              </p>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
