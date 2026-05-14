import type { DailyEntry, FootballEntry, MacroEntry, MeasurementEntry, WorkoutEntry } from './schemas';

export type CoachTone = 'good' | 'watch' | 'risk';
export type CoachCategory = 'readiness' | 'nutrition' | 'progression' | 'planning' | 'recovery' | 'data';

export type CoachInsight = {
  id: string;
  category: CoachCategory;
  tone: CoachTone;
  title: string;
  message: string;
  action: string;
  metric?: string;
};

export type CoachPayload = {
  readiness: number | null;
  summary: string;
  plan: CoachPlan;
  targets: {
    proteinMin: number | null;
    proteinMax: number | null;
    calorieTargetMin: number | null;
    calorieTargetMax: number | null;
    steps: number;
  };
  insights: CoachInsight[];
};

export type CoachPlan = {
  status: CoachTone;
  today: string;
  nextWorkout: 'PULL' | 'PUSH' | 'LEGS' | 'REST' | 'CALCIO';
  mode: 'standard' | 'protect-legs' | 'recovery' | 'compact';
  reason: string;
  pillars: Array<{ name: 'PULL' | 'PUSH' | 'LEGS'; done: boolean; lastDate: string | null }>;
  calendar: Array<{
    date: string;
    label: string;
    workout: 'PULL' | 'PUSH' | 'LEGS' | 'REST' | 'CALCIO';
    source: 'actual' | 'planned' | 'suggested';
    reason: string;
  }>;
  adjustments: string[];
};

type SeriesRow = {
  date: string;
  physicalRecovery: number | null;
  mentalRecovery: number | null;
  stress: number | null;
  sleepQuality: number | null;
  restingHeartRate: number | null;
  sleepHours: number | null;
  steps: number | null;
  caloriesIn: number | null;
  caloriesBurned: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  weight: number | null;
};

type ProgressionRow = {
  group: string;
  rows: Array<{ exercise: string; status: string }>;
};

export function buildCoachPayload(input: {
  selectedDate: string;
  period: 'day' | 'week' | 'month';
  daily: DailyEntry | null;
  macro: MacroEntry | null;
  measurement: MeasurementEntry | null;
  series: SeriesRow[];
  workouts: WorkoutEntry[];
  workout: WorkoutEntry | null;
  planningWorkouts: WorkoutEntry[];
  planningDailyEntries: DailyEntry[];
  football: FootballEntry[];
  footballActivities: FootballEntry[];
  planningFootballActivities: FootballEntry[];
  progression: ProgressionRow[];
  profileBasics: Array<{ label: string; value: string }>;
}): CoachPayload {
  const rowsWithMacro = input.series.filter((row) => hasAny(row.caloriesIn, row.protein, row.carbs, row.fat));
  const rowsWithDaily = input.series.filter((row) =>
    hasAny(row.physicalRecovery, row.mentalRecovery, row.stress, row.sleepQuality, row.sleepHours, row.steps)
  );
  const avgCalories = average(input.series.map((row) => row.caloriesIn));
  const avgBurned = average(input.series.map((row) => row.caloriesBurned));
  const avgProtein = average(input.series.map((row) => row.protein));
  const avgSteps = average(input.series.map((row) => row.steps));
  const avgSleep = average(input.series.map((row) => row.sleepHours));
  const avgStress = average(input.series.map((row) => row.stress));
  const readiness = calculateReadiness(input.period === 'day' ? input.daily : null, input.series);
  const weight = input.measurement?.weight ?? parseProfileNumber(input.profileBasics, 'Peso');
  const bmr = parseProfileNumber(input.profileBasics, 'BMR') ?? 1786;
  const proteinMin = weight ? round(weight * 1.6, 0) : null;
  const proteinMax = weight ? round(weight * 2, 0) : null;
  const calorieTarget = calculateCalorieTarget(bmr, avgBurned);
  const plan = buildDynamicPlan({
    selectedDate: input.selectedDate,
    readiness,
    daily: input.daily,
    workouts: input.planningWorkouts,
    dailyEntries: input.planningDailyEntries,
    todayFootball: input.football,
    footballActivities: input.planningFootballActivities
  });
  const insights: CoachInsight[] = [];

  insights.push(buildReadinessInsight(readiness, input.period));

  if (rowsWithMacro.length === 0) {
    insights.push({
      id: 'macro-missing',
      category: 'data',
      tone: 'watch',
      title: 'Macro non tracciati',
      message: 'Non ci sono calorie e macro nel periodo selezionato, quindi non posso valutare il rapporto calorico.',
      action: 'Compila kcal, proteine, carboidrati e grassi per attivare il controllo nutrizionale.',
      metric: '0 giorni'
    });
  } else {
    insights.push(buildNutritionInsight(avgCalories, calorieTarget, rowsWithMacro.length));
    insights.push(buildProteinInsight(avgProtein, proteinMin, proteinMax));
  }

  insights.push(buildStepsInsight(avgSteps));

  if (avgSleep !== null && avgSleep < 7) {
    insights.push({
      id: 'sleep-low',
      category: 'recovery',
      tone: 'watch',
      title: 'Sonno sotto soglia',
      message: `Nel periodo sei a ${avgSleep.toFixed(1)} h medie di sonno.`,
      action: 'Prima di aumentare volume o carichi, porta il sonno medio verso 7-8 ore.',
      metric: `${avgSleep.toFixed(1)} h`
    });
  }

  if (avgStress !== null && avgStress >= 65) {
    insights.push({
      id: 'stress-high',
      category: 'recovery',
      tone: 'risk',
      title: 'Stress alto',
      message: `Stress medio a ${avgStress}/100: il carico esterno puo mascherare il recupero reale.`,
      action: 'Mantieni i carichi e riduci le serie vicine al cedimento finche lo stress scende.',
      metric: `${avgStress}/100`
    });
  }

  const progressionInsights = buildProgressionInsights(
    input.period === 'day' ? (input.workout ? [input.workout] : []) : input.workouts,
    input.progression
  );
  insights.push(...progressionInsights);
  if (rowsWithDaily.length < Math.min(input.series.length, 3)) {
    insights.push({
      id: 'daily-sparse',
      category: 'data',
      tone: 'watch',
      title: 'Diario recupero incompleto',
      message: 'Ci sono pochi dati su sonno, recupero, stress e passi nel periodo.',
      action: 'Compila il diario giornaliero: il coach diventa piu preciso su deload e progressioni.',
      metric: `${rowsWithDaily.length}/${input.series.length} giorni`
    });
  }

  const sorted = sortInsights(insights).slice(0, 7);
  return {
    readiness,
    summary: buildSummary(readiness, sorted),
    plan,
    targets: {
      proteinMin,
      proteinMax,
      calorieTargetMin: calorieTarget.min,
      calorieTargetMax: calorieTarget.max,
      steps: 15000
    },
    insights: sorted
  };
}

function buildReadinessInsight(readiness: number | null, period: 'day' | 'week' | 'month'): CoachInsight {
  if (readiness === null) {
    return {
      id: 'readiness-missing',
      category: 'readiness',
      tone: 'watch',
      title: 'Readiness non calcolabile',
      message: 'Mancano recupero, sonno o stress per stimare quanto puoi spingere.',
      action: 'Aggiorna diario giornaliero prima di decidere i carichi.',
      metric: '--'
    };
  }
  const scope = period === 'day' ? 'oggi' : 'nel periodo';
  if (readiness >= 78) {
    return {
      id: 'readiness-good',
      category: 'readiness',
      tone: 'good',
      title: 'Pronto a spingere',
      message: `Readiness ${readiness}/100 ${scope}: recupero compatibile con una progressione controllata.`,
      action: 'Aumenta solo sugli esercizi dove completi il range con tecnica pulita.',
      metric: `${readiness}/100`
    };
  }
  if (readiness >= 60) {
    return {
      id: 'readiness-hold',
      category: 'readiness',
      tone: 'watch',
      title: 'Spingi con controllo',
      message: `Readiness ${readiness}/100 ${scope}: buono, ma non abbastanza alto per forzare tutto.`,
      action: 'Mantieni i carichi principali e aumenta solo una variabile per volta.',
      metric: `${readiness}/100`
    };
  }
  return {
    id: 'readiness-risk',
    category: 'readiness',
    tone: 'risk',
    title: 'Recupero fragile',
    message: `Readiness ${readiness}/100 ${scope}: il rischio e accumulare fatica non produttiva.`,
    action: 'Riduci volume del 15-25% o lavora tecnico senza cercare PR.',
    metric: `${readiness}/100`
  };
}

function buildNutritionInsight(
  avgCalories: number | null,
  calorieTarget: { min: number | null; max: number | null },
  days: number
): CoachInsight {
  if (avgCalories === null || calorieTarget.min === null || calorieTarget.max === null) {
    return {
      id: 'calorie-unknown',
      category: 'nutrition',
      tone: 'watch',
      title: 'Target calorico parziale',
      message: 'Ho macro registrati, ma non abbastanza dati per stimare il target calorico operativo.',
      action: 'Continua a tracciare kcal consumate e kcal bruciate.',
      metric: `${days} giorni`
    };
  }
  if (avgCalories < calorieTarget.min - 150) {
    return {
      id: 'calorie-low',
      category: 'nutrition',
      tone: 'risk',
      title: 'Deficit troppo aggressivo',
      message: `Media ${avgCalories} kcal su ${days} giorni contro target stimato ${calorieTarget.min}-${calorieTarget.max} kcal.`,
      action: 'Aumenta di 100-200 kcal, soprattutto carboidrati nei giorni pesi/calcio.',
      metric: `${avgCalories} kcal`
    };
  }
  if (avgCalories > calorieTarget.max + 150) {
    return {
      id: 'calorie-high',
      category: 'nutrition',
      tone: 'watch',
      title: 'Surplus sopra target',
      message: `Media ${avgCalories} kcal su ${days} giorni, sopra il range stimato ${calorieTarget.min}-${calorieTarget.max}.`,
      action: 'Riduci 100-150 kcal o aumenta passi se il peso medio non scende.',
      metric: `${avgCalories} kcal`
    };
  }
  return {
    id: 'calorie-ok',
    category: 'nutrition',
    tone: 'good',
    title: 'Calorie in range',
    message: `Media ${avgCalories} kcal su ${days} giorni, coerente con ricomposizione controllata.`,
    action: 'Mantieni il target e valuta il trend del peso medio, non il singolo giorno.',
    metric: `${avgCalories} kcal`
  };
}

function buildProteinInsight(avgProtein: number | null, min: number | null, max: number | null): CoachInsight {
  if (avgProtein === null || min === null || max === null) {
    return {
      id: 'protein-missing',
      category: 'nutrition',
      tone: 'watch',
      title: 'Proteine da completare',
      message: 'Mancano proteine o peso corporeo per verificare il target 1,6-2,0 g/kg.',
      action: 'Registra proteine giornaliere e peso aggiornato.',
      metric: '--'
    };
  }
  if (avgProtein < min) {
    return {
      id: 'protein-low',
      category: 'nutrition',
      tone: 'watch',
      title: 'Proteine sotto target',
      message: `Media ${avgProtein} g, sotto il minimo operativo ${min} g.`,
      action: 'Aggiungi una fonte proteica magra nei pasti piu scoperti.',
      metric: `${avgProtein} g`
    };
  }
  return {
    id: 'protein-ok',
    category: 'nutrition',
    tone: 'good',
    title: 'Proteine solide',
    message: `Media ${avgProtein} g, dentro il range ${min}-${max} g per ricomposizione.`,
    action: 'Mantieni la quota proteica e usa i carboidrati per sostenere le sedute pesanti.',
    metric: `${avgProtein} g`
  };
}

function buildStepsInsight(avgSteps: number | null): CoachInsight {
  if (avgSteps === null) {
    return {
      id: 'steps-missing',
      category: 'data',
      tone: 'watch',
      title: 'Passi mancanti',
      message: 'Non posso valutare il NEAT senza passi registrati.',
      action: 'Registra i passi: sono una leva chiave del deficit senza tagliare troppo il cibo.',
      metric: '--'
    };
  }
  if (avgSteps < 10000) {
    return {
      id: 'steps-low',
      category: 'nutrition',
      tone: 'watch',
      title: 'NEAT basso',
      message: `Media ${avgSteps} passi, sotto il target operativo 15.000.`,
      action: 'Prima di tagliare altre calorie, porta i passi almeno verso 10-12k.',
      metric: `${avgSteps}`
    };
  }
  if (avgSteps < 15000) {
    return {
      id: 'steps-mid',
      category: 'nutrition',
      tone: 'watch',
      title: 'NEAT migliorabile',
      message: `Media ${avgSteps} passi: buona base, ma sotto il target 15.000.`,
      action: 'Aggiungi una camminata breve nei giorni senza calcio.',
      metric: `${avgSteps}`
    };
  }
  return {
    id: 'steps-ok',
    category: 'nutrition',
    tone: 'good',
    title: 'Passi in target',
    message: `Media ${avgSteps} passi: il NEAT sostiene bene il deficit.`,
    action: 'Mantieni il movimento e non ridurre troppo le calorie.',
    metric: `${avgSteps}`
  };
}

function buildProgressionInsights(workouts: WorkoutEntry[], progression: ProgressionRow[]): CoachInsight[] {
  const progressionMap = new Map<string, { exercise: string; status: string }>();
  for (const group of progression) {
    for (const row of group.rows) {
      progressionMap.set(normalizeName(row.exercise), row);
    }
  }

  const latestByExercise = new Map<string, { workout: WorkoutEntry; exercise: WorkoutEntry['exercises'][number] }>();
  for (const workout of workouts) {
    for (const exercise of workout.exercises) {
      latestByExercise.set(normalizeName(exercise.exercise), { workout, exercise });
    }
  }

  let readyForLoadCount = 0;
  let readyForRepsCount = 0;
  for (const [key, current] of latestByExercise) {
    const progressionRow = findProgressionRow(key, progressionMap);
    if (!progressionRow) continue;
    const targetReps = parseTargetReps(progressionRow.status);
    const reps = parseReps(current.exercise.reps);
    const rir = average(parseNumberList(current.exercise.rir));
    if (targetReps === null || reps.length === 0) continue;
    const minReps = Math.min(...reps);
    const completedAboveTarget = minReps >= targetReps + 1;
    const readyForLoad = minReps >= targetReps + 2 && (rir === null || rir >= 1.5);
    if (readyForLoad) {
      readyForLoadCount += 1;
    } else if (completedAboveTarget) {
      readyForRepsCount += 1;
    }
  }

  if (readyForLoadCount > 0) {
    return [
      {
        id: 'progression-load-ready',
        category: 'progression',
        tone: 'good',
        title: 'Progressione carichi pronta',
        message: `${readyForLoadCount} esercizi hanno superato il riferimento con RIR ancora gestibile.`,
        action: 'Entra in Progressione e valuta un piccolo aumento di carico solo dove la tecnica era pulita.',
        metric: `${readyForLoadCount} esercizi`
      }
    ];
  }

  if (readyForRepsCount > 0) {
    return [
      {
        id: 'progression-reps-ready',
        category: 'progression',
        tone: 'good',
        title: 'Progressione reps pronta',
        message: `${readyForRepsCount} esercizi sono sopra il riferimento attuale, ma non ancora da carico automatico.`,
        action: 'Consolida il nuovo range di ripetizioni e aggiorna i dettagli nella sezione Progressione.',
        metric: `${readyForRepsCount} esercizi`
      }
    ];
  }

  if (workouts.length > 0) {
    return [
      {
        id: 'progression-hold',
        category: 'progression',
        tone: 'watch',
        title: 'Progressione da consolidare',
        message: 'Nel periodo non emergono esercizi chiaramente pronti per salire.',
        action: 'Mantieni i carichi e cerca reps stabili con RIR coerente.',
        metric: `${workouts.length} workout`
      }
    ];
  }

  return [];
}

function buildDynamicPlan(input: {
  selectedDate: string;
  readiness: number | null;
  daily: DailyEntry | null;
  workouts: WorkoutEntry[];
  dailyEntries: DailyEntry[];
  todayFootball: FootballEntry[];
  footballActivities: FootballEntry[];
}): CoachPlan {
  const dailyByDate = new Map(input.dailyEntries.map((entry) => [entry.date, entry]));
  const plannedByDate = new Map(
    input.dailyEntries
      .map((entry) => [entry.date, parsePlannedWorkout(entry.notes)] as const)
      .filter((entry): entry is readonly [string, 'PULL' | 'PUSH' | 'LEGS' | 'REST' | 'CALCIO'] => entry[1] !== null)
  );
  const footballDates = new Set([
    ...input.footballActivities.map((entry) => entry.date),
    ...[...plannedByDate.entries()].filter(([, workout]) => workout === 'CALCIO').map(([date]) => date)
  ]);
  const workoutPillars = input.workouts
    .map((workout) => ({ date: workout.date, pillar: detectPillar(workout.title) }))
    .filter((entry): entry is { date: string; pillar: 'PULL' | 'PUSH' | 'LEGS' } => entry.pillar !== null);
  const plannedPillars = [...plannedByDate.entries()]
    .map(([date, workout]) => ({ date, pillar: workout === 'PULL' || workout === 'PUSH' || workout === 'LEGS' ? workout : null }))
    .filter((entry): entry is { date: string; pillar: 'PULL' | 'PUSH' | 'LEGS' } => entry.pillar !== null);
  const pillarEntries = [...workoutPillars, ...plannedPillars].sort((a, b) => a.date.localeCompare(b.date));
  const pillars = (['PULL', 'PUSH', 'LEGS'] as const).map((pillar) => {
    const latest = pillarEntries.filter((entry) => entry.pillar === pillar).at(-1);
    return {
      name: pillar,
      done: pillarEntries.some((entry) => entry.pillar === pillar),
      lastDate: latest?.date ?? null
    };
  });
  const todayPlanned = plannedByDate.get(input.selectedDate) ?? null;
  const todayHasFootball = input.todayFootball.length > 0 || todayPlanned === 'CALCIO';
  const tomorrowHasFootball = footballDates.has(addIsoDays(input.selectedDate, 1));
  const yesterdayHadFootball = footballDates.has(addIsoDays(input.selectedDate, -1));
  const notes = normalizeText(input.daily?.notes ?? '');
  const compactRequest = /35|poco tempo|tempo poco|breve|veloce/.test(notes);
  const travelRequest = /trasferta|hotel|viaggio|corpo libero|manubri/.test(notes);
  const tiredLegs = /gambe (?:stanche|affaticate|pesanti)|doms gambe|dolore gambe/.test(notes);
  const yesterdayHadLegs = input.workouts.some(
    (workout) => workout.date === addIsoDays(input.selectedDate, -1) && detectPillar(workout.title) === 'LEGS'
  );
  const yesterdayWasRest = !input.workouts.some((workout) => workout.date === addIsoDays(input.selectedDate, -1)) &&
    !footballDates.has(addIsoDays(input.selectedDate, -1));
  const missingPillars = pillars.filter((pillar) => !pillar.done).map((pillar) => pillar.name);
  const nextPillar = chooseNextPillar(
    missingPillars,
    todayHasFootball,
    tomorrowHasFootball,
    yesterdayHadLegs || yesterdayHadFootball || tiredLegs
  );
  const calendar = buildPlanCalendar(input.selectedDate, input.workouts, input.dailyEntries, input.footballActivities);
  const todaySlot = calendar.find((day) => day.date === input.selectedDate)?.workout ?? nextPillar;
  const adjustments: string[] = [];

  if (todayHasFootball) {
    adjustments.push('Calcio oggi: evita LEGS e lavoro metabolico gambe.');
  }
  if (tomorrowHasFootball) {
    adjustments.push('Calcio domani: non creare DOMS pesanti sulle gambe.');
  }
  if (yesterdayHadFootball) {
    adjustments.push('Calcio ieri: evita LEGS subito dopo, meglio upper o REST.');
  }
  if (yesterdayHadLegs) {
    adjustments.push('LEGS ieri: lascia almeno 48 ore prima di un altro stress gambe.');
  }
  if (yesterdayWasRest) {
    adjustments.push('Ieri REST: puoi riprendere con un pilastro non completato, se readiness e sonno sono ok.');
  }
  if (compactRequest) {
    adjustments.push('Poco tempo: usa versione 35 minuti, meno accessori e recuperi controllati.');
  }
  if (travelRequest) {
    adjustments.push('Trasferta: usa alternative manubri/corpo libero mantenendo lo stesso schema PPL.');
  }
  if (tiredLegs) {
    adjustments.push('Gambe affaticate: sposta LEGS e fai upper o recupero.');
  }
  if (input.readiness !== null && input.readiness < 60) {
    adjustments.push('Readiness bassa: riduci volume 20-30% e tieni RIR piu alto.');
  }

  if (todayPlanned === 'REST') {
    return {
      status: 'good',
      today: 'Oggi REST programmato: recupero, mobilita o camminata leggera.',
      nextWorkout: 'REST',
      mode: 'recovery',
      reason: 'REST e stato impostato manualmente nella programmazione dinamica.',
      pillars,
      calendar,
      adjustments
    };
  }

  if (input.readiness !== null && input.readiness < 55) {
    return {
      status: 'risk',
      today: todayHasFootball ? 'Fai solo calcio, senza pesi aggiuntivi.' : 'REST attivo o tecnica leggera, niente progressioni.',
      nextWorkout: todayHasFootball ? 'CALCIO' : 'REST',
      mode: 'recovery',
      reason: 'Il recupero non supporta una seduta piena: meglio proteggere adattamento e sistema nervoso.',
      pillars,
      calendar,
      adjustments
    };
  }

  if (todayHasFootball) {
    return {
      status: 'watch',
      today: 'Oggi priorita CALCIO. Se vuoi fare pesi, solo upper leggero e lontano dalla partita.',
      nextWorkout: 'CALCIO',
      mode: 'protect-legs',
      reason: 'Il calcio conta come stress gambe/cardio: la scheda si riorganizza per non sommare DOMS e fatica neuromuscolare.',
      pillars,
      calendar,
      adjustments
    };
  }

  if (tiredLegs && nextPillar === 'LEGS') {
    return {
      status: 'watch',
      today: 'Sposta LEGS: oggi upper leggero o recupero, poi rivaluta gambe domani.',
      nextWorkout: chooseUpperPillar(missingPillars),
      mode: 'protect-legs',
      reason: 'Le gambe risultano affaticate dalle note: allenarle ora peggiorerebbe qualita tecnica e recupero.',
      pillars,
      calendar,
      adjustments
    };
  }

  if (tomorrowHasFootball && nextPillar === 'LEGS') {
    return {
      status: 'watch',
      today: 'Sposta LEGS: oggi meglio PULL o PUSH, con gambe fresche per il calcio di domani.',
      nextWorkout: chooseUpperPillar(missingPillars),
      mode: 'protect-legs',
      reason: 'LEGS il giorno prima del calcio aumenta il rischio di DOMS e peggiora sprint/cambi direzione.',
      pillars,
      calendar,
      adjustments
    };
  }

  if (compactRequest && nextPillar !== 'REST') {
    return {
      status: 'watch',
      today: `Versione 35 minuti di ${nextPillar}: multiarticolare principale, 2 accessori, addome breve.`,
      nextWorkout: nextPillar,
      mode: 'compact',
      reason: 'Il vincolo tempo cambia il volume, non il pilastro: si conserva la logica PPL senza comprimere tutto.',
      pillars,
      calendar,
      adjustments
    };
  }

  if (travelRequest && nextPillar !== 'REST') {
    return {
      status: 'watch',
      today: `${nextPillar} in versione trasferta: manubri/corpo libero, RIR controllato, niente esercizi impossibili da replicare.`,
      nextWorkout: nextPillar,
      mode: 'compact',
      reason: 'La trasferta cambia gli esercizi disponibili, non lo stimolo: mantieni il pattern del pilastro.',
      pillars,
      calendar,
      adjustments
    };
  }

  if (nextPillar === 'REST') {
    return {
      status: 'good',
      today: 'Settimana PPL gia coperta: oggi REST, mobilita o camminata.',
      nextWorkout: 'REST',
      mode: 'recovery',
      reason: 'Push, Pull e Legs risultano gia coperti nel periodo: il recupero diventa parte del programma.',
      pillars,
      calendar,
      adjustments
    };
  }

  return {
    status: 'good',
    today: `Oggi puoi fare ${todaySlot}. Mantieni la progressione solo se tecnica e RIR restano coerenti.`,
    nextWorkout: todaySlot,
    mode: 'standard',
    reason: `${todaySlot} e lo slot piu logico da completare rispetto a sedute, calcio e programmazione manuale.`,
    pillars,
    calendar,
    adjustments
  };
}

function buildPlanCalendar(
  selectedDate: string,
  workouts: WorkoutEntry[],
  dailyEntries: DailyEntry[],
  footballActivities: FootballEntry[]
): CoachPlan['calendar'] {
  const start = startOfIsoWeek(selectedDate);
  const days = Array.from({ length: 7 }, (_, index) => addIsoDays(start, index));
  const workoutByDate = new Map(workouts.map((workout) => [workout.date, workout]));
  const dailyByDate = new Map(dailyEntries.map((entry) => [entry.date, entry]));
  const footballByDate = new Set(footballActivities.map((entry) => entry.date));
  const calendar: CoachPlan['calendar'] = [];
  const covered = new Set<'PULL' | 'PUSH' | 'LEGS'>();
  for (const workout of workouts) {
    const pillar = detectPillar(workout.title);
    if (pillar) covered.add(pillar);
  }
  for (const entry of dailyEntries) {
    const planned = parsePlannedWorkout(entry.notes);
    if (planned === 'PULL' || planned === 'PUSH' || planned === 'LEGS') covered.add(planned);
  }

  for (const date of days) {
    const actualWorkout = workoutByDate.get(date);
    const actualPillar = actualWorkout ? detectPillar(actualWorkout.title) : null;
    if (actualWorkout && actualPillar) {
      covered.add(actualPillar);
      calendar.push({
        date,
        label: weekdayLabel(date),
        workout: actualPillar,
        source: 'actual',
        reason: `Allenamento registrato: ${actualWorkout.title}.`
      });
      continue;
    }
    const planned = parsePlannedWorkout(dailyByDate.get(date)?.notes ?? '');
    if (footballByDate.has(date) || planned === 'CALCIO') {
      calendar.push({
        date,
        label: weekdayLabel(date),
        workout: 'CALCIO',
        source: footballByDate.has(date) ? 'actual' : 'planned',
        reason: footballByDate.has(date) ? 'Calcio registrato nel tracking.' : 'Calcio impostato manualmente nella programmazione.'
      });
      continue;
    }
    if (planned) {
      if (planned === 'PULL' || planned === 'PUSH' || planned === 'LEGS') {
        covered.add(planned);
      }
      calendar.push({
        date,
        label: weekdayLabel(date),
        workout: planned,
        source: 'planned',
        reason: 'Slot impostato manualmente nella programmazione.'
      });
      continue;
    }

    if (date >= selectedDate) {
      const next = chooseSuggestedSlot(date, days, calendar, covered, footballByDate, dailyByDate);
      if (next === 'PULL' || next === 'PUSH' || next === 'LEGS') {
        covered.add(next);
      }
      calendar.push({
        date,
        label: weekdayLabel(date),
        workout: next,
        source: 'suggested',
        reason:
          next === 'REST'
            ? 'REST suggerito per non sommare fatica o perche PPL e gia coperto.'
            : 'Suggerimento dinamico ricalcolato sui vincoli della settimana.'
      });
      continue;
    }
    calendar.push({
      date,
      label: weekdayLabel(date),
      workout: 'REST',
      source: 'suggested',
      reason: 'Slot passato senza programmazione registrata.'
    });
  }

  return calendar;
}

function chooseSuggestedSlot(
  date: string,
  weekDays: string[],
  calendar: CoachPlan['calendar'],
  covered: Set<'PULL' | 'PUSH' | 'LEGS'>,
  footballByDate: Set<string>,
  dailyByDate: Map<string, DailyEntry>
): 'PULL' | 'PUSH' | 'LEGS' | 'REST' {
  const plannedFootball = (day: string) => parsePlannedWorkout(dailyByDate.get(day)?.notes ?? '') === 'CALCIO';
  const hasFootball = (day: string) => footballByDate.has(day) || plannedFootball(day);
  const previousDay = addIsoDays(date, -1);
  const nextDay = addIsoDays(date, 1);
  const previousSlot = calendar.find((day) => day.date === previousDay)?.workout;
  const remainingDays = weekDays.filter((day) => day >= date);
  const missing = (['PULL', 'PUSH', 'LEGS'] as const).filter((pillar) => !covered.has(pillar));
  if (missing.length === 0) return 'REST';

  const safe = missing.filter((pillar) => {
    if (pillar !== 'LEGS') return true;
    if (hasFootball(previousDay) || hasFootball(date) || hasFootball(nextDay)) return false;
    if (previousSlot === 'LEGS') return false;
    return true;
  });
  if (safe.length > 0) return safe[0];

  const hasFutureLegSlot = remainingDays.some((day) => {
    if (day === date) return false;
    return !hasFootball(addIsoDays(day, -1)) && !hasFootball(day) && !hasFootball(addIsoDays(day, 1));
  });
  if (missing.includes('LEGS') && hasFutureLegSlot) return 'REST';
  return missing.find((pillar) => pillar !== 'LEGS') ?? 'REST';
}

function chooseNextPillar(
  missingPillars: Array<'PULL' | 'PUSH' | 'LEGS'>,
  todayHasFootball: boolean,
  tomorrowHasFootball: boolean,
  yesterdayHadLegs: boolean
): 'PULL' | 'PUSH' | 'LEGS' | 'REST' {
  const safeMissing = missingPillars.filter((pillar) => {
    if (pillar !== 'LEGS') return true;
    return !todayHasFootball && !tomorrowHasFootball && !yesterdayHadLegs;
  });
  if (safeMissing.length > 0) return safeMissing[0];
  if (missingPillars.length > 0 && !todayHasFootball) return missingPillars[0];
  return 'REST';
}

function chooseUpperPillar(missingPillars: Array<'PULL' | 'PUSH' | 'LEGS'>): 'PULL' | 'PUSH' {
  const upper = missingPillars.find((pillar): pillar is 'PULL' | 'PUSH' => pillar === 'PULL' || pillar === 'PUSH');
  return upper ?? 'PULL';
}

function detectPillar(title: string): 'PULL' | 'PUSH' | 'LEGS' | null {
  const normalized = title.toUpperCase();
  if (normalized.includes('PULL')) return 'PULL';
  if (normalized.includes('PUSH')) return 'PUSH';
  if (normalized.includes('LEGS') || normalized.includes('GAMBE')) return 'LEGS';
  return null;
}

function parsePlannedWorkout(notes: string): 'PULL' | 'PUSH' | 'LEGS' | 'REST' | 'CALCIO' | null {
  const match = normalizeText(notes).match(/programma:\s*(pull|push|legs|rest|calcio)/i);
  if (!match) return null;
  return match[1].toUpperCase() as 'PULL' | 'PUSH' | 'LEGS' | 'REST' | 'CALCIO';
}

function calculateReadiness(daily: DailyEntry | null, series: SeriesRow[]): number | null {
  const source =
    daily ??
    ({
      physicalRecovery: average(series.map((row) => row.physicalRecovery)),
      mentalRecovery: average(series.map((row) => row.mentalRecovery)),
      sleepQuality: average(series.map((row) => row.sleepQuality)),
      stress: average(series.map((row) => row.stress))
    } as DailyEntry);
  const components = [
    source.physicalRecovery,
    source.mentalRecovery,
    source.sleepQuality,
    source.stress === null || source.stress === undefined ? null : 100 - source.stress
  ].filter((value): value is number => value !== null && value !== undefined);
  return components.length ? round(components.reduce((sum, value) => sum + value, 0) / components.length, 0) : null;
}

function calculateCalorieTarget(bmr: number | null, avgBurned: number | null): { min: number | null; max: number | null } {
  if (bmr === null) return { min: null, max: null };
  const activity = avgBurned ?? 350;
  const maintenance = bmr + activity;
  return {
    min: round(maintenance - 450, 0),
    max: round(maintenance - 150, 0)
  };
}

function buildSummary(readiness: number | null, insights: CoachInsight[]): string {
  const topRisk = insights.find((insight) => insight.tone === 'risk');
  if (topRisk) return topRisk.action;
  if (readiness !== null && readiness >= 78) return 'Giornata buona: puoi progredire dove i dati lo giustificano.';
  return insights[0]?.action ?? 'Compila i dati chiave per far reagire il coach.';
}

function sortInsights(insights: CoachInsight[]): CoachInsight[] {
  const toneRank: Record<CoachTone, number> = { risk: 0, watch: 1, good: 2 };
  const categoryRank: Record<CoachCategory, number> = {
    readiness: 0,
    nutrition: 1,
    planning: 2,
    progression: 3,
    recovery: 4,
    data: 5
  };
  return [...insights].sort((a, b) => toneRank[a.tone] - toneRank[b.tone] || categoryRank[a.category] - categoryRank[b.category]);
}

function findProgressionRow(key: string, rows: Map<string, { exercise: string; status: string }>) {
  if (rows.has(key)) return rows.get(key);
  return [...rows.entries()].find(([candidate]) => candidate.includes(key) || key.includes(candidate))?.[1] ?? null;
}

function parseTargetReps(status: string): number | null {
  const match = status.match(/\d+\s*x\s*(\d+)/i);
  return match ? Number(match[1]) : null;
}

function parseReps(value: string): number[] {
  if (/max/i.test(value)) return [];
  return parseNumberList(value);
}

function parseNumberList(value: string): number[] {
  return value.match(/\d+(\.\d+)?/g)?.map(Number) ?? [];
}

function parseProfileNumber(rows: Array<{ label: string; value: string }>, label: string): number | null {
  const row = rows.find((item) => item.label.trim().toLowerCase() === label.toLowerCase());
  if (!row) return null;
  const normalized = row.value.replace('.', '').replace(',', '.');
  const match = normalized.match(/\d+(\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b(con|in|a|ai|su|da|di|il|lo|la|gli|le)\b/g, ' ')
    .replace(/manubri/g, 'manubri')
    .replace(/elastici/g, 'elastici')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function addIsoDays(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function startOfIsoWeek(date: string): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  const day = parsed.getUTCDay() || 7;
  parsed.setUTCDate(parsed.getUTCDate() - day + 1);
  return parsed.toISOString().slice(0, 10);
}

function weekdayLabel(date: string): string {
  const labels = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];
  return labels[new Date(`${date}T00:00:00.000Z`).getUTCDay()] ?? date;
}

function hasAny(...values: Array<number | null | undefined>): boolean {
  return values.some((value) => value !== null && value !== undefined);
}

function average(values: Array<number | null | undefined>): number | null {
  const nums = values.filter((value): value is number => value !== null && value !== undefined && Number.isFinite(value));
  return nums.length ? round(nums.reduce((sum, value) => sum + value, 0) / nums.length, 1) : null;
}

function round(value: number, decimals = 1): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
