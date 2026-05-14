import cors from 'cors';
import express from 'express';
import { z } from 'zod';
import {
  dailyEntrySchema,
  footballEntrySchema,
  macroEntrySchema,
  measurementEntrySchema,
  periodSchema,
  progressionEntrySchema,
  recordEntrySchema,
  workoutEntrySchema
} from './schemas';
import { askProjectAi } from './aiAssistant';
import { WikiStore } from './wikiStore';

const app = express();
const store = new WikiStore();
const port = Number(process.env.PORT ?? 4317);

app.use(cors());
app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, wikiRoot: store.wikiRoot });
});

app.get('/api/dashboard', async (req, res, next) => {
  try {
    const query = z
      .object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        period: periodSchema
      })
      .parse(req.query);
    res.json(await store.getDashboard(query.date, query.period));
  } catch (error) {
    next(error);
  }
});

app.get('/api/workout/:date', async (req, res, next) => {
  try {
    const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(req.params.date);
    res.json(await store.getWorkout(date));
  } catch (error) {
    next(error);
  }
});

app.get('/api/wiki-data', async (_req, res, next) => {
  try {
    res.json(await store.readWikiData());
  } catch (error) {
    next(error);
  }
});

app.post('/api/ai/chat', async (req, res, next) => {
  try {
    const body = z
      .object({
        mode: z.enum(['auto', 'coach', 'auditor']).default('auto'),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        messages: z
          .array(
            z.object({
              role: z.enum(['user', 'assistant']),
              content: z.string().min(1).max(6000)
            })
          )
          .min(1)
          .max(20)
      })
      .parse(req.body);
    res.json(await askProjectAi(store.repoRoot, body.messages, body.mode, body.date));
  } catch (error) {
    next(error);
  }
});

app.post('/api/workouts', async (req, res, next) => {
  try {
    res.json(await store.upsertWorkout(workoutEntrySchema.parse(req.body)));
  } catch (error) {
    next(error);
  }
});

app.delete('/api/workouts/:id', async (req, res, next) => {
  try {
    await store.deleteWorkout(req.params.id);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.get('/api/records', async (_req, res, next) => {
  try {
    res.json(await store.readRecords());
  } catch (error) {
    next(error);
  }
});

app.post('/api/daily', async (req, res, next) => {
  try {
    res.json(await store.upsertDaily(dailyEntrySchema.parse(req.body)));
  } catch (error) {
    next(error);
  }
});

app.post('/api/football', async (req, res, next) => {
  try {
    res.json(await store.upsertFootball(footballEntrySchema.parse(req.body)));
  } catch (error) {
    next(error);
  }
});

app.post('/api/macro', async (req, res, next) => {
  try {
    res.json(await store.upsertMacro(macroEntrySchema.parse(req.body)));
  } catch (error) {
    next(error);
  }
});

app.post('/api/measurements', async (req, res, next) => {
  try {
    res.json(await store.upsertMeasurement(measurementEntrySchema.parse(req.body)));
  } catch (error) {
    next(error);
  }
});

app.delete('/api/measurements/:date', async (req, res, next) => {
  try {
    const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(req.params.date);
    await store.deleteMeasurement(date);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.post('/api/progression', async (req, res, next) => {
  try {
    res.json(await store.upsertProgression(progressionEntrySchema.parse(req.body)));
  } catch (error) {
    next(error);
  }
});

app.post('/api/records', async (req, res, next) => {
  try {
    res.json(await store.upsertRecord(recordEntrySchema.parse(req.body)));
  } catch (error) {
    next(error);
  }
});

app.delete('/api/records/:id', async (req, res, next) => {
  try {
    await store.deleteRecord(req.params.id);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (error instanceof z.ZodError) {
    res.status(400).json({ error: 'Validation error', issues: error.issues });
    return;
  }
  console.error(error);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(port, '127.0.0.1', () => {
  console.log(`Dashboard API listening on http://127.0.0.1:${port}`);
});
