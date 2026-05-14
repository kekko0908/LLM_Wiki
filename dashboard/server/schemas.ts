import { z } from 'zod';

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const optionalNumber = z.preprocess(
  (value) => (value === '' || value === undefined ? null : value),
  z.coerce.number().finite().optional().nullable()
);
const score = z.preprocess(
  (value) => (value === '' || value === undefined ? null : value),
  z.coerce.number().min(0).max(100).optional().nullable()
);
const text = z.string().optional().default('');

export const periodSchema = z.enum(['day', 'week', 'month']).default('day');

export const dailyEntrySchema = z.object({
  date: dateSchema,
  physicalRecovery: score,
  mentalRecovery: score,
  energy: score,
  stress: score,
  sleepQuality: score,
  doms: score,
  hunger: score,
  restingHeartRate: optionalNumber,
  sleepHours: optionalNumber,
  steps: optionalNumber,
  notes: text
});

export const footballEntrySchema = z.object({
  date: dateSchema,
  kind: z.enum(['partita', 'allenamento']).default('partita'),
  label: text,
  durationMin: optionalNumber,
  avgPace: text,
  avgHeartRate: optionalNumber,
  calories: optionalNumber,
  trainingLoad: optionalNumber,
  cadenceAvg: optionalNumber,
  cadenceMax: optionalNumber,
  strideAvg: optionalNumber,
  strideMax: optionalNumber,
  notes: text
});

export const macroEntrySchema = z.object({
  date: dateSchema,
  caloriesIn: optionalNumber,
  caloriesBurned: optionalNumber,
  protein: optionalNumber,
  carbs: optionalNumber,
  fat: optionalNumber,
  notes: text
});

export const measurementEntrySchema = z.object({
  date: dateSchema,
  weight: optionalNumber,
  waist: optionalNumber,
  hips: optionalNumber,
  chest: optionalNumber,
  leftArm: optionalNumber,
  rightArm: optionalNumber,
  thigh: optionalNumber,
  shoulders: optionalNumber
});

export const progressionEntrySchema = z.object({
  group: z.enum(['Push', 'Pull', 'Legs']),
  exercise: z.string().min(1),
  status: z.string().min(1)
});

export const exerciseEntrySchema = z.object({
  exercise: z.string().min(1),
  sets: optionalNumber,
  reps: text,
  weight: text,
  rir: text,
  notes: text
});

export const workoutEntrySchema = z.object({
  id: text,
  originalId: text,
  date: dateSchema,
  title: z.string().min(1),
  exercises: z.array(exerciseEntrySchema).min(1),
  volume: optionalNumber,
  averageRir: optionalNumber
});

export const recordEntrySchema = z.object({
  id: text,
  originalId: text,
  date: dateSchema,
  category: z.enum(['workout', 'calcio', 'corpo libero', 'pesi', 'core', 'altro']).default('workout'),
  discipline: text,
  name: z.string().min(1),
  value: z.string().min(1),
  unit: text,
  context: text,
  notes: text
});

export type DailyEntry = z.infer<typeof dailyEntrySchema>;
export type FootballEntry = z.infer<typeof footballEntrySchema>;
export type MacroEntry = z.infer<typeof macroEntrySchema>;
export type MeasurementEntry = z.infer<typeof measurementEntrySchema>;
export type ExerciseEntry = z.infer<typeof exerciseEntrySchema>;
export type WorkoutEntry = z.infer<typeof workoutEntrySchema>;
export type RecordEntry = z.infer<typeof recordEntrySchema>;
