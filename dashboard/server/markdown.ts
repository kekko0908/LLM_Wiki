import { format } from 'date-fns';
import type { DailyEntry, FootballEntry, MacroEntry, MeasurementEntry, WorkoutEntry } from './schemas';

export type MarkdownRow = string[];

export function splitMarkdownRow(line: string): MarkdownRow {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

export function parseMarkdownTable(section: string): MarkdownRow[] {
  return section
    .split(/\r?\n/)
    .filter((line) => line.trim().startsWith('|'))
    .filter((line) => !/^\|\s*:?-{3,}/.test(line.trim()))
    .slice(1)
    .map(splitMarkdownRow);
}

export function nullableNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const raw = String(value).trim().replace(',', '.');
  if (!raw || /^x$/i.test(raw)) {
    return null;
  }
  const match = raw.match(/-?\d+(\.\d+)?/);
  return match ? Number(match[0]) : null;
}

export function nullableText(value: unknown): string {
  const raw = String(value ?? '').trim();
  return /^x$/i.test(raw) ? '' : raw;
}

export function compactNumber(value: number | null | undefined): string {
  return value === null || value === undefined || Number.isNaN(value) ? '' : String(value);
}

export function escapeCell(value: unknown): string {
  return String(value ?? '').replace(/\r?\n/g, ' ').replace(/\|/g, '/').trim();
}

export function monthFromDate(date: string): string {
  return date.slice(0, 7);
}

export function italianMonthTitle(month: string): string {
  const [year, monthNumber] = month.split('-').map(Number);
  return format(new Date(year, monthNumber - 1, 1), 'MMMM yyyy');
}

export const dailyColumns = [
  'Data',
  'Recupero fisico',
  'Recupero mentale',
  'Stress',
  'Qualita sonno',
  'FC riposo',
  'Ore sonno',
  'Passi',
  'Note'
];

export const footballColumns = [
  'Data',
  'Tipo',
  'Nome attivita',
  'Tempo min',
  'Ritmo medio',
  'FC media',
  'Kcal bruciate',
  'Carico allenamento',
  'Cadenza media',
  'Cadenza max',
  'Falcata media',
  'Falcata max',
  'Note'
];

export const macroColumns = ['Data', 'Kcal consumate totali', 'Kcal bruciate', 'Proteine', 'Carboidrati', 'Grassi', 'Note'];
export const measurementColumns = ['Data', 'Peso', 'Vita', 'Fianchi', 'Petto', 'Braccio sx', 'Braccio dx', 'Coscia', 'Spalle'];

export const recordColumns = ['Record', 'Valore', 'Data', 'Note'];

export function buildDailyFile(month: string, rows: DailyEntry[]): string {
  return buildMonthlyTable({
    tags: '[tracking, giornaliero, recupero]',
    title: `Diario giornaliero - ${italianMonthTitle(month)}`,
    intro: 'Registro giornaliero usato dalla dashboard per recupero, sonno, frequenza cardiaca, passi e note operative.',
    month,
    columns: dailyColumns,
    rows: rows.map(dailyToRow)
  });
}

export function buildFootballFile(month: string, rows: FootballEntry[]): string {
  return buildMonthlyTable({
    tags: '[tracking, calcio, performance]',
    title: `Diario calcio - ${italianMonthTitle(month)}`,
    intro: 'Registro di partite e allenamenti calcio usato dalla dashboard per carico, cardio e parametri di corsa.',
    month,
    columns: footballColumns,
    rows: rows.map(footballToRow)
  });
}

export function buildMacroFile(rows: MacroEntry[]): string {
  const today = format(new Date(), 'yyyy-MM-dd');
  const months = [...new Set(rows.map((row) => monthFromDate(row.date)))].sort();
  const sections = months.map((month) => {
    const monthRows = rows.filter((row) => monthFromDate(row.date) === month);
    return [
      `## ${month}`,
      '',
      `| ${macroColumns.join(' | ')} |`,
      `| ${macroColumns.map(() => ':---').join(' | ')} |`,
      ...monthRows.map((row) => `| ${macroToRow(row).map(escapeCell).join(' | ')} |`)
    ].join('\n');
  });

  return [
    '---',
    'tags: [alimentazione, macro, tracking, ricomposizione-corporea]',
    `data_creazione: ${today}`,
    `data_aggiornamento: ${today}`,
    'fonti: []',
    '---',
    '# Diario macro',
    '',
    'Registro giornaliero di calorie e macronutrienti. Serve come fonte primaria per calcolare medie settimanali e confrontarle con allenamenti, misure e recupero.',
    '',
    '## Punti chiave',
    '',
    '- Compila calorie consumate, calorie bruciate, proteine, carboidrati e grassi ogni giorno.',
    '- Aggiungi solo righe con dati reali; non precompilare giorni vuoti.',
    '- La media settimanale va calcolata dai dati giornalieri compilati, senza inserirla a mano qui.',
    '',
    ...sections,
    '',
    '## Articoli correlati',
    '',
    '- [[strategia-nutrizionale]]',
    '- [[menu-settimana-1]]',
    '- [[check-in-settimanali]]',
    '- [[misure-corpo]]',
    '',
    '## Fonti',
    '',
    "- Nessuna fonte esterna: dati inseriti manualmente dall'utente.",
    ''
  ].join('\n');
}

function buildMonthlyTable(input: {
  tags: string;
  title: string;
  intro: string;
  month: string;
  columns: string[];
  rows: MarkdownRow[];
}): string {
  const today = format(new Date(), 'yyyy-MM-dd');
  const table = [
    `| ${input.columns.join(' | ')} |`,
    `| ${input.columns.map(() => ':---').join(' | ')} |`,
    ...input.rows.map((row) => `| ${row.map(escapeCell).join(' | ')} |`)
  ].join('\n');

  return [
    '---',
    `tags: ${input.tags}`,
    `data_creazione: ${today}`,
    `data_aggiornamento: ${today}`,
    'fonti: []',
    '---',
    `# ${input.title}`,
    '',
    input.intro,
    '',
    `## ${input.month}`,
    '',
    table,
    '',
    '## Fonti',
    '',
    '- Nessuna fonte esterna: dati inseriti manualmente dall utente.',
    ''
  ].join('\n');
}

export function dailyToRow(entry: DailyEntry): MarkdownRow {
  return [
    entry.date,
    compactNumber(entry.physicalRecovery),
    compactNumber(entry.mentalRecovery),
    compactNumber(entry.stress),
    compactNumber(entry.sleepQuality),
    compactNumber(entry.restingHeartRate),
    compactNumber(entry.sleepHours),
    compactNumber(entry.steps),
    entry.notes ?? ''
  ];
}

export function footballToRow(entry: FootballEntry): MarkdownRow {
  return [
    entry.date,
    entry.kind,
    entry.label ?? '',
    compactNumber(entry.durationMin),
    entry.avgPace ?? '',
    compactNumber(entry.avgHeartRate),
    compactNumber(entry.calories),
    compactNumber(entry.trainingLoad),
    compactNumber(entry.cadenceAvg),
    compactNumber(entry.cadenceMax),
    compactNumber(entry.strideAvg),
    compactNumber(entry.strideMax),
    entry.notes ?? ''
  ];
}

export function macroToRow(entry: MacroEntry): MarkdownRow {
  return [
    entry.date,
    compactNumber(entry.caloriesIn),
    compactNumber(entry.caloriesBurned),
    compactNumber(entry.protein),
    compactNumber(entry.carbs),
    compactNumber(entry.fat),
    entry.notes ?? ''
  ];
}

export function measurementToRow(entry: MeasurementEntry): MarkdownRow {
  return [
    entry.date,
    withUnit(entry.weight, 'kg'),
    withUnit(entry.waist, 'cm'),
    withUnit(entry.hips, 'cm'),
    withUnit(entry.chest, 'cm'),
    withUnit(entry.leftArm, 'cm'),
    withUnit(entry.rightArm, 'cm'),
    withUnit(entry.thigh, 'cm'),
    withUnit(entry.shoulders, 'cm')
  ];
}

function withUnit(value: number | null | undefined, unit: string): string {
  return value === null || value === undefined || Number.isNaN(value) ? '' : `${value} ${unit}`;
}

export function buildWorkoutSection(entry: WorkoutEntry): string {
  const table = [
    '| Esercizio | Serie | Ripetizioni | Peso | RIR | Note |',
    '| :--- | :--- | :--- | :--- | :--- | :--- |',
    ...entry.exercises.map((exercise) =>
      `| ${[
        exercise.exercise,
        compactNumber(exercise.sets),
        exercise.reps,
        exercise.weight,
        exercise.rir,
        exercise.notes
      ]
        .map(escapeCell)
        .join(' | ')} |`
    )
  ].join('\n');

  return [
    `## ${entry.date} - ${entry.title}`,
    '',
    table,
    ''
  ].join('\n');
}
