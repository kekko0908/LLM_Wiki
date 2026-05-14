import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { askProjectAi, collectProjectContextForTest, extractClarifications, extractWriteProposals, resolveAiMode } from '../aiAssistant';
import { parseWorkoutFile, WikiStore } from '../wikiStore';

describe('wiki markdown parsing', () => {
  it('parses workout sections and computes basic summaries', () => {
    const workouts = parseWorkoutFile(`
## 2026-05-11 - Scheda PULL

| Esercizio | Serie | Ripetizioni | Peso | RIR | Note |
| :--- | :--- | :--- | :--- | :--- | :--- |
| Rematore | 3 | 11 / 11 / 12 | 15 kg | 1-2 |  |
| Curl | 3 | 10 / 10 / 10 | 7.5 kg | 2 |  |
`);

    expect(workouts).toHaveLength(1);
    expect(workouts[0].date).toBe('2026-05-11');
    expect(workouts[0].volume).toBe(64);
    expect(workouts[0].averageRir).toBe(1.8);
  });
});

describe('local AI retrieval', () => {
  it('searches only wiki markdown and ignores project files outside wiki', async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'kernel-dashboard-'));
    await mkdir(path.join(repoRoot, 'wiki', 'tracking'), { recursive: true });
    await mkdir(path.join(repoRoot, 'venv', 'Lib'), { recursive: true });
    await mkdir(path.join(repoRoot, 'dashboard', 'server'), { recursive: true });
    await writeFile(
      path.join(repoRoot, 'qwen.md'),
      `
## Workflow: Consultazione
Usa la wiki.

### Promemoria tracking obbligatorio
Mostra un reminder sempre.

### Domanda settimanale consigliata
Template lungo.

## Workflow: Audit / Lint
Controlla la KB.
`,
      'utf8'
    );
    await writeFile(
      path.join(repoRoot, 'wiki', 'tracking', 'progressione-carichi.md'),
      'Push-up 3x10 @ corpo libero, RIR 2-3 -> mantieni',
      'utf8'
    );
    await writeFile(path.join(repoRoot, 'venv', 'Lib', 'noise.json'), '{"push-up":"non canonico"}', 'utf8');
    await writeFile(path.join(repoRoot, '.aider.chat.history.md'), 'push-up rumore', 'utf8');
    await writeFile(path.join(repoRoot, 'dashboard', 'server', 'wikiStore.ts'), 'push-up codice non canonico', 'utf8');

    const context = await collectProjectContextForTest(repoRoot, 'come gestisco progressione push-up');
    expect(context.sources).toContain('wiki/tracking/progressione-carichi.md');
    expect(context.sources).not.toContain('qwen.md');
    expect(context.sources.some((source) => source.includes('dashboard'))).toBe(false);
    expect(context.sources.some((source) => source.includes('venv'))).toBe(false);
    expect(context.sources.some((source) => source.includes('.aider'))).toBe(false);
    expect(context.text).toContain('Usa la wiki.');
    expect(context.text).not.toContain('Mostra un reminder sempre');

    await rm(repoRoot, { recursive: true, force: true });
  });

  it('prioritizes wiki training files and excludes dashboard code for workout questions', async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'kernel-dashboard-'));
    await mkdir(path.join(repoRoot, 'wiki', 'tracking'), { recursive: true });
    await mkdir(path.join(repoRoot, 'wiki', 'allenamenti'), { recursive: true });
    await mkdir(path.join(repoRoot, 'dashboard', 'server'), { recursive: true });
    await writeFile(path.join(repoRoot, 'qwen.md'), 'Usa la wiki come fonte primaria.', 'utf8');
    await writeFile(
      path.join(repoRoot, 'wiki', 'tracking', 'progressione-carichi.md'),
      'Push-up 3x10 @ corpo libero, RIR 2-3 -> se fai 3x15 pulito aumenta o mantieni in base al RIR.',
      'utf8'
    );
    await writeFile(
      path.join(repoRoot, 'wiki', 'allenamenti', 'scheda-push-abs.md'),
      'Scheda push con push-up, military press e progressione sulle ripetizioni.',
      'utf8'
    );
    await writeFile(
      path.join(repoRoot, 'dashboard', 'server', 'wikiStore.ts'),
      'progressione progressione progressione push-up workout dashboard codice test',
      'utf8'
    );

    const context = await collectProjectContextForTest(
      repoRoot,
      'oggi ho aumentato di 1 ripetizione i push-up come gestisco la progressione'
    );
    expect(context.sources.slice(0, 2)).toEqual([
      'wiki/tracking/progressione-carichi.md',
      'wiki/allenamenti/scheda-push-abs.md'
    ]);
    expect(context.sources).not.toContain('dashboard/server/wikiStore.ts');

    await rm(repoRoot, { recursive: true, force: true });
  });

  it('refuses questions outside the wiki domain without calling the local model', async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'kernel-dashboard-'));
    const response = await askProjectAi(repoRoot, [{ role: 'user', content: 'spiegami come funziona React' }]);
    expect(response.sources).toEqual([]);
    expect(response.answer).toContain('solo su dati e contenuti della wiki locale');

    await rm(repoRoot, { recursive: true, force: true });
  });

  it('maps sleep quality wording to sleepQuality instead of sleepHours', () => {
    const proposals = extractWriteProposals('oggi qualita del sonno 91', '2026-05-13');
    expect(proposals[0]).toMatchObject({
      type: 'daily',
      date: '2026-05-13',
      fields: { sleepQuality: 91 }
    });
    expect(proposals[0].fields).not.toHaveProperty('sleepHours');
  });

  it('asks a clarification for ambiguous sleep wording', () => {
    const clarifications = extractClarifications(
      'inserisci sonno 8',
      '2026-05-13',
      [],
      'Prima di salvare: intendi registrare 8 ore di sonno oppure una qualita del sonno pari a 8/100?'
    );
    expect(clarifications[0]).toMatchObject({
      question: 'Prima di salvare: intendi registrare 8 ore di sonno oppure una qualita del sonno pari a 8/100?'
    });
    expect(clarifications[0].options.map((option) => option.label)).toEqual(['Qualita sonno 8/100', 'Ore sonno 8h']);
  });

  it('creates relative-date proposals for rest and generic football intent', () => {
    const proposals = extractWriteProposals('ieri REST e oggi faccio calcio', '2026-05-14');
    expect(proposals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'daily',
          date: '2026-05-13',
          fields: expect.objectContaining({ notes: 'REST' })
        }),
        expect.objectContaining({
          type: 'football',
          date: '2026-05-14',
          fields: expect.objectContaining({ kind: 'allenamento', label: 'Calcio' })
        })
      ])
    );
  });

  it('keeps planning questions in coach mode instead of creating write proposals', () => {
    expect(resolveAiMode('oggi devo fare calcio domani che allenamento faccio?')).toBe('coach');
    expect(resolveAiMode('oggi faccio calcio')).toBe('auditor');
  });

  it('includes canonical tracking and nutrition files for body recomposition questions', async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'kernel-dashboard-'));
    await mkdir(path.join(repoRoot, 'wiki', 'alimentazione'), { recursive: true });
    await mkdir(path.join(repoRoot, 'wiki', 'profilo'), { recursive: true });
    await mkdir(path.join(repoRoot, 'wiki', 'tracking', 'giornaliero'), { recursive: true });
    await mkdir(path.join(repoRoot, 'wiki', 'tracking', 'diario'), { recursive: true });
    await mkdir(path.join(repoRoot, 'wiki', 'allenamenti'), { recursive: true });
    await writeFile(path.join(repoRoot, 'qwen.md'), 'Modalita consultazione wiki.', 'utf8');
    await writeFile(
      path.join(repoRoot, 'wiki', 'alimentazione', 'diario-macro.md'),
      `
| Data | Kcal consumate totali | Kcal bruciate | Proteine | Carboidrati | Grassi |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 2026-05-12 | 1500 | 420 | 140 | 180 | 40 |
`,
      'utf8'
    );
    await writeFile(path.join(repoRoot, 'wiki', 'profilo', 'dati-personali-e-obiettivi.md'), 'Obiettivo ricomposizione corporea.', 'utf8');
    await writeFile(path.join(repoRoot, 'wiki', 'tracking', 'misure-corpo.md'), '| Data | Peso | Vita |', 'utf8');
    await writeFile(path.join(repoRoot, 'wiki', 'tracking', 'check-in-settimanali.md'), '| Macro | Allenamenti | Recupero |', 'utf8');
    await writeFile(path.join(repoRoot, 'wiki', 'tracking', 'progressione-carichi.md'), '| Esercizio | Stato |', 'utf8');
    await writeFile(path.join(repoRoot, 'wiki', 'tracking', 'giornaliero', '2026-05.md'), '| Data | Recupero fisico |', 'utf8');
    await writeFile(path.join(repoRoot, 'wiki', 'tracking', 'diario', '2026-05.md'), '## 2026-05-12 - Scheda PUSH', 'utf8');
    await writeFile(
      path.join(repoRoot, 'wiki', 'allenamenti', 'allenamento-per-ricomposizione-corporea.md'),
      'Forza, NEAT e dieta per ricomposizione.',
      'utf8'
    );
    await writeFile(path.join(repoRoot, 'wiki', 'allenamenti', 'indice_wiki.md'), 'allenamento teoria', 'utf8');

    const context = await collectProjectContextForTest(
      repoRoot,
      'cosa pensi del mio percorso di allenamento e di kcal protein carbo grassi assunti fino ad ora per ricomposizione corporea?'
    );

    expect(context.sources).toContain('wiki/alimentazione/diario-macro.md');
    expect(context.sources).toContain('wiki/profilo/dati-personali-e-obiettivi.md');
    expect(context.sources).toContain('wiki/tracking/misure-corpo.md');
    expect(context.sources).toContain('wiki/tracking/check-in-settimanali.md');
    expect(context.sources).toContain('wiki/tracking/giornaliero/2026-05.md');
    expect(context.sources).toContain('wiki/tracking/diario/2026-05.md');
    expect(context.sources.slice(0, 4)).toEqual([
      'wiki/alimentazione/diario-macro.md',
      'wiki/profilo/dati-personali-e-obiettivi.md',
      'wiki/tracking/misure-corpo.md',
      'wiki/tracking/check-in-settimanali.md'
    ]);
    expect(context.text).toContain('## Sintesi numerica dai registri wiki');
    expect(context.text).toContain('Macro registrate');

    await rm(repoRoot, { recursive: true, force: true });
  });
});

describe('wiki store', () => {
  it('writes daily entries to monthly markdown ordered by date', async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'kernel-dashboard-'));
    const store = new WikiStore(repoRoot);

    await store.upsertDaily({
      date: '2026-05-12',
      physicalRecovery: 80,
      mentalRecovery: 75,
      energy: 70,
      stress: 35,
      sleepQuality: 82,
      doms: 25,
      hunger: 45,
      restingHeartRate: 58,
      sleepHours: 7.5,
      steps: 9000,
      notes: 'ok'
    });
    await store.upsertDaily({
      date: '2026-05-10',
      physicalRecovery: 65,
      mentalRecovery: null,
      energy: null,
      stress: null,
      sleepQuality: null,
      doms: null,
      hunger: null,
      restingHeartRate: null,
      sleepHours: null,
      steps: null,
      notes: ''
    });

    const file = await readFile(path.join(repoRoot, 'wiki', 'tracking', 'giornaliero', '2026-05.md'), 'utf8');
    expect(file.indexOf('| 2026-05-10 |')).toBeLessThan(file.indexOf('| 2026-05-12 |'));
    expect(file).toContain('| 2026-05-12 | 80 | 75 | 35 | 82 | 58 | 7.5 | 9000 | ok |');

    await rm(repoRoot, { recursive: true, force: true });
  });

  it('ignores x values when computing dashboard averages', async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'kernel-dashboard-'));
    const store = new WikiStore(repoRoot);
    const macroDir = path.join(repoRoot, 'wiki', 'alimentazione');
    await mkdir(macroDir, { recursive: true });
    await writeFile(
      path.join(macroDir, 'diario-macro.md'),
      `
| Data | Kcal consumate totali | Kcal bruciate | Proteine | Carboidrati | Grassi | Note |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 2026-05-11 | 1450 | 500 | 146 | 196 | 26 | |
| 2026-05-12 | x | x | x | x | x | |
`,
      'utf8'
    );

    const payload = await store.getDashboard('2026-05-12', 'week');
    expect(payload.averages.caloriesIn).toBe(1450);
    expect(payload.macro?.caloriesIn).toBeNull();

    await rm(repoRoot, { recursive: true, force: true });
  });

  it('parses legacy daily tables and writes the current compact daily format', async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'kernel-dashboard-'));
    const store = new WikiStore(repoRoot);
    const dailyDir = path.join(repoRoot, 'wiki', 'tracking', 'giornaliero');
    await mkdir(dailyDir, { recursive: true });
    await writeFile(
      path.join(dailyDir, '2026-05.md'),
      `
| Data | Recupero fisico | Recupero mentale | Energia | Stress | Qualita sonno | DOMS | Fame | FC riposo | Ore sonno | Passi | Note |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 2026-05-12 | 93 | 86 |  | 41 | 91 |  |  | 61 | 8.15 | 3500 | ok |
`,
      'utf8'
    );

    const rows = await store.readDailyMonths(['2026-05']);
    expect(rows[0].stress).toBe(41);
    expect(rows[0].energy).toBeNull();
    await store.upsertDaily(rows[0]);
    const file = await readFile(path.join(dailyDir, '2026-05.md'), 'utf8');
    expect(file).toContain('| Data | Recupero fisico | Recupero mentale | Stress | Qualita sonno | FC riposo | Ore sonno | Passi | Note |');
    expect(file).not.toContain('DOMS');
    expect(file).toContain('| 2026-05-12 | 93 | 86 | 41 | 91 | 61 | 8.15 | 3500 | ok |');

    await rm(repoRoot, { recursive: true, force: true });
  });

  it('returns workouts inside the selected dashboard range', async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'kernel-dashboard-'));
    const store = new WikiStore(repoRoot);
    const workoutDir = path.join(repoRoot, 'wiki', 'tracking', 'diario');
    await mkdir(workoutDir, { recursive: true });
    await writeFile(
      path.join(workoutDir, '2026-05.md'),
      `
## 2026-05-11 - Scheda PULL

| Esercizio | Serie | Ripetizioni | Peso | RIR | Note |
| :--- | :--- | :--- | :--- | :--- | :--- |
| Rematore | 3 | 11 / 11 / 11 | 15 kg | 1-2 | |

## 2026-05-08 - Scheda LEGS

| Esercizio | Serie | Ripetizioni | Peso | RIR | Note |
| :--- | :--- | :--- | :--- | :--- | :--- |
| Squat | 3 | 10 / 10 / 10 | 15 kg | 2 | |
`,
      'utf8'
    );

    const payload = await store.getDashboard('2026-05-12', 'week');
    expect(payload.workout).toBeNull();
    expect(payload.range).toEqual({ from: '2026-05-11', to: '2026-05-17' });
    expect(payload.workouts.map((workout) => workout.date)).toEqual(['2026-05-11']);

    await rm(repoRoot, { recursive: true, force: true });
  });

  it('returns reactive coach insights from dashboard data', async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'kernel-dashboard-'));
    const store = new WikiStore(repoRoot);
    await mkdir(path.join(repoRoot, 'wiki', 'profilo'), { recursive: true });
    await mkdir(path.join(repoRoot, 'wiki', 'tracking', 'giornaliero'), { recursive: true });
    await mkdir(path.join(repoRoot, 'wiki', 'tracking', 'diario'), { recursive: true });
    await mkdir(path.join(repoRoot, 'wiki', 'tracking'), { recursive: true });
    await mkdir(path.join(repoRoot, 'wiki', 'alimentazione'), { recursive: true });

    await writeFile(
      path.join(repoRoot, 'wiki', 'profilo', 'dati-personali-e-obiettivi.md'),
      `
## Dati di base

| Dato | Valore |
| :--- | :--- |
| Peso | 82 kg |
| BMR | 1.786 kcal/giorno |
`,
      'utf8'
    );
    await writeFile(
      path.join(repoRoot, 'wiki', 'tracking', 'giornaliero', '2026-05.md'),
      `
| Data | Recupero fisico | Recupero mentale | Stress | Qualita sonno | FC riposo | Ore sonno | Passi | Note |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 2026-05-11 | 92 | 86 | 35 | 88 | 58 | 8 | 5000 | |
`,
      'utf8'
    );
    await writeFile(
      path.join(repoRoot, 'wiki', 'alimentazione', 'diario-macro.md'),
      `
| Data | Kcal consumate totali | Kcal bruciate | Proteine | Carboidrati | Grassi | Note |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 2026-05-11 | 1450 | 500 | 146 | 196 | 26 | |
`,
      'utf8'
    );
    await writeFile(
      path.join(repoRoot, 'wiki', 'tracking', 'diario', '2026-05.md'),
      `
## 2026-05-11 - Scheda PULL

| Esercizio | Serie | Ripetizioni | Peso | RIR | Note |
| :--- | :--- | :--- | :--- | :--- | :--- |
| Rematore | 3 | 11 / 11 / 11 | 15 kg | 2 | |
`,
      'utf8'
    );
    await writeFile(
      path.join(repoRoot, 'wiki', 'tracking', 'progressione-carichi.md'),
      `
### Pull

| Esercizio | Stato |
| :--- | :--- |
| Rematore | 3x10 @ 15 kg, RIR 1-2 -> mantieni |
`,
      'utf8'
    );

    const payload = await store.getDashboard('2026-05-11', 'week');
    expect(payload.coach.targets.proteinMin).toBe(131);
    expect(payload.coach.insights.map((insight) => insight.id)).toContain('calorie-low');
    expect(payload.coach.insights.some((insight) => insight.category === 'progression')).toBe(true);

    await rm(repoRoot, { recursive: true, force: true });
  });

  it('protects legs in the dynamic plan when football is registered today', async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'kernel-dashboard-'));
    const store = new WikiStore(repoRoot);
    await mkdir(path.join(repoRoot, 'wiki', 'profilo'), { recursive: true });
    await mkdir(path.join(repoRoot, 'wiki', 'tracking', 'giornaliero'), { recursive: true });
    await mkdir(path.join(repoRoot, 'wiki', 'tracking', 'diario'), { recursive: true });
    await mkdir(path.join(repoRoot, 'wiki', 'tracking', 'calcio'), { recursive: true });

    await writeFile(
      path.join(repoRoot, 'wiki', 'profilo', 'dati-personali-e-obiettivi.md'),
      `
## Dati di base

| Dato | Valore |
| :--- | :--- |
| Peso | 82 kg |
| BMR | 1.786 kcal/giorno |
`,
      'utf8'
    );
    await writeFile(
      path.join(repoRoot, 'wiki', 'tracking', 'giornaliero', '2026-05.md'),
      `
| Data | Recupero fisico | Recupero mentale | Stress | Qualita sonno | FC riposo | Ore sonno | Passi | Note |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 2026-05-13 | 92 | 86 | 35 | 88 | 58 | 8 | 9000 | REST |
| 2026-05-14 | 90 | 84 | 40 | 87 | 59 | 7.5 | 3000 | |
`,
      'utf8'
    );
    await writeFile(
      path.join(repoRoot, 'wiki', 'tracking', 'diario', '2026-05.md'),
      `
## 2026-05-12 - Scheda PUSH

| Esercizio | Serie | Ripetizioni | Peso | RIR | Note |
| :--- | :--- | :--- | :--- | :--- | :--- |
| Military press | 3 | 10 / 10 / 10 | 7.5 kg | 2 | |
`,
      'utf8'
    );
    await writeFile(
      path.join(repoRoot, 'wiki', 'tracking', 'calcio', '2026-05.md'),
      `
| Data | Tipo | Nome attivita | Tempo min | Ritmo medio | FC media | Kcal bruciate | Carico allenamento | Cadenza media | Cadenza max | Falcata media | Falcata max | Note |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 2026-05-14 | allenamento | Calcio | 60 | | | | | | | | | |
`,
      'utf8'
    );

    const payload = await store.getDashboard('2026-05-14', 'week');
    expect(payload.coach.plan.mode).toBe('protect-legs');
    expect(payload.coach.plan.today).toContain('CALCIO');
    expect(payload.coach.plan.nextWorkout).not.toBe('LEGS');
    expect(payload.coach.plan.calendar.find((day) => day.date === '2026-05-14')).toMatchObject({
      workout: 'CALCIO',
      source: 'actual'
    });

    await rm(repoRoot, { recursive: true, force: true });
  });

  it('recalculates remaining dynamic days after a manual football slot', async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'kernel-dashboard-'));
    const store = new WikiStore(repoRoot);
    await mkdir(path.join(repoRoot, 'wiki', 'profilo'), { recursive: true });
    await mkdir(path.join(repoRoot, 'wiki', 'tracking', 'giornaliero'), { recursive: true });
    await mkdir(path.join(repoRoot, 'wiki', 'tracking', 'diario'), { recursive: true });

    await writeFile(
      path.join(repoRoot, 'wiki', 'profilo', 'dati-personali-e-obiettivi.md'),
      `
## Dati di base

| Dato | Valore |
| :--- | :--- |
| Peso | 82 kg |
| BMR | 1.786 kcal/giorno |
`,
      'utf8'
    );
    await writeFile(
      path.join(repoRoot, 'wiki', 'tracking', 'giornaliero', '2026-05.md'),
      `
| Data | Recupero fisico | Recupero mentale | Stress | Qualita sonno | FC riposo | Ore sonno | Passi | Note |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 2026-05-14 | 90 | 84 | 40 | 87 | 59 | 7.5 | 3000 | PROGRAMMA: CALCIO |
`,
      'utf8'
    );
    await writeFile(
      path.join(repoRoot, 'wiki', 'tracking', 'diario', '2026-05.md'),
      `
## 2026-05-11 - Scheda PULL

| Esercizio | Serie | Ripetizioni | Peso | RIR | Note |
| :--- | :--- | :--- | :--- | :--- | :--- |
| Rematore | 3 | 10 / 10 / 10 | 15 kg | 2 | |

## 2026-05-12 - Scheda PUSH

| Esercizio | Serie | Ripetizioni | Peso | RIR | Note |
| :--- | :--- | :--- | :--- | :--- | :--- |
| Military press | 3 | 10 / 10 / 10 | 7.5 kg | 2 | |
`,
      'utf8'
    );

    const payload = await store.getDashboard('2026-05-14', 'day');
    const byDate = new Map(payload.coach.plan.calendar.map((day) => [day.date, day]));
    expect(byDate.get('2026-05-14')).toMatchObject({ workout: 'CALCIO', source: 'planned' });
    expect(byDate.get('2026-05-15')?.workout).not.toBe('LEGS');
    expect(byDate.get('2026-05-16')).toMatchObject({ workout: 'LEGS', source: 'suggested' });

    await rm(repoRoot, { recursive: true, force: true });
  });

  it('keeps multiple football activities on the same day when names differ', async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'kernel-dashboard-'));
    const store = new WikiStore(repoRoot);

    await store.upsertFootball({
      date: '2026-05-12',
      kind: 'allenamento',
      label: 'Tecnico',
      durationMin: 45,
      avgPace: '',
      avgHeartRate: 140,
      calories: 300,
      trainingLoad: 55,
      cadenceAvg: null,
      cadenceMax: null,
      strideAvg: null,
      strideMax: null,
      notes: ''
    });
    await store.upsertFootball({
      date: '2026-05-12',
      kind: 'allenamento',
      label: 'Sprint',
      durationMin: 30,
      avgPace: '',
      avgHeartRate: 155,
      calories: 260,
      trainingLoad: 70,
      cadenceAvg: null,
      cadenceMax: null,
      strideAvg: null,
      strideMax: null,
      notes: ''
    });

    const payload = await store.getDashboard('2026-05-12', 'day');
    expect(payload.football.map((entry) => entry.label)).toEqual(['Tecnico', 'Sprint']);

    await rm(repoRoot, { recursive: true, force: true });
  });

  it('reads legacy records and appends dashboard records without dropping existing sections', async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'kernel-dashboard-'));
    const store = new WikiStore(repoRoot);
    const trackingDir = path.join(repoRoot, 'wiki', 'tracking');
    await mkdir(trackingDir, { recursive: true });
    await writeFile(
      path.join(trackingDir, 'record-personali.md'),
      `
# Record personali

## Corpo libero

| Record | Valore | Data | Note |
| :--- | :--- | :--- | :--- |
| Push-up consecutivi | 30 | 2026/05/11 | |

## Articoli correlati
`,
      'utf8'
    );

    await store.upsertRecord({
      id: '',
      originalId: '',
      date: '2026-05-12',
      category: 'calcio',
      discipline: 'partita',
      name: 'Km percorsi in partita',
      value: '8.4',
      unit: 'km',
      context: 'Partita 7v7',
      notes: ''
    });

    const records = await store.readRecords();
    const file = await readFile(path.join(trackingDir, 'record-personali.md'), 'utf8');
    expect(records.map((record) => record.name)).toContain('Push-up consecutivi');
    expect(records.map((record) => record.name)).toContain('Km percorsi in partita');
    expect(file).toContain('## Corpo libero');
    expect(file).not.toContain('## Record dashboard');
    expect(file).toContain('## Calcio');

    await rm(repoRoot, { recursive: true, force: true });
  });

  it('updates and deletes records by original id', async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'kernel-dashboard-'));
    const store = new WikiStore(repoRoot);

    const created = await store.upsertRecord({
      id: '',
      originalId: '',
      date: '2026-05-12',
      category: 'corpo libero',
      discipline: '',
      name: 'Push-up consecutivi',
      value: '30 reps',
      unit: '',
      context: '',
      notes: ''
    });
    await store.upsertRecord({ ...created, originalId: created.id, value: '32 reps' });
    let records = await store.readRecords();
    expect(records).toHaveLength(1);
    expect(records[0].value).toBe('32 reps');

    await store.deleteRecord(records[0].id);
    records = await store.readRecords();
    expect(records).toHaveLength(0);

    await rm(repoRoot, { recursive: true, force: true });
  });

  it('writes workout entries into the monthly workout diary', async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'kernel-dashboard-'));
    const store = new WikiStore(repoRoot);

    await store.upsertWorkout({
      id: '',
      originalId: '',
      date: '2026-05-12',
      title: 'Scheda TEST',
      exercises: [{ exercise: 'Push-up', sets: 3, reps: '10 / 10 / 10', weight: 'corpo libero', rir: '2', notes: '' }],
      volume: null,
      averageRir: null
    });

    const file = await readFile(path.join(repoRoot, 'wiki', 'tracking', 'diario', '2026-05.md'), 'utf8');
    expect(file).toContain('## 2026-05-12 - Scheda TEST');
    expect(file).toContain('| Push-up | 3 | 10 / 10 / 10 | corpo libero | 2 |  |');

    await rm(repoRoot, { recursive: true, force: true });
  });

  it('writes macro entries to the canonical macro diary ordered by date', async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'kernel-dashboard-'));
    const store = new WikiStore(repoRoot);

    await store.upsertMacro({
      date: '2026-05-12',
      caloriesIn: 1800,
      caloriesBurned: 520,
      protein: 150,
      carbs: 210,
      fat: 45,
      notes: 'manuale'
    });
    await store.upsertMacro({
      date: '2026-05-11',
      caloriesIn: 1450,
      caloriesBurned: 500,
      protein: 146,
      carbs: 196,
      fat: 26,
      notes: ''
    });

    const file = await readFile(path.join(repoRoot, 'wiki', 'alimentazione', 'diario-macro.md'), 'utf8');
    expect(file.indexOf('| 2026-05-11 |')).toBeLessThan(file.indexOf('| 2026-05-12 |'));
    expect(file).toContain('| 2026-05-12 | 1800 | 520 | 150 | 210 | 45 | manuale |');

    await rm(repoRoot, { recursive: true, force: true });
  });

  it('writes body measurements to the canonical measurements file', async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'kernel-dashboard-'));
    const store = new WikiStore(repoRoot);

    await store.upsertMeasurement({
      date: '2026-05-12',
      weight: 81.8,
      waist: 90,
      hips: 89,
      chest: 101,
      leftArm: 32,
      rightArm: 32,
      thigh: null,
      shoulders: 119
    });

    const file = await readFile(path.join(repoRoot, 'wiki', 'tracking', 'misure-corpo.md'), 'utf8');
    expect(file).toContain('## Misure');
    expect(file).toContain('| 2026-05-12 | 81.8 kg | 90 cm | 89 cm | 101 cm | 32 cm | 32 cm |  | 119 cm |');

    await rm(repoRoot, { recursive: true, force: true });
  });

  it('deletes body measurements by date', async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'kernel-dashboard-'));
    const store = new WikiStore(repoRoot);

    await store.upsertMeasurement({
      date: '2026-05-12',
      weight: 81.8,
      waist: 90,
      hips: null,
      chest: null,
      leftArm: null,
      rightArm: null,
      thigh: null,
      shoulders: null
    });
    await store.deleteMeasurement('2026-05-12');

    const rows = await store.readMeasurementEntries();
    const file = await readFile(path.join(repoRoot, 'wiki', 'tracking', 'misure-corpo.md'), 'utf8');
    expect(rows).toHaveLength(0);
    expect(file).not.toContain('| 2026-05-12 |');

    await rm(repoRoot, { recursive: true, force: true });
  });

  it('uses calendar weeks and months for dashboard ranges', async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'kernel-dashboard-'));
    const store = new WikiStore(repoRoot);

    const week = await store.getDashboard('2026-05-13', 'week');
    expect(week.range).toEqual({ from: '2026-05-11', to: '2026-05-17' });
    expect(week.series).toHaveLength(7);

    const month = await store.getDashboard('2026-05-13', 'month');
    expect(month.range).toEqual({ from: '2026-05-01', to: '2026-05-31' });
    expect(month.series).toHaveLength(31);

    await rm(repoRoot, { recursive: true, force: true });
  });

  it('updates progression rows in the canonical progression file', async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'kernel-dashboard-'));
    const store = new WikiStore(repoRoot);
    const trackingDir = path.join(repoRoot, 'wiki', 'tracking');
    await mkdir(trackingDir, { recursive: true });
    await writeFile(
      path.join(trackingDir, 'progressione-carichi.md'),
      `
# Progressione carichi

### Push

| Esercizio | Stato |
| :--- | :--- |
| Push-up | 3x10 @ corpo libero, RIR 2-3 -> mantieni |
`,
      'utf8'
    );

    await store.upsertProgression({
      group: 'Push',
      exercise: 'Push-up',
      status: '3x15 @ corpo libero, RIR 1-2 -> mantieni'
    });

    const file = await readFile(path.join(trackingDir, 'progressione-carichi.md'), 'utf8');
    expect(file).toContain('| Push-up | 3x15 @ corpo libero, RIR 1-2 -> mantieni |');
    expect(file).not.toContain('3x10 @ corpo libero');

    await rm(repoRoot, { recursive: true, force: true });
  });

  it('reads profile, progression and weekly schedule from canonical wiki files', async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'kernel-dashboard-'));
    const store = new WikiStore(repoRoot);
    await mkdir(path.join(repoRoot, 'wiki', 'profilo'), { recursive: true });
    await mkdir(path.join(repoRoot, 'wiki', 'tracking'), { recursive: true });
    await mkdir(path.join(repoRoot, 'wiki', 'allenamenti'), { recursive: true });

    await writeFile(
      path.join(repoRoot, 'wiki', 'profilo', 'dati-personali-e-obiettivi.md'),
      `
# Dati personali e obiettivi

## Punti chiave

- Altezza registrata: 1,73 m.
- [[bmr]] stimato: 1.786 kcal/giorno.

## Dati di base

| Dato | Valore |
| :--- | :--- |
| Altezza | 1,73 m |
| Peso | 82 kg |

## BMR e TDEE

| Formula | Valore con dati attuali |
| :--- | :--- |
| Uomo | \`10 x 82 = 820\` |

## Implicazioni pratiche

Deficit compatibile con allenamento e recupero.
`,
      'utf8'
    );
    await writeFile(
      path.join(repoRoot, 'wiki', 'tracking', 'progressione-carichi.md'),
      `
# Progressione carichi

## Esercizi da tracciare

### Push

| Esercizio | Stato |
| :--- | :--- |
| Military press | 3x10 @ 7.5 kg, RIR 1-2 -> mantieni |

### Pull

| Esercizio | Stato |
| :--- | :--- |
| Rematore | 3x10 @ 15 kg, RIR 1-2 -> mantieni |

### Legs

| Esercizio | Stato |
| :--- | :--- |
| Goblet squat | 3x10 @ 7.5 kg, RIR 1-2 -> mantieni |
`,
      'utf8'
    );
    await writeFile(
      path.join(repoRoot, 'wiki', 'allenamenti', 'programmazione-settimanale.md'),
      `
# Programmazione settimanale

## Opzione A: settimana con 2 partite

| Giorno | Workout | Dettagli tecnici |
| :--- | :--- | :--- |
| Mercoledi | CALCIO | Partita 1. |
| Giovedi | CALCIO | Partita 2. |

## Opzione B: settimana con 1 partita

| Giorno | Workout | Dettagli tecnici |
| :--- | :--- | :--- |
| Mercoledi | CALCIO | Partita. |
`,
      'utf8'
    );

    const payload = await store.readWikiData();
    expect(payload.profile.basics).toContainEqual({ label: 'Peso', value: '82 kg' });
    expect(payload.profile.keyPoints[1]).toBe('bmr stimato: 1.786 kcal/giorno.');
    expect(payload.profile.implications).toBe('Deficit compatibile con allenamento e recupero.');
    expect(payload.progression.find((group) => group.group === 'Push')?.rows[0].exercise).toBe('Military press');
    expect(payload.schedule.find((option) => option.title.includes('2 partite'))?.rows.map((row) => row.day)).toEqual([
      'Mercoledi',
      'Giovedi'
    ]);

    await rm(repoRoot, { recursive: true, force: true });
  });
});
