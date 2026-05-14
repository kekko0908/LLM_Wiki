import { existsSync } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

export type AiChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

export type AiChatResponse = {
  answer: string;
  sources: string[];
  proposals?: AiWriteProposal[];
  clarifications?: AiClarification[];
};

export type AiMode = 'auto' | 'coach' | 'auditor';

export type AiWriteProposal = {
  id: string;
  type: 'daily' | 'macro' | 'workout' | 'football';
  date: string;
  title: string;
  targetFile: string;
  fields: Record<string, number | string | Array<Record<string, number | string | null>> | null>;
};

export type AiClarification = {
  id: string;
  question: string;
  options: Array<{
    label: string;
    description: string;
    proposal: AiWriteProposal;
  }>;
};

type ContextHit = {
  file: string;
  score: number;
  snippet: string;
};

type SearchIntent = 'training' | 'general';

const ignoredDirs = new Set(['.git', 'node_modules', 'dist', 'build', '.vite', '.cache', 'venv', '.venv', '__pycache__']);
const searchableRoots = ['wiki'];
const searchableRootFiles: string[] = [];
const allowedExtensions = new Set(['.md']);

const outsideWikiAnswer =
  'Posso rispondere solo su dati e contenuti della wiki locale: tracking, allenamenti, calcio, nutrizione, misure, profilo, programmazione, progressione e record. Riformula la domanda dentro quel perimetro.';

export function resolveAiMode(question: string): Exclude<AiMode, 'auto'> {
  const normalized = normalize(question);
  const coachTerms = [
    'che allenamento',
    'cosa faccio',
    'cosa devo fare',
    'domani che',
    'oggi che',
    'programmazione',
    'organizza',
    'riorganizza',
    'sposta',
    'spostare'
  ];
  if (coachTerms.some((term) => normalized.includes(term))) return 'coach';

  const writeTerms = [
    'ho fatto',
    'ho dormito',
    'registra',
    'inserisci',
    'aggiungi',
    'salva',
    'segna',
    'passi',
    'kcal',
    'proteine',
    'carbo',
    'grassi',
    'fc riposo'
  ];
  const explicitEventWrite = /\b(oggi|ieri|domani)\b.{0,25}\b(faccio|ho fatto|devo fare)\b.{0,25}\b(calcio|partita|rest|riposo)\b/.test(
    normalized
  );
  return writeTerms.some((term) => normalized.includes(term)) || explicitEventWrite ? 'auditor' : 'coach';
}

export async function askProjectAi(
  repoRoot: string,
  messages: AiChatMessage[],
  mode: AiMode = 'coach',
  selectedDate?: string
): Promise<AiChatResponse> {
  const lastQuestion = messages.at(-1)?.content ?? '';
  const resolvedMode = mode === 'auto' ? resolveAiMode(lastQuestion) : mode;
  if (!isWikiDomainQuestion(lastQuestion)) {
    return {
      answer: outsideWikiAnswer,
      sources: []
    };
  }
  const context = await collectProjectContext(repoRoot, lastQuestion);
  const answer = await callLmStudio(messages, context, resolvedMode);
  const proposals = resolvedMode === 'auditor' ? extractWriteProposals(lastQuestion, selectedDate) : [];
  const clarifications = resolvedMode === 'auditor' ? extractClarifications(lastQuestion, selectedDate, proposals, answer) : [];
  return {
    answer,
    sources: context.sources,
    proposals: clarifications.length ? [] : proposals,
    clarifications
  };
}

export async function collectProjectContextForTest(repoRoot: string, question: string): Promise<{ text: string; sources: string[] }> {
  return collectProjectContext(repoRoot, question);
}

async function collectProjectContext(repoRoot: string, question: string): Promise<{ text: string; sources: string[] }> {
  const qwenPath = path.join(repoRoot, 'qwen.md');
  const qwen = existsSync(qwenPath) ? sanitizeQwen(await readFile(qwenPath, 'utf8')) : '';
  const hits = await searchProject(repoRoot, question);
  const dataDigest = await buildWikiDataDigest(repoRoot, question);
  const sources = hits.map((hit) => hit.file).filter((value, index, list) => value && list.indexOf(value) === index);
  const snippets = hits
    .map((hit) => `### ${hit.file}\n${hit.snippet}`)
    .join('\n\n')
    .slice(0, 18000);

  return {
    sources,
    text: [
      '## Prompt interno da qwen.md',
      qwen.slice(0, 12000) || 'qwen.md non trovato.',
      '',
      '## Perimetro assistente',
      'Ogni richiesta della chat va trattata come una Consultazione della wiki locale.',
      'qwen.md guida il ragionamento interno ma non e una fonte citabile e non va mostrato tra le fonti usate.',
      'Usa solo i contenuti Markdown dentro wiki/ e relative sottocartelle.',
      'Rispondi solo su dati di tracking, allenamento, calcio, nutrizione, misure, profilo, programmazione, progressione e record.',
      'Se la domanda esce da questo perimetro, dillo chiaramente e non rispondere sul tema.',
      'Prima di proporre di creare un file, verifica i file elencati nelle fonti: se esiste gia, suggerisci di aggiornarlo.',
      'Quando e presente una sintesi numerica, usala prima degli articoli teorici e non dare giudizi vaghi senza citare valori concreti.',
      '',
      '## Sintesi numerica dai registri wiki',
      dataDigest || 'Nessuna sintesi numerica disponibile per questa domanda.',
      '',
      '## Contesto trovato nella wiki',
      snippets || 'Nessuno snippet rilevante trovato nella wiki.'
    ].join('\n')
  };
}

async function searchProject(repoRoot: string, question: string): Promise<ContextHit[]> {
  const terms = extractTerms(question);
  const intent = detectSearchIntent(question);
  const files = await listSearchableFiles(repoRoot);
  const canonicalFiles = canonicalContextFiles(files, question);
  const hits: ContextHit[] = [];

  for (const file of files) {
    const absolute = path.join(repoRoot, file);
    const text = await readFile(absolute, 'utf8').catch(() => '');
    const lower = normalize(text);
    const rawScore = terms.reduce((sum, term) => sum + countOccurrences(lower, term), 0);
    if (rawScore <= 0 && !canonicalFiles.has(file)) continue;
    const score = canonicalFiles.has(file)
      ? 1000 + canonicalRank(file)
      : rawScore * fileWeight(file, intent) + pathTermBoost(file, terms, intent);
    hits.push({ file, score, snippet: buildSnippet(text, terms, canonicalFiles.has(file)) });
  }

  return hits.sort((a, b) => b.score - a.score).slice(0, 12);
}

function canonicalContextFiles(files: string[], question: string): Set<string> {
  const normalized = normalize(question);
  const selected = new Set<string>();
  const hasAny = (terms: string[]) => terms.some((term) => normalized.includes(term));
  const addIfPresent = (file: string) => {
    if (files.includes(file)) selected.add(file);
  };
  const addLatestFrom = (prefix: string) => {
    const latest = files
      .filter((file) => file.startsWith(prefix) && file.endsWith('.md'))
      .sort()
      .at(-1);
    if (latest) selected.add(latest);
  };

  if (
    hasAny([
      'ricomposizione',
      'kcal',
      'calorie',
      'macro',
      'proteine',
      'protein',
      'carbo',
      'carboidrati',
      'grassi',
      'peso',
      'dimagrimento',
      'massa',
      'obiettivo',
      'obiettivi'
    ])
  ) {
    addIfPresent('wiki/profilo/dati-personali-e-obiettivi.md');
    addIfPresent('wiki/profilo/regole-operative-ricomposizione.md');
    addIfPresent('wiki/alimentazione/diario-macro.md');
    addIfPresent('wiki/alimentazione/strategia-nutrizionale.md');
    addIfPresent('wiki/tracking/misure-corpo.md');
    addIfPresent('wiki/tracking/check-in-settimanali.md');
    addIfPresent('wiki/tracking/progressione-carichi.md');
    addIfPresent('wiki/allenamenti/allenamento-per-ricomposizione-corporea.md');
    addLatestFrom('wiki/tracking/giornaliero/');
    addLatestFrom('wiki/tracking/diario/');
  }

  if (hasAny(['allenamento', 'allenamenti', 'workout', 'progressione', 'carico', 'carichi', 'rir'])) {
    addIfPresent('wiki/tracking/progressione-carichi.md');
    addIfPresent('wiki/tracking/check-in-settimanali.md');
    addLatestFrom('wiki/tracking/diario/');
  }

  return selected;
}

function canonicalRank(file: string): number {
  if (file === 'wiki/alimentazione/diario-macro.md') return 180;
  if (file === 'wiki/profilo/dati-personali-e-obiettivi.md') return 170;
  if (file === 'wiki/tracking/misure-corpo.md') return 160;
  if (file === 'wiki/tracking/check-in-settimanali.md') return 150;
  if (file.startsWith('wiki/tracking/giornaliero/')) return 140;
  if (file.startsWith('wiki/tracking/diario/')) return 130;
  if (file === 'wiki/tracking/progressione-carichi.md') return 120;
  if (file === 'wiki/alimentazione/strategia-nutrizionale.md') return 90;
  if (file === 'wiki/profilo/regole-operative-ricomposizione.md') return 80;
  if (file === 'wiki/allenamenti/allenamento-per-ricomposizione-corporea.md') return 70;
  return 0;
}

function detectSearchIntent(question: string): SearchIntent {
  const normalized = normalize(question);
  const trainingTerms = [
    'allenamento',
    'allenamenti',
    'workout',
    'progressione',
    'carico',
    'carichi',
    'ripetizione',
    'ripetizioni',
    'reps',
    'rir',
    'scheda',
    'push',
    'pull',
    'legs',
    'calcio',
    'partita',
    'recupero',
    'sonno'
  ];
  if (trainingTerms.some((term) => normalized.includes(term))) return 'training';
  return 'general';
}

function fileWeight(file: string, intent: SearchIntent): number {
  if (file === 'wiki/alimentazione/diario-macro.md') return 8;
  if (file === 'wiki/profilo/dati-personali-e-obiettivi.md') return 7;
  if (file === 'wiki/tracking/misure-corpo.md') return 7;
  if (file === 'wiki/tracking/check-in-settimanali.md') return 6;
  if (intent === 'training') {
    if (file === 'wiki/tracking/progressione-carichi.md') return 8;
    if (file.startsWith('wiki/allenamenti/')) return 6;
    if (file.startsWith('wiki/tracking/diario/')) return 5;
    if (file.startsWith('wiki/tracking/giornaliero/')) return 4;
    if (file.startsWith('wiki/tracking/')) return 3.5;
    if (file.startsWith('wiki/alimentazione/')) return 2.4;
    if (file.startsWith('wiki/profilo/')) return 2.2;
  }
  if (file.startsWith('wiki/')) return 1.4;
  return 1;
}

function pathTermBoost(file: string, terms: string[], intent: SearchIntent): number {
  const normalizedFile = normalize(file);
  const base = terms.filter((term) => normalizedFile.includes(term)).length * 3;
  if (intent === 'training' && normalizedFile.includes('progressione-carichi')) return base + 20;
  if (intent === 'training' && normalizedFile.includes('allenamenti')) return base + 12;
  return base;
}

async function listSearchableFiles(repoRoot: string): Promise<string[]> {
  const files = new Set<string>();

  async function walk(dir: string): Promise<void> {
    if (files.size > 500) return;
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!ignoredDirs.has(entry.name)) {
          await walk(path.join(dir, entry.name));
        }
        continue;
      }
      const absolute = path.join(dir, entry.name);
      const ext = path.extname(entry.name).toLowerCase();
      if (!allowedExtensions.has(ext)) continue;
      const info = await stat(absolute).catch(() => null);
      if (!info || info.size > 250_000) continue;
      files.add(path.relative(repoRoot, absolute).replace(/\\/g, '/'));
    }
  }

  for (const file of searchableRootFiles) {
    if (existsSync(path.join(repoRoot, file))) {
      files.add(file);
    }
  }
  for (const root of searchableRoots) {
    const absolute = path.join(repoRoot, root);
    if (existsSync(absolute)) {
      await walk(absolute);
    }
  }
  return [...files];
}

async function buildWikiDataDigest(repoRoot: string, question: string): Promise<string> {
  const normalized = normalize(question);
  const needsDigest = [
    'ricomposizione',
    'kcal',
    'calorie',
    'macro',
    'proteine',
    'protein',
    'carbo',
    'grassi',
    'peso',
    'allenamento',
    'allenamenti',
    'recupero'
  ].some((term) => normalized.includes(term));
  if (!needsDigest) return '';

  const lines: string[] = [];
  const macroPath = path.join(repoRoot, 'wiki/alimentazione/diario-macro.md');
  const dailyPath = await latestExistingFile(repoRoot, 'wiki/tracking/giornaliero');
  const workoutPath = await latestExistingFile(repoRoot, 'wiki/tracking/diario');
  const measurePath = path.join(repoRoot, 'wiki/tracking/misure-corpo.md');
  const checkInPath = path.join(repoRoot, 'wiki/tracking/check-in-settimanali.md');

  const macro = existsSync(macroPath) ? parseTable(await readFile(macroPath, 'utf8')) : [];
  const macroRows = macro.filter((row) => row['Data']);
  if (macroRows.length) {
    lines.push(
      `Macro registrate: ${macroRows.length} giorni (${macroRows[0]['Data']} -> ${macroRows.at(-1)?.['Data']}).`,
      `Medie macro: ${averageRow(macroRows, 'Kcal consumate totali')} kcal assunte, ${averageRow(macroRows, 'Kcal bruciate')} kcal bruciate, ${averageRow(macroRows, 'Proteine')} g proteine, ${averageRow(macroRows, 'Carboidrati')} g carboidrati, ${averageRow(macroRows, 'Grassi')} g grassi.`
    );
  }

  const measures = existsSync(measurePath) ? parseTable(await readFile(measurePath, 'utf8')) : [];
  const latestMeasure = measures.filter((row) => row['Data']).at(-1);
  if (latestMeasure) {
    lines.push(
      `Ultime misure (${latestMeasure['Data']}): peso ${latestMeasure['Peso'] || 'n/d'}, vita ${latestMeasure['Vita'] || 'n/d'}, fianchi ${latestMeasure['Fianchi'] || 'n/d'}, petto ${latestMeasure['Petto'] || 'n/d'}, spalle ${latestMeasure['Spalle'] || 'n/d'}.`
    );
  }

  if (dailyPath) {
    const daily = parseTable(await readFile(dailyPath, 'utf8')).filter((row) => row['Data']);
    if (daily.length) {
      lines.push(
        `Diario giornaliero: ${daily.length} giorni (${daily[0]['Data']} -> ${daily.at(-1)?.['Data']}).`,
        `Medie recupero: fisico ${averageRow(daily, 'Recupero fisico')}/100, mentale ${averageRow(daily, 'Recupero mentale')}/100, stress ${averageRow(daily, 'Stress')}/100, sonno ${averageRow(daily, 'Qualita sonno')}/100, ore sonno ${averageRow(daily, 'Ore sonno')} h, passi ${averageRow(daily, 'Passi')}.`
      );
    }
  }

  if (workoutPath) {
    const workoutText = await readFile(workoutPath, 'utf8');
    const sessions = [...workoutText.matchAll(/^##\s+(\d{4}-\d{2}-\d{2})\s+-\s+(.+)$/gm)].map((match) => ({
      date: match[1],
      title: match[2].trim()
    }));
    if (sessions.length) {
      const latest = sessions.at(-1);
      lines.push(
        `Allenamenti tracciati: ${sessions.length} sessioni (${sessions[0].date} -> ${latest?.date}). Ultima sessione: ${latest?.date} - ${latest?.title}.`
      );
    }
  }

  if (existsSync(checkInPath)) {
    const checkInText = await readFile(checkInPath, 'utf8');
    const latestWeek = [...checkInText.matchAll(/## Settimana ([^\n]+)/g)].at(-1)?.[1]?.trim();
    const completed = checkInText.match(/\| Allenamenti completati \| ([^|]+)\|/g)?.at(-1)?.replace(/\| Allenamenti completati \|/, '').replace('|', '').trim();
    const football = checkInText.match(/\| Calcio \| ([^|]+)\|/g)?.at(-1)?.replace(/\| Calcio \|/, '').replace('|', '').trim();
    if (latestWeek || completed || football) {
      lines.push(`Ultimo check-in: ${latestWeek || 'n/d'}; allenamenti ${completed || 'n/d'}; calcio ${football || 'n/d'}.`);
    }
  }

  return lines.join('\n');
}

async function latestExistingFile(repoRoot: string, relativeDir: string): Promise<string | null> {
  const absoluteDir = path.join(repoRoot, relativeDir);
  if (!existsSync(absoluteDir)) return null;
  const entries = await readdir(absoluteDir).catch(() => []);
  const latest = entries
    .filter((entry) => entry.endsWith('.md'))
    .sort()
    .at(-1);
  return latest ? path.join(absoluteDir, latest) : null;
}

function parseTable(markdown: string): Array<Record<string, string>> {
  const rows = markdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('|') && line.endsWith('|'));
  const result: Array<Record<string, string>> = [];
  let headers: string[] = [];

  for (const row of rows) {
    const cells = row
      .slice(1, -1)
      .split('|')
      .map((cell) => cell.trim());
    if (cells.every((cell) => /^:?-{3,}:?$/.test(cell))) continue;
    if (headers.length === 0) {
      headers = cells;
      continue;
    }
    if (cells.length !== headers.length) continue;
    result.push(Object.fromEntries(headers.map((header, index) => [header, cells[index]])));
  }

  return result;
}

function averageRow(rows: Array<Record<string, string>>, key: string): string {
  const values = rows
    .map((row) => parseNumber(row[key]))
    .filter((value): value is number => value !== null);
  if (!values.length) return 'n/d';
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  return average >= 100 ? String(Math.round(average)) : String(Math.round(average * 10) / 10);
}

function parseNumber(value: string | undefined): number | null {
  if (!value) return null;
  const normalized = value.replace(',', '.').match(/-?\d+(?:\.\d+)?/);
  return normalized ? Number(normalized[0]) : null;
}

export function extractWriteProposals(question: string, selectedDate?: string): AiWriteProposal[] {
  const normalized = normalize(question);
  const date = resolveProposalDate(question, selectedDate);
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return [];
  const dailyDate = resolveEventDate(normalized, selectedDate, ['rest', 'riposo']) ?? date;
  const footballDate = resolveEventDate(normalized, selectedDate, ['calcio', 'partita']) ?? date;
  const proposals: AiWriteProposal[] = [];
  const dailyFields: Record<string, number | string> = {};
  const macroFields: Record<string, number> = {};
  const workoutFields: Record<string, number | string | Array<Record<string, number | string | null>>> = {};
  const footballFields: Record<string, number | string | null> = {};

  const steps = normalized.match(/(\d{3,6})\s*(passi|steps)\b/);
  if (steps) dailyFields.steps = Number(steps[1]);

  const sleepQuality = normalized.match(/qualita(?:\s+del|\s+di)?\s+sonno[^\d]*(\d{1,3})/);
  if (sleepQuality) dailyFields.sleepQuality = clampScore(Number(sleepQuality[1]));

  const sleepHours =
    normalized.match(/(?:dormito|ore sonno)[^\d]*(\d+(?:[\.,]\d+)?)/) ??
    normalized.match(/(\d+(?:[\.,]\d+)?)\s*(ore|h)\s*(?:di\s*)?sonno/);
  if (sleepHours && !sleepQuality) dailyFields.sleepHours = Number(sleepHours[1].replace(',', '.'));

  const restingHeartRate = normalized.match(/(?:fc riposo|frequenza cardiaca a riposo|battito a riposo)[^\d]*(\d{2,3})/);
  if (restingHeartRate) dailyFields.restingHeartRate = Number(restingHeartRate[1]);

  const physicalRecovery = normalized.match(/recupero fisico[^\d]*(\d{1,3})/);
  if (physicalRecovery) dailyFields.physicalRecovery = clampScore(Number(physicalRecovery[1]));

  const mentalRecovery = normalized.match(/recupero mentale[^\d]*(\d{1,3})/);
  if (mentalRecovery) dailyFields.mentalRecovery = clampScore(Number(mentalRecovery[1]));

  const stress = normalized.match(/stress[^\d]*(\d{1,3})/);
  if (stress) dailyFields.stress = clampScore(Number(stress[1]));

  if (/\b(rest|riposo)\b/.test(normalized)) {
    appendDailyNote(dailyFields, 'REST');
  }
  if (/poco tempo|tempo poco|35\s*(?:min| minuti)|allenamento breve|allenamento veloce/.test(normalized)) {
    appendDailyNote(dailyFields, 'POCO TEMPO');
  }
  if (/trasferta|hotel|viaggio|corpo libero|manubri/.test(normalized)) {
    appendDailyNote(dailyFields, 'TRASFERTA');
  }
  if (/gambe (?:stanche|affaticate|pesanti)|doms gambe|dolore gambe/.test(normalized)) {
    appendDailyNote(dailyFields, 'GAMBE AFFATICATE');
  }

  const caloriesIn = normalized.match(/(?:kcal|calorie)(?:\s*(?:assunte|mangiate|consumate|introitate))?[^\d]*(\d{3,5})/);
  if (caloriesIn) macroFields.caloriesIn = Number(caloriesIn[1]);

  const caloriesBurned = normalized.match(/(?:kcal|calorie)\s*(?:bruciate|bruciato|attive)[^\d]*(\d{2,5})/);
  if (caloriesBurned) macroFields.caloriesBurned = Number(caloriesBurned[1]);

  const protein = normalized.match(/(?:proteine|protein)[^\d]*(\d{1,3})/);
  if (protein) macroFields.protein = Number(protein[1]);

  const carbs = normalized.match(/(?:carboidrati|carbo)[^\d]*(\d{1,4})/);
  if (carbs) macroFields.carbs = Number(carbs[1]);

  const fat = normalized.match(/grassi[^\d]*(\d{1,3})/);
  if (fat) macroFields.fat = Number(fat[1]);

  const workout = normalized.match(/(?:ho fatto|allenamento|workout)?\s*(push|pull|legs)\s+(\d+)\s*x\s*(\d+)(?:[^\d]+rir\s*(\d{1,2}(?:-\d{1,2})?))?/);
  if (workout) {
    const title = `Scheda ${workout[1].toUpperCase()}`;
    workoutFields.title = title;
    workoutFields.exercises = [
      {
        exercise: title,
        sets: Number(workout[2]),
        reps: workout[3],
        weight: '',
        rir: workout[4] ?? '',
        notes: 'Proposta generata da Auditor: completa esercizi e carichi se necessario.'
      }
    ];
  }

  const footballKind = normalized.includes('partita') ? 'partita' : normalized.includes('calcio') ? 'allenamento' : '';
  if (footballKind) {
    footballFields.kind = footballKind;
    footballFields.label = footballKind === 'partita' ? 'Partita' : 'Calcio';
    const duration = normalized.match(/(\d{1,3})\s*(?:min| minuti)/);
    if (duration) footballFields.durationMin = Number(duration[1]);
    const avgHeartRate = normalized.match(/(?:fc media|frequenza media)[^\d]*(\d{2,3})/);
    if (avgHeartRate) footballFields.avgHeartRate = Number(avgHeartRate[1]);
    const calories = normalized.match(/(?:kcal|calorie)[^\d]*(\d{2,5})/);
    if (calories) footballFields.calories = Number(calories[1]);
    const trainingLoad = normalized.match(/carico[^\d]*(\d{1,4})/);
    if (trainingLoad) footballFields.trainingLoad = Number(trainingLoad[1]);
  }

  const month = date.slice(0, 7);
  if (Object.keys(dailyFields).length) {
    const dailyMonth = dailyDate.slice(0, 7);
    proposals.push({
      id: `daily-${dailyDate}-${Object.keys(dailyFields).join('-')}`,
      type: 'daily',
      date: dailyDate,
      title: `Aggiorna diario giornaliero ${dailyDate}`,
      targetFile: `wiki/tracking/giornaliero/${dailyMonth}.md`,
      fields: dailyFields
    });
  }
  if (Object.keys(macroFields).length) {
    proposals.push({
      id: `macro-${date}-${Object.keys(macroFields).join('-')}`,
      type: 'macro',
      date,
      title: `Aggiorna macro ${date}`,
      targetFile: 'wiki/alimentazione/diario-macro.md',
      fields: macroFields
    });
  }
  if (Object.keys(workoutFields).length) {
    proposals.push({
      id: `workout-${date}-${String(workoutFields.title).toLowerCase().replace(/\s+/g, '-')}`,
      type: 'workout',
      date,
      title: `Crea workout ${date}`,
      targetFile: `wiki/tracking/diario/${month}.md`,
      fields: workoutFields
    });
  }
  if (Object.keys(footballFields).length) {
    const footballMonth = footballDate.slice(0, 7);
    proposals.push({
      id: `football-${footballDate}-${footballFields.kind}`,
      type: 'football',
      date: footballDate,
      title: `Registra ${footballFields.kind} ${footballDate}`,
      targetFile: `wiki/tracking/calcio/${footballMonth}.md`,
      fields: footballFields
    });
  }
  return proposals;
}

export function extractClarifications(
  question: string,
  selectedDate?: string,
  existingProposals: AiWriteProposal[] = extractWriteProposals(question, selectedDate),
  aiAnswer = ''
): AiClarification[] {
  const normalized = normalize(question);
  const date = resolveProposalDate(question, selectedDate);
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return [];
  if (existingProposals.length) return [];

  const sleepValue = normalized.match(/(?:inserisci|segna|salva|aggiorna|metti)?\s*sonno[^\d]*(\d{1,3}(?:[\.,]\d+)?)/);
  const isExplicitSleepQuality = /qualita(?:\s+del|\s+di)?\s+sonno/.test(normalized);
  const isExplicitSleepHours = /(?:ore sonno|dormito|\d+(?:[\.,]\d+)?\s*(?:ore|h)\s*(?:di\s*)?sonno)/.test(normalized);
  if (!sleepValue || isExplicitSleepQuality || isExplicitSleepHours) return [];

  const value = Number(sleepValue[1].replace(',', '.'));
  if (!Number.isFinite(value)) return [];

  const options: AiClarification['options'] = [];
  if (value <= 100) {
    options.push({
      label: `Qualita sonno ${Math.round(value)}/100`,
      description: 'Usa questo se stai valutando quanto hai dormito bene.',
      proposal: createDailyProposal(date, { sleepQuality: clampScore(Math.round(value)) }, 'sleepQuality')
    });
  }
  if (value <= 24) {
    options.push({
      label: `Ore sonno ${value}h`,
      description: 'Usa questo se stai indicando quante ore hai dormito.',
      proposal: createDailyProposal(date, { sleepHours: value }, 'sleepHours')
    });
  }
  if (options.length < 2) return [];

  return [
    {
      id: `clarify-sleep-${date}-${value}`,
      question: extractAiClarificationQuestion(aiAnswer) ?? `Quando dici "sonno ${value}", quale dato vuoi aggiornare?`,
      options
    }
  ];
}

function extractAiClarificationQuestion(answer: string): string | null {
  const normalized = answer.replace(/\s+/g, ' ').trim();
  const question = normalized.match(/([^.!?]{12,220}\?)/)?.[1]?.trim();
  if (!question) return null;
  return question.replace(/^[-*\s]+/, '');
}

function createDailyProposal(date: string, fields: Record<string, number>, idSuffix: string): AiWriteProposal {
  const month = date.slice(0, 7);
  return {
    id: `daily-${date}-${idSuffix}`,
    type: 'daily',
    date,
    title: `Aggiorna diario giornaliero ${date}`,
    targetFile: `wiki/tracking/giornaliero/${month}.md`,
    fields
  };
}

function appendDailyNote(fields: Record<string, number | string>, note: string): void {
  const current = typeof fields.notes === 'string' ? fields.notes : '';
  fields.notes = [current, note].filter(Boolean).join(' - ');
}

function resolveProposalDate(question: string, selectedDate?: string): string | undefined {
  const explicit = question.match(/\b(\d{4}-\d{2}-\d{2})\b/)?.[1];
  if (explicit) return explicit;
  if (!selectedDate) return undefined;
  const normalized = normalize(question);
  if (/\bieri\b/.test(normalized)) return addIsoDays(selectedDate, -1);
  if (/\bdomani\b/.test(normalized)) return addIsoDays(selectedDate, 1);
  return selectedDate;
}

function resolveEventDate(normalizedQuestion: string, selectedDate: string | undefined, terms: string[]): string | undefined {
  if (!selectedDate) return undefined;
  for (const term of terms) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = normalizedQuestion.match(new RegExp(`\\b${escaped}\\b`));
    if (!match || match.index === undefined) continue;
    const before = normalizedQuestion.slice(Math.max(0, match.index - 40), match.index);
    const closestBefore = [...before.matchAll(/\b(ieri|oggi|domani)\b/g)].at(-1)?.[1];
    const after = normalizedQuestion.slice(match.index, match.index + 40);
    const closestAfter = after.match(/\b(ieri|oggi|domani)\b/)?.[1];
    const relative = closestBefore ?? closestAfter;
    if (relative === 'ieri') return addIsoDays(selectedDate, -1);
    if (relative === 'domani') return addIsoDays(selectedDate, 1);
    if (relative === 'oggi') return selectedDate;
  }
  return undefined;
}

function addIsoDays(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, value));
}

async function callLmStudio(messages: AiChatMessage[], context: { text: string; sources: string[] }, mode: AiMode): Promise<string> {
  const baseUrl = process.env.LM_STUDIO_BASE_URL ?? 'http://127.0.0.1:1234/v1';
  const model = process.env.LM_STUDIO_MODEL ?? 'local-model';
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      temperature: 0.15,
      top_p: 0.85,
      max_tokens: 900,
      enable_thinking: false,
      messages: [
        {
          role: 'system',
          content:
            [
              'Sei un assistente locale della dashboard Kernel.',
              'Rispondi in italiano, in modo pratico e diretto.',
              'Ogni messaggio utente e una Consultazione della wiki locale: applica le istruzioni interne di qwen.md ma non citarlo come fonte.',
              'Il tuo unico dominio sono i contenuti Markdown dentro wiki/ e sottocartelle.',
              'Non rispondere a domande di codice, sviluppo software, argomenti generici o temi non presenti nella wiki.',
              'Non aprire con reminder tracking, salvo richiesta esplicita.',
              'Non usare titoli lunghi tipo "Reminder Tracking" o analisi generiche.',
              'Per domande di allenamento usa questa struttura: "Risposta breve", "Come gestirla", "Cosa aggiornare nella wiki".',
              'Per domande di progressione, prima usa progressione-carichi, diario allenamenti, schede allenamento e profilo, se presenti nel contesto.',
              'Per domande valutative su percorso, ricomposizione o macro, apri con un giudizio onesto basato su numeri: medie kcal, proteine, carboidrati, grassi, peso/misure, recupero e allenamenti tracciati.',
              'Se i dati sono pochi, dai un giudizio parziale e spiega esattamente quali dati mancano; non dire "ben strutturato" senza evidenze numeriche.',
              'Usa solo il contesto fornito quando parli del progetto.',
              'Cita file reali solo se presenti nel contesto. Non inventare wikilink o percorsi.',
              'Non suggerire di creare un file se lo stesso file e gia presente nelle fonti.',
              'Se manca un dato, dillo chiaramente e chiedi solo quel dato.',
              'Se una richiesta di registrazione e ambigua, ragiona sul campo piu probabile ma non scegliere al posto dell utente: formula una sola domanda di chiarimento breve e concreta.',
              mode === 'auditor'
                ? 'Modalita Auditor: non fare coaching motivazionale. Controlla coerenza dei dati, incongruenze, doppioni, date mancanti e formato Markdown. Se l utente chiede di registrare un dato chiaro, descrivi una proposta operativa con sezioni: Verifica, Proposta modifica, File target, Campi, Rischi. Se il dato e ambiguo, fai una domanda di chiarimento invece di proporre la scrittura. Non dichiarare mai di aver scritto file.'
                : 'Modalita Coach: dai consigli pratici su allenamento, recupero, nutrizione e progressione usando i dati wiki. Non scrivere file e non fingere modifiche.'
            ].join(' ')
        },
        {
          role: 'system',
          content: context.text
        },
        ...messages.slice(-8)
      ]
    })
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(
      `LM Studio non risponde correttamente (${response.status}). Avvia il server locale OpenAI-compatible su ${baseUrl}. ${body}`
    );
  }

  const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return payload.choices?.[0]?.message?.content?.trim() || 'Nessuna risposta generata dal modello locale.';
}

function extractTerms(question: string): string[] {
  const stop = new Set([
    'come',
    'cosa',
    'dove',
    'quando',
    'oggi',
    'fare',
    'fatto',
    'provato',
    'prima',
    'tutti',
    'tutte',
    'sempre',
    'stesso',
    'stessa',
    'dimmi',
    'gestire',
    'perche',
    'perché',
    'della',
    'delle',
    'degli',
    'nella',
    'nelle',
    'questo',
    'quello',
    'dashboard',
    'progetto',
    'posso',
    'voglio',
    'devo'
  ]);
  return normalize(question)
    .split(/[^a-z0-9_-]+/i)
    .map((term) => term.trim())
    .filter((term) => term.length >= 3 && !stop.has(term))
    .slice(0, 16);
}

function isWikiDomainQuestion(question: string): boolean {
  const normalized = normalize(question);
  const domainTerms = [
    'wiki',
    'tracking',
    'diario',
    'giornaliero',
    'allenamento',
    'allenamenti',
    'workout',
    'esercizio',
    'esercizi',
    'scheda',
    'push',
    'pull',
    'legs',
    'serie',
    'reps',
    'ripetizioni',
    'rir',
    'carico',
    'carichi',
    'progressione',
    'calcio',
    'partita',
    'partite',
    'nutrizione',
    'alimentazione',
    'macro',
    'kcal',
    'calorie',
    'proteine',
    'protein',
    'carbo',
    'carboidrati',
    'grassi',
    'ricomposizione',
    'massa',
    'dimagrimento',
    'peso',
    'misure',
    'corpo',
    'profilo',
    'obiettivi',
    'programmazione',
    'record',
    'recupero',
    'mentale',
    'fisico',
    'stress',
    'sonno',
    'passi',
    'frequenza',
    'cardiaca',
    'cuore',
    'battito'
  ];
  return domainTerms.some((term) => normalized.includes(term));
}

function sanitizeQwen(text: string): string {
  return text
    .replace(/### Promemoria tracking obbligatorio[\s\S]*?(?=### Domanda settimanale consigliata)/, '')
    .replace(/### Domanda settimanale consigliata[\s\S]*?(?=## Workflow: Audit \/ Lint)/, '');
}

function buildSnippet(text: string, terms: string, includeFallback?: boolean): string;
function buildSnippet(text: string, terms: string[], includeFallback?: boolean): string;
function buildSnippet(text: string, terms: string | string[], includeFallback = false): string {
  const list = Array.isArray(terms) ? terms : [terms];
  const lines = text.split(/\r?\n/);
  const indexes = lines
    .map((line, index) => ({ line, index, normalized: normalize(line) }))
    .filter((item) => list.some((term) => item.normalized.includes(term)))
    .slice(0, 6)
    .flatMap((item) => [item.index - 1, item.index, item.index + 1])
    .filter((index, position, all) => index >= 0 && index < lines.length && all.indexOf(index) === position)
    .sort((a, b) => a - b);
  if (indexes.length === 0 && includeFallback) {
    return lines
      .slice(0, 120)
      .map((line, index) => `${index + 1}: ${line}`)
      .join('\n')
      .slice(0, 3500);
  }
  return indexes.map((index) => `${index + 1}: ${lines[index]}`).join('\n').slice(0, 2200);
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function countOccurrences(text: string, term: string): number {
  let count = 0;
  let index = text.indexOf(term);
  while (index >= 0) {
    count += 1;
    index = text.indexOf(term, index + term.length);
  }
  return count;
}
