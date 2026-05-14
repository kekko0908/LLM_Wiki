import {
  Activity,
  AlertTriangle,
  Bot,
  BookOpen,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Dumbbell,
  HeartPulse,
  ListChecks,
  Mic,
  MicOff,
  Moon,
  Plus,
  Save,
  Scale,
  Send,
  Trash2,
  TrendingUp,
  Trophy,
  X
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import {
  askAi,
  deleteRecord,
  deleteMeasurement,
  fetchDashboard,
  fetchRecords,
  fetchWikiData,
  saveDaily,
  saveFootball,
  saveMacro,
  saveMeasurement,
  saveProgression,
  saveRecord,
  saveWorkout
} from './lib/api';
import { readableDate, shiftDateByPeriod, todayIso } from './lib/date';
import type {
  AiChatMessage,
  AiClarification,
  AiMode,
  AiWriteProposal,
  DailyEntry,
  DashboardPayload,
  FootballEntry,
  MacroEntry,
  MeasurementEntry,
  Period,
  CoachPayload,
  ProgressionEntry,
  RecordEntry,
  WikiDataPayload,
  WorkoutEntry
} from './types';

type BrowserSpeechRecognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((event: { results: ArrayLike<{ 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
};

declare global {
  interface Window {
    SpeechRecognition?: new () => BrowserSpeechRecognition;
    webkitSpeechRecognition?: new () => BrowserSpeechRecognition;
  }
}

const emptyDaily = (date: string): DailyEntry => ({
  date,
  physicalRecovery: null,
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

const emptyFootball = (date: string): FootballEntry => ({
  date,
  kind: 'partita',
  label: '',
  durationMin: null,
  avgPace: '',
  avgHeartRate: null,
  calories: null,
  trainingLoad: null,
  cadenceAvg: null,
  cadenceMax: null,
  strideAvg: null,
  strideMax: null,
  notes: ''
});

const emptyMacro = (date: string): MacroEntry => ({
  date,
  caloriesIn: null,
  caloriesBurned: null,
  protein: null,
  carbs: null,
  fat: null,
  notes: ''
});

const emptyMeasurement = (date: string): MeasurementEntry => ({
  date,
  weight: null,
  waist: null,
  hips: null,
  chest: null,
  leftArm: null,
  rightArm: null,
  thigh: null,
  shoulders: null
});

const emptyRecord = (date: string): RecordEntry => ({
  id: '',
  originalId: '',
  date,
  category: 'workout',
  discipline: '',
  name: '',
  value: '',
  unit: '',
  context: '',
  notes: ''
});

const emptyWorkout = (date: string): WorkoutEntry => ({
  id: '',
  originalId: '',
  date,
  title: '',
  exercises: [{ exercise: '', sets: 3, reps: '', weight: '', rir: '', notes: '' }],
  volume: null,
  averageRir: null
});

type View = 'overview' | 'diary' | 'training' | 'records' | 'progression' | 'body' | 'profile' | 'schedule' | 'definitions';
type DailyPlanWorkout = 'PULL' | 'PUSH' | 'LEGS' | 'REST' | 'CALCIO';

const sectionViews: Array<{ view: View; label: string; Icon: typeof HeartPulse }> = [
  { view: 'overview', label: 'Panoramica', Icon: HeartPulse },
  { view: 'diary', label: 'Diario', Icon: Moon },
  { view: 'training', label: 'Allenamenti', Icon: Dumbbell },
  { view: 'records', label: 'Record', Icon: ClipboardList },
  { view: 'progression', label: 'Progressione', Icon: TrendingUp },
  { view: 'body', label: 'Misure corpo', Icon: Scale },
  { view: 'profile', label: 'Profilo', Icon: ListChecks },
  { view: 'schedule', label: 'Programmazione', Icon: CalendarDays },
  { view: 'definitions', label: 'Definizioni', Icon: BookOpen }
];

const scoreFields: Array<[keyof DailyEntry, string]> = [
  ['physicalRecovery', 'Recupero fisico'],
  ['mentalRecovery', 'Recupero mentale'],
  ['stress', 'Stress'],
  ['sleepQuality', 'Qualita sonno']
];

const metricFields: Array<[keyof DailyEntry, string, string]> = [
  ['restingHeartRate', 'FC riposo', 'bpm'],
  ['sleepHours', 'Ore sonno', 'h'],
  ['steps', 'Passi', '']
];

export default function App() {
  const [date, setDate] = useState(todayIso());
  const [period, setPeriod] = useState<Period>('day');
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [chartData, setChartData] = useState<DashboardPayload | null>(null);
  const [dailyForm, setDailyForm] = useState<DailyEntry>(emptyDaily(date));
  const [macroForm, setMacroForm] = useState<MacroEntry>(emptyMacro(date));
  const [measurementForm, setMeasurementForm] = useState<MeasurementEntry>(emptyMeasurement(date));
  const [footballForm, setFootballForm] = useState<FootballEntry>(emptyFootball(date));
  const [workoutForm, setWorkoutForm] = useState<WorkoutEntry>(emptyWorkout(date));
  const [trainingInputType, setTrainingInputType] = useState<'calcio' | 'workout'>('calcio');
  const [recordForm, setRecordForm] = useState<RecordEntry>(emptyRecord(date));
  const [records, setRecords] = useState<RecordEntry[]>([]);
  const [wikiData, setWikiData] = useState<WikiDataPayload | null>(null);
  const [activeView, setActiveView] = useState<View>('overview');
  const [showCalendar, setShowCalendar] = useState(false);
  const [showMeasurementForm, setShowMeasurementForm] = useState(false);
  const [openWorkoutDate, setOpenWorkoutDate] = useState<string | null>(null);
  const [status, setStatus] = useState('');

  useEffect(() => {
    if (!status) return;
    const timer = window.setTimeout(() => setStatus(''), 2000);
    return () => window.clearTimeout(timer);
  }, [status]);

  useEffect(() => {
    let active = true;
    const chartPeriod: Period = period === 'month' ? 'month' : 'week';
    fetchDashboard(date, period)
      .then((payload) => {
        if (!active) return;
        setData(payload);
        setDailyForm(payload.daily ?? emptyDaily(date));
        setMacroForm(payload.macro ?? emptyMacro(date));
        setMeasurementForm(payload.measurement?.date === date ? payload.measurement : emptyMeasurement(date));
        setFootballForm(payload.football[0] ?? emptyFootball(date));
      })
      .catch((error: Error) => setStatus(error.message));
    fetchDashboard(date, chartPeriod)
      .then((payload) => {
        if (active) setChartData(payload);
      })
      .catch((error: Error) => setStatus(error.message));
    return () => {
      active = false;
    };
  }, [date, period]);

  useEffect(() => {
    fetchRecords()
      .then(setRecords)
      .catch((error: Error) => setStatus(error.message));
    fetchWikiData()
      .then(setWikiData)
      .catch((error: Error) => setStatus(error.message));
  }, []);

  useEffect(() => {
    setRecordForm((current) => ({ ...current, date }));
    setWorkoutForm((current) => ({ ...current, date }));
    setMacroForm((current) => ({ ...current, date }));
    setMeasurementForm((current) => ({ ...current, date }));
  }, [date]);

  const readiness = data?.coach.readiness ?? 0;

  async function reload() {
    const payload = await fetchDashboard(date, period);
    setData(payload);
    const chartPayload = await fetchDashboard(date, period === 'month' ? 'month' : 'week');
    setChartData(chartPayload);
    return payload;
  }

  async function submitDaily(event: React.FormEvent) {
    event.preventDefault();
    setStatus('Salvataggio diario...');
    await saveDaily(dailyForm);
    await reload();
    setStatus('Diario giornaliero salvato.');
  }

  async function submitFootball(event: React.FormEvent) {
    event.preventDefault();
    setStatus('Salvataggio attivita...');
    await saveFootball(footballForm);
    await reload();
    setFootballForm(emptyFootball(date));
    setStatus('Attivita salvata.');
  }

  async function submitMacro(event: React.FormEvent) {
    event.preventDefault();
    setStatus('Salvataggio nutrizione...');
    await saveMacro(macroForm);
    await reload();
    setStatus('Nutrizione salvata.');
  }

  async function submitMeasurement(event: React.FormEvent) {
    event.preventDefault();
    setStatus('Salvataggio misure...');
    await saveMeasurement(measurementForm);
    await reload();
    setWikiData(await fetchWikiData());
    setShowMeasurementForm(false);
    setStatus('Misure salvate.');
  }

  async function submitWorkout(event: React.FormEvent) {
    event.preventDefault();
    setStatus('Salvataggio workout...');
    await saveWorkout(workoutForm);
    await reload();
    setWorkoutForm(emptyWorkout(date));
    setStatus('Workout salvato.');
  }

  async function submitRecord(event: React.FormEvent) {
    event.preventDefault();
    setStatus('Salvataggio record...');
    await saveRecord(recordForm);
    setRecords(await fetchRecords());
    setRecordForm(emptyRecord(date));
    setStatus('Record salvato.');
  }

  async function removeRecord(id: string) {
    setStatus('Eliminazione record...');
    await deleteRecord(id);
    setRecords(await fetchRecords());
    if (recordForm.id === id || recordForm.originalId === id) {
      setRecordForm(emptyRecord(date));
    }
    setStatus('Record eliminato.');
  }

  async function submitProgression(entry: ProgressionEntry) {
    setStatus('Aggiornamento progressione...');
    await saveProgression(entry);
    setWikiData(await fetchWikiData());
    setStatus('Progressione aggiornata.');
  }

  async function removeMeasurement(dateToDelete: string) {
    setStatus('Eliminazione misura...');
    await deleteMeasurement(dateToDelete);
    await reload();
    setWikiData(await fetchWikiData());
    if (measurementForm.date === dateToDelete) {
      setMeasurementForm(emptyMeasurement(date));
      setShowMeasurementForm(false);
    }
    setStatus('Misura eliminata.');
  }

  async function submitScheduleOverride(targetDate: string, workout: DailyPlanWorkout) {
    setStatus('Aggiornamento programmazione...');
    const payload = await fetchDashboard(targetDate, 'day');
    await saveDaily({
      ...(payload.daily ?? emptyDaily(targetDate)),
      date: targetDate,
      notes: setProgramNote(payload.daily?.notes ?? '', workout)
    });
    await reload();
    setStatus('Programmazione aggiornata.');
  }

  return (
    <main className="shell">
      <header className="topbar">
        <section className="date-panel">
          <button className="icon-button" title="Periodo precedente" onClick={() => setDate(shiftDateByPeriod(date, period, -1))}>
            <ChevronLeft size={20} />
          </button>
          <div className="date-core">
            <button className="date-button" onClick={() => setShowCalendar((value) => !value)}>
              <CalendarDays size={18} />
              <span>{readableDate(date)}</span>
            </button>
            {showCalendar && (
              <input
                className="calendar-popover"
                type="date"
                value={date}
                onChange={(event) => {
                  setDate(event.target.value);
                  setShowCalendar(false);
                }}
              />
            )}
          </div>
          <button className="icon-button" title="Periodo successivo" onClick={() => setDate(shiftDateByPeriod(date, period, 1))}>
            <ChevronRight size={20} />
          </button>
        </section>

        <section className="period-switch" aria-label="Periodo">
          {(['day', 'week', 'month'] as Period[]).map((item) => (
            <button key={item} className={period === item ? 'active' : ''} onClick={() => setPeriod(item)}>
              {item === 'day' ? 'Giorno' : item === 'week' ? 'Settimana' : 'Mese'}
            </button>
          ))}
        </section>
      </header>

      {status && <div className="status">{status}</div>}

      <nav className="section-nav" aria-label="Sezioni dashboard">
        {sectionViews.map(({ view, label, Icon }) => (
          <button
            key={view}
            className={activeView === view ? 'active' : ''}
            onClick={() => setActiveView(view)}
          >
            <Icon size={17} />
            {label}
          </button>
        ))}
      </nav>

      {activeView === 'overview' && (
        <>
          <section className="overview-grid">
            <article className="readiness-card">
              <div>
                <p className="eyebrow">Panoramica</p>
                <h1>{readiness || '--'}</h1>
              </div>
              <div className="gauge" style={{ '--value': `${readiness}%` } as React.CSSProperties}>
                <HeartPulse size={38} />
              </div>
              <p>
                {period === 'day'
                  ? 'Quadro del giorno selezionato'
                  : `Media dal ${data?.range.from} al ${data?.range.to}`}
              </p>
            </article>
            <MetricStrip data={data} />
            <OverviewPanel data={data} />
            <CoachPanel coach={data?.coach ?? null} />
          </section>
          <section className="main-grid">
            <Panel title="Trend recupero" icon={<Activity size={18} />}>
              <RecoveryChart data={chartData} />
            </Panel>
            <Panel title="Macro, calorie e passi" icon={<HeartPulse size={18} />}>
              <NutritionChart data={chartData} />
            </Panel>
          </section>
        </>
      )}

      {activeView === 'diary' && (
        <section className="main-grid">
          <Panel title="Diario giornaliero" icon={<Moon size={18} />}>
            <DailyForm form={dailyForm} onChange={setDailyForm} onSubmit={submitDaily} />
          </Panel>
          <Panel title="Nutrizione manuale" icon={<HeartPulse size={18} />}>
            <MacroForm form={macroForm} onChange={setMacroForm} onSubmit={submitMacro} />
          </Panel>
        </section>
      )}

      {activeView === 'training' && (
        <section className="main-grid">
          <Panel title="Allenamenti" icon={<Dumbbell size={18} />}>
            <TrainingPanel
              data={data}
              openWorkoutDate={openWorkoutDate}
              onToggleWorkout={(workoutDate) =>
                setOpenWorkoutDate((current) => (current === workoutDate ? null : workoutDate))
              }
              onEditFootball={(entry) => {
                setFootballForm(entry);
                setTrainingInputType('calcio');
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              onEditWorkout={(entry) => {
                setWorkoutForm(entry);
                setTrainingInputType('workout');
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
            />
          </Panel>
          <Panel title="Inserimento allenamento" icon={<Trophy size={18} />}>
            <TrainingInput
              type={trainingInputType}
              onTypeChange={setTrainingInputType}
              footballForm={footballForm}
              workoutForm={workoutForm}
              presets={wikiData?.presets ?? []}
              onFootballChange={setFootballForm}
              onWorkoutChange={setWorkoutForm}
              onFootballSubmit={submitFootball}
              onWorkoutSubmit={submitWorkout}
              onNewFootball={() => setFootballForm(emptyFootball(date))}
              onNewWorkout={() => setWorkoutForm(emptyWorkout(date))}
            />
          </Panel>
        </section>
      )}

      {activeView === 'records' && (
        <section className="main-grid">
          <Panel title="Nuovo record" icon={<ClipboardList size={18} />}>
            <RecordForm form={recordForm} onChange={setRecordForm} onSubmit={submitRecord} />
          </Panel>
          <Panel title="Record personali" icon={<Trophy size={18} />}>
            <RecordList records={records} onEdit={setRecordForm} onDelete={removeRecord} />
          </Panel>
        </section>
      )}

      {activeView === 'progression' && (
        <section className="single-grid wide-grid">
          <Panel title="Progressione carichi" icon={<TrendingUp size={18} />}>
            <ProgressionView data={wikiData} onSave={submitProgression} />
          </Panel>
        </section>
      )}

      {activeView === 'body' && (
        <section className={showMeasurementForm ? 'main-grid' : 'single-grid wide-grid'}>
          <Panel title="Misure corpo" icon={<Scale size={18} />}>
            <MeasurementsView
              data={wikiData}
              onAdd={() => {
                setMeasurementForm(emptyMeasurement(date));
                setShowMeasurementForm(true);
              }}
              onEdit={(entry) => {
                setMeasurementForm(entry);
                setShowMeasurementForm(true);
              }}
              onDelete={removeMeasurement}
            />
          </Panel>
          {showMeasurementForm && (
            <Panel title="Aggiungi o modifica misura" icon={<Scale size={18} />}>
              <MeasurementForm
                form={measurementForm}
                onChange={setMeasurementForm}
                onSubmit={submitMeasurement}
                onCancel={() => {
                  setMeasurementForm(emptyMeasurement(date));
                  setShowMeasurementForm(false);
                }}
              />
            </Panel>
          )}
        </section>
      )}

      {activeView === 'profile' && (
        <section className="single-grid wide-grid">
          <Panel title="Profilo" icon={<ListChecks size={18} />}>
            <ProfileView data={wikiData} />
          </Panel>
        </section>
      )}

      {activeView === 'schedule' && (
        <section className="single-grid wide-grid">
          <Panel title="Programmazione settimanale" icon={<CalendarDays size={18} />}>
            <ScheduleView data={wikiData} dashboard={data} selectedDate={date} onMove={submitScheduleOverride} />
          </Panel>
        </section>
      )}

      {activeView === 'definitions' && (
        <section className="single-grid wide-grid">
          <Panel title="Definizioni" icon={<BookOpen size={18} />}>
            <DefinitionsView data={wikiData} />
          </Panel>
        </section>
      )}

      <AiAssistant date={date} period={period} onApplied={reload} />
    </main>
  );
}

function AiAssistant({ date, period, onApplied }: { date: string; period: Period; onApplied: () => Promise<DashboardPayload> }) {
  const initialMessage: AiChatMessage = {
    role: 'assistant',
    content:
      'Chiedimi qualcosa sulla wiki: tracking, allenamenti, calcio, nutrizione, misure, progressione, profilo, programmazione e record.'
  };
  const quickActions = [
    {
      icon: '📅',
      label: 'Analizza giorno',
      prompt: `Analizza il giorno ${date}: dammi quadro sintetico, dati presenti, dati mancanti e priorita operative dalla wiki.`
    },
    {
      icon: '📈',
      label: 'Trend periodo',
      prompt: `Analizza il periodo ${period}: recupero, allenamenti, nutrizione, passi e coerenza dei dati nella wiki.`
    },
    {
      icon: '🏋️',
      label: 'Progressione',
      prompt: `Controlla la progressione carichi per il giorno ${date}: dimmi cosa aumentare, cosa mantenere e cosa monitorare.`
    },
    {
      icon: '🧩',
      label: 'Dati mancanti',
      prompt: `Controlla nella wiki quali dati importanti mancano per il giorno ${date} tra diario, macro, allenamenti, calcio, recupero e misure.`
    },
    {
      icon: '🍽️',
      label: 'Nutrizione',
      prompt: `Analizza nutrizione e macro per il giorno ${date}: calorie, proteine, carboidrati, grassi, coerenza con obiettivi e dati mancanti.`
    },
    {
      icon: '🛌',
      label: 'Recupero',
      prompt: `Analizza recupero per il giorno ${date}: sonno, stress, recupero fisico, recupero mentale, carico allenante e cosa fare domani.`
    },
    {
      icon: '🏆',
      label: 'Record',
      prompt: 'Controlla i record personali nella wiki e dimmi se dagli ultimi allenamenti o calcio ci sono record da aggiornare o monitorare.'
    },
    {
      icon: '🗓️',
      label: 'Programma',
      prompt: 'Guarda programmazione settimanale e dati recenti nella wiki: suggerisci come organizzare i prossimi allenamenti considerando calcio e recupero.'
    }
  ];
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<AiChatMessage[]>([initialMessage]);
  const [sources, setSources] = useState<string[]>([]);
  const [proposals, setProposals] = useState<AiWriteProposal[]>([]);
  const [clarifications, setClarifications] = useState<AiClarification[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingSeconds, setLoadingSeconds] = useState(0);
  const [listening, setListening] = useState(false);
  const [aiMode, setAiMode] = useState<AiMode>('auto');
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);

  useEffect(() => {
    if (!loading) {
      setLoadingSeconds(0);
      return;
    }
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      setLoadingSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 250);
    return () => window.clearInterval(timer);
  }, [loading]);

  function clearChat() {
    setMessages([initialMessage]);
    setSources([]);
    setProposals([]);
    setClarifications([]);
    setInput('');
  }

  async function sendQuestion(question: string) {
    if (!question || loading) return;
    const nextMessages: AiChatMessage[] = [...messages, { role: 'user', content: question }];
    setMessages(nextMessages);
    setInput('');
    setLoading(true);
    try {
      const response = await askAi(nextMessages.filter((message) => message.content.trim()), aiMode, date);
      setMessages([...nextMessages, { role: 'assistant', content: response.answer }]);
      setSources(response.sources);
      setProposals(response.proposals ?? []);
      setClarifications(response.clarifications ?? []);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Errore AI locale.';
      setMessages([...nextMessages, { role: 'assistant', content: message }]);
    } finally {
      setLoading(false);
    }
  }

  async function applyProposal(proposal: AiWriteProposal) {
    if (proposal.type === 'daily') {
      const payload = await fetchDashboard(proposal.date, 'day');
      await saveDaily({ ...(payload.daily ?? emptyDaily(proposal.date)), ...proposal.fields, date: proposal.date });
    }
    if (proposal.type === 'macro') {
      const payload = await fetchDashboard(proposal.date, 'day');
      await saveMacro({ ...(payload.macro ?? emptyMacro(proposal.date)), ...proposal.fields, date: proposal.date });
    }
    if (proposal.type === 'workout') {
      await saveWorkout({
        ...emptyWorkout(proposal.date),
        title: String(proposal.fields.title ?? 'Workout'),
        exercises: Array.isArray(proposal.fields.exercises)
          ? proposal.fields.exercises.map((exercise) => ({
              exercise: String(exercise.exercise ?? ''),
              sets: typeof exercise.sets === 'number' ? exercise.sets : null,
              reps: String(exercise.reps ?? ''),
              weight: String(exercise.weight ?? ''),
              rir: String(exercise.rir ?? ''),
              notes: String(exercise.notes ?? '')
            }))
          : emptyWorkout(proposal.date).exercises
      });
    }
    if (proposal.type === 'football') {
      await saveFootball({
        ...emptyFootball(proposal.date),
        kind: proposal.fields.kind === 'allenamento' ? 'allenamento' : 'partita',
        label: String(proposal.fields.label ?? ''),
        durationMin: typeof proposal.fields.durationMin === 'number' ? proposal.fields.durationMin : null,
        avgHeartRate: typeof proposal.fields.avgHeartRate === 'number' ? proposal.fields.avgHeartRate : null,
        calories: typeof proposal.fields.calories === 'number' ? proposal.fields.calories : null,
        trainingLoad: typeof proposal.fields.trainingLoad === 'number' ? proposal.fields.trainingLoad : null
      });
    }
    await onApplied();
    setProposals((current) => current.filter((item) => item.id !== proposal.id));
    setMessages((current) => [
      ...current,
      {
        role: 'assistant',
        content: `Modifica applicata in ${proposal.targetFile}.`
      }
    ]);
  }

  function chooseClarification(clarification: AiClarification, proposal: AiWriteProposal) {
    setClarifications((current) => current.filter((item) => item.id !== clarification.id));
    setProposals((current) => [...current.filter((item) => item.id !== proposal.id), proposal]);
    setMessages((current) => [
      ...current,
      {
        role: 'assistant',
        content: `Ok, preparo questa proposta: ${proposal.title}. Controlla i campi e premi Applica se va bene.`
      }
    ]);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    await sendQuestion(input.trim());
  }

  function toggleVoiceInput() {
    const SpeechRecognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setInput((current) => `${current} Il browser non supporta il microfono per dettatura.`.trim());
      return;
    }
    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = 'it-IT';
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript?.trim();
      if (transcript) {
        setInput((current) => [current, transcript].filter(Boolean).join(' '));
      }
    };
    recognition.onend = () => setListening(false);
    recognition.onerror = () => setListening(false);
    recognitionRef.current = recognition;
    setListening(true);
    recognition.start();
  }

  return (
    <div className={`ai-widget ${open ? 'open' : ''}`}>
      {open && (
        <section className="ai-panel" aria-label="Assistente AI locale">
          <header className="ai-header">
            <div>
              <span>Assistente locale</span>
              <strong>{aiMode === 'auditor' ? 'Auditor AI' : aiMode === 'coach' ? 'Coach AI' : 'Auto AI'}</strong>
            </div>
            <div className="ai-header-actions">
              <button className="ai-header-button" type="button" title="Pulisci chat" onClick={clearChat}>
                <Trash2 size={16} />
              </button>
              <button className="ai-header-button" type="button" title="Chiudi AI" onClick={() => setOpen(false)}>
                <X size={18} />
              </button>
            </div>
          </header>
          <div className="ai-mode-switch" aria-label="Modalita AI">
            <button className={aiMode === 'auto' ? 'active' : ''} type="button" onClick={() => setAiMode('auto')}>
              Auto
            </button>
            <button className={aiMode === 'coach' ? 'active' : ''} type="button" onClick={() => setAiMode('coach')}>
              Coach
            </button>
            <button className={aiMode === 'auditor' ? 'active' : ''} type="button" onClick={() => setAiMode('auditor')}>
              Auditor
            </button>
          </div>
          <div className="ai-messages">
            {messages.map((message, index) => (
              <article className={`ai-message ${message.role}`} key={`${message.role}-${index}`}>
                <AiMessageContent message={message} />
              </article>
            ))}
            {loading && <AiThinking seconds={loadingSeconds} />}
          </div>
          <div className="ai-quick-actions" aria-label="Azioni rapide AI">
            {quickActions.map((action) => (
              <button
                key={action.label}
                type="button"
                disabled={loading}
                title={action.prompt}
                onClick={() => sendQuestion(action.prompt)}
              >
                <span>{action.icon}</span>
                {action.label}
              </button>
            ))}
          </div>
          {sources.length > 0 && (
            <details className="ai-sources">
              <summary>
                <span>Fonti usate</span>
                <small>{sources.length}</small>
              </summary>
              <p>{sources.slice(0, 5).join(' · ')}</p>
            </details>
          )}
          {clarifications.length > 0 && (
            <AiClarificationList
              clarifications={clarifications}
              onChoose={chooseClarification}
              onCancel={(clarification) =>
                setClarifications((current) => current.filter((item) => item.id !== clarification.id))
              }
            />
          )}
          {proposals.length > 0 && (
            <AiProposalList
              proposals={proposals}
              onApply={applyProposal}
              onCancel={(proposal) => setProposals((current) => current.filter((item) => item.id !== proposal.id))}
            />
          )}
          <form className="ai-form" onSubmit={submit}>
            <input
              value={input}
              placeholder="Chiedi alla AI locale..."
              onChange={(event) => setInput(event.target.value)}
            />
            <button
              className={`voice-button ${listening ? 'listening' : ''}`}
              type="button"
              title={listening ? 'Ferma microfono' : 'Parla con il microfono'}
              onClick={toggleVoiceInput}
            >
              {listening ? <MicOff size={16} /> : <Mic size={16} />}
            </button>
            <button className="save-button" type="submit" disabled={loading}>
              <Send size={16} />
            </button>
          </form>
        </section>
      )}
      <button className="ai-badge" type="button" onClick={() => setOpen((value) => !value)} aria-label="Apri assistente AI">
        <Bot size={24} />
        <span>AI</span>
      </button>
    </div>
  );
}

function ProfileView({ data }: { data: WikiDataPayload | null }) {
  if (!data) return <p className="empty">Caricamento profilo...</p>;
  const findProfileValue = (label: string) =>
    data.profile.basics.find((item) => item.label.toLowerCase() === label.toLowerCase())?.value ?? '--';
  const operativeMetrics = [
    ['BMR stimato', findProfileValue('BMR')],
    ['Target', findProfileValue('Target')],
    ['Obiettivo', findProfileValue('Obiettivo')]
  ];
  return (
    <div className="profile-layout">
      <section className="sub-panel">
        <h3>Dati di base</h3>
        <div className="info-grid">
          {data.profile.basics.map((item) => (
            <div className="info-card" key={item.label}>
              <span>{item.label}</span>
              <strong>{item.value}</strong>
            </div>
          ))}
        </div>
      </section>
      <section className="sub-panel">
        <h3>Risultati operativi</h3>
        <div className="info-grid">
          {operativeMetrics.map(([label, value]) => (
            <div className="info-card emphasis" key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </div>
      </section>
      {data.profile.implications && (
        <section className="profile-note">
          <span>Implicazione pratica</span>
          <p>{data.profile.implications}</p>
        </section>
      )}
    </div>
  );
}

function ProgressionView({ data, onSave }: { data: WikiDataPayload | null; onSave: (entry: ProgressionEntry) => void }) {
  const [editing, setEditing] = useState<ProgressionEntry | null>(null);
  if (!data) return <p className="empty">Caricamento progressione...</p>;
  const parsedEditing = editing ? parseProgressionStatus(editing.status) : null;
  return (
    <div className="section-stack">
      <div className="progression-guide">
        <div className="guide-card increase">
          <span>Quando aumentare</span>
          <strong>Range alto completato</strong>
          <p>Tecnica pulita e RIR ancora coerente.</p>
        </div>
        <div className="guide-card hold">
          <span>Quando mantenere</span>
          <strong>Prestazione stabile</strong>
          <p>Carico ok, ma serve consolidare prima di salire.</p>
        </div>
        <div className="guide-card reduce">
          <span>Quando scaricare</span>
          <strong>Fatica o tecnica sporca</strong>
          <p>Riduci volume/carico o valuta deload.</p>
        </div>
      </div>
      {data.progression.map((group) => (
        <section className="sub-panel" key={group.group}>
          <h3>{group.group}</h3>
          <div className="progression-grid">
            {group.rows.map((row) => {
              const parsed = parseProgressionStatus(row.status);
              return (
                <article className="progression-card" key={row.exercise}>
                  <div>
                    <span>{group.group}</span>
                    <h4>{row.exercise}</h4>
                  </div>
                  <div className="progression-meta">
                    <div>
                      <small>Lavoro attuale</small>
                      <strong>{parsed.current}</strong>
                    </div>
                    <div>
                      <small>RIR</small>
                      <strong>{parsed.rir}</strong>
                    </div>
                  </div>
                  <p className={`decision-pill ${parsed.tone}`}>{parsed.decision}</p>
                  <button
                    className="ghost-button"
                    type="button"
                    onClick={() => setEditing({ group: group.group as ProgressionEntry['group'], exercise: row.exercise, status: row.status })}
                  >
                    Modifica progressione
                  </button>
                </article>
              );
            })}
          </div>
        </section>
      ))}
      {editing && parsedEditing && (
        <section className="progression-editor">
          <div>
            <span>{editing.group}</span>
            <h3>{editing.exercise}</h3>
          </div>
          <form
            className="form-grid"
            onSubmit={(event) => {
              event.preventDefault();
              onSave(editing);
              setEditing(null);
            }}
          >
            <TextField
              label="Lavoro attuale"
              value={parsedEditing.current}
              onChange={(value) =>
                setEditing((current) =>
                  current ? { ...current, status: buildProgressionStatus(value, parsedEditing.rir, parsedEditing.decision) } : current
                )
              }
            />
            <TextField
              label="RIR"
              value={parsedEditing.rir === '--' ? '' : parsedEditing.rir}
              onChange={(value) =>
                setEditing((current) =>
                  current ? { ...current, status: buildProgressionStatus(parsedEditing.current, value, parsedEditing.decision) } : current
                )
              }
            />
            <label className="field">
              <span>Decisione</span>
              <select
                value={parsedEditing.decision}
                onChange={(event) =>
                  setEditing((current) =>
                    current
                      ? { ...current, status: buildProgressionStatus(parsedEditing.current, parsedEditing.rir, event.target.value) }
                      : current
                  )
                }
              >
                <option value="mantieni">Mantieni</option>
                <option value="aumenta reps">Aumenta reps</option>
                <option value="aumenta carico">Aumenta carico</option>
                <option value="riduci volume">Riduci volume</option>
                <option value="deload">Deload</option>
              </select>
            </label>
            <label className="wide field">
              <span>Anteprima Markdown</span>
              <input value={editing.status} onChange={(event) => setEditing({ ...editing, status: event.target.value })} />
            </label>
            <div className="form-actions wide">
              <button className="ghost-button" type="button" onClick={() => setEditing(null)}>
                Annulla
              </button>
              <button className="save-button" type="submit">
                <Save size={17} />
                Salva progressione
              </button>
            </div>
          </form>
        </section>
      )}
    </div>
  );
}

function MeasurementsView({
  data,
  onAdd,
  onEdit,
  onDelete
}: {
  data: WikiDataPayload | null;
  onAdd: () => void;
  onEdit: (entry: MeasurementEntry) => void;
  onDelete: (date: string) => void;
}) {
  if (!data) return <p className="empty">Caricamento misure...</p>;
  return (
    <div className="measurement-stack">
      <div className="panel-actions">
        <button className="save-button" type="button" onClick={onAdd}>
          <Plus size={16} />
          Aggiungi misura
        </button>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Data</th>
              <th>Peso</th>
              <th>Vita</th>
              <th>Fianchi</th>
              <th>Petto</th>
              <th>Braccio sx</th>
              <th>Braccio dx</th>
              <th>Coscia</th>
              <th>Spalle</th>
              <th>Azioni</th>
            </tr>
          </thead>
          <tbody>
            {data.measurements.map((row) => (
              <tr key={row.date}>
                <td>{row.date}</td>
                <td>{display(row.weight)}</td>
                <td>{display(row.waist)}</td>
                <td>{display(row.hips)}</td>
                <td>{display(row.chest)}</td>
                <td>{display(row.leftArm)}</td>
                <td>{display(row.rightArm)}</td>
                <td>{display(row.thigh)}</td>
                <td>{display(row.shoulders)}</td>
                <td>
                  <div className="row-actions">
                    <button className="ghost-button" type="button" onClick={() => onEdit(row)}>
                      Modifica
                    </button>
                    <button className="ghost-button danger" type="button" onClick={() => onDelete(row.date)}>
                      Elimina
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ScheduleView({
  data,
  dashboard,
  selectedDate,
  onMove
}: {
  data: WikiDataPayload | null;
  dashboard: DashboardPayload | null;
  selectedDate: string;
  onMove: (date: string, workout: DailyPlanWorkout) => Promise<void>;
}) {
  const [mode, setMode] = useState<'dynamic' | 'two' | 'one'>('dynamic');
  if (!data) return <p className="empty">Caricamento programmazione...</p>;
  const selected = data.schedule.find((option) =>
    mode === 'two' ? option.title.toLowerCase().includes('2 partite') : option.title.toLowerCase().includes('1 partita')
  );
  const dynamicPlan = dashboard?.coach.plan;

  return (
    <div className="section-stack">
      <div className="schedule-selector" aria-label="Tipo settimana">
        <button className={mode === 'dynamic' ? 'active' : ''} type="button" onClick={() => setMode('dynamic')}>
          Dinamica
        </button>
        <button className={mode === 'two' ? 'active' : ''} type="button" onClick={() => setMode('two')}>
          2 partite Mer/Gio
        </button>
        <button className={mode === 'one' ? 'active' : ''} type="button" onClick={() => setMode('one')}>
          1 partita
        </button>
      </div>
      {mode === 'dynamic' ? (
        <section className="sub-panel">
          <h3>Settimana dinamica per {selectedDate}</h3>
          {!dynamicPlan ? (
            <p className="empty">Programmazione dinamica non disponibile.</p>
          ) : (
            <>
              <div className={`schedule-dynamic-header ${dynamicPlan.status}`}>
                <div>
                  <span>Oggi</span>
                  <strong>{dynamicPlan.nextWorkout}</strong>
                  <p>{dynamicPlan.today}</p>
                </div>
                <p>{dynamicPlan.reason}</p>
              </div>
              <div className="dynamic-schedule-grid">
                {dynamicPlan.calendar.map((day) => (
                  <article className={`dynamic-day ${day.source} ${day.date === selectedDate ? 'selected' : ''}`} key={day.date}>
                    <div>
                      <span>{day.label}</span>
                      <strong>{day.date}</strong>
                    </div>
                    <label className="field">
                      <span>Slot</span>
                      <select
                        value={day.workout}
                        disabled={day.source === 'actual'}
                        onChange={(event) => onMove(day.date, event.target.value as DailyPlanWorkout)}
                      >
                        {(['PULL', 'PUSH', 'LEGS', 'REST', 'CALCIO'] as DailyPlanWorkout[]).map((item) => (
                          <option key={item} value={item}>
                            {item}
                          </option>
                        ))}
                      </select>
                    </label>
                    <p>{day.reason}</p>
                  </article>
                ))}
              </div>
            </>
          )}
        </section>
      ) : (
        <section className="sub-panel">
          <h3>{selected?.title ?? 'Programmazione non trovata nella wiki.'}</h3>
          {selected && (
            <div className="schedule-grid">
              {selected.rows.map((row) => (
                <div className="schedule-card" key={`${selected.title}-${row.day}`}>
                  <span>{row.day}</span>
                  <strong>{row.workout}</strong>
                  <p>{row.details}</p>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function DefinitionsView({ data }: { data: WikiDataPayload | null }) {
  if (!data) return <p className="empty">Caricamento definizioni...</p>;
  return (
    <div className="definition-grid">
      {data.definitions.map((definition) => (
        <article className="definition-card" key={definition.slug}>
          <h3>{definition.title}</h3>
          <p>{definition.summary || 'Definizione disponibile nella wiki.'}</p>
        </article>
      ))}
    </div>
  );
}

function DailyForm({
  form,
  onChange,
  onSubmit
}: {
  form: DailyEntry;
  onChange: React.Dispatch<React.SetStateAction<DailyEntry>>;
  onSubmit: (event: React.FormEvent) => void;
}) {
  return (
    <form className="form-grid" onSubmit={onSubmit}>
      {scoreFields.map(([key, label]) => (
        <NumberField
          key={key}
          label={label}
          min={0}
          max={100}
          value={form[key] as number | null}
          onChange={(value) => onChange((current) => ({ ...current, [key]: value }))}
        />
      ))}
      {metricFields.map(([key, label, suffix]) => (
        <NumberField
          key={key}
          label={`${label}${suffix ? ` (${suffix})` : ''}`}
          value={form[key] as number | null}
          onChange={(value) => onChange((current) => ({ ...current, [key]: value }))}
        />
      ))}
      <label className="wide field">
        <span>Note</span>
        <textarea value={form.notes} onChange={(event) => onChange((current) => ({ ...current, notes: event.target.value }))} />
      </label>
      <button className="save-button wide" type="submit">
        <Save size={17} />
        Salva diario
      </button>
    </form>
  );
}

function MacroForm({
  form,
  onChange,
  onSubmit
}: {
  form: MacroEntry;
  onChange: React.Dispatch<React.SetStateAction<MacroEntry>>;
  onSubmit: (event: React.FormEvent) => void;
}) {
  return (
    <form className="form-grid" onSubmit={onSubmit}>
      <NumberField
        label="Kcal consumate"
        value={form.caloriesIn}
        onChange={(value) => onChange((current) => ({ ...current, caloriesIn: value }))}
      />
      <NumberField
        label="Kcal bruciate"
        value={form.caloriesBurned}
        onChange={(value) => onChange((current) => ({ ...current, caloriesBurned: value }))}
      />
      <NumberField
        label="Proteine (g)"
        value={form.protein}
        onChange={(value) => onChange((current) => ({ ...current, protein: value }))}
      />
      <NumberField
        label="Carboidrati (g)"
        value={form.carbs}
        onChange={(value) => onChange((current) => ({ ...current, carbs: value }))}
      />
      <NumberField
        label="Grassi (g)"
        value={form.fat}
        onChange={(value) => onChange((current) => ({ ...current, fat: value }))}
      />
      <label className="wide field">
        <span>Note nutrizione</span>
        <textarea value={form.notes} onChange={(event) => onChange((current) => ({ ...current, notes: event.target.value }))} />
      </label>
      <div className="metric-suggestion wide">
        <span>Metriche da valutare dopo</span>
        <p>Acqua, fibre, sale/sodio, digestione e timing pasti possono essere aggiunti se diventano utili davvero.</p>
      </div>
      <button className="save-button wide" type="submit">
        <Save size={17} />
        Salva nutrizione
      </button>
    </form>
  );
}

function MeasurementForm({
  form,
  onChange,
  onSubmit,
  onCancel
}: {
  form: MeasurementEntry;
  onChange: React.Dispatch<React.SetStateAction<MeasurementEntry>>;
  onSubmit: (event: React.FormEvent) => void;
  onCancel: () => void;
}) {
  return (
    <form className="form-grid compact-form" onSubmit={onSubmit}>
      <label className="wide field">
        <span>Data misura</span>
        <input type="date" value={form.date} onChange={(event) => onChange((current) => ({ ...current, date: event.target.value }))} />
      </label>
      <NumberField
        label="Peso (kg)"
        value={form.weight}
        onChange={(value) => onChange((current) => ({ ...current, weight: value }))}
      />
      <NumberField
        label="Vita (cm)"
        value={form.waist}
        onChange={(value) => onChange((current) => ({ ...current, waist: value }))}
      />
      <NumberField
        label="Fianchi (cm)"
        value={form.hips}
        onChange={(value) => onChange((current) => ({ ...current, hips: value }))}
      />
      <NumberField
        label="Petto (cm)"
        value={form.chest}
        onChange={(value) => onChange((current) => ({ ...current, chest: value }))}
      />
      <NumberField
        label="Braccio sx (cm)"
        value={form.leftArm}
        onChange={(value) => onChange((current) => ({ ...current, leftArm: value }))}
      />
      <NumberField
        label="Braccio dx (cm)"
        value={form.rightArm}
        onChange={(value) => onChange((current) => ({ ...current, rightArm: value }))}
      />
      <NumberField
        label="Coscia (cm)"
        value={form.thigh}
        onChange={(value) => onChange((current) => ({ ...current, thigh: value }))}
      />
      <NumberField
        label="Spalle (cm)"
        value={form.shoulders}
        onChange={(value) => onChange((current) => ({ ...current, shoulders: value }))}
      />
      <div className="form-actions wide">
        <button className="ghost-button" type="button" onClick={onCancel}>
          Annulla
        </button>
        <button className="save-button" type="submit">
          <Save size={17} />
          Salva misure
        </button>
      </div>
    </form>
  );
}

function RecoveryChart({ data }: { data: DashboardPayload | null }) {
  const ticks = chartTicks(data);
  const label = data?.period === 'month' ? 'mese calendario' : 'settimana calendario';
  return (
    <div className="chart-card">
      <p className="chart-caption chart-caption-top">Vista grafico: {label}</p>
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={data?.series ?? []}>
          <CartesianGrid strokeDasharray="3 3" stroke="#d9dfd8" />
          <XAxis dataKey="date" ticks={ticks} tickFormatter={formatChartDate} tick={{ fontSize: 11 }} interval={0} />
          <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
          <Tooltip />
          <Line type="monotone" dataKey="physicalRecovery" name="Rec. fisico" stroke="#278b57" strokeWidth={2} />
          <Line type="monotone" dataKey="mentalRecovery" name="Rec. mentale" stroke="#2f6fbb" strokeWidth={2} />
          <Line type="monotone" dataKey="stress" name="Stress" stroke="#c94f4f" strokeWidth={2} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function NutritionChart({ data }: { data: DashboardPayload | null }) {
  const ticks = chartTicks(data);
  const label = data?.period === 'month' ? 'mese calendario' : 'settimana calendario';
  return (
    <div className="chart-card chart-with-caption">
      <p className="chart-caption chart-caption-top">Vista grafico: {label}</p>
      <ResponsiveContainer width="100%" height={230}>
        <AreaChart data={data?.series ?? []}>
          <CartesianGrid strokeDasharray="3 3" stroke="#d9dfd8" />
          <XAxis dataKey="date" ticks={ticks} tickFormatter={formatChartDate} tick={{ fontSize: 11 }} interval={0} />
          <YAxis tick={{ fontSize: 11 }} />
          <Tooltip />
          <Area type="monotone" dataKey="caloriesIn" name="Kcal" stroke="#8b6f36" fill="#e9d7a7" />
          <Area type="monotone" dataKey="caloriesBurned" name="Kcal bruciate" stroke="#c94f4f" fill="#efc0b4" />
          <Area type="monotone" dataKey="steps" name="Passi" stroke="#436e75" fill="#b6d5d8" />
        </AreaChart>
      </ResponsiveContainer>
      <p className="chart-caption">Traccia kcal consumate, kcal bruciate e passi. I macro sono nei riquadri in alto e nel form Nutrizione.</p>
    </div>
  );
}

function AiMessageContent({ message }: { message: AiChatMessage }) {
  if (message.role === 'user') return <>{message.content}</>;
  const blocks = message.content
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  return (
    <div className="ai-rich-text">
      {blocks.map((line, index) => {
        const clean = line.replace(/^[-*]\s+/, '').replace(/^#{1,4}\s*/, '').replace(/^\*\*(.+)\*\*:?$/, '$1');
        const isHeading = /^#{1,4}\s/.test(line) || /^\*\*.+\*\*:?$/.test(line);
        const isList = /^[-*]\s+/.test(line) || /^\d+\.\s+/.test(line);
        return (
          <p className={isHeading ? 'ai-rich-heading' : isList ? 'ai-rich-list' : undefined} key={`${index}-${line}`}>
            {renderAiInline(clean.replace(/^\d+\.\s+/, ''))}
          </p>
        );
      })}
    </div>
  );
}

function renderAiInline(text: string) {
  const parts = text.split(/(`?wiki\/[^\s`),.]+(?:\.md)?`?)/g);
  return parts.map((part, index) => {
    const clean = part.replace(/`/g, '');
    if (/^wiki\//.test(clean)) {
      return (
        <span className="ai-file-pill" key={`${clean}-${index}`}>
          {clean}
        </span>
      );
    }
    return <span key={`${part}-${index}`}>{part.replace(/\*\*/g, '')}</span>;
  });
}

function AiClarificationList({
  clarifications,
  onChoose,
  onCancel
}: {
  clarifications: AiClarification[];
  onChoose: (clarification: AiClarification, proposal: AiWriteProposal) => void;
  onCancel: (clarification: AiClarification) => void;
}) {
  return (
    <div className="ai-clarifications">
      {clarifications.map((clarification) => (
        <article className="ai-clarification-card" key={clarification.id}>
          <div className="ai-clarification-copy">
            <span>Chiarimento</span>
            <strong>{clarification.question}</strong>
          </div>
          <div className="ai-clarification-options">
            {clarification.options.map((option) => (
              <button key={option.label} type="button" onClick={() => onChoose(clarification, option.proposal)}>
                <strong>{option.label}</strong>
                <small>{option.description}</small>
              </button>
            ))}
          </div>
          <button className="ghost-button" type="button" onClick={() => onCancel(clarification)}>
            Annulla
          </button>
        </article>
      ))}
    </div>
  );
}

function AiProposalList({
  proposals,
  onApply,
  onCancel
}: {
  proposals: AiWriteProposal[];
  onApply: (proposal: AiWriteProposal) => Promise<void>;
  onCancel: (proposal: AiWriteProposal) => void;
}) {
  return (
    <div className="ai-proposals">
      {proposals.map((proposal) => (
        <article className="ai-proposal-card" key={proposal.id}>
          <div>
            <span>Proposta Auditor</span>
            <strong>{proposal.title}</strong>
            <p>{proposal.targetFile}</p>
            <div className="ai-proposal-fields">
              {Object.entries(proposal.fields).map(([key, value]) => (
                <code key={key}>
                  {key}: {String(value)}
                </code>
              ))}
            </div>
          </div>
          <div className="ai-proposal-actions">
            <button className="ghost-button" type="button" onClick={() => onCancel(proposal)}>
              Annulla
            </button>
            <button className="save-button" type="button" onClick={() => onApply(proposal)}>
              Applica
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}

function AiThinking({ seconds }: { seconds: number }) {
  return (
    <article className="ai-message assistant ai-thinking" aria-live="polite">
      <div className="neural-loader" aria-hidden="true">
        <span className="node node-a" />
        <span className="node node-b" />
        <span className="node node-c" />
        <span className="node node-d" />
        <span className="node node-e" />
        <span className="node node-f" />
        <span className="link link-ab" />
        <span className="link link-bc" />
        <span className="link link-bd" />
        <span className="link link-ce" />
        <span className="link link-df" />
      </div>
      <div>
        <strong>Ragiono sui dati locali</strong>
        <span>Consulto la wiki e preparo una risposta utile...</span>
        <small>{seconds}s</small>
      </div>
    </article>
  );
}

function CoachPanel({ coach }: { coach: CoachPayload | null }) {
  if (!coach) {
    return (
      <article className="coach-panel">
        <p className="empty">Caricamento coach reattivo...</p>
      </article>
    );
  }

  const primary = coach.insights[0];
  const targets = [
    [
      'Proteine',
      coach.targets.proteinMin && coach.targets.proteinMax
        ? `${coach.targets.proteinMin}-${coach.targets.proteinMax} g`
        : '--'
    ],
    [
      'Kcal',
      coach.targets.calorieTargetMin && coach.targets.calorieTargetMax
        ? `${coach.targets.calorieTargetMin}-${coach.targets.calorieTargetMax}`
        : '--'
    ],
    ['Passi', String(coach.targets.steps)]
  ];
  const scoreTone = readinessTone(coach.readiness);

  return (
    <article className="coach-panel">
      <header className="coach-header">
        <div>
          <p className="eyebrow">Coach reattivo</p>
          <h2>{primary?.title ?? 'Dati da completare'}</h2>
          <p>{coach.summary}</p>
        </div>
        <div className={`coach-score ${scoreTone}`}>
          <span>Readiness</span>
          <strong>{coach.readiness ?? '--'}</strong>
        </div>
      </header>

      <div className="coach-targets">
        {targets.map(([label, value]) => (
          <div key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>

      <section className={`coach-plan ${coach.plan.status}`}>
        <div className="coach-plan-main">
          <span>Pianificazione dinamica</span>
          <h3>{coach.plan.nextWorkout}</h3>
          <p>{coach.plan.today}</p>
        </div>
        <div className="coach-plan-pillars" aria-label="Pilastri PPL">
          {coach.plan.pillars.map((pillar) => (
            <div className={pillar.done ? 'done' : ''} key={pillar.name}>
              <span>{pillar.name}</span>
              <strong>{pillar.done ? 'Fatto' : 'Da fare'}</strong>
              <small>{pillar.lastDate ?? '--'}</small>
            </div>
          ))}
        </div>
        <div className="coach-plan-rules">
          <p>{coach.plan.reason}</p>
          {coach.plan.adjustments.length > 0 && (
            <ul>
              {coach.plan.adjustments.slice(0, 3).map((adjustment) => (
                <li key={adjustment}>{adjustment}</li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <div className="coach-insights">
        {coach.insights.map((insight) => (
          <section className={`coach-insight ${insight.tone}`} key={insight.id}>
            <div className="coach-insight-icon">
              {insight.tone === 'risk' ? <AlertTriangle size={18} /> : insight.category === 'progression' ? <TrendingUp size={18} /> : <Bot size={18} />}
            </div>
            <div>
              <div className="coach-insight-title">
                <span>{categoryLabel(insight.category)}</span>
                {insight.metric && <small>{insight.metric}</small>}
              </div>
              <h3>{insight.title}</h3>
              <p>{insight.message}</p>
              <strong>{insight.action}</strong>
            </div>
          </section>
        ))}
      </div>
    </article>
  );
}

function MetricStrip({ data }: { data: DashboardPayload | null }) {
  const periodValue = (averageKey: string, dayValue: number | null | undefined) =>
    data?.period === 'day' ? dayValue : data?.averages[averageKey];
  const items = [
    ['Peso', periodValue('weight', data?.measurement?.weight), 'kg'],
    ['Kcal', periodValue('caloriesIn', data?.macro?.caloriesIn), ''],
    ['Proteine', periodValue('protein', data?.macro?.protein), 'g'],
    ['Carboidrati', periodValue('carbs', data?.macro?.carbs), 'g'],
    ['Grassi', periodValue('fat', data?.macro?.fat), 'g'],
    ['Sonno', periodValue('sleepHours', data?.daily?.sleepHours), 'h'],
    ['Passi', periodValue('steps', data?.daily?.steps), '']
  ];

  return (
    <article className="metric-strip">
      {items.map(([label, value, suffix]) => (
        <div className="metric-tile" key={label}>
          <span>{label}</span>
          <strong>{display(value as number | null)}</strong>
          <small>{suffix}</small>
        </div>
      ))}
    </article>
  );
}

function categoryLabel(category: CoachPayload['insights'][number]['category']): string {
  const labels: Record<CoachPayload['insights'][number]['category'], string> = {
    readiness: 'Readiness',
    nutrition: 'Nutrizione',
    progression: 'Carichi',
    planning: 'Programma',
    recovery: 'Recupero',
    data: 'Dati'
  };
  return labels[category];
}

function readinessTone(readiness: number | null): CoachPayload['insights'][number]['tone'] {
  if (readiness === null) return 'watch';
  if (readiness < 60) return 'risk';
  if (readiness < 78) return 'watch';
  return 'good';
}

function setProgramNote(notes: string, workout: DailyPlanWorkout): string {
  const cleaned = notes
    .split(/\s+-\s+/)
    .map((part) => part.trim())
    .filter((part) => part && !/^PROGRAMMA:/i.test(part));
  return [...cleaned, `PROGRAMMA: ${workout}`].join(' - ');
}

function OverviewPanel({ data }: { data: DashboardPayload | null }) {
  const periodValue = (averageKey: string, dayValue: number | null | undefined) =>
    data?.period === 'day' ? dayValue : data?.averages[averageKey];
  const workouts = data?.period === 'day' ? (data.workout ? [data.workout] : []) : (data?.workouts ?? []);
  const football = data?.period === 'day' ? (data?.football ?? []) : (data?.footballActivities ?? []);

  const items = [
    ['Recupero fisico', periodValue('physicalRecovery', data?.daily?.physicalRecovery), '/100'],
    ['Recupero mentale', periodValue('mentalRecovery', data?.daily?.mentalRecovery), '/100'],
    ['Stress', periodValue('stress', data?.daily?.stress), '/100'],
    ['Qualita sonno', periodValue('sleepQuality', data?.daily?.sleepQuality), '/100'],
    ['FC riposo', periodValue('restingHeartRate', data?.daily?.restingHeartRate), 'bpm'],
    ['Kcal bruciate', periodValue('caloriesBurned', data?.macro?.caloriesBurned), ''],
    ['Workout', workouts.length, ''],
    ['Calcio', football.length, '']
  ];

  return (
    <article className="overview-panel">
      {items.map(([label, value, suffix]) => (
        <div className="overview-item" key={label}>
          <span>{label}</span>
          <strong>{display(value as number | null)}</strong>
          <small>{suffix}</small>
        </div>
      ))}
    </article>
  );
}

function FootballForm({
  form,
  onChange,
  onSubmit,
  onNew
}: {
  form: FootballEntry;
  onChange: React.Dispatch<React.SetStateAction<FootballEntry>>;
  onSubmit: (event: React.FormEvent) => void;
  onNew: () => void;
}) {
  return (
    <form className="form-grid" onSubmit={onSubmit}>
      <div className="form-actions wide">
        <button className="ghost-button" type="button" onClick={onNew}>
          <Plus size={16} />
          Nuova attivita
        </button>
      </div>
      <label className="field">
        <span>Tipo calcio</span>
        <select
          value={form.kind}
          onChange={(event) => onChange((current) => ({ ...current, kind: event.target.value as FootballEntry['kind'] }))}
        >
          <option value="partita">Partita</option>
          <option value="allenamento">Allenamento calcio</option>
        </select>
      </label>
      <TextField
        label="Nome attivita"
        value={form.label}
        onChange={(value) => onChange((current) => ({ ...current, label: value }))}
      />
      <NumberField
        label="Tempo (min)"
        value={form.durationMin}
        onChange={(value) => onChange((current) => ({ ...current, durationMin: value }))}
      />
      <TextField
        label="Ritmo medio"
        value={form.avgPace}
        onChange={(value) => onChange((current) => ({ ...current, avgPace: value }))}
      />
      <NumberField
        label="FC media"
        value={form.avgHeartRate}
        onChange={(value) => onChange((current) => ({ ...current, avgHeartRate: value }))}
      />
      <NumberField
        label="Kcal bruciate"
        value={form.calories}
        onChange={(value) => onChange((current) => ({ ...current, calories: value }))}
      />
      <NumberField
        label="Carico allenamento"
        value={form.trainingLoad}
        onChange={(value) => onChange((current) => ({ ...current, trainingLoad: value }))}
      />
      <NumberField
        label="Cadenza media"
        value={form.cadenceAvg}
        onChange={(value) => onChange((current) => ({ ...current, cadenceAvg: value }))}
      />
      <NumberField
        label="Cadenza max"
        value={form.cadenceMax}
        onChange={(value) => onChange((current) => ({ ...current, cadenceMax: value }))}
      />
      <NumberField
        label="Falcata media"
        value={form.strideAvg}
        onChange={(value) => onChange((current) => ({ ...current, strideAvg: value }))}
      />
      <NumberField
        label="Falcata max"
        value={form.strideMax}
        onChange={(value) => onChange((current) => ({ ...current, strideMax: value }))}
      />
      <label className="wide field">
        <span>Note calcio</span>
        <textarea value={form.notes} onChange={(event) => onChange((current) => ({ ...current, notes: event.target.value }))} />
      </label>
      <button className="save-button wide" type="submit">
        <Save size={17} />
        Salva attivita
      </button>
    </form>
  );
}

function TrainingInput({
  type,
  onTypeChange,
  footballForm,
  workoutForm,
  presets,
  onFootballChange,
  onWorkoutChange,
  onFootballSubmit,
  onWorkoutSubmit,
  onNewFootball,
  onNewWorkout
}: {
  type: 'calcio' | 'workout';
  onTypeChange: (type: 'calcio' | 'workout') => void;
  footballForm: FootballEntry;
  workoutForm: WorkoutEntry;
  presets: WikiDataPayload['presets'];
  onFootballChange: React.Dispatch<React.SetStateAction<FootballEntry>>;
  onWorkoutChange: React.Dispatch<React.SetStateAction<WorkoutEntry>>;
  onFootballSubmit: (event: React.FormEvent) => void;
  onWorkoutSubmit: (event: React.FormEvent) => void;
  onNewFootball: () => void;
  onNewWorkout: () => void;
}) {
  return (
    <div className="training-input">
      <div className="type-switch">
        <button className={type === 'calcio' ? 'active' : ''} type="button" onClick={() => onTypeChange('calcio')}>
          Calcio
        </button>
        <button className={type === 'workout' ? 'active' : ''} type="button" onClick={() => onTypeChange('workout')}>
          Workout
        </button>
      </div>
      {type === 'calcio' ? (
        <FootballForm form={footballForm} onChange={onFootballChange} onSubmit={onFootballSubmit} onNew={onNewFootball} />
      ) : (
        <WorkoutForm
          form={workoutForm}
          presets={presets}
          onChange={onWorkoutChange}
          onSubmit={onWorkoutSubmit}
          onNew={onNewWorkout}
        />
      )}
    </div>
  );
}

function WorkoutForm({
  form,
  presets,
  onChange,
  onSubmit,
  onNew
}: {
  form: WorkoutEntry;
  presets: WikiDataPayload['presets'];
  onChange: React.Dispatch<React.SetStateAction<WorkoutEntry>>;
  onSubmit: (event: React.FormEvent) => void;
  onNew: () => void;
}) {
  const updateExercise = (index: number, key: keyof WorkoutEntry['exercises'][number], value: string | number | null) => {
    onChange((current) => ({
      ...current,
      exercises: current.exercises.map((exercise, currentIndex) =>
        currentIndex === index ? { ...exercise, [key]: value } : exercise
      )
    }));
  };

  return (
    <form className="workout-form" onSubmit={onSubmit}>
      <div className="form-actions wide">
        <button className="ghost-button" type="button" onClick={onNew}>
          <Plus size={16} />
          Nuovo workout
        </button>
      </div>
      <label className="field">
        <span>Preset</span>
        <select
          defaultValue=""
          onChange={(event) => {
            const preset = presets.find((item) => item.id === event.target.value);
            if (!preset) return;
            onChange((current) => ({
              ...current,
              title: preset.title,
              exercises: preset.exercises.map((exercise) => ({ ...exercise }))
            }));
          }}
        >
          <option value="">Seleziona preset</option>
          {presets.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.title}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Titolo workout</span>
        <input value={form.title} onChange={(event) => onChange((current) => ({ ...current, title: event.target.value }))} />
      </label>
      <div className="exercise-editor">
        {form.exercises.map((exercise, index) => (
          <div className="exercise-row" key={index}>
            <TextField label="Esercizio" value={exercise.exercise} onChange={(value) => updateExercise(index, 'exercise', value)} />
            <NumberField label="Set" value={exercise.sets} onChange={(value) => updateExercise(index, 'sets', value)} />
            <TextField label="Reps" value={exercise.reps} onChange={(value) => updateExercise(index, 'reps', value)} />
            <TextField label="Peso" value={exercise.weight} onChange={(value) => updateExercise(index, 'weight', value)} />
            <TextField label="RIR" value={exercise.rir} onChange={(value) => updateExercise(index, 'rir', value)} />
            <button
              className="ghost-button danger"
              type="button"
              onClick={() =>
                onChange((current) => ({
                  ...current,
                  exercises: current.exercises.filter((_, currentIndex) => currentIndex !== index)
                }))
              }
            >
              Elimina
            </button>
          </div>
        ))}
      </div>
      <button
        className="ghost-button"
        type="button"
        onClick={() =>
          onChange((current) => ({
            ...current,
            exercises: [...current.exercises, { exercise: '', sets: 3, reps: '', weight: '', rir: '', notes: '' }]
          }))
        }
      >
        <Plus size={16} />
        Aggiungi esercizio
      </button>
      <button className="save-button" type="submit">
        <Save size={17} />
        Salva workout
      </button>
    </form>
  );
}

function RecordForm({
  form,
  onChange,
  onSubmit
}: {
  form: RecordEntry;
  onChange: React.Dispatch<React.SetStateAction<RecordEntry>>;
  onSubmit: (event: React.FormEvent) => void;
}) {
  return (
    <form className="form-grid" onSubmit={onSubmit}>
      <label className="field">
        <span>Categoria</span>
        <select
          value={form.category}
          onChange={(event) => onChange((current) => ({ ...current, category: event.target.value as RecordEntry['category'] }))}
        >
          <option value="workout">Workout</option>
          <option value="calcio">Calcio</option>
          <option value="corpo libero">Corpo libero</option>
          <option value="pesi">Pesi</option>
          <option value="core">Core</option>
          <option value="altro">Altro</option>
        </select>
      </label>
      <TextField
        label="Disciplina"
        value={form.discipline}
        onChange={(value) => onChange((current) => ({ ...current, discipline: value }))}
      />
      <TextField
        label="Record"
        value={form.name}
        onChange={(value) => onChange((current) => ({ ...current, name: value }))}
      />
      <TextField
        label="Valore completo"
        value={form.value}
        onChange={(value) => onChange((current) => ({ ...current, value }))}
      />
      <TextField
        label="Contesto"
        value={form.context}
        onChange={(value) => onChange((current) => ({ ...current, context: value }))}
      />
      <label className="wide field">
        <span>Note</span>
        <textarea value={form.notes} onChange={(event) => onChange((current) => ({ ...current, notes: event.target.value }))} />
      </label>
      <button className="save-button wide" type="submit">
        <Save size={17} />
        Salva record
      </button>
    </form>
  );
}

function RecordList({
  records,
  onEdit,
  onDelete
}: {
  records: RecordEntry[];
  onEdit: (entry: RecordEntry) => void;
  onDelete: (id: string) => void;
}) {
  if (records.length === 0) {
    return <p className="empty">Nessun record registrato.</p>;
  }

  return (
    <div className="record-list">
      {records.map((record) => (
        <article className="record-card" key={`${record.date}-${record.category}-${record.name}-${record.value}`}>
          <div>
            <span className="workout-date">{record.date}</span>
            <h3>{record.name}</h3>
            <p>
              {record.category} {record.discipline ? `- ${record.discipline}` : ''} - {record.value}{' '}
              {record.unit}
            </p>
            {(record.context || record.notes) && <p>{[record.context, record.notes].filter(Boolean).join(' - ')}</p>}
          </div>
          <button className="ghost-button" onClick={() => onEdit(record)}>
            Modifica
          </button>
          <button className="ghost-button danger" onClick={() => onDelete(record.id)}>
            Elimina
          </button>
        </article>
      ))}
    </div>
  );
}

function TrainingPanel({
  data,
  openWorkoutDate,
  onToggleWorkout,
  onEditFootball,
  onEditWorkout
}: {
  data: DashboardPayload | null;
  openWorkoutDate: string | null;
  onToggleWorkout: (date: string) => void;
  onEditFootball: (entry: FootballEntry) => void;
  onEditWorkout: (entry: WorkoutEntry) => void;
}) {
  if (!data) {
    return <p className="empty">Caricamento allenamenti...</p>;
  }
  const workouts = data.period === 'day' ? (data.workout ? [data.workout] : []) : data.workouts;
  const football = data.period === 'day' ? data.football : data.footballActivities;

  return (
    <div className="training-stack">
      <section>
        <h3 className="subsection-title">Workout</h3>
        <WorkoutPanel
          workouts={workouts}
          data={data}
          openWorkoutDate={openWorkoutDate}
          onToggle={onToggleWorkout}
          onEdit={onEditWorkout}
        />
      </section>
      <section>
        <h3 className="subsection-title">Calcio</h3>
        <FootballList entries={football} onEdit={onEditFootball} />
      </section>
    </div>
  );
}

function WorkoutPanel({
  workouts,
  data,
  openWorkoutDate,
  onToggle,
  onEdit
}: {
  workouts: WorkoutEntry[];
  data: DashboardPayload;
  openWorkoutDate: string | null;
  onToggle: (date: string) => void;
  onEdit: (entry: WorkoutEntry) => void;
}) {
  if (workouts.length === 0) {
    return (
      <p className="empty">
        {data.period === 'day'
          ? 'Nessun workout registrato per questo giorno.'
          : 'Nessun workout registrato nel periodo selezionato.'}
      </p>
    );
  }

  return (
    <div className="workout-list">
      {data.period !== 'day' && (
        <p className="period-note">
          {workouts.length} workout tra {data.range.from} e {data.range.to}
        </p>
      )}
      {workouts.map((workout) => (
        <div className="workout-summary" key={`${workout.date}-${workout.title}`}>
          <div>
            <span className="workout-date">{workout.date}</span>
            <h3>{workout.title}</h3>
            <p>
              {workout.exercises.length} esercizi - volume reps {display(workout.volume)} - RIR medio{' '}
              {display(workout.averageRir)}
            </p>
          </div>
          <button className="ghost-button" onClick={() => onToggle(workout.date)}>
            {openWorkoutDate === workout.date ? 'Nascondi dettagli' : 'Vedi dettagli'}
          </button>
          <button className="ghost-button" onClick={() => onEdit(workout)}>
            Modifica
          </button>
          {openWorkoutDate === workout.date && <WorkoutTable workout={workout} />}
        </div>
      ))}
    </div>
  );
}

function FootballList({ entries, onEdit }: { entries: FootballEntry[]; onEdit: (entry: FootballEntry) => void }) {
  if (entries.length === 0) {
    return <p className="empty">Nessuna attivita calcio registrata.</p>;
  }

  return (
    <div className="football-list">
      {entries.map((entry) => (
        <article className="football-card" key={`${entry.date}-${entry.kind}-${entry.label}`}>
          <div>
            <span className="workout-date">{entry.date}</span>
            <h3>{entry.label || (entry.kind === 'partita' ? 'Partita' : 'Allenamento')}</h3>
            <p>
              {entry.kind} - {display(entry.durationMin)} min - FC {display(entry.avgHeartRate)} - kcal{' '}
              {display(entry.calories)}
            </p>
            <p>
              Ritmo {entry.avgPace || '--'} - carico {display(entry.trainingLoad)} - cadenza{' '}
              {display(entry.cadenceAvg)}/{display(entry.cadenceMax)} - falcata {display(entry.strideAvg)}/
              {display(entry.strideMax)}
            </p>
          </div>
          <button className="ghost-button" onClick={() => onEdit(entry)}>
            Modifica
          </button>
        </article>
      ))}
    </div>
  );
}

function WorkoutTable({ workout }: { workout: WorkoutEntry }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Esercizio</th>
            <th>Serie</th>
            <th>Reps</th>
            <th>Peso</th>
            <th>RIR</th>
          </tr>
        </thead>
        <tbody>
          {workout.exercises.map((exercise) => (
            <tr key={exercise.exercise}>
              <td>{exercise.exercise}</td>
              <td>{display(exercise.sets)}</td>
              <td>{exercise.reps}</td>
              <td>{exercise.weight}</td>
              <td>{exercise.rir}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Panel({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="panel">
      <div className="panel-title">
        {icon}
        <h2>{title}</h2>
      </div>
      {children}
    </section>
  );
}

function NumberField({
  label,
  value,
  onChange,
  min,
  max
}: {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
  min?: number;
  max?: number;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value === '' ? null : Number(event.target.value))}
      />
    </label>
  );
}

function TextField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function parseProgressionStatus(status: string): {
  current: string;
  rir: string;
  decision: string;
  tone: 'increase' | 'hold' | 'reduce';
} {
  const [currentRaw, decisionRaw] = status.split('->').map((part) => part.trim());
  const rir = currentRaw.match(/RIR\s*([^,]+)/i)?.[1]?.trim() ?? '--';
  const current = currentRaw.replace(/,\s*RIR\s*[^,]+/i, '').trim() || status;
  const decision = decisionRaw || 'valuta';
  const lower = decision.toLowerCase();
  const tone = /aument|sali|increment/i.test(lower)
    ? 'increase'
    : /deload|scaric|riduc|stop/i.test(lower)
      ? 'reduce'
      : 'hold';
  return { current, rir, decision, tone };
}

function buildProgressionStatus(current: string, rir: string, decision: string): string {
  return `${current.trim()}${rir.trim() ? `, RIR ${rir.trim()}` : ''} -> ${decision.trim() || 'mantieni'}`;
}

function chartTicks(data: DashboardPayload | null): string[] {
  const dates = data?.series.map((row) => row.date) ?? [];
  if (dates.length <= 8) return dates;
  const step = data?.period === 'month' ? 5 : 2;
  const ticks = dates.filter((_, index) => index % step === 0);
  const last = dates.at(-1);
  return last && !ticks.includes(last) ? [...ticks, last] : ticks;
}

function formatChartDate(value: string): string {
  const [, month, day] = value.split('-');
  return `${day}/${month}`;
}

function display(value: number | null | undefined): string {
  return value === null || value === undefined ? '--' : String(value);
}
