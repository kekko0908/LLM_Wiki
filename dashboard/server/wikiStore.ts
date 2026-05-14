import { addDays, eachDayOfInterval, endOfMonth, endOfWeek, format, parseISO, startOfMonth, startOfWeek } from 'date-fns';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  DailyEntry,
  ExerciseEntry,
  FootballEntry,
  MacroEntry,
  MeasurementEntry,
  RecordEntry,
  WorkoutEntry
} from './schemas';
import {
  buildDailyFile,
  buildFootballFile,
  buildMacroFile,
  buildWorkoutSection,
  escapeCell,
  measurementColumns,
  measurementToRow,
  monthFromDate,
  nullableNumber,
  nullableText,
  parseMarkdownTable
} from './markdown';
import { buildCoachPayload, type CoachPayload } from './coach';

export type DashboardPeriod = 'day' | 'week' | 'month';

export type DashboardPayload = {
  selectedDate: string;
  period: DashboardPeriod;
  range: { from: string; to: string };
  daily: DailyEntry | null;
  football: FootballEntry[];
  footballActivities: FootballEntry[];
  workout: WorkoutEntry | null;
  workouts: WorkoutEntry[];
  macro: MacroEntry | null;
  measurement: MeasurementEntry | null;
  series: Array<{
    date: string;
    physicalRecovery: number | null;
    mentalRecovery: number | null;
    energy: number | null;
    stress: number | null;
    sleepQuality: number | null;
    doms: number | null;
    hunger: number | null;
    restingHeartRate: number | null;
    sleepHours: number | null;
    steps: number | null;
    caloriesIn: number | null;
    caloriesBurned: number | null;
    protein: number | null;
    carbs: number | null;
    fat: number | null;
    weight: number | null;
  }>;
  averages: Record<string, number | null>;
  coach: CoachPayload;
};

export type WikiDataPayload = {
  profile: {
    basics: Array<{ label: string; value: string }>;
    keyPoints: string[];
    formulas: Array<{ label: string; value: string }>;
    implications: string;
  };
  progression: Array<{ group: string; rows: Array<{ exercise: string; status: string }> }>;
  measurements: MeasurementEntry[];
  schedule: Array<{ title: string; rows: Array<{ day: string; workout: string; details: string }> }>;
  definitions: Array<{ title: string; slug: string; summary: string }>;
  presets: Array<{ id: string; title: string; source: string; exercises: ExerciseEntry[] }>;
};

export type ProgressionEntry = {
  group: 'Push' | 'Pull' | 'Legs';
  exercise: string;
  status: string;
};

export class WikiStore {
  readonly repoRoot: string;
  readonly wikiRoot: string;

  constructor(repoRoot = resolveRepoRoot()) {
    this.repoRoot = repoRoot;
    this.wikiRoot = path.join(repoRoot, 'wiki');
  }

  async getDashboard(date: string, period: DashboardPeriod): Promise<DashboardPayload> {
    const range = getRange(date, period);
    const months = monthsBetween(range.from, range.to);
    const [dailyEntries, footballEntries, workouts, macros, measurements, progression, profile] = await Promise.all([
      this.readDailyMonths(months),
      this.readFootballMonths(months),
      this.readWorkoutMonths(months),
      this.readMacroEntries(),
      this.readMeasurementEntries(),
      this.readProgression(),
      this.readProfile()
    ]);

    const dailyByDate = new Map(dailyEntries.map((entry) => [entry.date, entry]));
    const macroByDate = new Map(macros.map((entry) => [entry.date, entry]));
    const measurementByDate = new Map(measurements.map((entry) => [entry.date, entry]));
    const rangeWorkouts = workouts.filter((entry) => entry.date >= range.from && entry.date <= range.to);
    const workoutByDate = new Map(rangeWorkouts.map((entry) => [entry.date, entry]));
    const rangeFootball = footballEntries.filter((entry) => entry.date >= range.from && entry.date <= range.to);
    const footballByDate = groupByDate(rangeFootball);
    const planningRange = getRange(date, 'week');
    const planningWorkouts = workouts.filter((entry) => entry.date >= planningRange.from && entry.date <= planningRange.to);
    const planningFootball = footballEntries.filter((entry) => entry.date >= planningRange.from && entry.date <= planningRange.to);
    const planningDaily = dailyEntries.filter((entry) => entry.date >= planningRange.from && entry.date <= planningRange.to);

    const days = eachDayOfInterval({ start: parseISO(range.from), end: parseISO(range.to) }).map((day) =>
      format(day, 'yyyy-MM-dd')
    );

    const series = days.map((day) => {
      const daily = dailyByDate.get(day);
      const macro = macroByDate.get(day);
      const measurement = measurementByDate.get(day);
      return {
        date: day,
        physicalRecovery: daily?.physicalRecovery ?? null,
        mentalRecovery: daily?.mentalRecovery ?? null,
        energy: daily?.energy ?? null,
        stress: daily?.stress ?? null,
        sleepQuality: daily?.sleepQuality ?? null,
        doms: daily?.doms ?? null,
        hunger: daily?.hunger ?? null,
        restingHeartRate: daily?.restingHeartRate ?? null,
        sleepHours: daily?.sleepHours ?? null,
        steps: daily?.steps ?? null,
        caloriesIn: macro?.caloriesIn ?? null,
        caloriesBurned: macro?.caloriesBurned ?? null,
        protein: macro?.protein ?? null,
        carbs: macro?.carbs ?? null,
        fat: macro?.fat ?? null,
        weight: measurement?.weight ?? null
      };
    });

    const dashboard = {
      selectedDate: date,
      period,
      range,
      daily: dailyByDate.get(date) ?? null,
      football: footballByDate.get(date) ?? [],
      footballActivities: rangeFootball,
      workout: workoutByDate.get(date) ?? null,
      workouts: rangeWorkouts,
      macro: macroByDate.get(date) ?? null,
      measurement: latestOnOrBefore(measurements, date),
      series,
      averages: averageSeries(series),
      coach: buildCoachPayload({
        selectedDate: date,
        period,
        daily: dailyByDate.get(date) ?? null,
        macro: macroByDate.get(date) ?? null,
        measurement: latestOnOrBefore(measurements, date),
        series,
        workouts: rangeWorkouts,
        workout: workoutByDate.get(date) ?? null,
        planningWorkouts,
        planningDailyEntries: planningDaily,
        football: footballByDate.get(date) ?? [],
        footballActivities: rangeFootball,
        planningFootballActivities: planningFootball,
        progression,
        profileBasics: profile.basics
      })
    };

    return dashboard;
  }

  async getWorkout(date: string): Promise<WorkoutEntry | null> {
    const workouts = await this.readWorkoutMonths([monthFromDate(date)]);
    return workouts.find((workout) => workout.date === date) ?? null;
  }

  async readWikiData(): Promise<WikiDataPayload> {
    const [profile, progression, measurements, schedule, definitions, presets] = await Promise.all([
      this.readProfile(),
      this.readProgression(),
      this.readMeasurementEntries(),
      this.readSchedule(),
      this.readDefinitions(),
      this.readWorkoutPresets()
    ]);
    return { profile, progression, measurements, schedule, definitions, presets };
  }

  async upsertWorkout(entry: WorkoutEntry): Promise<WorkoutEntry> {
    const month = monthFromDate(entry.date);
    const rows = await this.readWorkoutMonths([month]);
    const originalId = entry.originalId || entry.id;
    const next = [...rows.filter((row) => workoutId(row) !== originalId && workoutId(row) !== workoutId(entry)), entry].sort(
      byDate
    );
    await this.writeWorkoutMonth(month, next);
    return { ...entry, id: workoutId(entry), originalId: workoutId(entry) };
  }

  async deleteWorkout(id: string): Promise<void> {
    const month = id.match(/^workout:(\d{4}-\d{2})-/)?.[1];
    if (!month) {
      return;
    }
    const rows = await this.readWorkoutMonths([month]);
    await this.writeWorkoutMonth(
      month,
      rows.filter((row) => workoutId(row) !== id)
    );
  }

  async upsertDaily(entry: DailyEntry): Promise<DailyEntry> {
    const month = monthFromDate(entry.date);
    const rows = await this.readDailyMonths([month]);
    const next = upsertByDate(rows, entry);
    await this.writeDailyMonth(month, next);
    return entry;
  }

  async upsertFootball(entry: FootballEntry): Promise<FootballEntry> {
    const month = monthFromDate(entry.date);
    const rows = await this.readFootballMonths([month]);
    const next = upsertFootballActivity(rows, entry);
    await this.writeFootballMonth(month, next);
    return entry;
  }

  async upsertMacro(entry: MacroEntry): Promise<MacroEntry> {
    const rows = await this.readMacroEntries();
    const next = upsertByDate(rows, entry);
    const file = path.join(this.wikiRoot, 'alimentazione', 'diario-macro.md');
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, buildMacroFile(next), 'utf8');
    return entry;
  }

  async upsertMeasurement(entry: MeasurementEntry): Promise<MeasurementEntry> {
    const file = path.join(this.wikiRoot, 'tracking', 'misure-corpo.md');
    const text = existsSync(file) ? await readFile(file, 'utf8') : buildMeasurementFileShell();
    const rows = await this.readMeasurementEntries();
    const next = upsertByDate(rows, entry);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, replaceMeasurementSection(text, next), 'utf8');
    return entry;
  }

  async deleteMeasurement(date: string): Promise<void> {
    const file = path.join(this.wikiRoot, 'tracking', 'misure-corpo.md');
    const text = existsSync(file) ? await readFile(file, 'utf8') : buildMeasurementFileShell();
    const rows = await this.readMeasurementEntries();
    await writeFile(file, replaceMeasurementSection(text, rows.filter((row) => row.date !== date)), 'utf8');
  }

  async upsertProgression(entry: ProgressionEntry): Promise<ProgressionEntry> {
    const file = path.join(this.wikiRoot, 'tracking', 'progressione-carichi.md');
    if (!existsSync(file)) {
      throw new Error('File progressione-carichi.md non trovato.');
    }
    const text = await readFile(file, 'utf8');
    await writeFile(file, replaceProgressionRow(text, entry), 'utf8');
    return entry;
  }

  async readRecords(): Promise<RecordEntry[]> {
    const file = path.join(this.wikiRoot, 'tracking', 'record-personali.md');
    if (!existsSync(file)) {
      return [];
    }
    const text = await readFile(file, 'utf8');
    return parseRecords(text).sort(byDate);
  }

  async upsertRecord(entry: RecordEntry): Promise<RecordEntry> {
    const file = path.join(this.wikiRoot, 'tracking', 'record-personali.md');
    const text = existsSync(file) ? await readFile(file, 'utf8') : buildRecordFileShell();
    const originalId = entry.originalId || entry.id;
    const records = parseRecords(text);
    const next = [...records.filter((row) => recordId(row) !== originalId && recordKey(row) !== recordKey(entry)), entry].sort(
      byDate
    );
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, buildRecordFile(text, next), 'utf8');
    return withRecordId(entry);
  }

  async deleteRecord(id: string): Promise<void> {
    const file = path.join(this.wikiRoot, 'tracking', 'record-personali.md');
    const text = existsSync(file) ? await readFile(file, 'utf8') : buildRecordFileShell();
    const next = parseRecords(text).filter((row) => recordId(row) !== id);
    await writeFile(file, buildRecordFile(text, next), 'utf8');
  }

  async readDailyMonths(months: string[]): Promise<DailyEntry[]> {
    const entries = await Promise.all(months.map((month) => this.readDailyMonth(month)));
    return entries.flat().sort(byDate);
  }

  async readFootballMonths(months: string[]): Promise<FootballEntry[]> {
    const entries = await Promise.all(months.map((month) => this.readFootballMonth(month)));
    return entries.flat().sort(byDate);
  }

  async readDailyMonth(month: string): Promise<DailyEntry[]> {
    const file = path.join(this.wikiRoot, 'tracking', 'giornaliero', `${month}.md`);
    if (!existsSync(file)) {
      return [];
    }
    const rows = parseMarkdownTable(await readFile(file, 'utf8'));
    return rows.map(rowToDaily).filter((entry) => entry.date);
  }

  async readFootballMonth(month: string): Promise<FootballEntry[]> {
    const file = path.join(this.wikiRoot, 'tracking', 'calcio', `${month}.md`);
    if (!existsSync(file)) {
      return [];
    }
    const rows = parseMarkdownTable(await readFile(file, 'utf8'));
    return rows.map(rowToFootball).filter((entry) => entry.date);
  }

  async writeDailyMonth(month: string, entries: DailyEntry[]): Promise<void> {
    const dir = path.join(this.wikiRoot, 'tracking', 'giornaliero');
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, `${month}.md`), buildDailyFile(month, entries.sort(byDate)), 'utf8');
  }

  async writeFootballMonth(month: string, entries: FootballEntry[]): Promise<void> {
    const dir = path.join(this.wikiRoot, 'tracking', 'calcio');
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, `${month}.md`), buildFootballFile(month, entries.sort(byDate)), 'utf8');
  }

  async writeWorkoutMonth(month: string, entries: WorkoutEntry[]): Promise<void> {
    const dir = path.join(this.wikiRoot, 'tracking', 'diario');
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, `${month}.md`);
    const existing = existsSync(file) ? await readFile(file, 'utf8') : buildWorkoutFileShell(month);
    await writeFile(file, replaceWorkoutSections(existing, entries.sort(byDate)), 'utf8');
  }

  async readMacroEntries(): Promise<MacroEntry[]> {
    const file = path.join(this.wikiRoot, 'alimentazione', 'diario-macro.md');
    if (!existsSync(file)) {
      return [];
    }
    const rows = parseMarkdownTable(await readFile(file, 'utf8'));
    return rows
      .map((row) => ({
        date: row[0],
        caloriesIn: nullableNumber(row[1]),
        caloriesBurned: nullableNumber(row[2]),
        protein: nullableNumber(row[3]),
        carbs: nullableNumber(row[4]),
        fat: nullableNumber(row[5]),
        notes: nullableText(row[6])
      }))
      .filter((entry) => /^\d{4}-\d{2}-\d{2}$/.test(entry.date))
      .sort(byDate);
  }

  async readMeasurementEntries(): Promise<MeasurementEntry[]> {
    const file = path.join(this.wikiRoot, 'tracking', 'misure-corpo.md');
    if (!existsSync(file)) {
      return [];
    }
    const text = await readFile(file, 'utf8');
    const section = text.split('## Foto riferimento')[0] ?? text;
    const rows = parseMarkdownTable(section);
    return rows
      .map((row) => ({
        date: row[0],
        weight: nullableNumber(row[1]),
        waist: nullableNumber(row[2]),
        hips: nullableNumber(row[3]),
        chest: nullableNumber(row[4]),
        leftArm: nullableNumber(row[5]),
        rightArm: nullableNumber(row[6]),
        thigh: nullableNumber(row[7]),
        shoulders: nullableNumber(row[8])
      }))
      .filter((entry) => /^\d{4}-\d{2}-\d{2}$/.test(entry.date))
      .sort(byDate);
  }

  async readWorkoutMonths(months: string[]): Promise<WorkoutEntry[]> {
    const entries = await Promise.all(months.map((month) => this.readWorkoutMonth(month)));
    return entries.flat().sort(byDate);
  }

  async readWorkoutMonth(month: string): Promise<WorkoutEntry[]> {
    const file = path.join(this.wikiRoot, 'tracking', 'diario', `${month}.md`);
    if (!existsSync(file)) {
      return [];
    }
    return parseWorkoutFile(await readFile(file, 'utf8'));
  }

  async readProfile(): Promise<WikiDataPayload['profile']> {
    const file = path.join(this.wikiRoot, 'profilo', 'dati-personali-e-obiettivi.md');
    if (!existsSync(file)) return { basics: [], keyPoints: [], formulas: [], implications: '' };
    const text = await readFile(file, 'utf8');
    const basics = parseMarkdownTable(sectionByHeading(text, 'Dati di base')).map((row) => ({
      label: row[0],
      value: row[1]
    }));
    const formulas = parseMarkdownTable(sectionByHeading(text, 'BMR e TDEE')).map((row) => ({
      label: row[0],
      value: cleanWikiText(row[1])
    }));
    return {
      basics,
      keyPoints: parseBulletList(sectionByHeading(text, 'Punti chiave')),
      formulas,
      implications: sectionPlainText(sectionByHeading(text, 'Implicazioni pratiche'))
    };
  }

  async readProgression(): Promise<WikiDataPayload['progression']> {
    const file = path.join(this.wikiRoot, 'tracking', 'progressione-carichi.md');
    if (!existsSync(file)) return [];
    const text = await readFile(file, 'utf8');
    return ['Push', 'Pull', 'Legs'].map((group) => ({
      group,
      rows: parseMarkdownTable(sectionByHeading(text, group, 3)).map((row) => ({ exercise: row[0], status: row[1] }))
    }));
  }

  async readSchedule(): Promise<WikiDataPayload['schedule']> {
    const file = path.join(this.wikiRoot, 'allenamenti', 'programmazione-settimanale.md');
    if (!existsSync(file)) return [];
    const text = await readFile(file, 'utf8');
    return ['Opzione A: settimana con 2 partite', 'Opzione B: settimana con 1 partita'].map((title) => ({
      title,
      rows: parseMarkdownTable(sectionByHeading(text, title)).map((row) => ({
        day: row[0],
        workout: row[1],
        details: row[2]
      }))
    }));
  }

  async readDefinitions(): Promise<WikiDataPayload['definitions']> {
    const dir = path.join(this.wikiRoot, 'definizioni');
    if (!existsSync(dir)) return [];
    const files = (await readdir(dir)).filter((file) => file.endsWith('.md') && file !== 'indice_wiki.md');
    const definitions = await Promise.all(
      files.map(async (file) => {
        const text = await readFile(path.join(dir, file), 'utf8');
        const title = text.match(/^#\s+(.+)$/m)?.[1] ?? file.replace(/\.md$/, '');
        const summary = text.match(/## Punti chiave\s+(- .+)/s)?.[1]?.split(/\r?\n/)[0]?.replace(/^- /, '') ?? '';
        return { title, slug: file.replace(/\.md$/, ''), summary };
      })
    );
    return definitions.sort((a, b) => a.title.localeCompare(b.title));
  }

  async readWorkoutPresets(): Promise<WikiDataPayload['presets']> {
    const files = [
      ['push', 'scheda-push-abs.md'],
      ['pull', 'scheda-pull-abs.md'],
      ['legs', 'scheda-legs-abs.md']
    ] as const;
    const presets = await Promise.all(
      files.map(async ([id, file]) => {
        const fullPath = path.join(this.wikiRoot, 'allenamenti', file);
        const text = existsSync(fullPath) ? await readFile(fullPath, 'utf8') : '';
        const title = text.match(/^#\s+(.+)$/m)?.[1] ?? id.toUpperCase();
        return {
          id,
          title,
          source: `wiki/allenamenti/${file}`,
          exercises: parsePresetExercises(text)
        };
      })
    );
    return presets;
  }
}

export function resolveRepoRoot(): string {
  if (process.env.WIKI_ROOT) {
    return path.dirname(path.resolve(process.env.WIKI_ROOT));
  }
  const cwd = process.cwd();
  if (existsSync(path.join(cwd, 'wiki'))) {
    return cwd;
  }
  if (existsSync(path.join(cwd, '..', 'wiki'))) {
    return path.resolve(cwd, '..');
  }
  return cwd;
}

export function parseWorkoutFile(text: string): WorkoutEntry[] {
  const matches = [...text.matchAll(/^##\s+(\d{4}-\d{2}-\d{2})\s+-\s+(.+)$/gm)];
  return matches.map((match, index) => {
    const start = match.index ?? 0;
    const end = matches[index + 1]?.index ?? text.length;
    const section = text.slice(start, end);
    const exercises = parseMarkdownTable(section).map(rowToExercise);
    const workout = {
      id: '',
      originalId: '',
      date: match[1],
      title: match[2].trim(),
      exercises,
      volume: calculateVolume(exercises),
      averageRir: calculateAverageRir(exercises)
    };
    return { ...workout, id: workoutId(workout), originalId: workoutId(workout) };
  });
}

function rowToDaily(row: string[]): DailyEntry {
  const legacy = row.length >= 12;
  return {
    date: row[0],
    physicalRecovery: nullableNumber(row[1]),
    mentalRecovery: nullableNumber(row[2]),
    energy: legacy ? nullableNumber(row[3]) : null,
    stress: nullableNumber(row[legacy ? 4 : 3]),
    sleepQuality: nullableNumber(row[legacy ? 5 : 4]),
    doms: legacy ? nullableNumber(row[6]) : null,
    hunger: legacy ? nullableNumber(row[7]) : null,
    restingHeartRate: nullableNumber(row[legacy ? 8 : 5]),
    sleepHours: nullableNumber(row[legacy ? 9 : 6]),
    steps: nullableNumber(row[legacy ? 10 : 7]),
    notes: nullableText(row[legacy ? 11 : 8])
  };
}

function rowToFootball(row: string[]): FootballEntry {
  const hasLabelColumn = row.length >= 13;
  return {
    date: row[0],
    kind: row[1] === 'allenamento' ? 'allenamento' : 'partita',
    label: hasLabelColumn ? nullableText(row[2]) : '',
    durationMin: nullableNumber(row[hasLabelColumn ? 3 : 2]),
    avgPace: nullableText(row[hasLabelColumn ? 4 : 3]),
    avgHeartRate: nullableNumber(row[hasLabelColumn ? 5 : 4]),
    calories: nullableNumber(row[hasLabelColumn ? 6 : 5]),
    trainingLoad: nullableNumber(row[hasLabelColumn ? 7 : 6]),
    cadenceAvg: nullableNumber(row[hasLabelColumn ? 8 : 7]),
    cadenceMax: nullableNumber(row[hasLabelColumn ? 9 : 8]),
    strideAvg: nullableNumber(row[hasLabelColumn ? 10 : 9]),
    strideMax: nullableNumber(row[hasLabelColumn ? 11 : 10]),
    notes: nullableText(row[hasLabelColumn ? 12 : 11])
  };
}

function rowToExercise(row: string[]): ExerciseEntry {
  return {
    exercise: row[0] ?? '',
    sets: nullableNumber(row[1]),
    reps: nullableText(row[2]),
    weight: nullableText(row[3]),
    rir: nullableText(row[4]),
    notes: nullableText(row[5])
  };
}

function sectionByHeading(text: string, heading: string, level = 2): string {
  const lines = text.split(/\r?\n/);
  const marker = `${'#'.repeat(level)} ${heading}`.trim().toLowerCase();
  const start = lines.findIndex((line) => line.trim().toLowerCase() === marker);
  if (start < 0) return '';
  const end = lines.findIndex((line, index) => index > start && /^#{1,3}\s+/.test(line));
  return lines.slice(start, end < 0 ? undefined : end).join('\n');
}

function replaceProgressionRow(text: string, entry: ProgressionEntry): string {
  const lines = text.split(/\r?\n/);
  const heading = `### ${entry.group}`.toLowerCase();
  const start = lines.findIndex((line) => line.trim().toLowerCase() === heading);
  if (start < 0) {
    throw new Error(`Sezione ${entry.group} non trovata in progressione-carichi.md.`);
  }
  const end = lines.findIndex((line, index) => index > start && /^#{1,3}\s+/.test(line));
  const sectionEnd = end < 0 ? lines.length : end;
  const rowIndex = lines.findIndex((line, index) => {
    if (index <= start || index >= sectionEnd) return false;
    const row = parseMarkdownTable(`| Esercizio | Stato |\n| :--- | :--- |\n${line}`)[0];
    return row?.[0]?.trim().toLowerCase() === entry.exercise.trim().toLowerCase();
  });
  const nextRow = `| ${escapeCell(entry.exercise)} | ${escapeCell(entry.status)} |`;
  if (rowIndex >= 0) {
    lines[rowIndex] = nextRow;
  } else {
    let insertAt = start + 1;
    for (let index = start + 1; index < sectionEnd; index += 1) {
      if (lines[index].trim().startsWith('|')) {
        insertAt = index + 1;
      }
    }
    lines.splice(insertAt, 0, nextRow);
  }
  return lines.join('\n');
}

function replaceMeasurementSection(text: string, rows: MeasurementEntry[]): string {
  const section = buildMeasurementSection(rows);
  const start = text.search(/^##\s+Misure\s*$/m);
  if (start < 0) {
    return [text.trimEnd(), section].join('\n\n') + '\n';
  }
  const afterStart = text.slice(start + 1);
  const nextRelative = afterStart.search(/\n##\s+/);
  const end = nextRelative < 0 ? text.length : start + 1 + nextRelative;
  return [text.slice(0, start).trimEnd(), section, text.slice(end).trimStart()].filter(Boolean).join('\n\n').trimEnd() + '\n';
}

function buildMeasurementSection(rows: MeasurementEntry[]): string {
  return [
    '## Misure',
    '',
    `| ${measurementColumns.join(' | ')} |`,
    `| ${measurementColumns.map(() => ':---').join(' | ')} |`,
    ...rows.sort(byDate).map((row) => `| ${measurementToRow(row).map(escapeCell).join(' | ')} |`)
  ].join('\n');
}

function buildMeasurementFileShell(): string {
  return [
    '---',
    'tags: [tracking, misure, ricomposizione-corporea]',
    `data_creazione: ${format(new Date(), 'yyyy-MM-dd')}`,
    `data_aggiornamento: ${format(new Date(), 'yyyy-MM-dd')}`,
    'fonti: []',
    '---',
    '# Misure corpo',
    '',
    'Registro delle misure corporee usate per valutare la ricomposizione nel tempo.',
    '',
    '## Foto riferimento',
    '',
    '| Data | Percorso file/foto | Note |',
    '| :--- | :--- | :--- |',
    '',
    '## Fonti',
    '',
    "- Nessuna fonte esterna: dati inseriti manualmente dall'utente.",
    ''
  ].join('\n');
}

function parseBulletList(section: string): string[] {
  return section
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- '))
    .map((line) => cleanWikiText(line.replace(/^- /, '')));
}

function sectionPlainText(section: string): string {
  return cleanWikiText(
    section
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .join(' ')
  );
}

function cleanWikiText(value: string): string {
  return value.replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, '$1').replace(/`/g, '');
}

function parsePresetExercises(text: string): ExerciseEntry[] {
  const sections = [...text.matchAll(/^##\s+Workout .+$/gm)];
  return sections.flatMap((match, index) => {
    const start = match.index ?? 0;
    const end = sections[index + 1]?.index ?? text.indexOf('\n## Articoli correlati', start);
    const section = text.slice(start, end > start ? end : text.length);
    return parseMarkdownTable(section).map((row) => {
      const parsed = parseSetsAndReps(row[1]);
      const note = [nullableText(row[2]) ? `Recupero: ${nullableText(row[2])}` : '', nullableText(row[3])].filter(Boolean).join(' - ');
      return {
        exercise: nullableText(row[0]),
        sets: parsed.sets,
        reps: parsed.reps,
        weight: '',
        rir: '',
        notes: note
      };
    });
  });
}

function parseSetsAndReps(value: string): { sets: number | null; reps: string } {
  const raw = nullableText(value);
  const match = raw.match(/^(\d+)\s*x\s*(.+)$/i);
  return match ? { sets: Number(match[1]), reps: match[2].trim() } : { sets: null, reps: raw };
}

function parseRecords(text: string): RecordEntry[] {
  const sectionRecords = [...text.matchAll(/^##\s+(Corpo libero|Pesi|Core e resistenza|Calcio|Workout|Altro)\s*$/gim)].flatMap(
    (match, index, matches) => {
      const start = match.index ?? 0;
      const end = matches[index + 1]?.index ?? text.indexOf('\n## Articoli correlati', start);
      const section = text.slice(start, end > start ? end : text.length);
      return parseMarkdownTable(section)
        .map((row) => {
          const sectionName = match[1].toLowerCase();
          const isWeights = sectionName === 'pesi';
          const record = {
            id: '',
            originalId: '',
            date: normalizeRecordDate(row[2]),
            category: normalizeRecordCategory(sectionName === 'core e resistenza' ? 'core' : sectionName),
            discipline: isWeights ? 'workout' : '',
            name: nullableText(row[0]),
            value: nullableText(row[1]),
            unit: '',
            context: isWeights ? nullableText(row[0]) : '',
            notes: nullableText(row[3])
          };
          return withRecordId(record);
        })
        .filter((entry) => entry.date && entry.name && entry.value && !/da popolare/i.test(entry.value));
    }
  );

  const merged = new Map<string, RecordEntry>();
  for (const record of [...sectionRecords, ...parseDashboardRecords(text)]) {
    merged.set(recordKey(record), record);
  }
  return [...merged.values()];
}

function parseDashboardRecords(text: string): RecordEntry[] {
  const section = text.match(/## Record dashboard[\s\S]*?(?=\n## |\s*$)/)?.[0] ?? '';
  return parseMarkdownTable(section)
    .map((row) =>
      withRecordId({
        id: '',
        originalId: '',
        date: normalizeRecordDate(row[0]),
        category: normalizeRecordCategory(row[1]),
        discipline: nullableText(row[2]),
        name: nullableText(row[3]),
        value: [nullableText(row[4]), nullableText(row[5])].filter(Boolean).join(' '),
        unit: nullableText(row[5]),
        context: nullableText(row[6]),
        notes: nullableText(row[7])
      })
    )
    .filter((entry) => entry.date && entry.name && entry.value);
}

function buildRecordFile(text: string, rows: RecordEntry[]): string {
  const cleanText = text.replace(/\n## Record dashboard[\s\S]*?(?=\n## |\s*$)/, '').trimEnd();
  const sectionIndex = findIndexOrInfinity(cleanText.search(/\n##\s+(Corpo libero|Pesi|Core e resistenza|Calcio|Workout|Altro)\s*$/m));
  const tailIndex = findIndexOrInfinity(cleanText.search(/\n## Articoli correlati\s*$/m));
  const cutIndex = Math.min(sectionIndex, tailIndex);
  const beforeSections = (cutIndex === Infinity ? cleanText : cleanText.slice(0, cutIndex)).trimEnd();
  const tail =
    tailIndex !== Infinity
      ? cleanText.slice(tailIndex).replace(/\n##\s+(Corpo libero|Pesi|Core e resistenza|Calcio|Workout|Altro)[\s\S]*?(?=\n## |\s*$)/gm, '').trimStart()
      : '## Articoli correlati\n\n- [[diario-allenamenti]]';
  return [beforeSections, buildRecordSections(rows), tail].filter(Boolean).join('\n\n').trimEnd() + '\n';
}

function findIndexOrInfinity(index: number): number {
  return index < 0 ? Infinity : index;
}

function buildRecordSections(rows: RecordEntry[]): string {
  const groups: Array<[RecordEntry['category'], string, boolean]> = [
    ['corpo libero', 'Corpo libero', false],
    ['pesi', 'Pesi', true],
    ['core', 'Core e resistenza', false],
    ['calcio', 'Calcio', false],
    ['workout', 'Workout', false],
    ['altro', 'Altro', false]
  ];

  return groups
    .map(([category, title, isWeights]) => {
      const records = rows.filter((row) => row.category === category);
      if (records.length === 0 && !['corpo libero', 'pesi', 'core'].includes(category)) {
        return '';
      }
      const header = isWeights
        ? '| Esercizio | Record | Data | Note |\n| :--- | :--- | :--- | :--- |'
        : '| Record | Valore | Data | Note |\n| :--- | :--- | :--- | :--- |';
      const lines = records.map((record) => {
        const note = [record.context && category !== 'pesi' ? record.context : '', record.notes].filter(Boolean).join(' - ');
        const value = [record.value, record.unit].filter(Boolean).join(' ');
        return `| ${[record.name, value, record.date, note].map((cell) => String(cell).replace(/\|/g, '/')).join(' | ')} |`;
      });
      return [`## ${title}`, '', header, ...lines].join('\n');
    })
    .filter(Boolean)
    .join('\n\n');
}

function buildRecordFileShell(): string {
  return [
    '---',
    'tags: [tracking, record, allenamento]',
    `data_creazione: ${format(new Date(), 'yyyy-MM-dd')}`,
    `data_aggiornamento: ${format(new Date(), 'yyyy-MM-dd')}`,
    'fonti: []',
    '---',
    '# Record personali',
    '',
    'Registro dei migliori risultati personali.',
    '',
    '## Articoli correlati',
    '',
    '- [[diario-allenamenti]]',
    ''
  ].join('\n');
}

function buildWorkoutFileShell(month: string): string {
  return [
    '---',
    'tags: [tracking, allenamento, diario]',
    `data_creazione: ${format(new Date(), 'yyyy-MM-dd')}`,
    `data_aggiornamento: ${format(new Date(), 'yyyy-MM-dd')}`,
    'fonti: []',
    '---',
    `# Diario allenamenti - ${month}`,
    '',
    'Sessioni tracciate nel mese.',
    '',
    '## Articoli correlati',
    '',
    '- [[diario-allenamenti]]',
    ''
  ].join('\n');
}

function replaceWorkoutSections(text: string, rows: WorkoutEntry[]): string {
  const firstWorkout = text.search(/^##\s+\d{4}-\d{2}-\d{2}\s+-\s+.+$/m);
  const articles = text.search(/^##\s+Articoli correlati\s*$/m);
  const before = (firstWorkout >= 0 ? text.slice(0, firstWorkout) : articles >= 0 ? text.slice(0, articles) : text).trimEnd();
  const after = articles >= 0 ? text.slice(articles).trimStart() : '';
  const sections = rows.map(buildWorkoutSection).join('\n');
  return [before, sections, after].filter(Boolean).join('\n\n').trimEnd() + '\n';
}

function workoutId(entry: Pick<WorkoutEntry, 'date' | 'title'>): string {
  return `workout:${entry.date}:${entry.title.trim().toLowerCase()}`;
}

function withRecordId(entry: RecordEntry): RecordEntry {
  const id = recordId(entry);
  return { ...entry, id, originalId: entry.originalId || id };
}

function normalizeRecordDate(value: string): string {
  const raw = nullableText(value).replace(/\//g, '-');
  const match = raw.match(/\d{4}-\d{2}-\d{2}/);
  return match?.[0] ?? '';
}

function normalizeRecordCategory(value: string): RecordEntry['category'] {
  const raw = nullableText(value).toLowerCase();
  if (raw === 'calcio') return 'calcio';
  if (raw === 'corpo libero') return 'corpo libero';
  if (raw === 'pesi') return 'pesi';
  if (raw === 'core' || raw === 'core e resistenza') return 'core';
  if (raw === 'altro') return 'altro';
  return 'workout';
}

function calculateVolume(exercises: ExerciseEntry[]): number | null {
  const total = exercises.reduce((sum, exercise) => {
    const reps = exercise.reps
      .split('/')
      .map((part) => nullableNumber(part))
      .filter((value): value is number => value !== null)
      .reduce((inner, value) => inner + value, 0);
    return sum + reps;
  }, 0);
  return total > 0 ? total : null;
}

function calculateAverageRir(exercises: ExerciseEntry[]): number | null {
  const values = exercises
    .map((exercise) => {
      const nums = exercise.rir.match(/\d+(\.\d+)?/g)?.map(Number) ?? [];
      if (nums.length === 0) {
        return null;
      }
      return nums.reduce((sum, value) => sum + value, 0) / nums.length;
    })
    .filter((value): value is number => value !== null);
  return values.length ? round(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
}

function getRange(date: string, period: DashboardPeriod): { from: string; to: string } {
  const selected = parseISO(date);
  const today = new Date();
  if (period === 'day') {
    return {
      from: format(selected, 'yyyy-MM-dd'),
      to: format(selected, 'yyyy-MM-dd')
    };
  }
  if (period === 'week') {
    const base = selected > today ? today : selected;
    return {
      from: format(startOfWeek(base, { weekStartsOn: 1 }), 'yyyy-MM-dd'),
      to: format(endOfWeek(base, { weekStartsOn: 1 }), 'yyyy-MM-dd')
    };
  }
  const base = selected > today ? today : selected;
  return {
    from: format(startOfMonth(base), 'yyyy-MM-dd'),
    to: format(endOfMonth(base), 'yyyy-MM-dd')
  };
}

function monthsBetween(from: string, to: string): string[] {
  const start = parseISO(`${monthFromDate(from)}-01`);
  const end = parseISO(`${monthFromDate(to)}-01`);
  const months: string[] = [];
  for (let cursor = start; cursor <= end; cursor = addDays(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1), 0)) {
    months.push(format(cursor, 'yyyy-MM'));
  }
  return months;
}

function averageSeries(series: DashboardPayload['series']): Record<string, number | null> {
  const keys = [
    'physicalRecovery',
    'mentalRecovery',
    'energy',
    'stress',
    'sleepQuality',
    'doms',
    'hunger',
    'restingHeartRate',
    'sleepHours',
    'steps',
    'caloriesIn',
    'caloriesBurned',
    'protein',
    'carbs',
    'fat',
    'weight'
  ] as const;

  return Object.fromEntries(
    keys.map((key) => {
      const values = series.map((row) => row[key]).filter((value): value is number => value !== null);
      return [key, values.length ? round(values.reduce((sum, value) => sum + value, 0) / values.length) : null];
    })
  );
}

function latestOnOrBefore<T extends { date: string }>(entries: T[], date: string): T | null {
  return entries.filter((entry) => entry.date <= date).at(-1) ?? null;
}

function upsertByDate<T extends { date: string }>(rows: T[], entry: T): T[] {
  return [...rows.filter((row) => row.date !== entry.date), entry].sort(byDate);
}

function upsertFootballActivity(rows: FootballEntry[], entry: FootballEntry): FootballEntry[] {
  const key = footballKey(entry);
  return [...rows.filter((row) => footballKey(row) !== key), entry].sort(byDate);
}

function footballKey(entry: FootballEntry): string {
  return [entry.date, entry.kind, entry.label.trim().toLowerCase()].join('|');
}

function recordId(entry: RecordEntry): string {
  return `record:${recordKey(entry)}`;
}

function recordKey(entry: RecordEntry): string {
  return [entry.date, entry.category, entry.discipline, entry.name].map((part) => part.trim().toLowerCase()).join('|');
}

function groupByDate<T extends { date: string }>(rows: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    map.set(row.date, [...(map.get(row.date) ?? []), row]);
  }
  return map;
}

function byDate(a: { date: string }, b: { date: string }): number {
  return a.date.localeCompare(b.date);
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
