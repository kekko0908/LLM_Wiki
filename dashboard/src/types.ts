export type Period = 'day' | 'week' | 'month';

export type DailyEntry = {
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
  notes: string;
};

export type FootballEntry = {
  date: string;
  kind: 'partita' | 'allenamento';
  label: string;
  durationMin: number | null;
  avgPace: string;
  avgHeartRate: number | null;
  calories: number | null;
  trainingLoad: number | null;
  cadenceAvg: number | null;
  cadenceMax: number | null;
  strideAvg: number | null;
  strideMax: number | null;
  notes: string;
};

export type RecordEntry = {
  id: string;
  originalId: string;
  date: string;
  category: 'workout' | 'calcio' | 'corpo libero' | 'pesi' | 'core' | 'altro';
  discipline: string;
  name: string;
  value: string;
  unit: string;
  context: string;
  notes: string;
};

export type MacroEntry = {
  date: string;
  caloriesIn: number | null;
  caloriesBurned: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  notes: string;
};

export type ProgressionEntry = {
  group: 'Push' | 'Pull' | 'Legs';
  exercise: string;
  status: string;
};

export type MeasurementEntry = {
  date: string;
  weight: number | null;
  waist: number | null;
  hips: number | null;
  chest: number | null;
  leftArm: number | null;
  rightArm: number | null;
  thigh: number | null;
  shoulders: number | null;
};

export type ExerciseEntry = {
  exercise: string;
  sets: number | null;
  reps: string;
  weight: string;
  rir: string;
  notes: string;
};

export type WorkoutEntry = {
  id: string;
  originalId: string;
  date: string;
  title: string;
  exercises: ExerciseEntry[];
  volume: number | null;
  averageRir: number | null;
};

export type CoachInsight = {
  id: string;
  category: 'readiness' | 'nutrition' | 'progression' | 'planning' | 'recovery' | 'data';
  tone: 'good' | 'watch' | 'risk';
  title: string;
  message: string;
  action: string;
  metric?: string;
};

export type CoachPlan = {
  status: 'good' | 'watch' | 'risk';
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

export type DashboardPayload = {
  selectedDate: string;
  period: Period;
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

export type AiChatMessage = {
  role: 'user' | 'assistant';
  content: string;
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

export type AiChatResponse = {
  answer: string;
  sources: string[];
  proposals?: AiWriteProposal[];
  clarifications?: AiClarification[];
};
