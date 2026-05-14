import type {
  DailyEntry,
  AiMode,
  AiChatMessage,
  AiChatResponse,
  DashboardPayload,
  FootballEntry,
  MacroEntry,
  MeasurementEntry,
  Period,
  ProgressionEntry,
  RecordEntry,
  WikiDataPayload,
  WorkoutEntry
} from '../types';

export async function fetchDashboard(date: string, period: Period): Promise<DashboardPayload> {
  const response = await fetch(`/api/dashboard?date=${date}&period=${period}`);
  return parseResponse(response);
}

export async function askAi(messages: AiChatMessage[], mode: AiMode, date: string): Promise<AiChatResponse> {
  const response = await fetch('/api/ai/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, mode, date })
  });
  return parseResponse(response);
}

export async function saveDaily(entry: DailyEntry): Promise<DailyEntry> {
  const response = await fetch('/api/daily', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(entry)
  });
  return parseResponse(response);
}

export async function saveFootball(entry: FootballEntry): Promise<FootballEntry> {
  const response = await fetch('/api/football', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(entry)
  });
  return parseResponse(response);
}

export async function saveMacro(entry: MacroEntry): Promise<MacroEntry> {
  const response = await fetch('/api/macro', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(entry)
  });
  return parseResponse(response);
}

export async function saveMeasurement(entry: MeasurementEntry): Promise<MeasurementEntry> {
  const response = await fetch('/api/measurements', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(entry)
  });
  return parseResponse(response);
}

export async function deleteMeasurement(date: string): Promise<{ ok: true }> {
  const response = await fetch(`/api/measurements/${encodeURIComponent(date)}`, { method: 'DELETE' });
  return parseResponse(response);
}

export async function saveProgression(entry: ProgressionEntry): Promise<ProgressionEntry> {
  const response = await fetch('/api/progression', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(entry)
  });
  return parseResponse(response);
}

export async function fetchRecords(): Promise<RecordEntry[]> {
  const response = await fetch('/api/records');
  return parseResponse(response);
}

export async function fetchWikiData(): Promise<WikiDataPayload> {
  const response = await fetch('/api/wiki-data');
  return parseResponse(response);
}

export async function saveWorkout(entry: WorkoutEntry): Promise<WorkoutEntry> {
  const response = await fetch('/api/workouts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(entry)
  });
  return parseResponse(response);
}

export async function saveRecord(entry: RecordEntry): Promise<RecordEntry> {
  const response = await fetch('/api/records', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(entry)
  });
  return parseResponse(response);
}

export async function deleteRecord(id: string): Promise<{ ok: true }> {
  const response = await fetch(`/api/records/${encodeURIComponent(id)}`, { method: 'DELETE' });
  return parseResponse(response);
}

async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(error.error ?? 'Request failed');
  }
  return response.json() as Promise<T>;
}
